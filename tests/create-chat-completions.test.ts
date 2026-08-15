import { test, expect, mock } from "bun:test"

import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { HTTPError } from "../src/lib/error"
import { state } from "../src/lib/state"
import { createChatCompletions } from "../src/services/copilot/create-chat-completions"
import {
  createResponsesStreamState,
  translateResponsesEvent,
} from "../src/services/copilot/responses-api"

interface StreamChoice {
  index: number
  delta: {
    content?: string
    tool_calls?: Array<unknown>
  }
  finish_reason: string | null
  logprobs: null
}

const parseStreamChoice = (data: string | undefined): StreamChoice =>
  (
    JSON.parse(data ?? "{}") as {
      choices: Array<StreamChoice>
    }
  ).choices[0]

// Mock state
state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"

// Helper to mock fetch
const fetchMock = mock(
  (url: string, opts: { headers: Record<string, string>; body: string }) => {
    if (url.endsWith("/responses")) {
      return {
        ok: true,
        json: () => ({
          id: "resp_test",
          object: "response",
          created_at: 0,
          model: "gpt-responses-only",
          status: "completed",
          output: [],
        }),
        headers: opts.headers,
      }
    }
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

test("uses Responses API for models that advertise the responses endpoint", async () => {
  state.models = {
    object: "list",
    data: [
      {
        id: "gpt-responses-only",
        name: "GPT Responses Only",
        object: "model",
        vendor: "OpenAI",
        version: "1",
        preview: false,
        model_picker_enabled: true,
        supported_endpoints: ["/responses"],
        capabilities: {
          family: "gpt-responses-only",
          limits: {},
          object: "model_capabilities",
          supports: {},
          tokenizer: "o200k_base",
          type: "chat",
        },
      },
    ],
  }
  const callIndex = fetchMock.mock.calls.length

  await createChatCompletions({
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-responses-only",
  })

  const [url, options] = fetchMock.mock.calls[callIndex] as unknown as [
    string,
    { body: string },
  ]
  expect(url).toEndWith("/responses")
  const body = JSON.parse(options.body) as Record<string, unknown>
  expect(body.input).toEqual([{ role: "user", content: "hi" }])
  expect(body.messages).toBeUndefined()
})

test("converts a completed Responses API result to Chat Completions", async () => {
  const originalFetch = globalThis.fetch
  const responsesFetch = mock(() =>
    Response.json({
      id: "resp_123",
      object: "response",
      created_at: 123,
      model: "gpt-responses-only",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello" }],
        },
      ],
      usage: {
        input_tokens: 4,
        output_tokens: 2,
        total_tokens: 6,
        input_tokens_details: { cached_tokens: 1 },
      },
    }),
  )
  // @ts-expect-error - Mock fetch doesn't implement all fetch properties
  globalThis.fetch = responsesFetch

  try {
    const response = await createChatCompletions({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-responses-only",
    })

    expect(response).toEqual({
      id: "resp_123",
      object: "chat.completion",
      created: 123,
      model: "gpt-responses-only",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hello" },
          logprobs: null,
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 4,
        completion_tokens: 2,
        total_tokens: 6,
        prompt_tokens_details: { cached_tokens: 1 },
      },
    })
  } finally {
    // eslint-disable-next-line require-atomic-updates -- single-threaded test swap, restored in finally
    globalThis.fetch = originalFetch
  }
})

test("converts tools and tool messages to Responses API input items", async () => {
  const callIndex = fetchMock.mock.calls.length

  await createChatCompletions({
    model: "gpt-responses-only",
    messages: [
      { role: "user", content: "look it up" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "lookup", arguments: '{"id":1}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "found" },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "lookup",
          description: "Look up an item",
          parameters: { type: "object" },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "lookup" } },
    max_tokens: 100,
  })

  const body = JSON.parse(
    (fetchMock.mock.calls[callIndex][1] as { body: string }).body,
  ) as Record<string, unknown>
  expect(body.input).toEqual([
    { role: "user", content: "look it up" },
    {
      type: "function_call",
      call_id: "call_1",
      name: "lookup",
      arguments: '{"id":1}',
    },
    {
      type: "function_call_output",
      call_id: "call_1",
      output: "found",
    },
  ])
  expect(body.tools).toEqual([
    {
      type: "function",
      name: "lookup",
      description: "Look up an item",
      parameters: { type: "object" },
    },
  ])
  expect(body.tool_choice).toEqual({ type: "function", name: "lookup" })
  expect(body.max_output_tokens).toBe(100)
  expect(body.max_tokens).toBeUndefined()
})

