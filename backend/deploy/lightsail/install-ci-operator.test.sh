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
if grep -Eq 'sudoers|NOPASSWD' "$INSTALLER"; then
    fail "CI operator installer must not create a sudo path"
fi

reset_route_state_root
ensure_route_state_file preview
assert_route_state_structure preview
preview_snapshot="$TEST_ROOT/preview.snapshot"
/bin/cp "$(route_state_file preview)" "$preview_snapshot"
ensure_route_state_file preview
assert_file_unchanged "$preview_snapshot" "$(route_state_file preview)"

ensure_route_state_file production
assert_route_state_structure production
production_snapshot="$TEST_ROOT/production.snapshot"
/bin/cp "$(route_state_file production)" "$production_snapshot"
ensure_route_state_file production
assert_file_unchanged "$production_snapshot" "$(route_state_file production)"

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
