import { test, expect } from "bun:test"

import { parseJsonBody, repairJsonBody } from "../src/lib/json"

test("repairs a raw ESC control char inside a string literal", () => {
  // Raw ESC (0x1b) inside a JSON string is illegal and makes JSON.parse throw.
  const broken = `{"command":"echo \u001b[36mhi\u001b[0m"}`
  expect(() => JSON.parse(broken)).toThrow()

  const repaired = repairJsonBody(broken)
  expect(() => JSON.parse(repaired)).not.toThrow()
  const parsed = JSON.parse(repaired) as { command: string }
  // The byte is preserved (as the corresponding control character).
  expect(parsed.command).toBe("echo \u001b[36mhi\u001b[0m")
})

test("repairs nested tool_call arguments carrying raw control chars", () => {
  // Real shape: a request whose tool_call arguments (a nested JSON string)
  // contains a raw ESC byte on the wire.
  const broken =
    `{"messages":[{"role":"assistant","tool_calls":[` +
    `{"id":"call_1","type":"function","function":` +
    `{"name":"bash","arguments":"{\\"command\\":\\"ls \u001b[0m\\"}"}}]}]}`
  expect(() => JSON.parse(broken)).toThrow()

  const repaired = repairJsonBody(broken)
  // The outer body now parses (no more 500 from c.req.json()).
  expect(() => JSON.parse(repaired)).not.toThrow()
  const parsed = JSON.parse(repaired) as {
    messages: Array<{
      tool_calls: Array<{ function: { arguments: string } }>
    }>
  }
  const args = parsed.messages[0].tool_calls[0].function.arguments
  // After one level of unescaping the nested arguments still carries the raw
  // control byte — by design. The createChatCompletions sanitizer strips it
  // before the request is re-serialized and forwarded to Copilot.
  expect(args).toBe(`{"command":"ls \u001b[0m"}`)
})

test("leaves well-formed JSON untouched (fast path)", () => {
  const clean = `{"a":1,"b":"hello world","c":[1,2,3]}`
  expect(repairJsonBody(clean)).toBe(clean)
})

test("preserves structural whitespace (pretty-printed JSON)", () => {
  const pretty = `{\n  "a": 1,\n\t"b": "x"\n}`
  expect(repairJsonBody(pretty)).toBe(pretty)
  expect(JSON.parse(repairJsonBody(pretty))).toEqual({ a: 1, b: "x" })
})

test("does not corrupt escaped quotes inside strings", () => {
  const broken = `{"s":"a \\" b \u001b c"}`
  const repaired = repairJsonBody(broken)
  const parsed = JSON.parse(repaired) as { s: string }
  expect(parsed.s).toBe('a " b \u001b c')
})

test("parseJsonBody parses a payload with raw control chars", () => {
  const payload = parseJsonBody<{ messages: Array<{ content: string }> }>(
    `{"messages":[{"content":"x\u0007y"}]}`,
  )
  expect(payload.messages[0].content).toBe("x\u0007y")
})
