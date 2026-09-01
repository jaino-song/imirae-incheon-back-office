#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly DEPLOYER="$SCRIPT_ROOT/ci-deployer.sh"
readonly INSTALLER="$SCRIPT_ROOT/install-ci-deployer.sh"
readonly DISPATCHER="$SCRIPT_ROOT/ssh-dispatch.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    grep -Eq -- "$2" "$1" || fail "$3"
}

assert_not_contains() {
    if grep -Eq -- "$2" "$1"; then fail "$3"; fi
}

[[ -r "$DEPLOYER" ]] || fail "missing restricted LightNode CI deployer"
[[ -r "$INSTALLER" ]] || fail "missing restricted LightNode CI deployer installer"
[[ -r "$DISPATCHER" ]] || fail "missing forced-command SSH dispatcher"

assert_contains "$DEPLOYER" 'SUDO_USER' \
    "deployer must bind authority to the dedicated SSH user"
assert_contains "$DEPLOYER" 'DEPLOY_USER="babyjamjam-ci-deployer"' \
    "deployer must pin the dedicated SSH user identity"
assert_contains "$DEPLOYER" 'automatic-deploy-authority' \
    "deployer must require an explicit root-owned automation authority artifact"
assert_contains "$DEPLOYER" 'approved-public-routing\.sha256' \
    "deployer must verify the protected public routing identity"
assert_contains "$DEPLOYER" 'status_value runtime_mode' \
    "deployer must require an active fallback runtime"
assert_contains "$DEPLOYER" 'temporary-active' \
    "deployer must pin the active fallback mode"
assert_contains "$DEPLOYER" 'replace-temporary-active' \
    "deployer must delegate replacement to the rollback-capable operator"
assert_contains "$DEPLOYER" 'current_tag' \
    "deployer must verify the final immutable release identity"
assert_not_contains "$DEPLOYER" '(AWS_ACCESS_KEY|AWS_SECRET|docker[[:space:]]+build|git[[:space:]]+checkout)' \
    "deployer must not accept cloud credentials or build mutable source"

assert_contains "$INSTALLER" 'babyjamjam-ci-deployer' \
    "installer must require the dedicated deployment user"
assert_contains "$INSTALLER" 'docker.*group' \
    "installer must reject Docker-group privilege"
assert_contains "$INSTALLER" '/etc/sudoers\.d/babyjamjam-fallback-ci-deployer' \
    "installer must install one dedicated sudoers rule"
assert_contains "$INSTALLER" 'visudo -cf' \
    "installer must validate the sudoers rule before activation"
assert_not_contains "$INSTALLER" '(authorized_keys|ssh-rsa|BEGIN .*PRIVATE KEY)' \
    "installer must not provision or embed SSH credentials"
assert_contains "$DISPATCHER" 'SSH_ORIGINAL_COMMAND' \
    "dispatcher must ignore the login shell and parse only the forced original command"
assert_contains "$DISPATCHER" '^    status\)' \
    "dispatcher must allow the fixed status command"
assert_contains "$DISPATCHER" '\[0-9a-f\]\{40\}' \
    "dispatcher must strictly validate replacement identity"
assert_contains "$DISPATCHER" 'sha256:\[0-9a-f\]\{64\}' \
    "dispatcher must strictly validate the immutable digest"
assert_not_contains "$DISPATCHER" '(eval|bash -c|sh -c)' \
    "dispatcher must not evaluate the original SSH command"

bash -n "$DEPLOYER" "$INSTALLER" "$DISPATCHER"
if [[ "$EUID" -ne 0 ]]; then
    if "$DEPLOYER" status >/dev/null 2>&1; then
        fail "deployer must reject direct non-root execution"
    fi
    if "$INSTALLER" >/dev/null 2>&1; then
        fail "installer must reject direct non-root execution"
    fi
fi
echo "Fallback CI deployer contract tests passed"
