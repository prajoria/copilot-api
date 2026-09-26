#!/bin/sh
set -eu

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