test("converts multimodal content and JSON response format", async () => {
  const callIndex = fetchMock.mock.calls.length

  await createChatCompletions({
    model: "gpt-responses-only",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "describe this" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,abc", detail: "high" },
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
  })

  const body = JSON.parse(
    (fetchMock.mock.calls[callIndex][1] as { body: string }).body,
  ) as Record<string, unknown>
  expect(body.input).toEqual([
    {
      role: "user",
      content: [
        { type: "input_text", text: "describe this" },
        {
          type: "input_image",
          image_url: "data:image/png;base64,abc",
          detail: "high",
        },
      ],
    },
  ])
  expect(body.text).toEqual({ format: { type: "json_object" } })
})

test("converts Responses API function calls to Chat Completions tool calls", async () => {
  const originalFetch = globalThis.fetch
  const responsesFetch = mock(() =>
    Response.json({
      id: "resp_tool",
      object: "response",
      created_at: 456,
      model: "gpt-responses-only",
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "lookup",
          arguments: '{"id":1}',
        },
      ],
    }),
  )
  // @ts-expect-error - Mock fetch doesn't implement all fetch properties
  globalThis.fetch = responsesFetch

  try {
    const response = await createChatCompletions({
      messages: [{ role: "user", content: "look it up" }],
      model: "gpt-responses-only",
    })

    expect("choices" in response && response.choices[0]).toEqual({
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "lookup", arguments: '{"id":1}' },
          },
        ],
      },
      logprobs: null,
      finish_reason: "tool_calls",
    })
  } finally {
    // eslint-disable-next-line require-atomic-updates -- single-threaded test swap, restored in finally
    globalThis.fetch = originalFetch
  }
})

test("translates Responses text stream events to Chat Completions chunks", () => {
  const streamState = createResponsesStreamState()
  expect(
    translateResponsesEvent(
      {
        data: JSON.stringify({
          type: "response.created",
          response: {
            id: "resp_stream",
            created_at: 789,
            model: "gpt-responses-only",
          },
        }),
      },
      streamState,
    ),
  ).toEqual([])

  const deltaEvents = translateResponsesEvent(
    {
      data: JSON.stringify({
        type: "response.output_text.delta",
        delta: "hello",
      }),
    },
    streamState,
  )
  expect(deltaEvents).toHaveLength(1)
  expect(JSON.parse(deltaEvents[0].data as string)).toEqual({
    id: "resp_stream",
    object: "chat.completion.chunk",
    created: 789,
    model: "gpt-responses-only",
    choices: [
      {
        index: 0,
        delta: { content: "hello" },
        finish_reason: null,
        logprobs: null,
      },
    ],
  })

  const completedEvents = translateResponsesEvent(
    {
      data: JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp_stream",
          created_at: 789,
          model: "gpt-responses-only",
          status: "completed",
          output: [],
          usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
        },
      }),
    },
    streamState,
  )
  expect(JSON.parse(completedEvents[0].data as string)).toEqual({
    id: "resp_stream",
    object: "chat.completion.chunk",
    created: 789,
    model: "gpt-responses-only",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 3,
      completion_tokens: 1,
      total_tokens: 4,
    },
  })
  expect(completedEvents[1]).toEqual({ data: "[DONE]" })
})

test("translates Responses function-call stream events", () => {
  const streamState = createResponsesStreamState()
  translateResponsesEvent(
    {
      data: JSON.stringify({
        type: "response.created",
        response: {
          id: "resp_tool_stream",
          created_at: 987,
          model: "gpt-responses-only",
        },
      }),
    },
    streamState,
  )

  const addedEvents = translateResponsesEvent(
    {
      data: JSON.stringify({
        type: "response.output_item.added",
        output_index: 0,
        item: {
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "lookup",
          arguments: "",
        },
      }),
    },
    streamState,
  )
  expect(parseStreamChoice(addedEvents[0].data)).toEqual({
    index: 0,
    delta: {
      tool_calls: [
        {
          index: 0,
          id: "call_1",
          type: "function",
          function: { name: "lookup", arguments: "" },
        },
      ],
    },
    finish_reason: null,
    logprobs: null,
  })

  const deltaEvents = translateResponsesEvent(
    {
      data: JSON.stringify({
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 0,
        delta: '{"id":1}',
      }),
    },
    streamState,
  )
  expect(parseStreamChoice(deltaEvents[0].data).delta).toEqual({
    tool_calls: [
      {
        index: 0,
        function: { arguments: '{"id":1}' },
      },
    ],
  })

  const completedEvents = translateResponsesEvent(
    {
      data: JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp_tool_stream",
          created_at: 987,
          model: "gpt-responses-only",
          status: "completed",
          output: [],
        },
      }),
    },
    streamState,
  )
  expect(parseStreamChoice(completedEvents[0].data).finish_reason).toBe(
    "tool_calls",
  )
})

