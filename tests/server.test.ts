import { expect, test } from "bun:test"

import { server } from "~/server"

test("does not expose the Copilot token route", async () => {
  const response = await server.request("/token")

  expect(response.status).toBe(404)
})
