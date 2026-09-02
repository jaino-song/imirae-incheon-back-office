#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPOSITORY_ROOT="$(git -C "$SCRIPT_ROOT" rev-parse --show-toplevel)"
readonly WORKFLOW="$REPOSITORY_ROOT/.github/workflows/backend-ci.yml"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    grep -Eq -- "$2" "$1" || fail "$3"
}

assert_contains "$WORKFLOW" '^  resolve-backend-deploy-target:' \
    "backend CI must resolve exactly one production deployment target"
assert_contains "$WORKFLOW" 'resolve-deploy-target\.mjs' \
    "backend CI must use the fail-closed target resolver"
assert_contains "$WORKFLOW" 'FALLBACK_DNS_SHA256' \
    "backend CI must compare the current route with the protected fallback identity"
assert_contains "$WORKFLOW" 'LIGHTSAIL_DNS_SHA256' \
    "backend CI must compare the current route with the protected Lightsail identity"
assert_contains "$WORKFLOW" '^  deploy-lightnode:' \
    "backend CI must define the LightNode replacement job"
assert_contains "$WORKFLOW" '^  lightnode-connection-smoke:' \
    "backend CI must expose a read-only LightNode connection smoke"
assert_contains "$WORKFLOW" "inputs.operation == 'lightnode-status'" \
    "LightNode connection smoke must require an explicit manual operation"
assert_contains "$WORKFLOW" "needs\.resolve-backend-deploy-target\.outputs\.target == 'lightnode'" \
    "LightNode deployment must require the resolved LightNode target"
assert_contains "$WORKFLOW" "needs\.resolve-backend-deploy-target\.outputs\.target == 'lightsail'" \
    "Lightsail deployment must require the resolved Lightsail target"
assert_contains "$WORKFLOW" "'status'" \
    "LightNode deployment must invoke only the forced status command"
assert_contains "$WORKFLOW" '"replace \$GITHUB_SHA \$IMAGE_DIGEST"' \
    "LightNode deployment must invoke only the forced replacement command"
assert_contains "$WORKFLOW" 'StrictHostKeyChecking=yes' \
    "LightNode SSH must fail closed on host-key mismatch"
assert_contains "$WORKFLOW" 'count == 1 && value != ""' \
    "LightNode status reader must reject missing or duplicated status keys"
assert_contains "$WORKFLOW" '::error::LightNode status' \
    "LightNode status assertions must fail with a visible reason"

echo "Fallback deployment workflow contract tests passed"
