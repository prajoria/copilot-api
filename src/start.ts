import type { ServerHandler } from "srvx"

import consola from "consola"
import invariant from "tiny-invariant"

import { ensurePaths } from "./lib/paths"
import { generateEnvScript, type ShellName } from "./lib/shell"
import { state } from "./lib/state"
import { setupCopilotToken, setupGitHubToken } from "./lib/token"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"
import { server } from "./server"

export interface RunServerOptions {
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
    consola.info(`Using ${options.accountType} plan GitHub account`)
  }

  state.manualApprove = options.manual
  state.rateLimitSeconds = options.rateLimit
  state.rateLimitWait = options.rateLimitWait
  state.showToken = options.showToken

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

  consola.info(
    `Available models: \n${state.models?.data.map((model) => `- ${model.id}`).join("\n")}`,
  )

  const serverUrl = `http://localhost:${options.port}`

  if (options.claudeCode) {
    invariant(state.models, "Models should be loaded by now")
    const availableModelIds = state.models.data.map((model) => model.id)
    invariant(
      availableModelIds.includes(options.claudeModel),
      `Claude Code model "${options.claudeModel}" is unavailable. Available models: ${availableModelIds.join(", ")}`,
    )
    invariant(
      availableModelIds.includes(options.claudeSmallModel),
      `Claude Code small model "${options.claudeSmallModel}" is unavailable. Available models: ${availableModelIds.join(", ")}`,
    )

    const command = generateEnvScript(
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

    try {
      const { default: clipboard } = await import("clipboardy")
      clipboard.writeSync(command)
      consola.success("Copied Claude Code command to clipboard!")
    } catch {
      consola.warn(
        "Failed to copy to clipboard. Here is the Claude Code command:",
      )
      consola.log(command)
    }
  }

  consola.info(
    `Usage Viewer: https://ericc-ch.github.io/copilot-api?endpoint=${serverUrl}/usage`,
  )

  const { serve } = await import("srvx")
  serve({
    fetch: server.fetch as ServerHandler,
    port: options.port,
    silent: true,
  })

  consola.success(`Listening on ${serverUrl}/ (all interfaces)`)
}
