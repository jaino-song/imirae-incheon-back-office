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
    [[ "$command_status" -ne 0 ]] || fail "expected command to fail: $*"
}

assert_contains() {
    local haystack="$1"
    local needle="$2"

    [[ "$haystack" == *"$needle"* ]] || fail "missing '$needle' in '$haystack'"
}

assert_not_contains() {
    local haystack="$1"
    local needle="$2"

    [[ "$haystack" != *"$needle"* ]] || fail "unexpected '$needle' in '$haystack'"
}

assert_complete_envelope() {
    local envelope="$1"

    printf '%s\n' "$envelope" | node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(0, "utf8").trim();
if (!raw || raw.split(/\r?\n/).length !== 1) throw new Error("reconcile output must be one JSON line");
const value = JSON.parse(raw);
const required = [
  "schemaVersion", "source", "environment", "requestId", "hostGeneration",
  "activeRoute", "phase", "result", "sharedOk", "directOk",
  "sharedFailureCount", "directSuccessCount", "directFailureCount",
  "emergencySharedSuccessCount", "sharedHealthyCount", "directActivatedAt",
  "sharedHealthyStartedAt", "sharedHealthyLastAt", "cooldownUntil",
  "recentNormalRoundTrips", "transition",
];
for (const key of required) if (!(key in value)) throw new Error(`missing ${key}`);
if (value.schemaVersion !== 1 || value.source !== "babyjamjam-db-failover-host") throw new Error("bad envelope identity");
if (!Number.isInteger(value.hostGeneration) || value.hostGeneration < 0) throw new Error("bad generation");
if (!["SHARED", "DIRECT"].includes(value.activeRoute)) throw new Error("bad route");
if (!["SHARED_ACTIVE", "SWITCHING_TO_DIRECT", "DIRECT_ACTIVE", "RECOVERING_SHARED", "SWITCHING_TO_SHARED", "BLOCKED", "DEGRADED"].includes(value.phase)) throw new Error("bad phase");
for (const key of ["sharedFailureCount", "directSuccessCount", "directFailureCount", "emergencySharedSuccessCount", "sharedHealthyCount", "directActivatedAt", "sharedHealthyStartedAt", "sharedHealthyLastAt", "cooldownUntil"]) {
  if (!Number.isInteger(value[key]) || value[key] < 0) throw new Error(`bad nonnegative field ${key}`);
}
if (![null, true, false].includes(value.sharedOk) || ![null, true, false].includes(value.directOk)) throw new Error("bad probe booleans");
if (!Array.isArray(value.recentNormalRoundTrips) || value.recentNormalRoundTrips.some((entry) => !Number.isInteger(entry) || entry < 0)) throw new Error("bad history");
const transition = value.transition;
for (const key of ["previousRoute", "targetRoute", "startedAt", "generation", "terminalReason"]) if (!(key in transition)) throw new Error(`missing transition ${key}`);
for (const key of ["previousRoute", "targetRoute"]) if (transition[key] !== null && !["SHARED", "DIRECT"].includes(transition[key])) throw new Error("bad transition route");
if (!Number.isInteger(transition.startedAt) || transition.startedAt < 0 || !Number.isInteger(transition.generation) || transition.generation < 0) throw new Error("bad transition timestamps");
' || fail "invalid reconcile envelope: $envelope"
}

assert_worker_parser_accepts() {
    local envelope="$1"
    local expected_request_id="$2"

    printf '%s' "$envelope" | \
    PARSER_EXPECTED_REQUEST_ID="$expected_request_id" \
    PARSER_MODULE="$SCRIPT_DIR/sentry-db-failover/src/worker.mjs" \
    node --input-type=module -e '
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const { parseStatusOutput } = await import(pathToFileURL(process.env.PARSER_MODULE).href);
const raw = fs.readFileSync(0, "utf8");
const parsed = parseStatusOutput(raw, {
  environment: "preview",
  requestId: process.env.PARSER_EXPECTED_REQUEST_ID,
});
if (!parsed || parsed.environment !== "preview" || parsed.requestId !== process.env.PARSER_EXPECTED_REQUEST_ID) {
  throw new Error("worker parser rejected the host envelope");
}
' || fail "worker parser rejected ci-operator output"
}

