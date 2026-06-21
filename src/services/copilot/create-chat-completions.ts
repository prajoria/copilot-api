import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

// Raw (unescaped) ASCII control characters other than tab/newline/carriage
// return. Terminal output that gets captured into tool inputs/results commonly
// carries ANSI escape sequences (ESC = 0x1b) plus other control bytes.
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

const stripControlChars = (value: string): string =>
  value.replace(CONTROL_CHARS_RE, "")

const sanitizeMessageContent = (
  content: Message["content"],
): Message["content"] => {
  if (typeof content === "string") {
    return stripControlChars(content)
  }
  if (Array.isArray(content)) {
    return content.map((part) =>
      part.type === "text" ? { ...part, text: stripControlChars(part.text) } : (
        part
      ),
    )
  }
  return content
}

// Copilot's upstream JSON parser rejects raw control characters inside a
// tool_call's `arguments`, which is itself a JSON string nested within the
// request JSON. A raw control byte that survives one level of unescaping
// becomes illegal in that inner JSON, yielding HTTP 400:
//   { code: "invalid_tool_call_format",
//     message: "Invalid JSON format in tool call arguments" }
// Strip control characters from outgoing tool_call arguments and text content
// before forwarding. This is a no-op for already well-formed payloads (where
// control characters are present only as escaped \u00XX sequences).
const sanitizeMessages = (messages: Array<Message>): Array<Message> =>
  messages.map((message) => {
    const sanitized: Message = {
      ...message,
      content: sanitizeMessageContent(message.content),
    }
    if (message.tool_calls) {
      sanitized.tool_calls = message.tool_calls.map((call) => ({
        ...call,
        function: {
          ...call.function,
          arguments: stripControlChars(call.function.arguments),
        },
      }))
    }
    return sanitized
  })

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  // Guard against assistant-message prefill. Some Copilot-hosted models
  // (current Claude Sonnet/Opus, GPT-5 variants) reject requests whose last
  // message is an assistant turn with:
  //   "This model does not support assistant message prefill.
  //    The conversation must end with a user message."
  // Anthropic-style clients routinely send a trailing assistant message as a
  // prefill. When that happens, append a minimal user continuation so the
  // request is accepted upstream; the prefilled assistant text stays in
  // context. We only do this for plain assistant text (no tool_calls), since
  // an assistant turn carrying tool_calls would normally be followed by a
  // tool-result message and is a different shape entirely.
  const lastMessage = payload.messages.at(-1)
  const needsUserContinuation =
    lastMessage?.role === "assistant" && !lastMessage.tool_calls?.length
  const continuedPayload: ChatCompletionsPayload =
    needsUserContinuation ?
      {
        ...payload,
        messages: [
          ...payload.messages,
          { role: "user", content: "Continue." },
        ],
      }
    : payload
  if (needsUserContinuation) {
    consola.debug(
      "Trailing assistant prefill detected — appending synthetic user continuation",
    )
  }

  // Strip raw control characters from tool_call arguments and text content so
  // Copilot's strict upstream JSON parser does not reject the request with
  // "Invalid JSON format in tool call arguments" (HTTP 400). No-op for clean
  // payloads.
  const effectivePayload: ChatCompletionsPayload = {
    ...continuedPayload,
    messages: sanitizeMessages(continuedPayload.messages),
  }

  const enableVision = effectivePayload.messages.some(
    (x) =>
      typeof x.content !== "string"
      && x.content?.some((x) => x.type === "image_url"),
  )

  // Agent/user check for X-Initiator header
  // Determine if any message is from an agent ("assistant" or "tool")
  const isAgentCall = effectivePayload.messages.some((msg) =>
    ["assistant", "tool"].includes(msg.role),
  )

  // Build headers and add X-Initiator
  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  // Surface the exact model id sent upstream. Both the OpenAI and the
  // Anthropic (Claude Code) routes funnel through here after any
  // COPILOT_API_FORCE_MODEL override is applied, so this is the single source
  // of truth for "which model is actually talking" — clients like Claude Code
  // do not always show it.
  consola.info(
    `Using model: ${effectivePayload.model} (initiator: ${isAgentCall ? "agent" : "user"}, stream: ${Boolean(effectivePayload.stream)})`,
  )

  const response = await fetch(`${copilotBaseUrl(state)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(effectivePayload),
  })

  if (!response.ok) {
    // Read the upstream body from a clone so the real failure reason is
    // visible immediately. Logging the bare Response only prints an
    // unconsumed ReadableStream, hiding why Copilot rejected the request.
    // The original `response` is left intact for `forwardError` downstream.
    const errorBody = await response.clone().text()
    consola.error("Failed to create chat completions", {
      status: response.status,
      statusText: response.statusText,
      body: errorBody,
    })
    throw new HTTPError("Failed to create chat completions", response)
  }

  if (effectivePayload.stream) {
    return events(response)
  }

  return (await response.json()) as ChatCompletionResponse
}

// Streaming types

export interface ChatCompletionChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<Choice>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
    completion_tokens_details?: {
      accepted_prediction_tokens: number
      rejected_prediction_tokens: number
    }
  }
}

interface Delta {
  content?: string | null
  role?: "user" | "assistant" | "system" | "tool"
  tool_calls?: Array<{
    index: number
    id?: string
    type?: "function"
    function?: {
      name?: string
      arguments?: string
    }
  }>
}

interface Choice {
  index: number
  delta: Delta
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  logprobs: object | null
}

// Non-streaming types

export interface ChatCompletionResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<ChoiceNonStreaming>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
  }
}

interface ResponseMessage {
  role: "assistant"
  content: string | null
  tool_calls?: Array<ToolCall>
}

interface ChoiceNonStreaming {
  index: number
  message: ResponseMessage
  logprobs: object | null
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
}

// Payload types

export interface ChatCompletionsPayload {
  messages: Array<Message>
  model: string
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  stop?: string | Array<string> | null
  n?: number | null
  stream?: boolean | null

  frequency_penalty?: number | null
  presence_penalty?: number | null
  logit_bias?: Record<string, number> | null
  logprobs?: boolean | null
  response_format?: { type: "json_object" } | null
  seed?: number | null
  tools?: Array<Tool> | null
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null
  user?: string | null
}

export interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool" | "developer"
  content: string | Array<ContentPart> | null

  name?: string
  tool_calls?: Array<ToolCall>
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export type ContentPart = TextPart | ImagePart

export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image_url"
  image_url: {
    url: string
    detail?: "low" | "high" | "auto"
  }
}
