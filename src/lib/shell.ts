import process from "node:process"

export type ShellName = "bash" | "zsh" | "fish" | "powershell" | "cmd" | "sh"
type EnvVars = Record<string, string | undefined>

function getShell(): ShellName {
  const { platform, env } = process

  if (platform === "win32") {
    return "powershell"
  }

  const shellPath = env.SHELL
  if (shellPath?.endsWith("zsh")) return "zsh"
  if (shellPath?.endsWith("fish")) return "fish"
  if (shellPath?.endsWith("bash")) return "bash"

  return "sh"
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Generates a copy-pasteable script to set multiple environment variables
 * and run a subsequent command.
 * @param {EnvVars} envVars - An object of environment variables to set.
 * @param {string} commandToRun - The command to run after setting the variables.
 * @returns {string} The formatted script string.
 */
export function generateEnvScript(
  envVars: EnvVars,
  commandToRun: string = "",
  shell: ShellName = getShell(),
): string {
  const filteredEnvVars = Object.entries(envVars).filter(
    ([, value]) => value !== undefined,
  ) as Array<[string, string]>

  let commandBlock: string

  switch (shell) {
    case "powershell": {
      commandBlock = filteredEnvVars
        .map(([key, value]) => `$env:${key} = ${quotePowerShell(value)}`)
        .join("; ")
      break
    }
    case "cmd": {
      commandBlock = filteredEnvVars
        .map(([key, value]) => `set "${key}=${value}"`)
        .join(" & ")
      break
    }
    case "fish": {
      commandBlock = filteredEnvVars
        .map(([key, value]) => `set -gx ${key} ${quotePosix(value)}`)
        .join("; ")
      break
    }
    default: {
      // bash, zsh, sh
      const assignments = filteredEnvVars
        .map(([key, value]) => `${key}=${quotePosix(value)}`)
        .join(" ")
      commandBlock = filteredEnvVars.length > 0 ? `export ${assignments}` : ""
      break
    }
  }

  if (commandBlock && commandToRun) {
    const separator = shell === "cmd" ? " & " : " && "
    return `${commandBlock}${separator}${commandToRun}`
  }

  return commandBlock || commandToRun
}
