import { defineCommand } from "citty"

import type { ShellName } from "./lib/shell"
import type { RunServerOptions } from "./start"

const DEFAULT_CLAUDE_MODEL = "claude-opus-4.8"
export const DEFAULT_HOST = "127.0.0.1"

interface StartCommandArgs {
  host: string
  port: string
  verbose: boolean
  "account-type": string
  manual: boolean
  "rate-limit"?: string
  wait: boolean
  "github-token"?: string
  "claude-code": boolean
  "claude-model": string
  "claude-small-model": string
  "claude-shell": string
  "show-token": boolean
  "proxy-env": boolean
}

function parseShellName(value: string): ShellName {
  switch (value) {
    case "bash":
    case "cmd":
    case "fish":
    case "powershell":
    case "sh":
    case "zsh": {
      return value
    }
    default: {
      throw new Error(
        `Unsupported shell "${value}". Use bash, zsh, fish, sh, powershell, or cmd.`,
      )
    }
  }
}

export const start = defineCommand({
  meta: {
    name: "start",
    description: "Start the Copilot API server",
  },
  args: {
    host: {
      type: "string",
      default: DEFAULT_HOST,
      description: "Host to listen on",
    },
    port: {
      alias: "p",
      type: "string",
      default: "4141",
      description: "Port to listen on",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type to use (individual, business, enterprise)",
    },
    manual: {
      type: "boolean",
      default: false,
      description: "Enable manual request approval",
    },
    "rate-limit": {
      alias: "r",
      type: "string",
      description: "Rate limit in seconds between requests",
    },
    wait: {
      alias: "w",
      type: "boolean",
      default: false,
      description:
        "Wait instead of error when rate limit is hit. Has no effect if rate limit is not set",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description:
        "Provide GitHub token directly (must be generated using the `auth` subcommand)",
    },
    "claude-code": {
      alias: "c",
      type: "boolean",
      default: false,
      description:
        "Generate a command to launch Claude Code with Copilot API config",
    },
    "claude-model": {
      type: "string",
      default: DEFAULT_CLAUDE_MODEL,
      description: "Model to configure as the Claude Code primary model",
    },
    "claude-small-model": {
      type: "string",
      default: DEFAULT_CLAUDE_MODEL,
      description: "Model to configure for Claude Code background tasks",
    },
    "claude-shell": {
      type: "string",
      default: process.platform === "win32" ? "powershell" : "sh",
      description:
        "Shell syntax for the generated command (bash, zsh, fish, sh, powershell, cmd)",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Deprecated; token values are never logged",
    },
    "proxy-env": {
      type: "boolean",
      default: false,
      description: "Initialize proxy from environment variables",
    },
  },
  async run({ args }) {
    const { runServer } = await import("./start")

    return runServer(createRunServerOptions(args))
  },
})

export function createRunServerOptions(
  args: StartCommandArgs,
): RunServerOptions {
  const rateLimitRaw = args["rate-limit"]
  const rateLimit =
    rateLimitRaw === undefined ? undefined : Number.parseInt(rateLimitRaw, 10)

  return {
    host: args.host,
    port: Number.parseInt(args.port, 10),
    verbose: args.verbose,
    accountType: args["account-type"],
    manual: args.manual,
    rateLimit,
    rateLimitWait: args.wait,
    githubToken: args["github-token"],
    claudeCode: args["claude-code"],
    claudeModel: args["claude-model"],
    claudeSmallModel: args["claude-small-model"],
    claudeShell: parseShellName(args["claude-shell"]),
    showToken: args["show-token"],
    proxyEnv: args["proxy-env"],
  }
}
