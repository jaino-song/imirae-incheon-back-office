#!/usr/bin/env bash

set -euo pipefail

declare -a execute_args=()
stdin_file=""

cleanup() {
  if [[ -n "$stdin_file" ]]; then
    rm -f "$stdin_file"
  fi
}
trap cleanup EXIT

for arg in "$@"; do
  if [[ "$arg" == "--stdin" ]]; then
    stdin_file="$(mktemp)"
    cat >"$stdin_file"
    execute_args+=(--file "$stdin_file")
  else
    execute_args+=("$arg")
  fi
done

last_output=""
last_status=0

execute_once() {
  local connection_url="$1"

  set +e
  last_output="$(
    DIRECT_URL="$connection_url" \
      pnpm exec prisma db execute "${execute_args[@]}" 2>&1
  )"
  last_status=$?
  set -e

  printf '%s\n' "$last_output"
  return "$last_status"
}

if execute_once "$DIRECT_URL"; then
  exit 0
fi

if [[ "$last_output" != *"EMAXCONNSESSION"* ]]; then
  exit "$last_status"
fi

echo "Session pool is full; retrying this database patch through DATABASE_URL."

for attempt in 1 2 3; do
  if execute_once "$DATABASE_URL"; then
    exit 0
  fi

  if [[ "$last_output" != *"EMAXCONNSESSION"* ]] || (( attempt == 3 )); then
    exit "$last_status"
  fi

  sleep $((attempt * 5))
done
