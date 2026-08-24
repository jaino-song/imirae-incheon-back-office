#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_SCRIPT="$SCRIPT_DIR/ci-operator.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_fails() {
    local command_status

    set +e
    "$@" >/dev/null 2>&1
    command_status=$?
    set -e
    if [[ "$command_status" -eq 0 ]]; then
        fail "expected command to fail: $*"
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"

    [[ "$haystack" == *"$needle"* ]] || fail "missing '$needle' in '$haystack'"
}

[[ -r "$OPERATOR_SCRIPT" ]] || fail "missing CI operator: $OPERATOR_SCRIPT"

# shellcheck source=backend/deploy/lightsail/ci-operator.sh
source "$OPERATOR_SCRIPT"

valid_uuid="123e4567-e89b-12d3-a456-426614174000"
configure_environment preview

acquire_lock() { :; }
probe_env_mode="valid"
validate_backend_env_file() { [[ "$probe_env_mode" == "valid" ]]; }
ensure_route_state() { :; }
write_route_state() { write_count=$((write_count + 1)); }
current_epoch() { echo "$test_now"; }
load_current_release_identity() {
    CURRENT_ROUTE_IMAGE_TAG="known-good"
    CURRENT_ROUTE_IMAGE_DIGEST="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}

probe_image_id="sha256:probe-image"
probe_secret_url="postgres""ql://db-user:db-password@example.invalid/db?sslmode=require"
probe_docker_mode="valid"
probe_invocations=()
run_as_deployer() {
    local invocation="$*"

    probe_invocations+=("$invocation")
    if [[ "$invocation" == *"image inspect --format {{.Id}} babyjamjam-backend:known-good"* ]]; then
        printf '%s\n' "$probe_image_id"
    elif [[ "$invocation" == *"image inspect --format {{join .RepoDigests"* ]]; then
        if [[ "$probe_docker_mode" == "valid" ]]; then
            printf '%s\n' "ghcr.io/jaino-song/babyjamjam-admin-backend@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        else
            printf '%s\n' "ghcr.io/jaino-song/babyjamjam-admin-backend@sha256:bad"
        fi
    elif [[ "$invocation" == *"image inspect --format {{.Id}} ghcr.io/jaino-song/babyjamjam-admin-backend@sha256:"* ]]; then
        printf '%s\n' "$probe_image_id"
    elif [[ "$invocation" == *"docker run --rm --pull=never"* ]]; then
        printf '%s\n' "$probe_secret_url"
    else
        fail "unexpected probe docker invocation: $invocation"
    fi
}

find_api_container_optional() {
    fail "database probes must not require a running API container"
}

probe_shared_outcomes=()
probe_direct_outcomes=()
probe_shared_index=0
probe_direct_index=0
probe_secret_output=false
verify_outcomes=()
probe_route() {
    local route="$1"
    local outcome

    if [[ "$probe_secret_output" == true ]]; then
        printf '%s\n' "$probe_secret_url"
    fi

    if [[ "$route" == "shared" ]]; then
        outcome="${probe_shared_outcomes[$probe_shared_index]:-fail}"
        probe_shared_index=$((probe_shared_index + 1))
    else
        outcome="${probe_direct_outcomes[$probe_direct_index]:-fail}"
        probe_direct_index=$((probe_direct_index + 1))
    fi
    [[ "$outcome" == "ok" ]]
}

recreate_calls=()
recreate_api_for_route() {
    recreate_calls+=("$1")
    return "${recreate_result:-0}"
}

verify_api_runtime() {
    local outcome

    verify_calls+=("$1")
    outcome="${verify_outcomes[0]:-${verify_result:-0}}"
    if ((${#verify_outcomes[@]} > 0)); then
        verify_outcomes=("${verify_outcomes[@]:1}")
    fi
    return "$outcome"
}

reset_state() {
    test_now=100000
    write_count=0
    recreate_calls=()
    verify_calls=()
    verify_outcomes=()
    probe_shared_index=0
    probe_direct_index=0
    probe_secret_output=false
    probe_docker_mode=valid
    probe_env_mode=valid
    probe_invocations=()
    recreate_result=0
    verify_result=0
    ROUTE_STATE_VERSION=1
    ROUTE_STATE_GENERATION=0
    ROUTE_STATE_ACTIVE_ROUTE=shared
    ROUTE_STATE_PHASE=SHARED_ACTIVE
    ROUTE_STATE_TRANSITION_STARTED_AT=0
    ROUTE_STATE_DIRECT_ACTIVATED_AT=0
    ROUTE_STATE_SHARED_FAILURE_COUNT=0
    ROUTE_STATE_DIRECT_SUCCESS_COUNT=0
    ROUTE_STATE_DIRECT_FAILURE_COUNT=0
    ROUTE_STATE_SHARED_SUCCESS_COUNT=0
    ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT=0
    ROUTE_STATE_SHARED_SUCCESS_STARTED_AT=0
    ROUTE_STATE_SHARED_SUCCESS_LAST_AT=0
    ROUTE_STATE_NORMAL_ROUNDTRIP_COUNT=0
    ROUTE_STATE_ROUNDTRIP_WINDOW_STARTED_AT=100000
    ROUTE_STATE_LAST_REQUEST_ID=""
    ROUTE_STATE_LAST_PROBE_ROUTE=""
    ROUTE_STATE_LAST_PROBE_RESULT=none
    ROUTE_STATE_LAST_PROBE_AT=0
    ROUTE_STATE_LAST_RESULT=initialized
    ROUTE_STATE_TERMINAL_REASON=""
}

reset_state
rm -f /tmp/db-failover-test-output
probe_shared_outcomes=(fail fail fail)
probe_direct_outcomes=(ok ok ok)
RECONCILE_REQUEST_ID="$valid_uuid"
for _attempt in 1 2; do
    reconcile_shared_active "$test_now" >>/tmp/db-failover-test-output
done
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" ]] || fail "shared-to-direct transition happened before three paired results"
[[ "$ROUTE_STATE_DIRECT_SUCCESS_COUNT" == "2" ]] || fail "direct success evidence did not count each paired result"
[[ -z "${recreate_calls[*]-}" ]] || fail "unexpected recreate before the third paired result"
reconcile_shared_active "$test_now" >>/tmp/db-failover-test-output
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "direct" ]] || fail "shared-to-direct transition did not activate direct"
[[ "${recreate_calls[*]}" == "direct" ]] || fail "unexpected recreate sequence: ${recreate_calls[*]}"
assert_contains "$(< /tmp/db-failover-test-output)" '"result":"route_switched"'
assert_contains "$(< /tmp/db-failover-test-output)" '"activeRoute":"DIRECT"'

reset_state
route_before="$ROUTE_STATE_ACTIVE_ROUTE"
generation_before="$ROUTE_STATE_GENERATION"
probe_invocations=()
run_probe_query direct >/tmp/db-failover-probe-output 2>&1
probe_output="$(</tmp/db-failover-probe-output)"
[[ -z "$probe_output" ]] || fail "database probe emitted output: $probe_output"
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "$route_before" ]] || fail "database probe mutated the active route"
[[ "$ROUTE_STATE_GENERATION" == "$generation_before" ]] || fail "database probe mutated route generation"
[[ "$write_count" == "0" ]] || fail "database probe wrote route state"
probe_run_invocation="${probe_invocations[*]}"
assert_contains "$probe_run_invocation" "docker run --rm --pull=never"
assert_contains "$probe_run_invocation" "--network babyjamjam-backend-preview_backend"
assert_contains "$probe_run_invocation" "--env-file $BACKEND_ENV_FILE"
assert_contains "$probe_run_invocation" "--env DATABASE_CONNECTION_MODE=direct"
assert_contains "$probe_run_invocation" "--entrypoint /usr/local/bin/node"
assert_contains "$probe_run_invocation" "ghcr.io/jaino-song/babyjamjam-admin-backend@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
assert_contains "$PROBE_NODE_SCRIPT" 'searchParams.set("connection_limit", "1")'
assert_contains "$PROBE_NODE_SCRIPT" 'setTimeout(() => finish(1), 5000)'
assert_contains "$PROBE_NODE_SCRIPT" 'SELECT 1'
[[ "$probe_run_invocation" != *"docker exec"* ]] || fail "database probe used docker exec"
[[ "$probe_run_invocation" != *"docker compose"* ]] || fail "database probe used Compose"
[[ "$probe_run_invocation" != *"dist/main.js"* ]] || fail "database probe started the application"
[[ "$probe_run_invocation" != *"SCHEDULERS_ENABLED"* ]] || fail "database probe passed scheduler configuration"
[[ "$probe_run_invocation" != *"VALKEY"* ]] || fail "database probe passed dependency configuration"
[[ "$probe_run_invocation" != *"postgresql://"* ]] || fail "database probe logged a database URL"

