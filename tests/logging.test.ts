import { expect, test } from "bun:test"

import * as logging from "~/lib/logging"

test("sanitizes control characters and punctuation in logged identifiers", () => {
  expect("sanitizeLogIdentifier" in logging).toBe(true)
  if (!("sanitizeLogIdentifier" in logging)) return

  expect(logging.sanitizeLogIdentifier("model\r\nsecret\t\u001b[31m<>")).toBe(
    "model__secret___31m__",
  )
})

test("bounds logged identifiers", () => {
  expect("sanitizeLogIdentifier" in logging).toBe(true)
  if (!("sanitizeLogIdentifier" in logging)) return

  const result = logging.sanitizeLogIdentifier(`model-${"a".repeat(200)}`)

  expect(result.length).toBe(80)
  expect(result).toBe(`model-${"a".repeat(74)}`)
})

test("logs only allowlisted upstream response metadata", () => {
  expect("upstreamErrorMetadata" in logging).toBe(true)
  if (!("upstreamErrorMetadata" in logging)) return

  const metadata = logging.upstreamErrorMetadata(
    new Response("private body", {
      status: 429,
      headers: {
        "x-github-request-id": "safe request;unsafe",
        "x-token-endpoint": "https://secret.invalid/token",
      },
    }),
    "chat_completions",
  )

  expect(metadata).toEqual({
    category: "chat_completions",
    status: 429,
    requestId: "safe_request_unsafe",
  })
})
