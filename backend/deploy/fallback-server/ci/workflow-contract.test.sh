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

assert_text_contains() {
    grep -Eq -- "$2" <<<"$1" || fail "$3"
}

assert_contains "$WORKFLOW" '^  resolve-backend-deploy-target:' \
    "backend CI must resolve exactly one production deployment target"
assert_contains "$WORKFLOW" 'name:[[:space:]]*build immutable backend image' \
    "the shared backend artifact must not be presented as a Lightsail-only image"
assert_contains "$WORKFLOW" '^  wait-database-patches:' \
    "backend CI must wait for the same-commit Database Patches run before resolving a deploy target"
assert_contains "$WORKFLOW" 'run: bash backend/deploy/ci/wait-database-patches.sh' \
    "the wait job must run the wait-database-patches script"

# Extract one top-level job's block: from its header line up to (but not
# including) the next top-level job header — generic over whichever job
# happens to follow next in the file, so reordering jobs doesn't silently
# widen or narrow the range.
extract_job() {
    local header_pattern="$1"
    awk -v header="$header_pattern" '
        $0 ~ header { found=1; print; next }
        found && /^  [a-z0-9-]*:$/ { exit }
        found { print }
    ' "$WORKFLOW"
}

verify_job="$(extract_job '^  verify:')"
assert_text_contains "$verify_job" 'Show production backend target before main promotion' \
    "the required backend check must show the production target before main promotion"
assert_text_contains "$verify_job" "github\.event_name == 'pull_request' && github\.base_ref == 'main'" \
    "the production-target preflight must run only for pull requests targeting main"
assert_text_contains "$verify_job" 'DEPLOY_REF_NAME:[[:space:]]*main' \
    "the pre-main target preflight must resolve the production route"
assert_text_contains "$verify_job" 'Production backend deployment target' \
    "the pre-main target preflight must publish a visible Actions summary"
assert_text_contains "$verify_job" '::notice title=Production backend target' \
    "the pre-main target preflight must publish a visible Actions notice"

wait_job="$(extract_job '^  wait-database-patches:')"
assert_text_contains "$wait_job" 'group:[[:space:]]*backend-deploy-wait-' \
    "the wait job must use a backend-deploy-wait- concurrency group so a newer push cancels an older run's wait"
assert_text_contains "$wait_job" 'cancel-in-progress:[[:space:]]*true' \
    "the wait job's concurrency group must cancel an in-progress (stale) wait, not queue behind it"

resolve_target_job="$(extract_job '^  resolve-backend-deploy-target:')"
assert_text_contains "$resolve_target_job" 'needs:[[:space:]]*\[build-lightsail-image,[[:space:]]*wait-database-patches\]' \
    "target resolution must depend on the Database Patches wait job"
assert_text_contains "$resolve_target_job" "needs\.wait-database-patches\.result == 'success'" \
    "target resolution must require the Database Patches wait job to succeed"
# The joined (newline-folded) form catches a weakened `&&` -> `||` between
# the two build/wait success checks, which the two separate substring
# assertions above would not: each half would still be present verbatim.
resolve_target_job_joined="$(tr '\n' ' ' <<<"$resolve_target_job")"
assert_text_contains "$resolve_target_job_joined" \
    "needs\.build-lightsail-image\.result == 'success' &&[[:space:]]+needs\.wait-database-patches\.result == 'success'" \
    "target resolution must require BOTH the build and the Database Patches wait job to succeed (not just either)"
assert_contains "$WORKFLOW" 'resolve-deploy-target\.mjs' \
    "backend CI must use the fail-closed target resolver"
assert_text_contains "$resolve_target_job" 'Backend deployment target' \
    "the push-time target resolver must publish a visible Actions summary"
assert_text_contains "$resolve_target_job" '::notice title=Backend deployment target' \
    "the push-time target resolver must publish a visible Actions notice"
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
assert_contains "$WORKFLOW" 'expect_status lease_mode required' \
    "LightNode replacement must confirm the deployed runtime contests the scheduler lease (ADR-010)"

echo "Fallback deployment workflow contract tests passed"
