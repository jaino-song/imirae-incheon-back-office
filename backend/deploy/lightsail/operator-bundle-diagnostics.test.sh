#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_SOURCE="$SCRIPT_DIR/ci-operator.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_equals() {
    local expected="$1"
    local actual="$2"

    [[ "$expected" == "$actual" ]] \
        || fail "expected '$expected', got '$actual'"
}

assert_fails() {
    if ("$@") >/dev/null 2>&1; then
        fail "expected command to fail: $*"
    fi
}

assert_contains() {
    local needle="$1"
    local haystack="$2"
    local description="$3"

    [[ "$haystack" == *"$needle"* ]] || fail "$description"
}

assert_not_contains() {
    local needle="$1"
    local haystack="$2"
    local description="$3"

    [[ "$haystack" != *"$needle"* ]] || fail "$description"
}

[[ -r "$OPERATOR_SOURCE" ]] || fail "missing CI operator: $OPERATOR_SOURCE"
grep -Fq 'diagnostics <preview|production>' "$OPERATOR_SOURCE" \
    || fail "diagnostics usage contract is missing"
grep -Fq 'require_root' "$OPERATOR_SOURCE" \
    || fail "diagnostics must retain the root boundary"
grep -Fq 'DIAGNOSTICS_MAX_OUTPUT_BYTES="131072"' "$OPERATOR_SOURCE" \
    || fail "diagnostics output cap is missing"

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/babyjamjam-operator-diagnostics.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT
LOG_ROOT_OVERRIDE="$TEST_ROOT/logs"
mkdir -p "$LOG_ROOT_OVERRIDE"

# ci-operator.sh intentionally pins the production log root. Generate an
# isolated copy with only that fixed root redirected to a temporary test tree;
# all diagnostics logic and the root-boundary dispatch remain unchanged.
GENERATED_OPERATOR="$TEST_ROOT/ci-operator.sh"
sed "s#readonly LOG_ROOT=\"/var/log/babyjamjam-deploy\"#readonly LOG_ROOT=\"$LOG_ROOT_OVERRIDE\"#" \
    "$OPERATOR_SOURCE" >"$GENERATED_OPERATOR"
chmod 0750 "$GENERATED_OPERATOR"

# shellcheck source=backend/deploy/lightsail/ci-operator.sh
source "$GENERATED_OPERATOR"

validate_invocation diagnostics preview
validate_invocation diagnostics production
assert_fails validate_invocation diagnostics preview extra
assert_fails validate_invocation diagnostics preview/../production
assert_fails validate_invocation diagnostics /tmp

write_preview_log() {
    local index="$1"
    local path="$LOG_ROOT/preview.$(printf '%03d' "$index").log"

    printf '%s\n' \
        "attempt=$index token=TOP_TOKEN_$index password=\"TOP SECRET $index\" DATABASE_URL=postgresql://user:pass@example.invalid/db Authorization: Bearer TOP_AUTH_$index Cookie: TOP_COOKIE_$index" \
        "health probe https://public.example.invalid/deploy/$index" \
        >"$path"
    # Distinct mtimes make ordering deterministic on filesystems with a coarse
    # timestamp resolution; implementation still sorts by mtime then name.
    touch -t "20260828$(printf '%02d' "$index")00" "$path"
}

for index in 1 2 3 4 5 6 7; do
    write_preview_log "$index"
done
printf '%s\n' 'production-secret=PRODUCTION_ONLY' >"$LOG_ROOT/production.001.log"
touch -t 202608280001 "$LOG_ROOT/production.001.log"
printf '%s\n' 'ignored=wrong-extension' >"$LOG_ROOT/preview.008.txt"
ln -s "$LOG_ROOT/production.001.log" "$LOG_ROOT/preview.099.log"

preview_snapshot="$TEST_ROOT/preview.007.snapshot"
cp "$LOG_ROOT/preview.007.log" "$preview_snapshot"
root_boundary_calls=0
require_root() {
    root_boundary_calls=$((root_boundary_calls + 1))
}

