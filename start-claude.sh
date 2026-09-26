#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_MODEL="${CLAUDE_MODEL:-claude-opus-4.8}"
ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-http://127.0.0.1:4141}"
OS_NAME="$(uname -s)"

case "$OS_NAME" in
  CYGWIN*|MINGW*|MSYS*)
    if ! command -v cygpath >/dev/null 2>&1 || ! command -v cmd.exe >/dev/null 2>&1; then
      echo "[start-claude] Windows compatibility shell detected, but cygpath or cmd.exe is unavailable." >&2
      exit 1
    fi

    WINDOWS_LAUNCHER="$(cygpath -w "$SCRIPT_DIR/start-claude.bat")"
    MSYS2_ARG_CONV_EXCL="*" exec cmd.exe /d /c "$WINDOWS_LAUNCHER" "$@"
    ;;
  Darwin|Linux)
    ;;
  *)
    echo "[start-claude] Unsupported operating system: $OS_NAME" >&2
    exit 1
    ;;
esac

if ! command -v bun >/dev/null 2>&1; then
  echo "[start-claude] Bun is required to run the proxy from source." >&2
  echo "Install it from https://bun.sh/docs/installation" >&2
  exit 1
fi

if command -v claude >/dev/null 2>&1 && claude --version >/dev/null 2>&1; then
  claude_command=(claude)
elif command -v npx >/dev/null 2>&1; then
  echo "[start-claude] Installed Claude Code is missing or broken; using the latest package through npx."
  claude_command=(
    npx
    --yes
    --package=@anthropic-ai/claude-code@latest
    --
    claude
  )
else
  echo "[start-claude] A working Claude Code installation was not found." >&2
  echo "Install it with: npm install --global @anthropic-ai/claude-code" >&2
  echo "Or install Node.js 22+ and rerun this script to use npx." >&2
  exit 1
fi

if ! curl --fail --silent --max-time 1 "${ANTHROPIC_BASE_URL}/" >/dev/null 2>&1; then
  log_file="${TMPDIR:-/tmp}/copilot-api.log"
  echo "[start-claude] Starting Copilot API with forced model ${CLAUDE_MODEL}..."
  COPILOT_API_FORCE_MODEL="${CLAUDE_MODEL}" \
    nohup "${SCRIPT_DIR}/start.sh" >"${log_file}" 2>&1 &
  echo "[start-claude] Proxy log: ${log_file}"
fi

echo "[start-claude] Waiting for Copilot API..."
for _ in {1..60}; do
  if models="$(curl --fail --silent --max-time 1 "${ANTHROPIC_BASE_URL}/v1/models" 2>/dev/null)"; then
    break
  fi
  sleep 0.5
done

if [[ -z "${models:-}" ]]; then
  echo "[start-claude] ERROR: Copilot API did not start within 30 seconds." >&2
  exit 1
fi

if ! grep -Fq "\"id\":\"${CLAUDE_MODEL}\"" <<<"${models}"; then
  echo "[start-claude] ERROR: ${CLAUDE_MODEL} is not available for this Copilot account." >&2
  exit 1
fi

echo "[start-claude] Launching Claude Code with ${CLAUDE_MODEL}..."
export ANTHROPIC_BASE_URL
export ANTHROPIC_AUTH_TOKEN="dummy"
export ANTHROPIC_MODEL="${CLAUDE_MODEL}"
export ANTHROPIC_DEFAULT_SONNET_MODEL="${CLAUDE_MODEL}"
export ANTHROPIC_SMALL_FAST_MODEL="${CLAUDE_MODEL}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="${CLAUDE_MODEL}"
export DISABLE_NON_ESSENTIAL_MODEL_CALLS=1
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

exec "${claude_command[@]}" --model "${CLAUDE_MODEL}" "$@"