test("streams translated Chat Completions events from Responses API", async () => {
  const originalFetch = globalThis.fetch
  const upstreamEvents = [
    {
      type: "response.created",
      response: {
        id: "resp_live_stream",
        created_at: 111,
        model: "gpt-responses-only",
      },
    },
    { type: "response.output_text.delta", delta: "hello" },
    {
      type: "response.completed",
      response: {
        id: "resp_live_stream",
        created_at: 111,
        model: "gpt-responses-only",
        status: "completed",
        output: [],
      },
    },
  ]
  const streamBody = upstreamEvents
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("")
  const responsesFetch = mock(
    () =>
      new Response(streamBody, {
        headers: { "content-type": "text/event-stream" },
      }),
  )
  // @ts-expect-error - Mock fetch doesn't implement all fetch properties
  globalThis.fetch = responsesFetch

  try {
    const response = await createChatCompletions({
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-responses-only",
      stream: true,
    })
    expect("choices" in response).toBe(false)

    const translated = []
    for await (const event of response as AsyncIterable<{ data?: string }>) {
      translated.push(event)
    }

    expect(parseStreamChoice(translated[0].data).delta.content).toBe("hello")
    expect(parseStreamChoice(translated[1].data).finish_reason).toBe("stop")
    expect(translated[2]).toEqual({ data: "[DONE]" })
  } finally {
    // eslint-disable-next-line require-atomic-updates -- single-threaded test swap, restored in finally
    globalThis.fetch = originalFetch
  }
})

test("surfaces Responses API stream failures", () => {
  const streamState = createResponsesStreamState()

  expect(() =>
    translateResponsesEvent(
      {
        data: JSON.stringify({
          type: "response.failed",
          response: {
            id: "resp_failed",
            created_at: 222,
            model: "gpt-responses-only",
            status: "failed",
            output: [],
            error: {
              code: "model_error",
              message: "The model failed to respond",
            },
          },
        }),
      },
      streamState,
    ),
  ).toThrow("model_error: The model failed to respond")
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

test("strips raw control characters from tool_call arguments before forwarding", async () => {
  const callIndex = fetchMock.mock.calls.length
  // ESC (0x1b) is what ANSI color codes captured from terminal output use; a
  // raw ESC inside the nested arguments JSON makes Copilot reject the request
  // with "Invalid JSON format in tool call arguments".
  const argsWithEsc = `{"command":"echo \u001b[36mhi\u001b[0m"}`
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "run it" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "bash", arguments: argsWithEsc },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "done" },
      { role: "user", content: "thanks" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  const rawBody = (fetchMock.mock.calls[callIndex][1] as { body: string }).body
  // The serialized request body must contain no raw control characters.
  expect(
    Array.from(rawBody).some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 32 && code !== 9 && code !== 10 && code !== 13
    }),
  ).toBe(false)
  const body = JSON.parse(rawBody) as ChatCompletionsPayload
  const forwardedArgs = body.messages[1].tool_calls?.[0].function.arguments
  expect(forwardedArgs).toBe(`{"command":"echo [36mhi[0m"}`)
  // Stripped arguments must remain valid JSON.
  expect(() => {
    JSON.parse(forwardedArgs as string)
  }).not.toThrow()
})

test("strips raw control characters from message text content", async () => {
  const callIndex = fetchMock.mock.calls.length
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hello\u0000\u001bworld" }],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  const body = JSON.parse(
    (fetchMock.mock.calls[callIndex][1] as { body: string }).body,
  ) as ChatCompletionsPayload
  expect(body.messages[0].content).toBe("helloworld")
})

test("preserves tab, newline and carriage return in content", async () => {
  const callIndex = fetchMock.mock.calls.length
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "a\tb\nc\rd" }],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  const body = JSON.parse(
    (fetchMock.mock.calls[callIndex][1] as { body: string }).body,
  ) as ChatCompletionsPayload
  expect(body.messages[0].content).toBe("a\tb\nc\rd")
})

test("throws HTTPError and preserves upstream body on non-ok response", async () => {
  const upstreamBody = "This model does not support assistant message prefill."
  const errorFetch = mock(
    () =>
      new Response(upstreamBody, { status: 400, statusText: "Bad Request" }),
  )
  const originalFetch = globalThis.fetch
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
    // eslint-disable-next-line require-atomic-updates -- single-threaded test swap, restored in finally
    globalThis.fetch = originalFetch
  }
})
