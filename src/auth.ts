#!/usr/bin/env node

import { defineCommand } from "citty"
import consola from "consola"

interface RunAuthOptions {
  verbose: boolean
  showToken: boolean
}

export async function runAuth(options: RunAuthOptions): Promise<void> {
  const [{ ensurePaths }, { state }, { setupGitHubToken }] = await Promise.all([
    import("./lib/paths"),
    import("./lib/state"),
    import("./lib/token"),
  ])

  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.showToken = options.showToken
  if (options.showToken) {
    consola.warn("Token display is disabled for security.")
  }

  await ensurePaths()
  await setupGitHubToken({ force: true })
  consola.success("GitHub token stored")
}

export const auth = defineCommand({
  meta: {
    name: "auth",
    description: "Run GitHub auth flow without running the server",
  },
  args: {
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Deprecated; token values are never logged",
    },
  },
  run({ args }) {
    return runAuth({
      verbose: args.verbose,
      showToken: args["show-token"],
    })
  },
})
