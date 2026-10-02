import { expect, test } from "bun:test"

import * as startModule from "~/start"
import { start } from "~/start-command"
import * as startCommandModule from "~/start-command"

test("keeps Bun connections alive beyond Claude's response finalization window", () => {
  expect(startModule.SERVER_IDLE_TIMEOUT_SECONDS).toBeGreaterThan(10)
})

test("direct CLI defaults to loopback", async () => {
  const args =
    typeof start.args === "function" ? await start.args() : await start.args

  expect(args?.host.default).toBe("127.0.0.1")
})

test("start command maps the configured host into RunServer options", () => {
  expect("createRunServerOptions" in startCommandModule).toBe(true)
  if (!("createRunServerOptions" in startCommandModule)) return

  const options = startCommandModule.createRunServerOptions({
    host: "192.0.2.10",
    port: "4242",
    verbose: false,
    "account-type": "individual",
    manual: false,
    "rate-limit": undefined,
    wait: false,
    "github-token": undefined,
    "claude-code": false,
    "claude-model": "model",
    "claude-small-model": "small-model",
    "claude-shell": "sh",
    "show-token": false,
    "proxy-env": false,
  })

  expect(options.host).toBe("192.0.2.10")
  expect(options.port).toBe(4242)
})

test("serve options bind the configured host and preserve Bun idle timeout", () => {
  expect("createServeOptions" in startModule).toBe(true)
  if (!("createServeOptions" in startModule)) return

  const options = startModule.createServeOptions("192.0.2.20", 4343)

  expect(options.hostname).toBe("192.0.2.20")
  expect(options.port).toBe(4343)
  expect(options.bun?.idleTimeout).toBe(startModule.SERVER_IDLE_TIMEOUT_SECONDS)
})

test("formats IPv6 bind hosts as valid server URLs", () => {
  expect("formatServerUrl" in startModule).toBe(true)
  if (!("formatServerUrl" in startModule)) return

  expect(startModule.formatServerUrl("::1", 4141)).toBe("http://[::1]:4141")
  expect(startModule.formatServerUrl("127.0.0.1", 4141)).toBe(
    "http://127.0.0.1:4141",
  )
})