[[ -r "$OPERATOR_SCRIPT" ]] || fail "missing CI operator: $OPERATOR_SCRIPT"

# shellcheck source=backend/deploy/lightsail/ci-operator.sh
source "$OPERATOR_SCRIPT"

valid_uuid="123e4567-e89b-12d3-a456-426614174000"
second_uuid="223e4567-e89b-12d3-a456-426614174000"
third_uuid="323e4567-e89b-12d3-a456-426614174000"

request_id_for_index() {
    printf '423e4567-e89b-42d3-a456-%012x\n' "$1"
}
configure_environment preview

acquire_lock() { :; }
ensure_route_state() { :; }
load_route_state() { :; }
validate_backend_env_file() { return 0; }
current_epoch() { echo "$test_now"; }
load_current_release_identity() {
    CURRENT_ROUTE_IMAGE_TAG="known-good"
    CURRENT_ROUTE_IMAGE_DIGEST="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}

probe_secret_url="postgres""ql://db-user:db-password@example.invalid/db?sslmode=require"
probe_image_id="sha256:probe-image"
probe_docker_mode="valid"
probe_invocations=()
run_as_root() {
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

probe_shared_outcomes=()
probe_direct_outcomes=()
probe_shared_index=0
probe_direct_index=0
probe_secret_output=false
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
recreate_result=0
recreate_api_for_route() {
    recreate_calls+=("$1")
    return "$recreate_result"
}

verify_calls=()
verify_result=0
verify_outcomes=()
verify_api_runtime() {
    local outcome

    verify_calls+=("$1")
    outcome="${verify_outcomes[0]:-$verify_result}"
    if ((${#verify_outcomes[@]} > 0)); then
        verify_outcomes=("${verify_outcomes[@]:1}")
    fi
    return "$outcome"
}

write_count=0
write_route_state() {
    write_count=$((write_count + 1))
}

reset_state() {
    test_now=100000
    write_count=0
    recreate_calls=()
    verify_calls=()
    verify_outcomes=()
    recreate_result=0
    verify_result=0
    probe_shared_index=0
    probe_direct_index=0
    probe_invocations=()
    probe_shared_outcomes=()
    probe_direct_outcomes=()
    probe_secret_output=false
    probe_docker_mode=valid
    RECONCILE_REQUEST_ID="$valid_uuid"
    RECONCILE_OUTPUT_PERSIST=false
    ROUTE_STATE_VERSION="$ROUTE_STATE_FORMAT_VERSION"
    ROUTE_STATE_GENERATION=0
    ROUTE_STATE_ACTIVE_ROUTE=shared
    ROUTE_STATE_PHASE=SHARED_ACTIVE
    ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE=""
    ROUTE_STATE_TRANSITION_TARGET_ROUTE=""
    ROUTE_STATE_TRANSITION_STARTED_AT=0
    ROUTE_STATE_TRANSITION_GENERATION=0
    ROUTE_STATE_DIRECT_ACTIVATED_AT=0
    ROUTE_STATE_SHARED_FAILURE_COUNT=0
    ROUTE_STATE_DIRECT_SUCCESS_COUNT=0
    ROUTE_STATE_DIRECT_FAILURE_COUNT=0
    ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT=0
    ROUTE_STATE_SHARED_SUCCESS_COUNT=0
    ROUTE_STATE_SHARED_SUCCESS_STARTED_AT=0
    ROUTE_STATE_SHARED_SUCCESS_LAST_AT=0
    ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY=""
    ROUTE_STATE_COOLDOWN_UNTIL=0
    ROUTE_STATE_LAST_REQUEST_ID=""
    ROUTE_STATE_REQUEST_HISTORY=""
    ROUTE_STATE_LAST_PROBE_ROUTE=""
    ROUTE_STATE_LAST_PROBE_RESULT=none
    ROUTE_STATE_LAST_PROBE_AT=0
    ROUTE_STATE_LAST_SHARED_OK=null
    ROUTE_STATE_LAST_DIRECT_OK=null
    ROUTE_STATE_LAST_RESULT=initialized
    ROUTE_STATE_TERMINAL_REASON=""
}

run_reconcile() {
    local request_id="$1"
    local output_file="$2"

    : >"$output_file"
    set +e
    db_reconcile "$request_id" >"$output_file"
    RUN_STATUS=$?
    set -e
    RUN_OUTPUT="$(<"$output_file")"
}

run_shared_reconcile() {
    local now="$1"
    local output_file="$2"

    test_now="$now"
    : >"$output_file"
    set +e
    reconcile_shared_active "$now" >"$output_file"
    RUN_STATUS=$?
    set -e
    RUN_OUTPUT="$(<"$output_file")"
}

run_direct_reconcile() {
    local now="$1"
    local output_file="$2"

    test_now="$now"
    : >"$output_file"
    set +e
    reconcile_direct_active "$now" >"$output_file"
    RUN_STATUS=$?
    set -e
    RUN_OUTPUT="$(<"$output_file")"
}

output_file="$(mktemp /tmp/db-failover-operator.XXXXXX)"
trap 'rm -f "$output_file" /tmp/db-failover-state-test.XXXXXX /tmp/db-failover-probe-output' EXIT

# Every new request owns exactly one new host generation. A duplicate UUID is
# a read-only replay of the persisted result, including terminal results.
reset_state
probe_shared_outcomes=(ok ok)
run_reconcile "$valid_uuid" "$output_file"
[[ "$RUN_STATUS" -eq 0 && "$ROUTE_STATE_GENERATION" == "1" ]] || fail "first reconcile did not allocate generation one"
first_output="$RUN_OUTPUT"
assert_complete_envelope "$first_output"
assert_worker_parser_accepts "$first_output" "$valid_uuid"
run_reconcile "$second_uuid" "$output_file"
[[ "$RUN_STATUS" -eq 0 && "$ROUTE_STATE_GENERATION" == "2" ]] || fail "new reconcile did not increment generation"
second_output="$RUN_OUTPUT"
assert_complete_envelope "$second_output"
probe_count_before_duplicate="$probe_shared_index"
shared_failures_before_duplicate="$ROUTE_STATE_SHARED_FAILURE_COUNT"
run_reconcile "$second_uuid" "$output_file"
[[ "$RUN_STATUS" -eq 0 && "$ROUTE_STATE_GENERATION" == "2" ]] || fail "duplicate reconcile changed generation"
[[ "$RUN_OUTPUT" == "$second_output" ]] || fail "duplicate reconcile did not return the prior envelope"
[[ "$probe_shared_index" == "$probe_count_before_duplicate" ]] || fail "duplicate reconcile re-ran probes"
[[ "$ROUTE_STATE_SHARED_FAILURE_COUNT" == "$shared_failures_before_duplicate" ]] || fail "duplicate reconcile changed counters"

# A request remains read-only after another request interleaves. The bounded
# durable history prevents the one-slot last-request marker from re-executing A.
reset_state
probe_shared_outcomes=(ok ok ok)
run_reconcile "$valid_uuid" "$output_file"
run_reconcile "$second_uuid" "$output_file"
probe_count_before_interleaved_replay="$probe_shared_index"
generation_before_interleaved_replay="$ROUTE_STATE_GENERATION"
run_reconcile "$valid_uuid" "$output_file"
[[ "$RUN_STATUS" -eq 0 && "$ROUTE_STATE_GENERATION" == "$generation_before_interleaved_replay" \
    && "$probe_shared_index" == "$probe_count_before_interleaved_replay" ]] \
    || fail "interleaved old request re-executed host reconciliation"
assert_complete_envelope "$RUN_OUTPUT"

# The replay history is bounded, while retaining the full interleaving window.
reset_state
probe_shared_outcomes=()
for request_index in $(seq 0 32); do
    probe_shared_outcomes+=(ok)
    run_reconcile "$(request_id_for_index "$request_index")" "$output_file"
done
IFS=',' read -r -a request_history_items <<<"$ROUTE_STATE_REQUEST_HISTORY"
[[ "${#request_history_items[@]}" == "32" ]] || fail "request history exceeded its bound"

reset_state
probe_shared_outcomes=(fail)
probe_direct_outcomes=(fail)
run_reconcile "$third_uuid" "$output_file"
[[ "$RUN_STATUS" -ne 0 && "$ROUTE_STATE_PHASE" == "BLOCKED" && "$ROUTE_STATE_GENERATION" == "1" ]] \
    || fail "both-down reconcile did not durably block at generation one"
assert_contains "$RUN_OUTPUT" '"result":"both_routes_failed"'
assert_complete_envelope "$RUN_OUTPUT"
blocked_generation="$ROUTE_STATE_GENERATION"
blocked_failures="$ROUTE_STATE_DIRECT_FAILURE_COUNT"
run_reconcile "$valid_uuid" "$output_file"
[[ "$RUN_STATUS" -eq 0 && "$ROUTE_STATE_PHASE" == "BLOCKED" \
    && "$ROUTE_STATE_GENERATION" == "$((blocked_generation + 1))" \
    && "$ROUTE_STATE_DIRECT_FAILURE_COUNT" == "$blocked_failures" ]] \
    || fail "new terminal request did not preserve counters"
assert_contains "$RUN_OUTPUT" '"result":"terminal_state"'
assert_contains "$RUN_OUTPUT" '"terminalReason":"both_routes_failed"'
terminal_generation="$ROUTE_STATE_GENERATION"
run_reconcile "$valid_uuid" "$output_file"
[[ "$ROUTE_STATE_GENERATION" == "$terminal_generation" ]] || fail "duplicate terminal request changed generation"
assert_contains "$RUN_OUTPUT" '"result":"terminal_state"'
assert_complete_envelope "$RUN_OUTPUT"

# The old version and old fixed-bucket keys fail closed instead of being
# silently interpreted as the v2 rolling-history state.
ROUTE_STATE_FILE="$(mktemp /tmp/db-failover-state-test.XXXXXX)"
state_fixture="$ROUTE_STATE_FILE"
printf 'version=1\n' >"$ROUTE_STATE_FILE"
if bash -c 'source "$1"; configure_environment preview; ensure_route_state() { :; }; ROUTE_STATE_FILE="$2"; load_route_state' _ "$OPERATOR_SCRIPT" "$state_fixture" >/dev/null 2>&1; then
    fail "v1 route state was migrated implicitly"
fi
printf 'version=2\nnormal_roundtrip''_count=0\n' >"$ROUTE_STATE_FILE"
if bash -c 'source "$1"; configure_environment preview; ensure_route_state() { :; }; ROUTE_STATE_FILE="$2"; load_route_state' _ "$OPERATOR_SCRIPT" "$state_fixture" >/dev/null 2>&1; then
    fail "deprecated fixed-bucket state was accepted"
fi
rm -f "$ROUTE_STATE_FILE"

# Three paired Shared failures and Direct successes are still required, and a
# switch recreates only the API before proving the complete runtime.
reset_state
probe_shared_outcomes=(fail fail fail)
probe_direct_outcomes=(ok ok ok)
run_shared_reconcile 100000 "$output_file"
run_shared_reconcile 100060 "$output_file"
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" && "$ROUTE_STATE_DIRECT_SUCCESS_COUNT" == "2" ]] \
    || fail "failover switched before three paired probe results"
[[ -z "${recreate_calls[*]-}" ]] || fail "failover recreated before the third pair"
run_shared_reconcile 100120 "$output_file"
[[ "$RUN_STATUS" -eq 0 && "$ROUTE_STATE_ACTIVE_ROUTE" == "direct" ]] \
    || fail "three paired probes did not switch to direct"
[[ "${recreate_calls[*]-}" == "direct" && "${verify_calls[*]-}" == "direct" ]] \
    || fail "switch did not recreate and verify only the target API"
assert_contains "$RUN_OUTPUT" '"activeRoute":"DIRECT"'
assert_contains "$RUN_OUTPUT" '"cooldownUntil":100420'
assert_complete_envelope "$RUN_OUTPUT"

# A live transition still compensates the previous route exactly once. A
# failed compensation is terminal DEGRADED and is returned in the same safe
# envelope as every other reconcile outcome.
reset_state
probe_shared_outcomes=(fail fail fail)
probe_direct_outcomes=(ok ok ok)
verify_outcomes=(1 0)
run_shared_reconcile 100000 "$output_file"
run_shared_reconcile 100060 "$output_file"
run_shared_reconcile 100120 "$output_file"
[[ "$RUN_STATUS" -eq 0 && "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" \
    && "$ROUTE_STATE_LAST_RESULT" == "transition_failed_compensated" \
    && "${recreate_calls[*]-}" == "direct shared" ]] \
    || fail "live target failure did not compensate the previous route"
assert_complete_envelope "$RUN_OUTPUT"
reset_state
probe_shared_outcomes=(fail fail fail)
probe_direct_outcomes=(ok ok ok)
verify_outcomes=(1 1)
run_shared_reconcile 100000 "$output_file"
run_shared_reconcile 100060 "$output_file"
run_shared_reconcile 100120 "$output_file"
[[ "$RUN_STATUS" -ne 0 && "$ROUTE_STATE_PHASE" == "DEGRADED" \
    && "$ROUTE_STATE_LAST_RESULT" == "compensation_failed" \
    && "${recreate_calls[*]-}" == "direct shared" ]] \
    || fail "live compensation failure did not become terminal degraded"
assert_complete_envelope "$RUN_OUTPUT"

# Normal failover budget is a rolling timestamp history. The cutoff is
# inclusive: the exact six-hour boundary still consumes the budget, while a
# timestamp just beyond it is pruned.
reset_state
ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY="100000,100001"
test_now=121599
assert_fails reserve_normal_roundtrip "$test_now"
[[ "$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY" == "100000,100001" ]] || fail "just-before cutoff pruned history"
reset_state
ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY="100000,100001"
test_now=121600
assert_fails reserve_normal_roundtrip "$test_now"
[[ "$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY" == "100000,100001" ]] || fail "exact cutoff did not retain history"
reset_state
ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY="100000,100001"
test_now=121601
reserve_normal_roundtrip "$test_now"
[[ "$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY" == "100001,121601" ]] || fail "just-after cutoff did not prune one timestamp"

# A new normal failover cannot start during host cooldown; a successful switch
# sets the persisted cooldown for five minutes.
reset_state
ROUTE_STATE_COOLDOWN_UNTIL=100300
test_now=100000
transition_route shared direct >"$output_file"
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" && -z "${recreate_calls[*]-}" \
    && "$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY" == "" ]] || fail "cooldown did not block a new failover"
ROUTE_STATE_COOLDOWN_UNTIL=0
transition_route shared direct >"$output_file"
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "direct" && "$ROUTE_STATE_COOLDOWN_UNTIL" == "100300" ]] \
    || fail "successful failover did not persist cooldown"

# Shared evidence accepts exactly 45-90 seconds, ignores faster duplicate
# observations, and resets after a 91-second gap.
reset_state
record_shared_success 1000
record_shared_success 1044
[[ "$ROUTE_STATE_SHARED_SUCCESS_COUNT" == "1" && "$ROUTE_STATE_SHARED_SUCCESS_LAST_AT" == "1000" \
    && "$ROUTE_STATE_SHARED_SUCCESS_ACCEPTED" == "false" ]] || fail "44-second evidence was counted"
record_shared_success 1045
record_shared_success 1135
[[ "$ROUTE_STATE_SHARED_SUCCESS_COUNT" == "3" && "$ROUTE_STATE_SHARED_SUCCESS_LAST_AT" == "1135" ]] \
    || fail "45/90-second evidence boundary was rejected"
record_shared_success 1226
[[ "$ROUTE_STATE_SHARED_SUCCESS_COUNT" == "1" && "$ROUTE_STATE_SHARED_SUCCESS_STARTED_AT" == "1226" \
    && "$ROUTE_STATE_SHARED_SUCCESS_RESET" == "true" ]] || fail "91-second evidence gap did not reset"

reset_state
record_shared_success 1000
for _sample in $(seq 1 40); do record_shared_success 1000; done
[[ "$ROUTE_STATE_SHARED_SUCCESS_COUNT" == "1" ]] || fail "rapid Shared probes qualified as recovery"
reset_state
record_shared_success 1000
for _sample in $(seq 1 40); do
    record_shared_success $((1000 + (_sample * 120)))
done
[[ "$ROUTE_STATE_SHARED_SUCCESS_COUNT" == "1" ]] || fail "120-second Shared probes qualified as recovery"

# Thirty accepted one-minute probes plus 1740 seconds of elapsed evidence and
# the one-hour Direct hold are required before normal failback.
reset_state
ROUTE_STATE_ACTIVE_ROUTE=direct
ROUTE_STATE_PHASE=DIRECT_ACTIVE
ROUTE_STATE_DIRECT_ACTIVATED_AT=96000
test_now=100000
probe_direct_outcomes=()
probe_shared_outcomes=()
for _sample in $(seq 1 30); do
    probe_direct_outcomes+=(ok)
    probe_shared_outcomes+=(ok)
done
for _sample in $(seq 0 29); do
    test_now=$((100000 + (_sample * 60)))
    run_direct_reconcile "$test_now" "$output_file"
done
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" && "$ROUTE_STATE_SHARED_SUCCESS_COUNT" == "0" ]] \
    || fail "spaced thirty-probe failback did not switch to Shared"
assert_contains "$RUN_OUTPUT" '"activeRoute":"SHARED"'
assert_complete_envelope "$RUN_OUTPUT"

# Emergency Direct -> Shared recovery bypasses the Direct hold and cooldown,
# but it still uses the same accepted evidence spacing.
reset_state
ROUTE_STATE_ACTIVE_ROUTE=direct
ROUTE_STATE_PHASE=DIRECT_ACTIVE
ROUTE_STATE_DIRECT_ACTIVATED_AT=99999
ROUTE_STATE_COOLDOWN_UNTIL=200000
probe_direct_outcomes=(fail fail fail fail)
probe_shared_outcomes=(ok ok ok ok)
run_direct_reconcile 100000 "$output_file"
run_direct_reconcile 100044 "$output_file"
run_direct_reconcile 100089 "$output_file"
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "direct" \
    && "$ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT" == "2" ]] || fail "fast emergency evidence was counted"
run_direct_reconcile 100179 "$output_file"
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" ]] || fail "emergency failback did not bypass hold/cooldown"

# An interrupted switching state is compensated exactly once from the
# persisted previous route; it cannot promote the target from state alone.
reset_state
ROUTE_STATE_GENERATION=4
ROUTE_STATE_LAST_REQUEST_ID="$valid_uuid"
ROUTE_STATE_ACTIVE_ROUTE=shared
ROUTE_STATE_PHASE=SWITCHING_TO_DIRECT
ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE=shared
ROUTE_STATE_TRANSITION_TARGET_ROUTE=direct
ROUTE_STATE_TRANSITION_STARTED_AT=100000
ROUTE_STATE_TRANSITION_GENERATION=4
run_reconcile "$second_uuid" "$output_file"
[[ "$RUN_STATUS" -eq 0 && "$ROUTE_STATE_GENERATION" == "5" \
    && "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" \
    && "$ROUTE_STATE_PHASE" == "SHARED_ACTIVE" \
    && "$ROUTE_STATE_LAST_RESULT" == "stale_transition_compensated" \
    && "${recreate_calls[*]-}" == "shared" ]] \
    || fail "stale Shared compensation did not restore the previous route"
[[ "$ROUTE_STATE_TRANSITION_TARGET_ROUTE" == "" ]] || fail "stale compensation left target metadata"
compensation_call_count="${#recreate_calls[@]}"
run_reconcile "$second_uuid" "$output_file"
[[ "${#recreate_calls[@]}" == "$compensation_call_count" && "$ROUTE_STATE_GENERATION" == "5" ]] \
    || fail "duplicate stale-transition request retried compensation"
assert_contains "$RUN_OUTPUT" '"result":"stale_transition_compensated"'
assert_complete_envelope "$RUN_OUTPUT"

reset_state
ROUTE_STATE_GENERATION=4
ROUTE_STATE_LAST_REQUEST_ID="$valid_uuid"
ROUTE_STATE_ACTIVE_ROUTE=direct
ROUTE_STATE_PHASE=SWITCHING_TO_SHARED
ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE=direct
ROUTE_STATE_TRANSITION_TARGET_ROUTE=shared
ROUTE_STATE_TRANSITION_STARTED_AT=100000
ROUTE_STATE_TRANSITION_GENERATION=4
run_reconcile "$second_uuid" "$output_file"
[[ "$ROUTE_STATE_ACTIVE_ROUTE" == "direct" && "$ROUTE_STATE_PHASE" == "DIRECT_ACTIVE" \
    && "${recreate_calls[*]-}" == "direct" ]] || fail "stale Direct compensation did not restore Direct"

reset_state
ROUTE_STATE_GENERATION=4
ROUTE_STATE_LAST_REQUEST_ID="$valid_uuid"
ROUTE_STATE_ACTIVE_ROUTE=shared
ROUTE_STATE_PHASE=SWITCHING_TO_DIRECT
ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE=shared
ROUTE_STATE_TRANSITION_TARGET_ROUTE=direct
ROUTE_STATE_TRANSITION_STARTED_AT=100000
ROUTE_STATE_TRANSITION_GENERATION=4
recreate_result=1
run_reconcile "$second_uuid" "$output_file"
[[ "$RUN_STATUS" -ne 0 && "$ROUTE_STATE_PHASE" == "DEGRADED" \
    && "$ROUTE_STATE_LAST_RESULT" == "stale_transition_compensation_failed" \
    && "${recreate_calls[*]-}" == "shared" ]] || fail "failed stale compensation was not terminal degraded"
failed_compensation_calls="${#recreate_calls[@]}"
run_reconcile "$third_uuid" "$output_file"
[[ "$ROUTE_STATE_PHASE" == "DEGRADED" && "${#recreate_calls[@]}" == "$failed_compensation_calls" ]] \
    || fail "terminal stale compensation failure retried route recreation"
assert_contains "$RUN_OUTPUT" '"result":"terminal_state"'
assert_complete_envelope "$RUN_OUTPUT"

# Probes remain independent, digest-bound, API-container-free, and silent.
reset_state
probe_invocations=()
run_probe_query direct > /tmp/db-failover-probe-output 2>&1
[[ ! -s /tmp/db-failover-probe-output ]] || fail "database probe emitted output"
probe_run_invocation="${probe_invocations[*]-}"
assert_contains "$probe_run_invocation" "docker run --rm --pull=never"
assert_contains "$probe_run_invocation" "--network babyjamjam-backend-preview_backend"
assert_contains "$probe_run_invocation" "--env-file $BACKEND_ENV_FILE"
assert_contains "$probe_run_invocation" "--env DATABASE_CONNECTION_MODE=direct"
assert_contains "$probe_run_invocation" "--entrypoint /usr/local/bin/node"
assert_contains "$probe_run_invocation" "ghcr.io/jaino-song/babyjamjam-admin-backend@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
assert_contains "$PROBE_NODE_SCRIPT" 'searchParams.set("connection_limit", "1")'
assert_contains "$PROBE_NODE_SCRIPT" 'setTimeout(() => finish(1), 5000)'
assert_contains "$PROBE_NODE_SCRIPT" 'SELECT 1'
assert_not_contains "$probe_run_invocation" "docker exec"
assert_not_contains "$probe_run_invocation" "docker compose"
assert_not_contains "$probe_run_invocation" "dist/main.js"
assert_not_contains "$probe_run_invocation" "SCHEDULERS_ENABLED"
assert_not_contains "$probe_run_invocation" "postgres""ql://"
reset_state
probe_docker_mode=invalid
assert_fails run_probe_query direct
[[ "${probe_invocations[*]-}" != *"docker run --rm --pull=never"* ]] || fail "probe ran with an unproven digest"
reset_state
probe_secret_output=true
probe_shared_outcomes=(ok)
db_probe_output="$(db_probe shared "$valid_uuid")"
assert_not_contains "$db_probe_output" "$probe_secret_url"
assert_contains "$db_probe_output" "db_probe=ok"

rm -f /tmp/db-failover-probe-output
echo "db-failover-operator tests passed"
