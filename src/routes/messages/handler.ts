import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { parseJsonBody } from "~/lib/json"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createChatCompletions,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"

import { type AnthropicMessagesPayload } from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateOpenAIEventStream } from "./stream-translation"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = parseJsonBody<AnthropicMessagesPayload>(
    await c.req.text(),
  )
  consola.debug("Anthropic request received", {
    messageCount: anthropicPayload.messages.length,
    stream: Boolean(anthropicPayload.stream),
  })

  const openAIPayload = translateToOpenAI(anthropicPayload)

  if (state.manualApprove) {
    await awaitApproval()
  }

  const response = await createChatCompletions(openAIPayload)

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming Anthropic response received")
    const anthropicResponse = translateToAnthropic(response)
    return c.json(anthropicResponse)
  }

  consola.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    for await (const event of translateOpenAIEventStream(response)) {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      })
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")
