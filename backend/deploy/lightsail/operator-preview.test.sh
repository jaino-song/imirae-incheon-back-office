#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_SCRIPT="$SCRIPT_DIR/operator-preview.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

[[ -r "$OPERATOR_SCRIPT" ]] || fail "missing retired preview operator shim"
grep -Fq 'legacy preview operator is retired' "$OPERATOR_SCRIPT" \
    || fail "preview operator must be a retirement shim"
if grep -Eq 'docker|compose|DATABASE_CONNECTION_MODE|BACKEND_ENV_FILE|deploy\.sh|rollback\.sh' "$OPERATOR_SCRIPT"; then
    fail "retired preview operator must not expose deployment or secret paths"
fi

set +e
output="$(BACKEND_ENV_FILE='postgresql://db-user:db-password@example.invalid/db' \
    "$OPERATOR_SCRIPT" status 2>&1)"
status=$?
set -e
[[ "$status" -ne 0 ]] || fail "retired preview operator unexpectedly succeeded"
[[ "$output" == *"legacy preview operator is retired"* ]] \
    || fail "retirement refusal was not reported"
[[ "$output" != *"db-password"* ]] \
    || fail "legacy shim leaked caller environment content"

echo "operator-preview retirement tests passed"
