#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$SCRIPT_DIR/install-ci-operator.sh"
HOST_OPERATOR="$SCRIPT_DIR/ci-operator.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_fails() {
    if ("$@") >/dev/null 2>&1; then
        fail "expected command to fail: $*"
    fi
}

assert_equals() {
    local expected="$1"
    local actual="$2"

    [[ "$expected" == "$actual" ]] \
        || fail "expected '$expected', got '$actual'"
}

assert_file_unchanged() {
    local snapshot="$1"
    local path="$2"

    /usr/bin/cmp -s "$snapshot" "$path" \
        || fail "file changed unexpectedly: $path"
}

[[ -r "$INSTALLER" ]] || fail "missing CI operator installer: $INSTALLER"
[[ -r "$HOST_OPERATOR" ]] || fail "missing CI operator host implementation: $HOST_OPERATOR"

# shellcheck source=backend/deploy/lightsail/install-ci-operator.sh
source "$INSTALLER"

TEST_TEMP_ROOT="${TMPDIR:-/tmp}"
TEST_TEMP_ROOT="$(cd "$TEST_TEMP_ROOT" && pwd -P)"
TEST_ROOT="$(/usr/bin/mktemp -d "$TEST_TEMP_ROOT/babyjamjam-install-ci-operator.XXXXXX")"
trap '/bin/rm -rf "$TEST_ROOT"' EXIT

TEST_ROUTE_PARENT="$TEST_ROOT/host"
/bin/mkdir -p "$TEST_ROUTE_PARENT"
/bin/chmod 0755 "$TEST_ROUTE_PARENT"

STATE_ROOT="$TEST_ROOT/environments"
ROUTE_STATE_ROOT="$TEST_ROUTE_PARENT/db-failover-state"
LOG_DIRECTORY="$TEST_ROOT/logs"
INSTALLED_OPERATOR="$TEST_ROOT/operator"

REAL_CHOWN="$(command -v chown)"
REAL_STAT="$(command -v stat)"
VALID_REQUEST_ID="123e4567-e89b-12d3-a456-426614174000"

test_stat() {
    local format_flag="$1"
    local format="$2"
    local path="$3"
    local actual_metadata
    local owner
    local group
    local mode

    [[ "$format_flag" == "-c" && "$format" == "%U:%G:%a" ]] \
        || fail "unexpected stat invocation: $*"
    if [[ "$(uname -s)" == "Darwin" ]]; then
        actual_metadata="$($REAL_STAT -f '%Su:%Sg:%Lp' "$path")"
    else
        actual_metadata="$($REAL_STAT -c '%U:%G:%a' "$path")"
    fi
    owner="${actual_metadata%%:*}"
    group="${actual_metadata#*:}"
    group="${group%%:*}"
    mode="${actual_metadata##*:}"

    if [[ "$path" == "${TEST_STAT_OVERRIDE_PATH:-}" ]]; then
        owner="${TEST_STAT_OVERRIDE_OWNER%%:*}"
        group="${TEST_STAT_OVERRIDE_OWNER#*:}"
    elif [[ "${TEST_STAT_FAKE_OWNER:-0}" == "1" ]]; then
        owner="root"
        group="root"
    fi
    printf '%s:%s:%s\n' "$owner" "$group" "$mode"
}

test_chown() {
    if [[ "$EUID" -eq 0 ]]; then
        "$REAL_CHOWN" "$@"
    fi
}

test_install() {
    local -a arguments=()
    local argument

    if [[ "$EUID" -eq 0 ]]; then
        /usr/bin/install "$@"
        return
    fi

    while [[ "$#" -gt 0 ]]; do
        argument="$1"
        case "$argument" in
            -o|-g)
                shift 2
                ;;
            *)
                arguments+=("$argument")
                shift
                ;;
        esac
    done
    /usr/bin/install "${arguments[@]}"
}

CMD_STAT=test_stat
CMD_CHOWN=test_chown
CMD_INSTALL=test_install
CMD_DATE="$(command -v date)"
CMD_MV="$(command -v mv)"
CMD_UNLINK="$(command -v unlink)"
TEST_STAT_FAKE_OWNER=0
if [[ "$EUID" -ne 0 ]]; then
    TEST_STAT_FAKE_OWNER=1
