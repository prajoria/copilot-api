#!/bin/sh
set -eu

if [ "${1:-}" = "--auth" ]; then
  set -- auth
fi

case "${1:-}" in
  auth|check-usage|debug)
    exec bun run dist/main.js "$@"
    ;;
  start)
    shift
    ;;
esac

if [ -n "${GH_TOKEN:-}" ]; then
  set -- --github-token "$GH_TOKEN" "$@"
fi

exec bun run dist/main.js start "$@"
