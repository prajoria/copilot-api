import { test, expect, mock } from "bun:test"

import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { HTTPError } from "../src/lib/error"
import { state } from "../src/lib/state"
import { createChatCompletions } from "../src/services/copilot/create-chat-completions"

// Mock state
state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"

// Helper to mock fetch
const fetchMock = mock(
  (
    _url: string,
    opts: { headers: Record<string, string>; body: string },
  ) => {
    return {
      ok: true,
      json: () => ({ id: "123", object: "chat.completion", choices: [] }),
      headers: opts.headers,
    }
  },
)
// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

test("sets X-Initiator to agent if tool/assistant present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", content: "tool call" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("agent")
})

test("sets X-Initiator to user if only user present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "user", content: "hello again" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls[1][1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("user")
})

test("appends synthetic user turn when last message is a plain assistant prefill", async () => {
  const callIndex = fetchMock.mock.calls.length
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "Sure, here is" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  const body = JSON.parse(
    (fetchMock.mock.calls[callIndex][1] as { body: string }).body,
  ) as ChatCompletionsPayload
  expect(body.messages.length).toBe(3)
  const last = body.messages.at(-1)
  expect(last?.role).toBe("user")
  expect(last?.content).toBe("Continue.")
})

test("does NOT append synthetic user turn when assistant message carries tool_calls", async () => {
  const callIndex = fetchMock.mock.calls.length
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "noop", arguments: "{}" },
          },
        ],
      },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  const body = JSON.parse(
    (fetchMock.mock.calls[callIndex][1] as { body: string }).body,
  ) as ChatCompletionsPayload
  expect(body.messages.length).toBe(2)
  expect(body.messages.at(-1)?.role).toBe("assistant")
})

test("does NOT modify payload when last message is already a user turn", async () => {
  const callIndex = fetchMock.mock.calls.length
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "assistant", content: "earlier reply" },
      { role: "user", content: "follow-up" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  const body = JSON.parse(
    (fetchMock.mock.calls[callIndex][1] as { body: string }).body,
  ) as ChatCompletionsPayload
  expect(body.messages.length).toBe(2)
  expect(body.messages.at(-1)?.role).toBe("user")
  expect(body.messages.at(-1)?.content).toBe("follow-up")
})

test("throws HTTPError and preserves upstream body on non-ok response", async () => {
  const upstreamBody =
    "This model does not support assistant message prefill."
  const errorFetch = mock(
    () => new Response(upstreamBody, { status: 400, statusText: "Bad Request" }),
  )
  const originalFetch = globalThis.fetch
  // eslint-disable-next-line require-atomic-updates -- single-threaded test swap, restored in finally
  // @ts-expect-error - Mock fetch doesn't implement all fetch properties
  globalThis.fetch = errorFetch

  try {
    const payload: ChatCompletionsPayload = {
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-test",
    }

    let caught: unknown
    try {
      await createChatCompletions(payload)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(HTTPError)
    // The original response body must remain readable so forwardError can
    // surface the upstream reason to the client (the clone is what we consume
    // for logging).
    const preserved = await (caught as HTTPError).response.text()
    expect(preserved).toBe(upstreamBody)
  } finally {
    globalThis.fetch = originalFetch
  }
})
