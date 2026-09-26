import { describe, expect, test } from "bun:test"

import { generateEnvScript, type ShellName } from "../src/lib/shell"

const envVars = {
  ANTHROPIC_BASE_URL: "http://localhost:4141",
  ANTHROPIC_AUTH_TOKEN: "it's valid",
  OMITTED: undefined,
}

describe.each([
  [
    "powershell",
    "$env:ANTHROPIC_BASE_URL = 'http://localhost:4141'; $env:ANTHROPIC_AUTH_TOKEN = 'it''s valid' && claude",
  ],
  [
    "cmd",
    'set "ANTHROPIC_BASE_URL=http://localhost:4141" & set "ANTHROPIC_AUTH_TOKEN=it\'s valid" & claude',
  ],
  [
    "bash",
    `export ANTHROPIC_BASE_URL='http://localhost:4141' ANTHROPIC_AUTH_TOKEN='it'"'"'s valid' && claude`,
  ],
  [
    "zsh",
    `export ANTHROPIC_BASE_URL='http://localhost:4141' ANTHROPIC_AUTH_TOKEN='it'"'"'s valid' && claude`,
  ],
  [
    "sh",
    `export ANTHROPIC_BASE_URL='http://localhost:4141' ANTHROPIC_AUTH_TOKEN='it'"'"'s valid' && claude`,
  ],
  [
    "fish",
    `set -gx ANTHROPIC_BASE_URL 'http://localhost:4141'; set -gx ANTHROPIC_AUTH_TOKEN 'it'"'"'s valid' && claude`,
  ],
] as Array<[ShellName, string]>)("%s", (shell, expected) => {
  test("quotes values and appends the command", () => {
    expect(generateEnvScript(envVars, "claude", shell)).toBe(expected)
  })
})

test("returns the command when there are no environment variables", () => {
  expect(generateEnvScript({}, "claude", "bash")).toBe("claude")
})
