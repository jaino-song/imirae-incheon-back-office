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
ARTIFACT_DIRECTORY="$TEST_ROOT/artifacts"
INSTALLED_OPERATOR_ARTIFACT="$ARTIFACT_DIRECTORY/ci-operator.sh"
INSTALLED_DEPLOY_ARTIFACT="$ARTIFACT_DIRECTORY/deploy.sh"
INSTALLED_ROLLBACK_ARTIFACT="$ARTIFACT_DIRECTORY/rollback.sh"
INSTALLED_COMPOSE_ARTIFACT="$ARTIFACT_DIRECTORY/compose.lightsail.yml"

REAL_CHOWN="$(command -v chown)"
REAL_STAT="$(command -v stat)"
VALID_REQUEST_ID="123e4567-e89b-12d3-a456-426614174000"

request_id_for_index() {
    printf '423e4567-e89b-42d3-a456-%012x\n' "$1"
}

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
    elif [[ "${TEST_STAT_FAKE_LOCK_OWNER:-0}" == "1" \
        && "$path" == "$STATE_ROOT"/*/operator.lock ]]; then
        owner="root"
        group="root"
    elif [[ "${TEST_STAT_FAKE_OWNER:-0}" == "1" ]]; then
        owner="root"
        group="root"
    fi
    printf '%s:%s:%s\n' "$owner" "$group" "$mode"
}

test_inode() {
    local path="$1"

    if [[ "$(uname -s)" == "Darwin" ]]; then
        "$REAL_STAT" -f '%i' "$path"
    else
        "$REAL_STAT" -c '%i' "$path"
    fi
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

test_install_operator_failure() {
    local last_argument=""
    local argument

    for argument in "$@"; do
        last_argument="$argument"
    done
    [[ "$last_argument" == "$INSTALLED_OPERATOR" ]] && return 1
    test_install "$@"
}

test_install_target_failure() {
    local last_argument=""
    local argument

    for argument in "$@"; do
        last_argument="$argument"
    done
    [[ "$last_argument" == "$TEST_INSTALL_FAILURE_TARGET" ]] && return 1
    test_install "$@"
}

test_mv_failure() {
    return 1
}

test_flock() {
    return 0
}

test_flock_failure() {
    return 1
}

test_flock_trace() {
    printf '%s\n' "$2" >>"$TEST_FLOCK_TRACE"
}

test_flock_mutate_operator() {
    if [[ "$2" == 201 ]]; then
        printf '%s\n' '# concurrent authorized installer mutation' >>"$INSTALLED_OPERATOR"
    fi
}

CMD_STAT=test_stat
CMD_CHOWN=test_chown
CMD_INSTALL=test_install
CMD_FLOCK=test_flock
CMD_DATE="$(command -v date)"
CMD_MV="$(command -v mv)"
CMD_RM="$(command -v rm)"
CMD_UNLINK="$(command -v unlink)"
TEST_STAT_FAKE_OWNER=0
if [[ "$EUID" -ne 0 ]]; then
    TEST_STAT_FAKE_OWNER=1
fi

reset_route_state_root() {
    /bin/rm -rf "$ROUTE_STATE_ROOT"
}

reset_installation_targets() {
    /bin/rm -rf \
        "$ROUTE_STATE_ROOT" "$STATE_ROOT" "$LOG_DIRECTORY" \
        "$INSTALLED_OPERATOR" "$ARTIFACT_DIRECTORY"
    /bin/mkdir -p "$STATE_ROOT/preview" "$STATE_ROOT/production"
    /bin/chmod 0700 "$STATE_ROOT/preview" "$STATE_ROOT/production"
}

install_current_test_bundle() {
    /bin/mkdir -p "$ARTIFACT_DIRECTORY"
    /bin/chmod 0700 "$ARTIFACT_DIRECTORY"
    /bin/cp "$HOST_OPERATOR" "$INSTALLED_OPERATOR"
    /bin/cp "$HOST_OPERATOR" "$INSTALLED_OPERATOR_ARTIFACT"
    /bin/cp "$SOURCE_DEPLOY_HELPER" "$INSTALLED_DEPLOY_ARTIFACT"
    /bin/cp "$SOURCE_ROLLBACK_HELPER" "$INSTALLED_ROLLBACK_ARTIFACT"
    /bin/cp "$SOURCE_COMPOSE_FILE" "$INSTALLED_COMPOSE_ARTIFACT"
    /bin/chmod 0750 \
        "$INSTALLED_OPERATOR" "$INSTALLED_OPERATOR_ARTIFACT" \
        "$INSTALLED_DEPLOY_ARTIFACT" "$INSTALLED_ROLLBACK_ARTIFACT"
    /bin/chmod 0640 "$INSTALLED_COMPOSE_ARTIFACT"
}

route_state_file() {
    local environment="$1"

    printf '%s/%s/%s\n' "$ROUTE_STATE_ROOT" "$environment" "$ROUTE_STATE_FILE_NAME"
}

assert_path_absent() {
    local path="$1"

    [[ ! -e "$path" && ! -L "$path" ]] || fail "path exists unexpectedly: $path"
}

assert_path_metadata_unchanged() {
    local expected_metadata="$1"
    local path="$2"

    assert_equals "$expected_metadata" "$(test_stat -c '%U:%G:%a' "$path")"
}

make_legacy_operator() {
    local path="$1"

    {
        printf '%s\n' '#!/usr/bin/env bash'
        printf '%s\n' 'set -Eeuo pipefail'
        printf '%s\n' 'state_path="$1"'
        printf '%s\n' '[[ -f "$state_path" && ! -L "$state_path" ]]'
        printf '%s\n' '! grep -q "^request_history=" "$state_path"'
        printf '%s\n' 'grep -Fxq "version=2" "$state_path"'
    } >"$path"
    /bin/chmod 0750 "$path"
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
        'request_history=' \
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
grep -Fq 'must not belong to the docker group' "$INSTALLER" \
    || fail "installer must reject ubuntu Docker membership"
if grep -Fq 'must belong to the docker group' "$INSTALLER"; then
    fail "installer must not require ubuntu Docker membership"
fi
grep -Fq 'root:root:750' "$INSTALLER" \
    || fail "operator mode check must be root:root:750"
grep -Fq 'root:root:700' "$INSTALLER" \
    || fail "log and route-state directories must be root-owned and mode 0700"
grep -Fq 'root:root:600' "$INSTALLER" \
    || fail "shared lock mode check must remain root-only"
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
invalid_history_snapshot="$TEST_ROOT/invalid-history.snapshot"
/usr/bin/sed "s/^request_history=.*/request_history=not-a-uuid/" "$(route_state_file preview)" >"$invalid_history_snapshot"
/bin/mv "$invalid_history_snapshot" "$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
/bin/cp "$(route_state_file preview)" "$invalid_history_snapshot"
assert_refusal_message "Invalid route state value." ensure_route_state_file preview
assert_file_unchanged "$invalid_history_snapshot" "$(route_state_file preview)"

/bin/cp "$preview_snapshot" "$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
oversized_history=""
for request_index in $(seq 0 32); do
    if [[ -n "$oversized_history" ]]; then
        oversized_history="${oversized_history},"
    fi
    oversized_history+="$(request_id_for_index "$request_index")"
done
oversized_history_snapshot="$TEST_ROOT/oversized-history.snapshot"
/usr/bin/sed "s/^request_history=.*/request_history=$oversized_history/" "$(route_state_file preview)" >"$oversized_history_snapshot"
/bin/mv "$oversized_history_snapshot" "$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
/bin/cp "$(route_state_file preview)" "$oversized_history_snapshot"
assert_refusal_message "Invalid route state value." ensure_route_state_file preview
assert_file_unchanged "$oversized_history_snapshot" "$(route_state_file preview)"

/bin/cp "$preview_snapshot" "$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
legacy_snapshot="$TEST_ROOT/legacy-v2.snapshot"
/usr/bin/sed \
    -e '/^request_history=/d' \
    -e "s/^last_request_id=.*/last_request_id=$VALID_REQUEST_ID/" \
    "$(route_state_file preview)" >"$legacy_snapshot"
/bin/mv "$legacy_snapshot" "$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
/bin/cp "$(route_state_file preview)" "$legacy_snapshot"

/bin/mkdir -p "$STATE_ROOT/preview" "$STATE_ROOT/production" "$LOG_DIRECTORY"
/bin/chmod 0700 "$STATE_ROOT/preview" "$STATE_ROOT/production" "$LOG_DIRECTORY"
install_current_test_bundle
TEST_STAT_FAKE_LOCK_OWNER=1
ensure_deployment_locks false

# A read-only validation/check accepts the pre-history v2 shape but does not
# rewrite it. Installation/replacement explicitly performs the fail-safe
# migration and seeds history from the durable last-request marker.
ensure_route_state_file preview
assert_file_unchanged "$legacy_snapshot" "$(route_state_file preview)"
verify_installed_files >/dev/null
assert_file_unchanged "$legacy_snapshot" "$(route_state_file preview)"
ensure_route_state_file preview true
grep -Fxq "request_history=$VALID_REQUEST_ID" "$(route_state_file preview)" \
    || fail "legacy v2 migration did not preserve last_request_id as history"
assert_route_state_structure preview

/bin/cp "$legacy_snapshot" "$(route_state_file preview)"
/bin/chmod 0600 "$(route_state_file preview)"
CMD_MV=test_mv_failure
assert_refusal_message "Unable to migrate legacy route state." ensure_route_state_file preview true
CMD_MV="$(command -v mv)"
assert_file_unchanged "$legacy_snapshot" "$(route_state_file preview)"
assert_no_temporary_route_state

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

# Integration-style compatibility path: the installer creates the v2 state,
# the real sourced operator reconcile persists a request history entry, and
# installer check/reinstall/replace preserve that durable history.
run_operator_reconcile() {
    local state_path="$1"
    local request_id="$2"
    local environment="${3:-preview}"

    /bin/bash -s -- "$HOST_OPERATOR" "$state_path" "$request_id" "$environment" <<'EOF'
set -Eeuo pipefail

operator_source="$1"
state_path="$2"
request_id="$3"
environment="$4"
source "$operator_source"
configure_environment "$environment"
ROUTE_STATE_DIRECTORY="$(/usr/bin/dirname "$state_path")"
ROUTE_STATE_FILE="$state_path"

ensure_route_state() { :; }
acquire_lock() { :; }
validate_backend_env_file() { :; }
current_epoch() { printf '1700000000\n'; }
probe_route() { [[ "$1" == "shared" ]]; }

# Keep the operator's real db_reconcile/load/remember/reconcile path while
# replacing only the root-owned writer for this unprivileged shell harness.
write_route_state() {
    local temporary_file

    temporary_file="$(/usr/bin/mktemp "$ROUTE_STATE_DIRECTORY/.db-route-state.test.XXXXXX")"
    {
        printf 'version=%s\n' "$ROUTE_STATE_VERSION"
        printf 'generation=%s\n' "$ROUTE_STATE_GENERATION"
        printf 'active_route=%s\n' "$ROUTE_STATE_ACTIVE_ROUTE"
        printf 'phase=%s\n' "$ROUTE_STATE_PHASE"
        printf 'transition_previous_route=%s\n' "$ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE"
        printf 'transition_target_route=%s\n' "$ROUTE_STATE_TRANSITION_TARGET_ROUTE"
        printf 'transition_started_at=%s\n' "$ROUTE_STATE_TRANSITION_STARTED_AT"
        printf 'transition_generation=%s\n' "$ROUTE_STATE_TRANSITION_GENERATION"
        printf 'direct_activated_at=%s\n' "$ROUTE_STATE_DIRECT_ACTIVATED_AT"
        printf 'shared_failure_count=%s\n' "$ROUTE_STATE_SHARED_FAILURE_COUNT"
        printf 'direct_success_count=%s\n' "$ROUTE_STATE_DIRECT_SUCCESS_COUNT"
        printf 'direct_failure_count=%s\n' "$ROUTE_STATE_DIRECT_FAILURE_COUNT"
        printf 'emergency_shared_success_count=%s\n' "$ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT"
        printf 'shared_healthy_count=%s\n' "$ROUTE_STATE_SHARED_SUCCESS_COUNT"
        printf 'shared_healthy_started_at=%s\n' "$ROUTE_STATE_SHARED_SUCCESS_STARTED_AT"
        printf 'shared_healthy_last_at=%s\n' "$ROUTE_STATE_SHARED_SUCCESS_LAST_AT"
        printf 'normal_roundtrip_history=%s\n' "$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY"
        printf 'cooldown_until=%s\n' "$ROUTE_STATE_COOLDOWN_UNTIL"
        printf 'last_request_id=%s\n' "$ROUTE_STATE_LAST_REQUEST_ID"
        printf 'request_history=%s\n' "$ROUTE_STATE_REQUEST_HISTORY"
        printf 'last_probe_route=%s\n' "$ROUTE_STATE_LAST_PROBE_ROUTE"
        printf 'last_probe_result=%s\n' "$ROUTE_STATE_LAST_PROBE_RESULT"
        printf 'last_probe_at=%s\n' "$ROUTE_STATE_LAST_PROBE_AT"
        printf 'last_shared_ok=%s\n' "$ROUTE_STATE_LAST_SHARED_OK"
        printf 'last_direct_ok=%s\n' "$ROUTE_STATE_LAST_DIRECT_OK"
        printf 'last_result=%s\n' "$ROUTE_STATE_LAST_RESULT"
        printf 'terminal_reason=%s\n' "$ROUTE_STATE_TERMINAL_REASON"
    } >"$temporary_file"
    /bin/mv -f "$temporary_file" "$ROUTE_STATE_FILE"
}

db_reconcile "$request_id" >/dev/null
EOF
}

reset_route_state_root
ensure_route_state_file preview
ensure_route_state_file production
/bin/mkdir -p "$STATE_ROOT/preview" "$STATE_ROOT/production"
/bin/chmod 0700 "$STATE_ROOT/preview" "$STATE_ROOT/production"
run_operator_reconcile "$(route_state_file preview)" "$VALID_REQUEST_ID"
history_before_install="$(/usr/bin/sed -n 's/^request_history=//p' "$(route_state_file preview)")"
[[ -n "$history_before_install" ]] || fail "operator reconcile did not persist request history"
[[ "$history_before_install" == "$VALID_REQUEST_ID" ]] \
    || fail "unexpected operator request history: $history_before_install"
preview_after_reconcile_snapshot="$TEST_ROOT/preview-after-reconcile.snapshot"
/bin/cp "$(route_state_file preview)" "$preview_after_reconcile_snapshot"

/bin/mkdir -p "$LOG_DIRECTORY"
/bin/chmod 0700 "$LOG_DIRECTORY"
install_current_test_bundle
TEST_STAT_FAKE_LOCK_OWNER=1
ensure_deployment_locks true

# The command entry points are exercised with only the host/root probes
# bypassed; all route-state validation and install/replace behavior is real.
require_root() { :; }
verify_host_prerequisites() { :; }
main check >/dev/null
assert_file_unchanged "$preview_after_reconcile_snapshot" "$(route_state_file preview)"
main install >/dev/null
assert_file_unchanged "$preview_after_reconcile_snapshot" "$(route_state_file preview)"

printf '# replacement marker\n' >>"$INSTALLED_OPERATOR"
main install --replace >/dev/null
assert_file_unchanged "$preview_after_reconcile_snapshot" "$(route_state_file preview)"
assert_equals "$history_before_install" "$(/usr/bin/sed -n 's/^request_history=//p' "$(route_state_file preview)")"

legacy_operator="$TEST_ROOT/legacy-operator"
make_legacy_operator "$legacy_operator"

# A plain install must authorize replacement before it can migrate either
# environment. Keep both legacy state files and the old executable byte-for-byte
# intact, then prove that the old executable still accepts the legacy shape.
reset_installation_targets
ensure_route_state_file preview
ensure_route_state_file production
ensure_deployment_locks false
for environment in preview production; do
    legacy_request_id="$VALID_REQUEST_ID"
    if [[ "$environment" == production ]]; then
        legacy_request_id="223e4567-e89b-42d3-a456-426614174000"
    fi
    legacy_state_temp="$TEST_ROOT/$environment-legacy-state"
    /usr/bin/sed \
        -e '/^request_history=/d' \
        -e "s/^last_request_id=.*/last_request_id=$legacy_request_id/" \
        "$(route_state_file "$environment")" >"$legacy_state_temp"
    /bin/mv "$legacy_state_temp" "$(route_state_file "$environment")"
    /bin/chmod 0600 "$(route_state_file "$environment")"
done
/bin/cp "$legacy_operator" "$INSTALLED_OPERATOR"
/bin/chmod 0750 "$INSTALLED_OPERATOR"
preview_legacy_snapshot="$TEST_ROOT/plain-refusal-preview.snapshot"
production_legacy_snapshot="$TEST_ROOT/plain-refusal-production.snapshot"
old_operator_snapshot="$TEST_ROOT/plain-refusal-operator.snapshot"
/bin/cp "$(route_state_file preview)" "$preview_legacy_snapshot"
/bin/cp "$(route_state_file production)" "$production_legacy_snapshot"
/bin/cp "$INSTALLED_OPERATOR" "$old_operator_snapshot"
preview_legacy_metadata="$(test_stat -c '%U:%G:%a' "$(route_state_file preview)")"
production_legacy_metadata="$(test_stat -c '%U:%G:%a' "$(route_state_file production)")"
old_operator_metadata="$(test_stat -c '%U:%G:%a' "$INSTALLED_OPERATOR")"
preview_lock_metadata="$(test_stat -c '%U:%G:%a' "$STATE_ROOT/preview/operator.lock")"
production_lock_metadata="$(test_stat -c '%U:%G:%a' "$STATE_ROOT/production/operator.lock")"
"$INSTALLED_OPERATOR" "$(route_state_file preview)"
"$INSTALLED_OPERATOR" "$(route_state_file production)"
assert_refusal_message "already exists" main install
assert_file_unchanged "$preview_legacy_snapshot" "$(route_state_file preview)"
assert_file_unchanged "$production_legacy_snapshot" "$(route_state_file production)"
assert_file_unchanged "$old_operator_snapshot" "$INSTALLED_OPERATOR"
assert_path_metadata_unchanged "$preview_legacy_metadata" "$(route_state_file preview)"
assert_path_metadata_unchanged "$production_legacy_metadata" "$(route_state_file production)"
assert_path_metadata_unchanged "$old_operator_metadata" "$INSTALLED_OPERATOR"
assert_path_metadata_unchanged "$preview_lock_metadata" "$STATE_ROOT/preview/operator.lock"
assert_path_metadata_unchanged "$production_lock_metadata" "$STATE_ROOT/production/operator.lock"
assert_path_absent "$LOG_DIRECTORY"
assert_no_temporary_route_state

# Authorized replacement migrates both states, installs the new operator, and
# leaves check/reconcile/reinstall paths compatible with the new schema.
replacement_preview_lock_inode="$(test_inode "$STATE_ROOT/preview/operator.lock")"
replacement_production_lock_inode="$(test_inode "$STATE_ROOT/production/operator.lock")"
TEST_FLOCK_TRACE="$TEST_ROOT/install-lock-order.trace"
: >"$TEST_FLOCK_TRACE"
printf '200\n201\n' >"$TEST_ROOT/install-lock-order.expected"
CMD_FLOCK=test_flock_trace
main install --replace >/dev/null
CMD_FLOCK=test_flock
assert_file_unchanged "$TEST_ROOT/install-lock-order.expected" "$TEST_FLOCK_TRACE"
assert_equals "$replacement_preview_lock_inode" "$(test_inode "$STATE_ROOT/preview/operator.lock")"
assert_equals "$replacement_production_lock_inode" "$(test_inode "$STATE_ROOT/production/operator.lock")"
for environment in preview production; do
    assert_route_state_structure "$environment"
    grep -Fxq "request_history=$VALID_REQUEST_ID" "$(route_state_file "$environment")" \
        || if [[ "$environment" == production ]]; then
            grep -Fxq "request_history=223e4567-e89b-42d3-a456-426614174000" "$(route_state_file "$environment")" \
                || fail "replacement did not migrate production request history"
        else
            fail "replacement did not migrate preview request history"
        fi
    assert_host_loads_route_state "$environment"
done
main check >/dev/null
run_operator_reconcile "$(route_state_file preview)" "323e4567-e89b-42d3-a456-426614174000" preview
run_operator_reconcile "$(route_state_file production)" "323e4567-e89b-42d3-a456-426614174000" production
main install >/dev/null
main check >/dev/null

# A plain install must recheck after locking: if a concurrent authorized
# installer changes the byte-identical operator before the snapshot phase, the
# newer binary remains in place and legacy states are not migrated.
reset_installation_targets
ensure_route_state_file preview
ensure_route_state_file production
ensure_deployment_locks false
for environment in preview production; do
    race_state_temp="$TEST_ROOT/$environment-race-legacy-state"
    /usr/bin/sed '/^request_history=/d' "$(route_state_file "$environment")" >"$race_state_temp"
    /bin/mv "$race_state_temp" "$(route_state_file "$environment")"
    /bin/chmod 0600 "$(route_state_file "$environment")"
done
install_current_test_bundle
race_preview_snapshot="$TEST_ROOT/race-preview.snapshot"
race_production_snapshot="$TEST_ROOT/race-production.snapshot"
race_operator_expected="$TEST_ROOT/race-operator.expected"
/bin/cp "$(route_state_file preview)" "$race_preview_snapshot"
/bin/cp "$(route_state_file production)" "$race_production_snapshot"
/bin/cp "$INSTALLED_OPERATOR" "$race_operator_expected"
printf '%s\n' '# concurrent authorized installer mutation' >>"$race_operator_expected"
race_preview_metadata="$(test_stat -c '%U:%G:%a' "$(route_state_file preview)")"
race_production_metadata="$(test_stat -c '%U:%G:%a' "$(route_state_file production)")"
race_operator_metadata="$(test_stat -c '%U:%G:%a' "$INSTALLED_OPERATOR")"
CMD_FLOCK=test_flock_mutate_operator
assert_refusal_message "already exists" main install
CMD_FLOCK=test_flock
assert_file_unchanged "$race_preview_snapshot" "$(route_state_file preview)"
assert_file_unchanged "$race_production_snapshot" "$(route_state_file production)"
assert_file_unchanged "$race_operator_expected" "$INSTALLED_OPERATOR"
assert_path_metadata_unchanged "$race_preview_metadata" "$(route_state_file preview)"
assert_path_metadata_unchanged "$race_production_metadata" "$(route_state_file production)"
assert_path_metadata_unchanged "$race_operator_metadata" "$INSTALLED_OPERATOR"
assert_path_absent "$LOG_DIRECTORY"
assert_no_temporary_route_state

# A failure after migration must restore the old operator, both state
# snapshots, and the intentionally missing production file as one unit.
reset_installation_targets
ensure_route_state_file preview
ensure_route_state_file production
ensure_deployment_locks false
for environment in preview production; do
    legacy_state_temp="$TEST_ROOT/$environment-rollback-legacy-state"
    /usr/bin/sed \
        -e '/^request_history=/d' \
        -e "s/^last_request_id=.*/last_request_id=$VALID_REQUEST_ID/" \
        "$(route_state_file "$environment")" >"$legacy_state_temp"
    /bin/mv "$legacy_state_temp" "$(route_state_file "$environment")"
    /bin/chmod 0600 "$(route_state_file "$environment")"
done
/bin/unlink "$(route_state_file production)"
/bin/cp "$legacy_operator" "$INSTALLED_OPERATOR"
/bin/chmod 0750 "$INSTALLED_OPERATOR"
rollback_preview_snapshot="$TEST_ROOT/rollback-preview.snapshot"
rollback_operator_snapshot="$TEST_ROOT/rollback-operator.snapshot"
/bin/cp "$(route_state_file preview)" "$rollback_preview_snapshot"
/bin/cp "$INSTALLED_OPERATOR" "$rollback_operator_snapshot"
rollback_preview_metadata="$(test_stat -c '%U:%G:%a' "$(route_state_file preview)")"
rollback_operator_metadata="$(test_stat -c '%U:%G:%a' "$INSTALLED_OPERATOR")"
rollback_preview_lock_metadata="$(test_stat -c '%U:%G:%a' "$STATE_ROOT/preview/operator.lock")"
rollback_production_lock_metadata="$(test_stat -c '%U:%G:%a' "$STATE_ROOT/production/operator.lock")"
rollback_preview_lock_inode="$(test_inode "$STATE_ROOT/preview/operator.lock")"
rollback_production_lock_inode="$(test_inode "$STATE_ROOT/production/operator.lock")"
original_verify_definition="$(declare -f verify_installed_files | /usr/bin/sed 's/^verify_installed_files/_original_verify_installed_files/')"
eval "$original_verify_definition"
verify_installed_files() {
    return 1
}
assert_fails main install --replace
eval "$original_verify_definition"
assert_file_unchanged "$rollback_preview_snapshot" "$(route_state_file preview)"
assert_file_unchanged "$rollback_operator_snapshot" "$INSTALLED_OPERATOR"
assert_path_absent "$(route_state_file production)"
assert_path_absent "$LOG_DIRECTORY"
assert_path_metadata_unchanged "$rollback_preview_metadata" "$(route_state_file preview)"
assert_path_metadata_unchanged "$rollback_operator_metadata" "$INSTALLED_OPERATOR"
assert_path_metadata_unchanged "$rollback_preview_lock_metadata" "$STATE_ROOT/preview/operator.lock"
assert_path_metadata_unchanged "$rollback_production_lock_metadata" "$STATE_ROOT/production/operator.lock"
assert_equals "$rollback_preview_lock_inode" "$(test_inode "$STATE_ROOT/preview/operator.lock")"
assert_equals "$rollback_production_lock_inode" "$(test_inode "$STATE_ROOT/production/operator.lock")"
"$INSTALLED_OPERATOR" "$(route_state_file preview)"
assert_no_temporary_route_state

# The same all-or-nothing guarantee must hold when the final operator install
# itself fails after both migration attempts.
reset_installation_targets
ensure_route_state_file preview
ensure_route_state_file production
ensure_deployment_locks false
for environment in preview production; do
    legacy_state_temp="$TEST_ROOT/$environment-install-rollback-state"
    /usr/bin/sed \
        -e '/^request_history=/d' \
        -e "s/^last_request_id=.*/last_request_id=$VALID_REQUEST_ID/" \
        "$(route_state_file "$environment")" >"$legacy_state_temp"
    /bin/mv "$legacy_state_temp" "$(route_state_file "$environment")"
    /bin/chmod 0600 "$(route_state_file "$environment")"
done
/bin/unlink "$(route_state_file production)"
/bin/cp "$legacy_operator" "$INSTALLED_OPERATOR"
/bin/chmod 0750 "$INSTALLED_OPERATOR"
/bin/unlink "$STATE_ROOT/preview/operator.lock"
/bin/unlink "$STATE_ROOT/production/operator.lock"
install_failure_preview_snapshot="$TEST_ROOT/install-failure-preview.snapshot"
install_failure_operator_snapshot="$TEST_ROOT/install-failure-operator.snapshot"
/bin/cp "$(route_state_file preview)" "$install_failure_preview_snapshot"
/bin/cp "$INSTALLED_OPERATOR" "$install_failure_operator_snapshot"
CMD_INSTALL=test_install_operator_failure
assert_fails main install --replace
CMD_INSTALL=test_install
assert_file_unchanged "$install_failure_preview_snapshot" "$(route_state_file preview)"
assert_file_unchanged "$install_failure_operator_snapshot" "$INSTALLED_OPERATOR"
assert_path_absent "$(route_state_file production)"
assert_path_absent "$LOG_DIRECTORY"
assert_no_temporary_route_state
for environment in preview production; do
    lock_file="$STATE_ROOT/$environment/operator.lock"
    if [[ ! -f "$lock_file" || -L "$lock_file" ]]; then
        fail "rollback did not retain a safe $environment lock file"
    fi
    [[ ! -s "$lock_file" ]] || fail "rollback retained non-empty $environment lock file"
    assert_equals "root:root:600" "$(test_stat -c '%U:%G:%a' "$lock_file")"
done

# Every protected bundle replacement point participates in the same
# compensating transaction. A failure at any point must restore both the
# complete prior bundle and the route-state files.
failure_index=0
for TEST_INSTALL_FAILURE_TARGET in \
    "$ARTIFACT_DIRECTORY" \
    "$INSTALLED_OPERATOR_ARTIFACT" \
    "$INSTALLED_DEPLOY_ARTIFACT" \
    "$INSTALLED_ROLLBACK_ARTIFACT" \
    "$INSTALLED_COMPOSE_ARTIFACT" \
    "$INSTALLED_OPERATOR"; do
    reset_installation_targets
    ensure_route_state_file preview
    ensure_route_state_file production
    ensure_deployment_locks true
    install_current_test_bundle
    failure_preview_snapshot="$TEST_ROOT/bundle-failure-$failure_index-preview.snapshot"
    failure_production_snapshot="$TEST_ROOT/bundle-failure-$failure_index-production.snapshot"
    failure_operator_snapshot="$TEST_ROOT/bundle-failure-$failure_index-operator.snapshot"
    failure_operator_artifact_snapshot="$TEST_ROOT/bundle-failure-$failure_index-operator-artifact.snapshot"
    failure_deploy_snapshot="$TEST_ROOT/bundle-failure-$failure_index-deploy.snapshot"
    failure_rollback_snapshot="$TEST_ROOT/bundle-failure-$failure_index-rollback.snapshot"
    failure_compose_snapshot="$TEST_ROOT/bundle-failure-$failure_index-compose.snapshot"
    /bin/cp "$(route_state_file preview)" "$failure_preview_snapshot"
    /bin/cp "$(route_state_file production)" "$failure_production_snapshot"
    /bin/cp "$INSTALLED_OPERATOR" "$failure_operator_snapshot"
    /bin/cp "$INSTALLED_OPERATOR_ARTIFACT" "$failure_operator_artifact_snapshot"
    /bin/cp "$INSTALLED_DEPLOY_ARTIFACT" "$failure_deploy_snapshot"
    /bin/cp "$INSTALLED_ROLLBACK_ARTIFACT" "$failure_rollback_snapshot"
    /bin/cp "$INSTALLED_COMPOSE_ARTIFACT" "$failure_compose_snapshot"

    CMD_INSTALL=test_install_target_failure
    assert_fails main install --replace
    CMD_INSTALL=test_install
    assert_file_unchanged "$failure_preview_snapshot" "$(route_state_file preview)"
    assert_file_unchanged "$failure_production_snapshot" "$(route_state_file production)"
    assert_file_unchanged "$failure_operator_snapshot" "$INSTALLED_OPERATOR"
    assert_file_unchanged "$failure_operator_artifact_snapshot" "$INSTALLED_OPERATOR_ARTIFACT"
    assert_file_unchanged "$failure_deploy_snapshot" "$INSTALLED_DEPLOY_ARTIFACT"
    assert_file_unchanged "$failure_rollback_snapshot" "$INSTALLED_ROLLBACK_ARTIFACT"
    assert_file_unchanged "$failure_compose_snapshot" "$INSTALLED_COMPOSE_ARTIFACT"
    assert_path_absent "$LOG_DIRECTORY"
    failure_index=$((failure_index + 1))
done
unset TEST_INSTALL_FAILURE_TARGET

# A busy environment lock fails closed before any snapshot migration.
CMD_FLOCK=test_flock_failure
assert_fails main install --replace
CMD_FLOCK=test_flock
assert_file_unchanged "$failure_preview_snapshot" "$(route_state_file preview)"
assert_file_unchanged "$failure_production_snapshot" "$(route_state_file production)"
assert_file_unchanged "$failure_operator_snapshot" "$INSTALLED_OPERATOR"
assert_file_unchanged "$failure_operator_artifact_snapshot" "$INSTALLED_OPERATOR_ARTIFACT"
assert_file_unchanged "$failure_deploy_snapshot" "$INSTALLED_DEPLOY_ARTIFACT"
assert_file_unchanged "$failure_rollback_snapshot" "$INSTALLED_ROLLBACK_ARTIFACT"
assert_file_unchanged "$failure_compose_snapshot" "$INSTALLED_COMPOSE_ARTIFACT"
assert_path_absent "$LOG_DIRECTORY"

echo "install-ci-operator tests passed"
