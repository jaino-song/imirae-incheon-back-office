#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly HELPER="$SCRIPT_ROOT/production-db-identity.sh"
readonly TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fallback-db-identity.XXXXXX")"

cleanup() {
    rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

hash_ref() {
    local ref="$1"

    if command -v sha256sum >/dev/null 2>&1; then
        printf '%s' "$ref" | sha256sum | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        printf '%s' "$ref" | shasum -a 256 | awk '{print $1}'
    else
        fail "no SHA-256 utility available"
    fi
}

readonly PROJECT_REF='abcdefghijklmnopqrst'
readonly PROJECT_HASH="$(hash_ref "$PROJECT_REF")"
readonly OTHER_HASH='0000000000000000000000000000000000000000000000000000000000000000'

write_env() {
    local path="$1"
    shift

    printf '%s\n' "$@" >"$path"
    chmod 600 "$path"
}

write_approval() {
    local path="$1"
    local hash="$2"

    printf '%s\n' "$hash" >"$path"
    chmod 400 "$path"
}

valid_fixture() {
    local path="$1"

    write_env "$path" \
        '# fake values only; this fixture never reaches a provider' \
        "SUPABASE_URL=\"https://${PROJECT_REF}.supabase.co\"" \
        "DATABASE_URL=\"postgresql://postgres.${PROJECT_REF}:fake@aws-0.pooler.supabase.com:6543/postgres\"" \
        "DIRECT_URL=\"postgresql://postgres:fake@db.${PROJECT_REF}.supabase.co:5432/postgres\"" \
        'NODE_ENV=production'
}

expect_ok() {
    local env_file="$1"
    local approval_file="$2"
    local stdout_file="$TEST_ROOT/stdout"
    local stderr_file="$TEST_ROOT/stderr"

    if ! check_production_db_identity "$env_file" "$approval_file" false >"$stdout_file" 2>"$stderr_file"; then
        fail "expected identity check to pass"
    fi
    [[ "$(<"$stdout_file")" == 'production_db_identity=ok' ]] || fail "success output was not the stable marker"
    [[ ! -s "$stderr_file" ]] || fail "success emitted an unexpected error"
}

expect_fail() {
    local env_file="$1"
    local approval_file="$2"
    local stdout_file="$TEST_ROOT/stdout"
    local stderr_file="$TEST_ROOT/stderr"

    if check_production_db_identity "$env_file" "$approval_file" false >"$stdout_file" 2>"$stderr_file"; then
        fail "expected identity check to fail"
    fi
    [[ ! -s "$stdout_file" ]] || fail "failure emitted stdout"
    [[ "$(<"$stderr_file")" == 'production_db_identity=failed' ]] || fail "failure output was not generic"
}

source "$HELPER"

valid="$TEST_ROOT/valid.env"
approval="$TEST_ROOT/approved.sha256"
valid_fixture "$valid"
write_approval "$approval" "$PROJECT_HASH"
expect_ok "$valid" "$approval"

missing_approval="$TEST_ROOT/missing-approved.sha256"
expect_fail "$valid" "$missing_approval"

wrong_approval="$TEST_ROOT/wrong-approved.sha256"
write_approval "$wrong_approval" "$OTHER_HASH"
expect_fail "$valid" "$wrong_approval"

uppercase_approval="$TEST_ROOT/uppercase-approved.sha256"
write_approval "$uppercase_approval" 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
expect_fail "$valid" "$uppercase_approval"

extra_approval="$TEST_ROOT/extra-approved.sha256"
printf '%s\n\n' "$PROJECT_HASH" >"$extra_approval"
chmod 400 "$extra_approval"
expect_fail "$valid" "$extra_approval"

whitespace_approval="$TEST_ROOT/whitespace-approved.sha256"
printf '%s \n' "$PROJECT_HASH" >"$whitespace_approval"
chmod 400 "$whitespace_approval"
expect_fail "$valid" "$whitespace_approval"

symlink_approval="$TEST_ROOT/symlink-approved.sha256"
ln -s "$approval" "$symlink_approval"
expect_fail "$valid" "$symlink_approval"

wrong_mode_approval="$TEST_ROOT/wrong-mode-approved.sha256"
write_approval "$wrong_mode_approval" "$PROJECT_HASH"
chmod 440 "$wrong_mode_approval"
expect_fail "$valid" "$wrong_mode_approval"

self_attested="$TEST_ROOT/self-attested.env"
valid_fixture "$self_attested"
printf '%s\n' "FALLBACK_PRODUCTION_DB_REF_SHA256=\"${PROJECT_HASH}\"" >>"$self_attested"
expect_fail "$self_attested" "$approval"

duplicate_env="$TEST_ROOT/duplicate-env.env"
valid_fixture "$duplicate_env"
printf '%s\n' "SUPABASE_URL=\"https://${PROJECT_REF}.supabase.co\"" >>"$duplicate_env"
expect_fail "$duplicate_env" "$approval"

empty_env="$TEST_ROOT/empty-env.env"
write_env "$empty_env" \
    'SUPABASE_URL=' \
    "DATABASE_URL=\"postgresql://postgres.${PROJECT_REF}:fake@pooler.supabase.com:6543/postgres\"" \
    "DIRECT_URL=\"postgresql://postgres:fake@db.${PROJECT_REF}.supabase.co:5432/postgres\""
expect_fail "$empty_env" "$approval"

malformed_env="$TEST_ROOT/malformed-env.env"
valid_fixture "$malformed_env"
printf '%s\n' 'not an assignment' >>"$malformed_env"
expect_fail "$malformed_env" "$approval"

non_https="$TEST_ROOT/non-https.env"
write_env "$non_https" \
    "SUPABASE_URL=\"http://${PROJECT_REF}.supabase.co\"" \
    "DATABASE_URL=\"postgresql://postgres.${PROJECT_REF}:fake@pooler.supabase.com:6543/postgres\"" \
    "DIRECT_URL=\"postgresql://postgres:fake@db.${PROJECT_REF}.supabase.co:5432/postgres\""
expect_fail "$non_https" "$approval"

localhost_supabase="$TEST_ROOT/localhost-supabase.env"
write_env "$localhost_supabase" \
    'SUPABASE_URL="https://localhost"' \
    "DATABASE_URL=\"postgresql://postgres.${PROJECT_REF}:fake@pooler.supabase.com:6543/postgres\"" \
    "DIRECT_URL=\"postgresql://postgres:fake@db.${PROJECT_REF}.supabase.co:5432/postgres\""
expect_fail "$localhost_supabase" "$approval"

invalid_ref="$TEST_ROOT/invalid-ref.env"
write_env "$invalid_ref" \
    'SUPABASE_URL="https://ABCDEFGHIJKLMNOPQRST.supabase.co"' \
    "DATABASE_URL=\"postgresql://postgres.${PROJECT_REF}:fake@pooler.supabase.com:6543/postgres\"" \
    "DIRECT_URL=\"postgresql://postgres:fake@db.${PROJECT_REF}.supabase.co:5432/postgres\""
expect_fail "$invalid_ref" "$approval"

inconsistent_ref="$TEST_ROOT/inconsistent-ref.env"
write_env "$inconsistent_ref" \
    "SUPABASE_URL=\"https://${PROJECT_REF}.supabase.co\"" \
    'DATABASE_URL="postgresql://postgres.zyxwvutsrqponmlkjihg:fake@aws-0.pooler.supabase.com:6543/postgres"' \
    "DIRECT_URL=\"postgresql://postgres:fake@db.${PROJECT_REF}.supabase.co:5432/postgres\""
expect_fail "$inconsistent_ref" "$approval"

wrong_mode_env="$TEST_ROOT/wrong-mode.env"
valid_fixture "$wrong_mode_env"
chmod 640 "$wrong_mode_env"
expect_fail "$wrong_mode_env" "$approval"

symlink_env="$TEST_ROOT/symlink.env"
ln -s "$valid" "$symlink_env"
expect_fail "$symlink_env" "$approval"

if [[ "$(id -u)" -ne 0 ]]; then
    strict_stdout="$TEST_ROOT/strict-stdout"
    strict_stderr="$TEST_ROOT/strict-stderr"
    if "$HELPER" "$valid" "$approval" >"$strict_stdout" 2>"$strict_stderr"; then
        fail "strict command accepted a non-root-owned fixture"
    fi
    [[ ! -s "$strict_stdout" ]] || fail "strict failure emitted stdout"
    [[ "$(<"$strict_stderr")" == 'production_db_identity=failed' ]] \
        || fail "strict ownership failure was not generic"
fi

echo "Fallback Server Production DB identity tests passed"
