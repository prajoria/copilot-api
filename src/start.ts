import type { ServerHandler, ServerOptions } from "srvx"

import consola from "consola"
import invariant from "tiny-invariant"

import { sanitizeLogIdentifier } from "./lib/logging"
import { ensurePaths } from "./lib/paths"
import { generateEnvScript, type ShellName } from "./lib/shell"
import { state } from "./lib/state"
import { setupCopilotToken, setupGitHubToken } from "./lib/token"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"
import { server } from "./server"

export const SERVER_IDLE_TIMEOUT_SECONDS = 255

export interface RunServerOptions {
  host: string
  port: number
  verbose: boolean
  accountType: string
  manual: boolean
  rateLimit?: number
  rateLimitWait: boolean
  githubToken?: string
  claudeCode: boolean
  claudeModel: string
  claudeSmallModel: string
  claudeShell: ShellName
  showToken: boolean
  proxyEnv: boolean
}

export async function runServer(options: RunServerOptions): Promise<void> {
  if (options.proxyEnv) {
    const { initProxyFromEnv } = await import("./lib/proxy")
    initProxyFromEnv()
  }

  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.accountType = options.accountType
  if (options.accountType !== "individual") {
    consola.info(
      `Using ${sanitizeLogIdentifier(options.accountType)} plan GitHub account`,
    )
  }

  state.manualApprove = options.manual
  state.rateLimitSeconds = options.rateLimit
  state.rateLimitWait = options.rateLimitWait
  state.showToken = options.showToken
  if (options.showToken) {
    consola.warn("Token display is disabled for security.")
  }

  await ensurePaths()
  await cacheVSCodeVersion()

  if (options.githubToken) {
    state.githubToken = options.githubToken
    consola.info("Using provided GitHub token")
  } else {
    await setupGitHubToken()
  }

  await setupCopilotToken()
  await cacheModels()

  consola.info(`Available model count: ${state.models?.data.length ?? 0}`)

  const serverUrl = formatServerUrl(options.host, options.port)
  const safeServerUrl = formatServerUrl(
    sanitizeLogIdentifier(options.host),
    options.port,
  )

  if (options.claudeCode) {
    invariant(state.models, "Models should be loaded by now")
    const availableModelIds = new Set(
      state.models.data.map((model) => model.id),
    )
    invariant(
      availableModelIds.has(options.claudeModel),
      "Configured Claude Code model is unavailable.",
    )
    invariant(
      availableModelIds.has(options.claudeSmallModel),
      "Configured Claude Code small model is unavailable.",
    )

    const command = createClaudeCommand(options, serverUrl)

    try {
      const { default: clipboard } = await import("clipboardy")
      clipboard.writeSync(command)
      consola.success("Copied Claude Code command to clipboard!")
    } catch {
      consola.warn(
        "Failed to copy to clipboard. Here is the Claude Code command:",
      )
      consola.log(
        createClaudeCommand(
          {
            ...options,
            claudeModel: sanitizeLogIdentifier(options.claudeModel),
            claudeSmallModel: sanitizeLogIdentifier(options.claudeSmallModel),
          },
          safeServerUrl,
        ),
      )
    }
  }

  consola.info(
    `Usage Viewer: https://ericc-ch.github.io/copilot-api?endpoint=${safeServerUrl}/usage`,
  )

  const { serve } = await import("srvx")
  serve(createServeOptions(options.host, options.port))

  consola.success(`Listening on ${safeServerUrl}/`)
}

export function formatServerUrl(hostname: string, port: number): string {
  const urlHostname = hostname.includes(":") ? `[${hostname}]` : hostname
  return `http://${urlHostname}:${port}`
}

function createClaudeCommand(
  options: RunServerOptions,
  serverUrl: string,
): string {
  return generateEnvScript(
    {
      ANTHROPIC_BASE_URL: serverUrl,
      ANTHROPIC_AUTH_TOKEN: "dummy",
      ANTHROPIC_MODEL: options.claudeModel,
      ANTHROPIC_DEFAULT_SONNET_MODEL: options.claudeModel,
      ANTHROPIC_SMALL_FAST_MODEL: options.claudeSmallModel,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: options.claudeSmallModel,
      DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
    "claude",
    options.claudeShell,
  )
}

export function createServeOptions(
  hostname: string,
  port: number,
): ServerOptions {
  return {
    fetch: server.fetch as ServerHandler,
    hostname,
    port,
    silent: true,
    bun: {
      idleTimeout: SERVER_IDLE_TIMEOUT_SECONDS,
    },
  }
}