fi

reset_route_state_root() {
    /bin/rm -rf "$ROUTE_STATE_ROOT"
}

route_state_file() {
    local environment="$1"

    printf '%s/%s/%s\n' "$ROUTE_STATE_ROOT" "$environment" "$ROUTE_STATE_FILE_NAME"
}

assert_route_state_structure() {
    local environment="$1"
    local route_state_directory="$ROUTE_STATE_ROOT/$environment"
    local route_state_file_path

    route_state_file_path="$(route_state_file "$environment")"
    [[ -d "$ROUTE_STATE_ROOT" && ! -L "$ROUTE_STATE_ROOT" ]] \
        || fail "route state root is missing or unsafe"
    [[ -d "$route_state_directory" && ! -L "$route_state_directory" ]] \
        || fail "route state directory is missing or unsafe: $environment"
    [[ -f "$route_state_file_path" && ! -L "$route_state_file_path" ]] \
        || fail "route state file is missing or unsafe: $environment"
    assert_equals "root:root:700" "$(test_stat -c '%U:%G:%a' "$ROUTE_STATE_ROOT")"
    assert_equals "root:root:700" "$(test_stat -c '%U:%G:%a' "$route_state_directory")"
    assert_equals "root:root:600" "$(test_stat -c '%U:%G:%a' "$route_state_file_path")"
}

assert_no_temporary_route_state() {
    local temporary_path

    temporary_path="$(/usr/bin/find "$ROUTE_STATE_ROOT" -type f -name '.db-route-state.*' -print -quit 2>/dev/null || true)"
    [[ -z "$temporary_path" ]] || fail "temporary route state was left behind: $temporary_path"
}

assert_v2_initial_state() {
    local environment="$1"
    local route_state_path
    local actual_state
    local expected_state

    route_state_path="$(route_state_file "$environment")"
    actual_state="$(<"$route_state_path")"
    expected_state="$(printf '%s\n' \
        'version=2' \
        'generation=0' \
        'active_route=shared' \
        'phase=SHARED_ACTIVE' \
        'transition_previous_route=' \
        'transition_target_route=' \
        'transition_started_at=0' \
        'transition_generation=0' \
        'direct_activated_at=0' \
        'shared_failure_count=0' \
        'direct_success_count=0' \
        'direct_failure_count=0' \
        'emergency_shared_success_count=0' \
        'shared_healthy_count=0' \
        'shared_healthy_started_at=0' \
        'shared_healthy_last_at=0' \
        'normal_roundtrip_history=' \
        'cooldown_until=0' \
        'last_request_id=' \
        'last_probe_route=' \
        'last_probe_result=none' \
        'last_probe_at=0' \
        'last_shared_ok=null' \
        'last_direct_ok=null' \
        'last_result=initialized' \
        'terminal_reason=')"
    assert_equals "$expected_state" "$actual_state"
    if grep -Eq '^(normal_roundtrip_count|roundtrip_window_started_at|shared_success_count)=' "$route_state_path"; then
        fail "v1-only route state key was emitted: $route_state_path"
    fi
}

