#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/install-ci-operator.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_fails() {
    if ("$@") >/dev/null 2>&1; then
        fail "expected command to fail: $*"
    fi
}

[[ -r "$INSTALLER" ]] || fail "missing CI operator installer: $INSTALLER"

# shellcheck source=backend/deploy/lightsail/install-ci-operator.sh
source "$INSTALLER"

group_list_contains docker "ubuntu docker"
assert_fails group_list_contains docker "ubuntu adm"
assert_fails group_list_contains dock "ubuntu docker"

grep -Fq 'root:root:750' "$INSTALLER" || fail "operator mode check must be root:root:750"
grep -Fq 'root:root:700' "$INSTALLER" || fail "log directory mode check must be root:root:700"
grep -Fq 'ubuntu:ubuntu:640' "$INSTALLER" || fail "shared lock mode check must allow the deploy user"
grep -Fq 'db-route-state' "$INSTALLER" || fail "route state path must be installed per environment"
grep -Fq 'ROUTE_STATE_ROOT="/opt/babyjamjam/db-failover-state"' "$INSTALLER" \
    || fail "route state must use a dedicated root-only state root"
grep -Fq 'ensure_route_state_directory' "$INSTALLER" \
    || fail "installer must create and validate dedicated route state directories"
grep -Fq 'root:root:700' "$INSTALLER" || fail "route state directories must remain root-owned and mode 0700"
grep -Fq 'root:root:600' "$INSTALLER" || fail "route state must remain root-owned and mode 0600"
if grep -Eq 'sudoers|NOPASSWD' "$INSTALLER"; then
    fail "CI operator installer must not create a sudo path"
fi

echo "install-ci-operator tests passed"
