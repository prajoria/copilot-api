import { expect, mock, spyOn, test } from "bun:test"
import consola from "consola"

import { pollAccessToken } from "~/services/github/poll-access-token"

test("access-token polling never logs response bodies or token values", async () => {
  const failureBody = "SENTINEL_PRIVATE_RESPONSE_BODY"
  const accessToken = "SENTINEL_PRIVATE_ACCESS_TOKEN"
  const responses = [
    new Response(failureBody, {
      status: 503,
      headers: { "x-github-request-id": "request-123" },
    }),
    Response.json({ access_token: accessToken }),
  ]
  const originalFetch = globalThis.fetch
  const fetchMock = mock(() => Promise.resolve(responses.shift() as Response))
  // @ts-expect-error - test fetch does not implement Bun's preconnect property
  globalThis.fetch = fetchMock
  const errorLog = spyOn(consola, "error")
  const debugLog = spyOn(consola, "debug")
  consola.pauseLogs()

  try {
    const result = await pollAccessToken({
      device_code: "device-code",
      user_code: "user-code",
      verification_uri: "https://example.invalid",
      expires_in: 60,
      interval: -1,
    })

    expect(result).toBe(accessToken)
    const logs = JSON.stringify([
      ...errorLog.mock.calls,
      ...debugLog.mock.calls,
    ])
    expect(logs).not.toContain(failureBody)
    expect(logs).not.toContain(accessToken)
    expect(logs).toContain("503")
    expect(logs).toContain("request-123")
  } finally {
    consola.resumeLogs()
    errorLog.mockRestore()
    debugLog.mockRestore()
    // eslint-disable-next-line require-atomic-updates -- restores a single-threaded test swap
    globalThis.fetch = originalFetch
  }
})