assert_complete_healthy_envelope() {
    local environment="$1"
    local envelope="$2"

    printf '%s\n' "$envelope" | node -e '
const raw = require("node:fs").readFileSync(0, "utf8").trim();
if (!raw || raw.split(/\r?\n/).length !== 1) throw new Error("envelope must be one JSON line");
const value = JSON.parse(raw);
const required = [
  "schemaVersion", "source", "controlPlaneOk", "environment", "requestId", "hostGeneration",
  "activeRoute", "phase", "result", "sharedOk", "directOk", "sharedFailureCount",
  "directSuccessCount", "directFailureCount", "emergencySharedSuccessCount", "sharedHealthyCount",
  "directActivatedAt", "sharedHealthyStartedAt", "sharedHealthyLastAt", "cooldownUntil",
  "recentNormalRoundTrips", "transition", "terminalReason",
];
for (const key of required) if (!(key in value)) throw new Error(`missing ${key}`);
if (value.schemaVersion !== 1 || value.source !== "babyjamjam-db-failover-host" || value.controlPlaneOk !== true) throw new Error("bad envelope identity");
if (value.environment !== process.argv[1] || value.result !== "healthy") throw new Error("bad healthy envelope state");
if (!Number.isInteger(value.hostGeneration) || value.hostGeneration !== 0) throw new Error("bad generation");
if (value.activeRoute !== "SHARED" || value.phase !== "SHARED_ACTIVE") throw new Error("bad initial route");
for (const key of ["sharedFailureCount", "directSuccessCount", "directFailureCount", "emergencySharedSuccessCount", "sharedHealthyCount", "directActivatedAt", "sharedHealthyStartedAt", "sharedHealthyLastAt", "cooldownUntil"]) {
  if (!Number.isInteger(value[key]) || value[key] < 0) throw new Error(`bad nonnegative field ${key}`);
}
if (value.sharedOk !== null || value.directOk !== null) throw new Error("bad initial probe booleans");
if (!Array.isArray(value.recentNormalRoundTrips) || value.recentNormalRoundTrips.length !== 0) throw new Error("bad empty history");
if (value.transition.previousRoute !== null || value.transition.targetRoute !== null || value.transition.startedAt !== 0 || value.transition.generation !== 0 || value.transition.terminalReason !== null) throw new Error("bad empty transition");
if (value.terminalReason !== null) throw new Error("bad terminal reason");
' "$environment" || fail "invalid healthy envelope for $environment: $envelope"
}

assert_host_loads_route_state() {
    local environment="$1"
    local route_state_path
    local envelope

    route_state_path="$(route_state_file "$environment")"
    envelope="$(/bin/bash -c '
        set -Eeuo pipefail
        source "$1"
        configure_environment "$2"
        ensure_route_state() { :; }
        ROUTE_STATE_FILE="$3"
        load_route_state
        RECONCILE_REQUEST_ID="$4"
        RECONCILE_OUTPUT_PERSIST=false
        reconcile_output healthy
    ' _ "$HOST_OPERATOR" "$environment" "$route_state_path" "$VALID_REQUEST_ID")" \
        || fail "host could not load installer state for $environment"
    assert_complete_healthy_envelope "$environment" "$envelope"
}

assert_refusal_message() {
    local expected_message="$1"
    shift
    local output
    local status

    set +e
    output="$("$@" 2>&1 >/dev/null)"
    status=$?
    set -e
    [[ "$status" -ne 0 ]] || fail "expected command to fail: $*"
    [[ "$output" == *"$expected_message"* ]] \
        || fail "expected '$expected_message' in refusal output, got '$output'"
}

assert_owner_refusal() {
    local path="$1"
    local environment="$2"

    if [[ "$EUID" -eq 0 ]] && /usr/bin/id nobody >/dev/null 2>&1; then
        "$REAL_CHOWN" nobody:nobody "$path"
        assert_fails ensure_route_state_file "$environment"
        "$REAL_CHOWN" root:root "$path"
    else
        TEST_STAT_OVERRIDE_PATH="$path"
        TEST_STAT_OVERRIDE_OWNER="nobody:nobody"
        assert_fails ensure_route_state_file "$environment"
        unset TEST_STAT_OVERRIDE_PATH TEST_STAT_OVERRIDE_OWNER
    fi
}

group_list_contains docker "ubuntu docker"
assert_fails group_list_contains docker "ubuntu adm"
assert_fails group_list_contains dock "ubuntu docker"

grep -Fq '[[ "$EUID" -eq 0 ]]' "$INSTALLER" \
    || fail "installer must retain its root requirement"
grep -Fq 'root:root:750' "$INSTALLER" \
    || fail "operator mode check must be root:root:750"
grep -Fq 'root:root:700' "$INSTALLER" \
    || fail "log and route-state directories must be root-owned and mode 0700"
grep -Fq 'ubuntu:ubuntu:640' "$INSTALLER" \
    || fail "shared lock mode check must allow the deploy user"
grep -Fq 'db-route-state' "$INSTALLER" \
    || fail "route state path must be installed per environment"
grep -Fq 'ROUTE_STATE_ROOT="/opt/babyjamjam/db-failover-state"' "$INSTALLER" \
    || fail "route state must use a dedicated root-only state root"
grep -Fq 'ensure_route_state_directory' "$INSTALLER" \
    || fail "installer must create and validate dedicated route state directories"
