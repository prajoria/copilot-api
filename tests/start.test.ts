import { expect, test } from "bun:test"

import { SERVER_IDLE_TIMEOUT_SECONDS } from "~/start"

test("keeps Bun connections alive beyond Claude's response finalization window", () => {
  expect(SERVER_IDLE_TIMEOUT_SECONDS).toBeGreaterThan(10)
})