reset_state
probe_docker_mode=invalid
assert_fails run_probe_query direct
[[ "${probe_invocations[*]-}" != *"docker run --rm --pull=never"* ]] \
    || fail "database probe ran with an unproven image digest"

reset_state
probe_env_mode=invalid
assert_fails run_probe_query direct
[[ "${probe_invocations[*]-}" != *"docker run --rm --pull=never"* ]] \
    || fail "database probe ran with an unproven environment file"

reset_state
ROUTE_STATE_SHARED_FAILURE_COUNT=5
ROUTE_STATE_DIRECT_SUCCESS_COUNT=0
probe_shared_outcomes=(fail)
probe_direct_outcomes=(ok)
RECONCILE_REQUEST_ID="$valid_uuid"
reconcile_shared_active "$test_now" >/dev/null
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" ]] || fail "shared route changed before direct evidence was complete"
[[ -z "${recreate_calls[*]-}" ]] || fail "unexpected recreate before direct evidence was complete"

reset_state
probe_shared_outcomes=(fail)
probe_direct_outcomes=(fail)
RECONCILE_REQUEST_ID="$valid_uuid"
assert_fails reconcile_shared_active "$test_now"
[[ "$ROUTE_STATE_PHASE" == "BLOCKED" ]] || fail "both-down state was not blocked"
[[ -z "${recreate_calls[*]-}" ]] || fail "both-down state recreated the API"

