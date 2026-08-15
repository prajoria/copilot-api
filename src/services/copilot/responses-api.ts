import type { ServerSentEventMessage } from "fetch-event-stream"

import type {
  ChatCompletionResponse,
  ChatCompletionsPayload,
  Message,
} from "./create-chat-completions"
import type { Model } from "./get-models"

export interface ResponsesStreamState {
  id: string
  created: number
  model: string
  done: boolean
  hasToolCalls: boolean
  nextToolCallIndex: number
  toolCallIndexes: Map<string, number>
}

export function createResponsesStreamState(): ResponsesStreamState {
  return {
    id: "",
    created: 0,
    model: "",
    done: false,
    hasToolCalls: false,
    nextToolCallIndex: 0,
    toolCallIndexes: new Map(),
  }
}

interface ResponsesUsage {
  input_tokens: number
  input_tokens_details?: { cached_tokens?: number }
  output_tokens: number
  total_tokens: number
}

interface ResponsesOutputText {
  type: "output_text"
  text: string
}

interface ResponsesMessageOutput {
  type: "message"
  role: "assistant"
  content: Array<ResponsesOutputText>
}

interface ResponsesFunctionCallOutput {
  type: "function_call"
  call_id: string
  name: string
  arguments: string
}

interface ResponsesResult {
  id: string
  object: "response"
  created_at: number
  model: string
  status: "completed" | "incomplete" | "failed"
  incomplete_details?: { reason?: string }
  error?: { code?: string; message?: string }
  output: Array<ResponsesMessageOutput | ResponsesFunctionCallOutput>
  usage?: ResponsesUsage
}

interface ResponsesStreamEvent {
  type?: string
  delta?: string
  item_id?: string
  output_index?: number
  item?: ResponsesFunctionCallOutput & { id?: string }
  response?: ResponsesResult
}

type FinishReason = "stop" | "length" | "tool_calls"

interface StreamMessageOptions {
  delta: Record<string, unknown>
  finishReason: FinishReason | null
  usage?: ChatCompletionResponse["usage"]
}

const isDefined = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined

function getFinishReason(
  hasToolCalls: boolean,
  status?: ResponsesResult["status"],
  incompleteReason?: string,
): FinishReason {
  if (hasToolCalls) return "tool_calls"
  if (status === "incomplete" && incompleteReason === "max_output_tokens") {
    return "length"
  }
  return "stop"
}

function toChatCompletionUsage(
  usage: ResponsesUsage | undefined,
): ChatCompletionResponse["usage"] {
  if (!usage) return undefined
  return {
    prompt_tokens: usage.input_tokens,
    completion_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    ...(usage.input_tokens_details?.cached_tokens !== undefined && {
      prompt_tokens_details: {
        cached_tokens: usage.input_tokens_details.cached_tokens,
      },
    }),
  }
}

function getToolCallIndex(
  payload: ResponsesStreamEvent,
  state: ResponsesStreamState,
): number | undefined {
  if (payload.item_id !== undefined) {
    const itemIndex = state.toolCallIndexes.get(payload.item_id)
    if (itemIndex !== undefined) return itemIndex
  }
  if (payload.output_index !== undefined) {
    return state.toolCallIndexes.get(`output:${payload.output_index}`)
  }
  return undefined
}

export function usesResponsesApi(model: Model | undefined): boolean {
  return model?.supported_endpoints?.includes("/responses") ?? false
}

export function toResponsesPayload(
  payload: ChatCompletionsPayload,
): Record<string, unknown> {
  return {
    model: payload.model,
    input: payload.messages.flatMap((message) =>
      toResponsesInputItems(message),
    ),
    stream: payload.stream ?? false,
    ...(isDefined(payload.max_tokens) && {
      max_output_tokens: payload.max_tokens,
    }),
    ...(isDefined(payload.temperature) && {
      temperature: payload.temperature,
    }),
    ...(isDefined(payload.top_p) && { top_p: payload.top_p }),
    ...(isDefined(payload.user) && { user: payload.user }),
    ...(payload.response_format && {
      text: { format: payload.response_format },
    }),
    ...(payload.tools && {
      tools: payload.tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        ...(tool.function.description !== undefined && {
          description: tool.function.description,
        }),
        parameters: tool.function.parameters,
      })),
    }),
    ...(isDefined(payload.tool_choice) && {
      tool_choice:
        typeof payload.tool_choice === "object" ?
          {
            type: "function",
            name: payload.tool_choice.function.name,
          }
        : payload.tool_choice,
    }),
  }
}

