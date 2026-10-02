#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fake_bin=$(mktemp -d)
trap 'rm -rf "$fake_bin"' EXIT

cat >"$fake_bin/bun" <<'EOF'
#!/bin/sh
printf '%s\n' "$@"
EOF
chmod +x "$fake_bin/bun"

run_entrypoint() {
  PATH="$fake_bin:$PATH" GH_TOKEN="test-token" \
    sh "$repo_root/entrypoint.sh" "$@"
}

default_output=$(run_entrypoint --port 4141)
printf '%s\n' "$default_output" | grep -Fx -- "--host" >/dev/null
printf '%s\n' "$default_output" | grep -Fx -- "0.0.0.0" >/dev/null
[ "$(printf '%s\n' "$default_output" | grep -Fxc -- "--host")" -eq 1 ]

override_output=$(run_entrypoint --host 127.0.0.1 --port 4141)
printf '%s\n' "$override_output" | grep -Fx -- "127.0.0.1" >/dev/null
[ "$(printf '%s\n' "$override_output" | grep -Fxc -- "--host")" -eq 1 ]
if printf '%s\n' "$override_output" | grep -Fx -- "0.0.0.0" >/dev/null; then
  echo "entrypoint duplicated the default host alongside an explicit override" >&2
  exit 1
fi

equals_override_output=$(run_entrypoint --host=127.0.0.1 --port 4141)
printf '%s\n' "$equals_override_output" |
  grep -Fx -- "--host=127.0.0.1" >/dev/null
if printf '%s\n' "$equals_override_output" | grep -Fx -- "0.0.0.0" >/dev/null; then
  echo "entrypoint ignored an equals-form host override" >&2
  exit 1
fi

grep -Eq '^EXPOSE[[:space:]]+4141$' "$repo_root/Dockerfile"
grep -F -- '"4141:4141"' "$repo_root/compose.yaml" >/dev/null