reset_state
ROUTE_STATE_ACTIVE_ROUTE=direct
ROUTE_STATE_PHASE=DIRECT_ACTIVE
ROUTE_STATE_DIRECT_ACTIVATED_AT=$((test_now - DIRECT_MINIMUM_HOLD_SECONDS - 1))
ROUTE_STATE_SHARED_SUCCESS_COUNT=29
ROUTE_STATE_SHARED_SUCCESS_LAST_AT=$((test_now - 1))
probe_shared_outcomes=(ok)
probe_direct_outcomes=(ok)
RECONCILE_REQUEST_ID="$valid_uuid"
reconcile_direct_active "$test_now" >/dev/null
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" ]] || fail "normal direct-to-shared failback did not activate shared"

reset_state
ROUTE_STATE_ACTIVE_ROUTE=direct
ROUTE_STATE_PHASE=DIRECT_ACTIVE
probe_shared_outcomes=(ok ok ok)
probe_direct_outcomes=(fail fail fail)
RECONCILE_REQUEST_ID="$valid_uuid"
reconcile_direct_active "$test_now" >/dev/null
reconcile_direct_active "$test_now" >/dev/null
reconcile_direct_active "$test_now" >/dev/null
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" ]] || fail "emergency shared return did not activate shared"

reset_state
ROUTE_STATE_SHARED_FAILURE_COUNT=5
ROUTE_STATE_DIRECT_SUCCESS_COUNT=2
ROUTE_STATE_NORMAL_ROUNDTRIP_COUNT=2
probe_shared_outcomes=(fail)
probe_direct_outcomes=(ok)
RECONCILE_REQUEST_ID="$valid_uuid"
assert_fails reconcile_shared_active "$test_now"
[[ "$ROUTE_STATE_PHASE" == "BLOCKED" ]] || fail "third normal roundtrip was not blocked"
[[ -z "${recreate_calls[*]-}" ]] || fail "budget block recreated the API"

reset_state
ROUTE_STATE_ACTIVE_ROUTE=shared
ROUTE_STATE_PHASE=SHARED_ACTIVE
route_before="$ROUTE_STATE_ACTIVE_ROUTE"
probe_shared_outcomes=(ok)
db_probe shared "$valid_uuid" >/dev/null
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "$route_before" ]] || fail "db-probe mutated the active route"
[[ "$write_count" == "0" ]] || fail "db-probe mutated route state"

reset_state
probe_secret_output=true
probe_shared_outcomes=(ok)
probe_output="$(db_probe shared "$valid_uuid")"
[[ "$probe_output" != *"$probe_secret_url"* ]] || fail "db-probe exposed a database URL"
[[ "$probe_output" == *"db_probe=ok"* ]] || fail "db-probe did not return generic success"

reset_state
ROUTE_STATE_SHARED_FAILURE_COUNT=5
ROUTE_STATE_DIRECT_SUCCESS_COUNT=2
probe_shared_outcomes=(fail)
probe_direct_outcomes=(ok)
recreate_result=0
verify_result=1
verify_outcomes=(1 0)
RECONCILE_REQUEST_ID="$valid_uuid"
reconcile_shared_active "$test_now" >/dev/null
[[ "${recreate_calls[*]}" == "direct shared" ]] || fail "compensation did not recreate exactly target then previous route"
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" ]] || fail "successful compensation did not retain previous route"
[[ "$ROUTE_STATE_LAST_RESULT" == "transition_failed_compensated" ]] || fail "compensation result was not recorded"

reset_state
ROUTE_STATE_SHARED_FAILURE_COUNT=5
ROUTE_STATE_DIRECT_SUCCESS_COUNT=2
probe_shared_outcomes=(fail)
probe_direct_outcomes=(ok)
recreate_result=0
verify_result=1
verify_outcomes=(1 1)
recreate_api_for_route() {
    recreate_calls+=("$1")
    if [[ "$1" == "shared" ]]; then
        return 1
    fi
    return 0
}
RECONCILE_REQUEST_ID="$valid_uuid"
assert_fails reconcile_shared_active "$test_now"
[[ "${recreate_calls[*]}" == "direct shared" ]] || fail "failed compensation did not stop after one restore attempt"
[[ "$ROUTE_STATE_PHASE" == "DEGRADED" ]] || fail "failed compensation did not become terminal degraded"

rm -f /tmp/db-failover-test-output
echo "db-failover-operator tests passed"