function toResponsesInputItems(
  message: Message,
): Array<Record<string, unknown>> {
  if (message.role === "tool") {
    return [
      {
        type: "function_call_output",
        call_id: message.tool_call_id,
        output:
          typeof message.content === "string" ?
            message.content
          : JSON.stringify(message.content),
      },
    ]
  }

  const items: Array<Record<string, unknown>> = []
  if (message.content !== null && message.content !== "") {
    items.push({
      role: message.role,
      content:
        typeof message.content === "string" ?
          message.content
        : message.content.map((part) =>
            part.type === "text" ?
              { type: "input_text", text: part.text }
            : {
                type: "input_image",
                image_url: part.image_url.url,
                ...(part.image_url.detail && {
                  detail: part.image_url.detail,
                }),
              },
          ),
    })
  }
  for (const toolCall of message.tool_calls ?? []) {
    items.push({
      type: "function_call",
      call_id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    })
  }
  return items
}

export function fromResponsesResult(
  response: ResponsesResult,
): ChatCompletionResponse {
  const content = response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .map((part) => part.text)
    .join("")
  const toolCalls = response.output
    .filter((item) => item.type === "function_call")
    .map((item) => ({
      id: item.call_id,
      type: "function" as const,
      function: { name: item.name, arguments: item.arguments },
    }))
  const finishReason = getFinishReason(
    toolCalls.length > 0,
    response.status,
    response.incomplete_details?.reason,
  )
  const usage = toChatCompletionUsage(response.usage)

  return {
    id: response.id,
    object: "chat.completion",
    created: response.created_at,
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        },
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
    ...(usage && { usage }),
  }
}

/* eslint-disable complexity -- maps the Responses API event state machine */

export function translateResponsesEvent(
  event: ServerSentEventMessage,
  state: ResponsesStreamState,
): Array<ServerSentEventMessage> {
  if (!event.data) return []
  if (event.data === "[DONE]") {
    if (state.done) return []
    state.done = true
    return [{ data: "[DONE]" }]
  }

  const payload = JSON.parse(event.data) as ResponsesStreamEvent
  if (payload.response) {
    state.id = payload.response.id
    state.created = payload.response.created_at
    state.model = payload.response.model
  }

  if (payload.type === "response.failed") {
    const code = payload.response?.error?.code ?? "response_failed"
    const message =
      payload.response?.error?.message ?? "The Responses API request failed"
    throw new Error(`${code}: ${message}`)
  }

  if (payload.type === "response.output_text.delta" && payload.delta) {
    return [
      toStreamMessage(state, {
        delta: { content: payload.delta },
        finishReason: null,
      }),
    ]
  }

  if (
    payload.type === "response.output_item.added"
    && payload.item?.type === "function_call"
  ) {
    const toolCallIndex = state.nextToolCallIndex++
    state.hasToolCalls = true
    if (payload.item.id) {
      state.toolCallIndexes.set(payload.item.id, toolCallIndex)
    }
    if (payload.output_index !== undefined) {
      state.toolCallIndexes.set(`output:${payload.output_index}`, toolCallIndex)
    }
    return [
      toStreamMessage(state, {
        delta: {
          tool_calls: [
            {
              index: toolCallIndex,
              id: payload.item.call_id,
              type: "function",
              function: {
                name: payload.item.name,
                arguments: payload.item.arguments,
              },
            },
          ],
        },
        finishReason: null,
      }),
    ]
  }

  if (
    payload.type === "response.function_call_arguments.delta"
    && payload.delta
  ) {
    const toolCallIndex = getToolCallIndex(payload, state)
    if (toolCallIndex === undefined) return []
    return [
      toStreamMessage(state, {
        delta: {
          tool_calls: [
            {
              index: toolCallIndex,
              function: { arguments: payload.delta },
            },
          ],
        },
        finishReason: null,
      }),
    ]
  }

  if (
    payload.type === "response.completed"
    || payload.type === "response.incomplete"
  ) {
    const response = payload.response
    const finishReason = getFinishReason(
      state.hasToolCalls,
      response?.status,
      response?.incomplete_details?.reason,
    )
    const usage = toChatCompletionUsage(response?.usage)
    state.done = true
    return [
      toStreamMessage(state, { delta: {}, finishReason, usage }),
      { data: "[DONE]" },
    ]
  }

  return []
}
/* eslint-enable complexity */

export async function* translateResponsesStream(
  source: AsyncIterable<ServerSentEventMessage>,
): AsyncGenerator<ServerSentEventMessage> {
  const streamState = createResponsesStreamState()
  for await (const event of source) {
    yield* translateResponsesEvent(event, streamState)
  }
}

function toStreamMessage(
  state: ResponsesStreamState,
  options: StreamMessageOptions,
): ServerSentEventMessage {
  return {
    data: JSON.stringify({
      id: state.id,
      object: "chat.completion.chunk",
      created: state.created,
      model: state.model,
      choices: [
        {
          index: 0,
          delta: options.delta,
          finish_reason: options.finishReason,
          logprobs: null,
        },
      ],
      ...(options.usage && { usage: options.usage }),
    }),
  }
}
