#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SCRIPT="$SCRIPT_DIR/install-operator.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_retired() {
    local command_status
    local output

    set +e
    output="$("$INSTALL_SCRIPT" "$@" 2>&1)"
    command_status=$?
    set -e
    [[ "$command_status" -ne 0 ]] || fail "legacy installer unexpectedly succeeded: $*"
    [[ "$output" == *"legacy preview operator is retired"* ]] \
        || fail "missing retirement refusal for: $*"
}

[[ -r "$INSTALL_SCRIPT" ]] || fail "missing legacy installer shim"
if grep -Eq 'docker group|runuser|docker[[:space:]]|compose|deploy\.sh|rollback\.sh' "$INSTALL_SCRIPT"; then
    fail "legacy installer must not retain an alternate Docker/deploy path"
fi

assert_retired install
assert_retired check

echo "install-operator retirement tests passed"
