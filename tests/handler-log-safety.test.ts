import { expect, mock, spyOn, test } from "bun:test"
import consola from "consola"
import { Hono } from "hono"

import { state } from "~/lib/state"
import { handleCompletion as handleChatCompletion } from "~/routes/chat-completions/handler"
import { handleCompletion as handleAnthropicCompletion } from "~/routes/messages/handler"

const secretPrompt = "SENTINEL_PRIVATE_PROMPT"
const secretCompletion = "SENTINEL_PRIVATE_COMPLETION"

const completionResponse = {
  id: "chatcmpl-log-safety",
  object: "chat.completion",
  created: 1,
  model: "safe-model",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: secretCompletion },
      finish_reason: "stop",
      logprobs: null,
    },
  ],
  usage: {
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2,
  },
}

const streamingResponse = [
  `data: ${JSON.stringify({
    id: "chatcmpl-log-safety",
    object: "chat.completion.chunk",
    created: 1,
    model: "safe-model",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: secretCompletion },
        finish_reason: null,
      },
    ],
  })}`,
  "",
  "data: [DONE]",
  "",
].join("\n")

const captureLogs = async (operation: () => Promise<void>): Promise<string> => {
  const spies = [
    spyOn(consola, "debug"),
    spyOn(consola, "info"),
    spyOn(consola, "warn"),
    spyOn(consola, "error"),
  ]
  consola.pauseLogs()
  try {
    await operation()
    return JSON.stringify(spies.flatMap((spy) => spy.mock.calls))
  } finally {
    consola.resumeLogs()
    for (const spy of spies) spy.mockRestore()
  }
}

const setFetchResponse = (response: Response): (() => void) => {
  const originalFetch = globalThis.fetch
  const fetchMock = mock(() => Promise.resolve(response))
  // @ts-expect-error - test fetch does not implement Bun's preconnect property
  globalThis.fetch = fetchMock
  return () => {
    globalThis.fetch = originalFetch
  }
}

test("OpenAI routes never log request or response content", async () => {
  state.copilotToken = "test-token"
  state.models = undefined
  const app = new Hono().post("/", handleChatCompletion)

  for (const stream of [false, true]) {
    const restoreFetch = setFetchResponse(
      stream ?
        new Response(streamingResponse, {
          headers: { "content-type": "text/event-stream" },
        })
      : new Response(JSON.stringify(completionResponse), {
          headers: { "content-type": "application/json" },
        }),
    )
    try {
      const logs = await captureLogs(async () => {
        const response = await app.request("/", {
          method: "POST",
          body: JSON.stringify({
            model: `unsafe\r\n${"m".repeat(200)}`,
            messages: [{ role: "user", content: secretPrompt }],
            stream,
          }),
        })
        await response.text()
      })
      expect(logs).not.toContain(secretPrompt)
      expect(logs).not.toContain(secretCompletion)
      expect(logs).not.toContain("unsafe\r\n")
    } finally {
      restoreFetch()
    }
  }
})

test("Anthropic routes never log request or response content", async () => {
  state.copilotToken = "test-token"
  state.models = undefined
  const app = new Hono().post("/", handleAnthropicCompletion)

  for (const stream of [false, true]) {
    const restoreFetch = setFetchResponse(
      stream ?
        new Response(streamingResponse, {
          headers: { "content-type": "text/event-stream" },
        })
      : new Response(JSON.stringify(completionResponse), {
          headers: { "content-type": "application/json" },
        }),
    )
    try {
      const logs = await captureLogs(async () => {
        const response = await app.request("/", {
          method: "POST",
          body: JSON.stringify({
            model: "safe-model",
            max_tokens: 32,
            messages: [{ role: "user", content: secretPrompt }],
            stream,
          }),
        })
        await response.text()
      })
      expect(logs).not.toContain(secretPrompt)
      expect(logs).not.toContain(secretCompletion)
    } finally {
      restoreFetch()
    }
  }
})
