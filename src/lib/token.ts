import consola from "consola"
import fs from "node:fs/promises"

import { sanitizeLogIdentifier, upstreamErrorMetadata } from "~/lib/logging"
import { PATHS } from "~/lib/paths"
import { getCopilotToken } from "~/services/github/get-copilot-token"
import { getDeviceCode } from "~/services/github/get-device-code"
import { getGitHubUser } from "~/services/github/get-user"
import { pollAccessToken } from "~/services/github/poll-access-token"

import { HTTPError } from "./error"
import { state } from "./state"

const readGithubToken = () => fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")

const writeGithubToken = (token: string) =>
  fs.writeFile(PATHS.GITHUB_TOKEN_PATH, token)

export const setupCopilotToken = async () => {
  const { token, refresh_in } = await getCopilotToken()
  state.copilotToken = token

  consola.debug("GitHub Copilot Token fetched successfully!")

  const refreshInterval = (refresh_in - 60) * 1000
  setInterval(async () => {
    consola.debug("Refreshing Copilot token")
    try {
      const { token } = await getCopilotToken()
      state.copilotToken = token
      consola.debug("Copilot token refreshed")
    } catch {
      consola.error("Failed to refresh Copilot token", {
        category: "copilot_token_refresh",
      })
      throw new Error("Failed to refresh Copilot token.")
    }
  }, refreshInterval)
}

interface SetupGitHubTokenOptions {
  force?: boolean
}

export async function setupGitHubToken(
  options?: SetupGitHubTokenOptions,
): Promise<void> {
  try {
    const githubToken = await readGithubToken()

    if (githubToken && !options?.force) {
      state.githubToken = githubToken
      await logUser()

      return
    }

    consola.info("Not logged in, getting new access token")
    const response = await getDeviceCode()
    consola.debug("Device authorization code received")

    consola.info(
      `Please enter the code "${response.user_code}" in ${response.verification_uri}`,
    )

    const token = await pollAccessToken(response)
    await writeGithubToken(token)
    state.githubToken = token

    await logUser()
  } catch (error) {
    if (error instanceof HTTPError) {
      consola.error(
        "Failed to get GitHub token",
        upstreamErrorMetadata(error.response, "github_token_setup"),
      )
      throw error
    }

    consola.error("Failed to get GitHub token", {
      category: "github_token_setup",
    })
    throw error
  }
}

async function logUser() {
  // Cosmetic "Logged in as X" banner only. GitHub's /user endpoint
  // intermittently returns a transient 503 (HTML body); that must never
  // be fatal to startup — the Copilot token is fetched separately and is
  // what actually matters. Warn and continue instead of crashing.
  try {
    const user = await getGitHubUser()
    consola.info(`Logged in as ${sanitizeLogIdentifier(user.login)}`)
  } catch (error) {
    consola.warn(
      "Could not fetch GitHub user (continuing anyway):",
      error instanceof HTTPError ?
        upstreamErrorMetadata(error.response, "github_user_lookup")
      : { category: "github_user_lookup" },
    )
  }
}