basic_output_path="$TEST_ROOT/basic.out"
main diagnostics preview >"$basic_output_path"
basic_output="$(<"$basic_output_path")"
assert_equals "1" "$root_boundary_calls"
assert_contains $'environment=preview\n' "$basic_output" \
    "diagnostics must identify the requested environment"
assert_contains $'logs=5\n' "$basic_output" \
    "diagnostics must cap the retained log count"
assert_equals "5" "$(grep -c '^log=' "$basic_output_path")"
assert_equals "log=preview.007.log" "$(grep '^log=' "$basic_output_path" | head -n 1 | cut -d' ' -f1)"
assert_not_contains "production.001.log" "$basic_output" \
    "diagnostics must not enumerate another environment"
assert_not_contains "PRODUCTION_ONLY" "$basic_output" \
    "diagnostics must not expose another environment's log content"
assert_not_contains "preview.008.txt" "$basic_output" \
    "diagnostics must ignore non-log paths"
assert_not_contains "preview.099.log" "$basic_output" \
    "diagnostics must ignore symlinked logs"
for secret in TOP_TOKEN_1 "TOP SECRET 1" 'postgresql://user:pass@example.invalid/db' TOP_AUTH_1 TOP_COOKIE_1; do
    assert_not_contains "$secret" "$basic_output" \
        "diagnostics leaked a secret or credential: $secret"
done
assert_contains '[REDACTED]' "$basic_output" \
    "diagnostics must visibly redact secret-like values"
assert_contains '[REDACTED_URL]' "$basic_output" \
    "diagnostics must visibly redact URLs"
cmp -s "$preview_snapshot" "$LOG_ROOT/preview.007.log" \
    || fail "diagnostics mutated a retained log"

# A large individual log must be bounded even when the global output budget
# still has room. The first selected log is deliberately large so the
# per-file line cap is exercised before the remaining logs are enumerated.
for line_index in $(seq 1 250); do
    printf 'diagnostic-line-%03d\n' "$line_index"
done >"$LOG_ROOT/preview.007.log"
bounded_output_path="$TEST_ROOT/bounded.out"
main diagnostics preview >"$bounded_output_path"
bounded_output="$(<"$bounded_output_path")"
bounded_bytes="$(wc -c <"$bounded_output_path" | tr -d '[:space:]')"
(( bounded_bytes <= 131072 )) || fail "diagnostics exceeded the global output cap: $bounded_bytes"
assert_contains '[output truncated: line cap]' "$bounded_output" \
    "diagnostics must mark per-log line truncation"
assert_contains 'diagnostic-line-200' "$bounded_output" \
    "diagnostics must retain content through the line cap"
assert_not_contains 'diagnostic-line-201' "$bounded_output" \
    "diagnostics must stop content at the line cap"

# Exercise the global output cap with five large logs. The command must stop
# emitting at the fixed byte budget and must never read an arbitrary path.
for index in 1 2 3 4 5; do
    path="$LOG_ROOT/preview.$(printf '%03d' "$index").log"
    awk 'BEGIN { for (i = 0; i < 40000; i++) printf "X"; printf "\n" }' >"$path"
done
global_output_path="$TEST_ROOT/global.out"
main diagnostics preview >"$global_output_path"
global_bytes="$(wc -c <"$global_output_path" | tr -d '[:space:]')"
(( global_bytes <= 131072 )) || fail "diagnostics exceeded the global output cap: $global_bytes"

rm -rf "$LOG_ROOT"
missing_output_path="$TEST_ROOT/missing.out"
main diagnostics preview >"$missing_output_path"
assert_equals $'environment=preview\nlogs=0\nmessage=no_retained_deployment_logs' "$(<"$missing_output_path")"

echo "operator bundle and diagnostics tests passed"