grep -Fq 'root:root:600' "$INSTALLER" \
    || fail "route state must remain root-owned and mode 0600"
grep -Fq "'version=2'" "$INSTALLER" \
    || fail "fresh route state must use v2"
if grep -Eq 'normal_roundtrip_count|roundtrip_window_started_at|(^|[^A-Za-z0-9_])shared_success_count([^A-Za-z0-9_]|$)' "$INSTALLER"; then
    fail "installer must not validate or emit v1-only route state keys"
fi
if grep -Eq 'sudoers|NOPASSWD' "$INSTALLER"; then
    fail "CI operator installer must not create a sudo path"
fi

reset_route_state_root
ensure_route_state_file preview
assert_route_state_structure preview
assert_v2_initial_state preview
assert_host_loads_route_state preview
preview_snapshot="$TEST_ROOT/preview.snapshot"
/bin/cp "$(route_state_file preview)" "$preview_snapshot"
ensure_route_state_file preview
assert_file_unchanged "$preview_snapshot" "$(route_state_file preview)"

ensure_route_state_file production
assert_route_state_structure production
assert_v2_initial_state production
assert_host_loads_route_state production
production_snapshot="$TEST_ROOT/production.snapshot"
/bin/cp "$(route_state_file production)" "$production_snapshot"
ensure_route_state_file production
assert_file_unchanged "$production_snapshot" "$(route_state_file production)"

missing_key_snapshot="$TEST_ROOT/missing-key.snapshot"
/usr/bin/sed '/^cooldown_until=/d' "$(route_state_file preview)" >"$missing_key_snapshot"
/bin/mv "$missing_key_snapshot" "$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
/bin/cp "$(route_state_file preview)" "$missing_key_snapshot"
assert_refusal_message "Route state is incomplete." ensure_route_state_file preview
assert_file_unchanged "$missing_key_snapshot" "$(route_state_file preview)"

/bin/cp "$preview_snapshot" "$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
ensure_route_state_file preview
duplicate_key_snapshot="$TEST_ROOT/duplicate-key.snapshot"
printf 'cooldown_until=0\n' >>"$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
/bin/cp "$(route_state_file preview)" "$duplicate_key_snapshot"
assert_refusal_message "Duplicate route state key." ensure_route_state_file preview
assert_file_unchanged "$duplicate_key_snapshot" "$(route_state_file preview)"

/bin/cp "$preview_snapshot" "$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
ensure_route_state_file preview
unknown_key_snapshot="$TEST_ROOT/unknown-key.snapshot"
printf 'unknown_key=value\n' >>"$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
/bin/cp "$(route_state_file preview)" "$unknown_key_snapshot"
assert_refusal_message "Invalid route state value." ensure_route_state_file preview
assert_file_unchanged "$unknown_key_snapshot" "$(route_state_file preview)"

/bin/cp "$preview_snapshot" "$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
ensure_route_state_file preview
v1_snapshot="$TEST_ROOT/v1.snapshot"
printf 'version=1\n' >"$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
/bin/cp "$(route_state_file preview)" "$v1_snapshot"
assert_refusal_message "Invalid route state value." ensure_route_state_file preview
assert_file_unchanged "$v1_snapshot" "$(route_state_file preview)"

printf 'not-a-route-state\n' >"$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
malformed_snapshot="$TEST_ROOT/malformed.snapshot"
/bin/cp "$(route_state_file preview)" "$malformed_snapshot"
assert_fails ensure_route_state_file preview
assert_file_unchanged "$malformed_snapshot" "$(route_state_file preview)"

reset_route_state_root
ensure_route_state_file preview
/bin/chmod 0750 "$ROUTE_STATE_ROOT"
assert_fails ensure_route_state_file preview
/bin/chmod 0700 "$ROUTE_STATE_ROOT"
/bin/chmod 0750 "$ROUTE_STATE_ROOT/preview"
assert_fails ensure_route_state_file preview
/bin/chmod 0700 "$ROUTE_STATE_ROOT/preview"
/bin/chmod 0640 "$(route_state_file preview)"
assert_fails ensure_route_state_file preview
/bin/chmod 0600 "$(route_state_file preview)"

