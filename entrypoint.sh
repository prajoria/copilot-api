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

has_host=false
for arg in "$@"; do
  case "$arg" in
    --host|--host=*)
      has_host=true
      break
      ;;
  esac
done
if [ "$has_host" = false ]; then
  set -- --host 0.0.0.0 "$@"
fi

if [ -n "${GH_TOKEN:-}" ]; then
  set -- --github-token "$GH_TOKEN" "$@"
fi

exec bun run dist/main.js start "$@"
