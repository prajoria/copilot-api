#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
OS_NAME="$(uname -s)"

case "$OS_NAME" in
  CYGWIN*|MINGW*|MSYS*)
    if ! command -v cygpath >/dev/null 2>&1 || ! command -v cmd.exe >/dev/null 2>&1; then
      echo "[start] Windows compatibility shell detected, but cygpath or cmd.exe is unavailable." >&2
      exit 1
    fi

    WINDOWS_LAUNCHER="$(cygpath -w "$SCRIPT_DIR/start.bat")"
    exec cmd.exe //d //c "$WINDOWS_LAUNCHER" "$@"
    ;;
  Darwin|Linux)
    ;;
  *)
    echo "[start] Unsupported operating system: $OS_NAME" >&2
    exit 1
    ;;
esac

cd "$SCRIPT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it from https://bun.sh/docs/installation" >&2
  exit 1
fi

echo "Installing dependencies from bun.lock..."
bun install --frozen-lockfile

echo "Building production CLI..."
bun run build

echo "Starting server in production mode..."
exec bun run ./dist/main.js start "$@"
