import type { Context } from "hono"

import { expect, mock, spyOn, test } from "bun:test"
import consola from "consola"

import { forwardError, HTTPError } from "~/lib/error"

test("does not log an upstream response body", async () => {
  const sensitiveBody = "private prompt and completion token material"
  const json = mock(() => new Response())
  const context = { json } as unknown as Context
  const errorLog = spyOn(consola, "error")
  consola.pauseLogs()

  try {
    await forwardError(
      context,
      new HTTPError(
        "Failed to create chat completions",
        new Response(sensitiveBody, {
          status: 400,
          headers: { "x-github-request-id": "safe-request-123" },
        }),
      ),
    )

    const logged = JSON.stringify(errorLog.mock.calls)
    expect(logged).not.toContain(sensitiveBody)
    expect(logged).toContain("400")
    expect(logged).toContain("safe-request-123")
  } finally {
    consola.resumeLogs()
    errorLog.mockRestore()
  }
})

test("does not log arbitrary internal error values", async () => {
  const sensitiveMessage = "private token endpoint and model list"
  const json = mock(() => new Response())
  const context = { json } as unknown as Context
  const errorLog = spyOn(consola, "error")
  consola.pauseLogs()

  try {
    await forwardError(context, new Error(sensitiveMessage))

    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(sensitiveMessage)
  } finally {
    consola.resumeLogs()
    errorLog.mockRestore()
  }
})