assert_owner_refusal "$ROUTE_STATE_ROOT" preview
assert_owner_refusal "$ROUTE_STATE_ROOT/preview" preview
assert_owner_refusal "$(route_state_file preview)" preview

reset_route_state_root
root_target="$TEST_ROOT/root-target"
/bin/mkdir -p "$root_target"
printf 'root-target\n' >"$root_target/sentinel"
/bin/ln -s "$root_target" "$ROUTE_STATE_ROOT"
assert_fails ensure_route_state_file preview
[[ -L "$ROUTE_STATE_ROOT" ]] || fail "route-state root symlink was replaced"
assert_equals "root-target" "$(/bin/cat "$root_target/sentinel")"

reset_route_state_root
ancestor_target="$TEST_ROOT/ancestor-target"
ancestor_link="$TEST_ROOT/ancestor-link"
/bin/mkdir -p "$ancestor_target"
/bin/ln -s "$ancestor_target" "$ancestor_link"
ROUTE_STATE_ROOT="$ancestor_link/db-failover-state"
assert_fails ensure_route_state_file preview
[[ -L "$ancestor_link" ]] || fail "route-state ancestor symlink was followed"
ROUTE_STATE_ROOT="$TEST_ROUTE_PARENT/db-failover-state"

reset_route_state_root
/bin/mkdir -p "$ROUTE_STATE_ROOT"
/bin/chmod 0700 "$ROUTE_STATE_ROOT"
environment_target="$TEST_ROOT/environment-target"
/bin/mkdir -p "$environment_target"
/bin/ln -s "$environment_target" "$ROUTE_STATE_ROOT/preview"
printf 'environment-target\n' >"$environment_target/sentinel"
assert_fails ensure_route_state_file preview
[[ -L "$ROUTE_STATE_ROOT/preview" ]] || fail "route-state directory symlink was replaced"
assert_equals "environment-target" "$(/bin/cat "$environment_target/sentinel")"

reset_route_state_root
/bin/mkdir -p "$ROUTE_STATE_ROOT/preview"
/bin/chmod 0700 "$ROUTE_STATE_ROOT" "$ROUTE_STATE_ROOT/preview"
file_target="$TEST_ROOT/file-target"
printf 'file-target\n' >"$file_target"
/bin/ln -s "$file_target" "$(route_state_file preview)"
assert_fails ensure_route_state_file preview
[[ -L "$(route_state_file preview)" ]] || fail "route-state file symlink was replaced"
assert_equals "file-target" "$(/bin/cat "$file_target")"

reset_route_state_root
CMD_MV=test_mv_failure
test_mv_failure() {
    return 1
}
assert_fails ensure_route_state_file preview
CMD_MV="$(command -v mv)"
[[ ! -e "$(route_state_file preview)" ]] || fail "state file was created after an atomic move failure"
assert_no_temporary_route_state

reset_route_state_root
ensure_route_state_file preview
ensure_route_state_file production
for environment in preview production; do
    route_directory="$ROUTE_STATE_ROOT/$environment"
    route_file="$(route_state_file "$environment")"
    route_directory_metadata="$(test_stat -c '%U:%G:%a' "$route_directory")"
    route_file_metadata="$(test_stat -c '%U:%G:%a' "$route_file")"
    route_directory_mode="${route_directory_metadata##*:}"
    route_file_mode="${route_file_metadata##*:}"
    [[ "${route_directory_mode:1:2}" == "00" ]] \
        || fail "deploy user may write route-state directory: $environment"
    [[ "${route_file_mode:1:2}" == "00" ]] \
        || fail "deploy user may write route-state file: $environment"
done
if [[ "$EUID" -eq 0 ]] && /usr/bin/id "$DEPLOY_USER" >/dev/null 2>&1 && [[ -x "$CMD_RUNUSER" ]]; then
    for environment in preview production; do
        route_file="$(route_state_file "$environment")"
        if "$CMD_RUNUSER" -u "$DEPLOY_USER" -- /bin/sh -c "printf x >> '$route_file'" >/dev/null 2>&1; then
            fail "deploy user can write route state: $environment"
        fi
    done
else
    echo "deploy-user write check skipped: no root-owned ubuntu account in this local harness"
fi

echo "install-ci-operator tests passed"
