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

write_fixture() {
    local path="$1"
    shift

    printf '%s\n' "$@" >"$path"
    chmod 600 "$path"
}

valid_fixture() {
    local path="$1"

    write_fixture "$path" \
        '# fake values only; this fixture never reaches a provider' \
        "SUPABASE_URL=\"https://${PROJECT_REF}.supabase.co\"" \
        "DATABASE_URL=\"postgresql://postgres.${PROJECT_REF}:fake@aws-0.pooler.supabase.com:6543/postgres\"" \
        "DIRECT_URL=\"postgresql://postgres:fake@db.${PROJECT_REF}.supabase.co:5432/postgres\"" \
        "FALLBACK_PRODUCTION_DB_REF_SHA256=\"${PROJECT_HASH}\"" \
        'NODE_ENV=production'
}

expect_ok() {
    local path="$1"
    local stdout_file="$TEST_ROOT/stdout"
    local stderr_file="$TEST_ROOT/stderr"

    if ! check_production_db_identity "$path" false >"$stdout_file" 2>"$stderr_file"; then
        fail "expected identity check to pass"
    fi
    [[ "$(<"$stdout_file")" == 'production_db_identity=ok' ]] || fail "success output was not the stable marker"
    [[ ! -s "$stderr_file" ]] || fail "success emitted an unexpected error"
}

expect_fail() {
    local path="$1"
    local stdout_file="$TEST_ROOT/stdout"
    local stderr_file="$TEST_ROOT/stderr"

    if check_production_db_identity "$path" false >"$stdout_file" 2>"$stderr_file"; then
        fail "expected identity check to fail"
    fi
    [[ ! -s "$stdout_file" ]] || fail "failure emitted stdout"
    [[ "$(<"$stderr_file")" == 'production_db_identity=failed' ]] || fail "failure output was not generic"
}

source "$HELPER"

valid="$TEST_ROOT/valid.env"
valid_fixture "$valid"
expect_ok "$valid"

missing_hash="$TEST_ROOT/missing-hash.env"
write_fixture "$missing_hash" \
    "SUPABASE_URL=\"https://${PROJECT_REF}.supabase.co\"" \
    "DATABASE_URL=\"postgresql://postgres.${PROJECT_REF}:fake@pooler.supabase.com:6543/postgres\"" \
    "DIRECT_URL=\"postgresql://postgres:fake@db.${PROJECT_REF}.supabase.co:5432/postgres\""
expect_fail "$missing_hash"

duplicate_required="$TEST_ROOT/duplicate-required.env"
valid_fixture "$duplicate_required"
printf '%s\n' "SUPABASE_URL=\"https://${PROJECT_REF}.supabase.co\"" >>"$duplicate_required"
expect_fail "$duplicate_required"

duplicate_unrelated="$TEST_ROOT/duplicate-unrelated.env"
valid_fixture "$duplicate_unrelated"
printf '%s\n' 'NODE_ENV=production' >>"$duplicate_unrelated"
expect_fail "$duplicate_unrelated"

empty_required="$TEST_ROOT/empty-required.env"
valid_fixture "$empty_required"
printf '%s\n' 'DIRECT_URL=' >"$empty_required"
chmod 600 "$empty_required"
expect_fail "$empty_required"

malformed_key="$TEST_ROOT/malformed-key.env"
valid_fixture "$malformed_key"
printf '%s\n' "supabase_url=\"https://${PROJECT_REF}.supabase.co\"" >>"$malformed_key"
expect_fail "$malformed_key"

malformed_line="$TEST_ROOT/malformed-line.env"
valid_fixture "$malformed_line"
printf '%s\n' 'not an assignment' >>"$malformed_line"
expect_fail "$malformed_line"

symlink="$TEST_ROOT/symlink.env"
ln -s "$valid" "$symlink"
expect_fail "$symlink"

non_https="$TEST_ROOT/non-https.env"
valid_fixture "$non_https"
sed -i.bak 's#https://#http://#' "$non_https"
expect_fail "$non_https"

localhost_supabase="$TEST_ROOT/localhost-supabase.env"
write_fixture "$localhost_supabase" \
    'SUPABASE_URL="https://localhost"' \
    "DATABASE_URL=\"postgresql://postgres.${PROJECT_REF}:fake@pooler.supabase.com:6543/postgres\"" \
    "DIRECT_URL=\"postgresql://postgres:fake@db.${PROJECT_REF}.supabase.co:5432/postgres\"" \
    "FALLBACK_PRODUCTION_DB_REF_SHA256=\"${PROJECT_HASH}\""
expect_fail "$localhost_supabase"

invalid_ref="$TEST_ROOT/invalid-ref.env"
valid_fixture "$invalid_ref"
sed -i.bak 's#abcdefghijklmnopqrst#ABCDEFGHIJKLMNOPQRST#g' "$invalid_ref"
expect_fail "$invalid_ref"

inconsistent_ref="$TEST_ROOT/inconsistent-ref.env"
valid_fixture "$inconsistent_ref"
sed -i.bak 's#db\.abcdefghijklmnopqrst#db\.zyxwvutsrqponmlkjihg#' "$inconsistent_ref"
expect_fail "$inconsistent_ref"

missing_db_ref="$TEST_ROOT/missing-db-ref.env"
valid_fixture "$missing_db_ref"
sed -i.bak 's#postgres\.abcdefghijklmnopqrst#postgres#' "$missing_db_ref"
sed -i.bak 's#db\.abcdefghijklmnopqrst\.supabase\.co#db.other.supabase.co#' "$missing_db_ref"
expect_fail "$missing_db_ref"

malformed_db_scheme="$TEST_ROOT/malformed-db-scheme.env"
valid_fixture "$malformed_db_scheme"
sed -i.bak 's#postgresql://#mysql://#g' "$malformed_db_scheme"
expect_fail "$malformed_db_scheme"

db_whitespace="$TEST_ROOT/db-whitespace.env"
valid_fixture "$db_whitespace"
sed -i.bak 's#postgres\.abcdefghijklmnopqrst#postgres.abcdefghijklmnopqrst fake#' "$db_whitespace"
expect_fail "$db_whitespace"

mismatched_hash="$TEST_ROOT/mismatched-hash.env"
valid_fixture "$mismatched_hash"
sed -i.bak 's/FALLBACK_PRODUCTION_DB_REF_SHA256=.*/FALLBACK_PRODUCTION_DB_REF_SHA256="0000000000000000000000000000000000000000000000000000000000000000"/' "$mismatched_hash"
expect_fail "$mismatched_hash"

malformed_hash="$TEST_ROOT/malformed-hash.env"
valid_fixture "$malformed_hash"
sed -i.bak 's/FALLBACK_PRODUCTION_DB_REF_SHA256=.*/FALLBACK_PRODUCTION_DB_REF_SHA256="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"/' "$malformed_hash"
expect_fail "$malformed_hash"

unexpected_quote="$TEST_ROOT/unexpected-quote.env"
valid_fixture "$unexpected_quote"
sed -i.bak 's#postgres\.abcdefghijklmnopqrst#postgres".abcdefghijklmnopqrst#' "$unexpected_quote"
expect_fail "$unexpected_quote"

wrong_mode="$TEST_ROOT/wrong-mode.env"
valid_fixture "$wrong_mode"
chmod 640 "$wrong_mode"
expect_fail "$wrong_mode"

if [[ "$(id -u)" -ne 0 ]]; then
    strict_stdout="$TEST_ROOT/strict-stdout"
    strict_stderr="$TEST_ROOT/strict-stderr"
    if "$HELPER" "$valid" >"$strict_stdout" 2>"$strict_stderr"; then
        fail "strict command accepted a non-root-owned fixture"
    fi
    [[ ! -s "$strict_stdout" ]] || fail "strict failure emitted stdout"
    [[ "$(<"$strict_stderr")" == 'production_db_identity=failed' ]] \
        || fail "strict ownership failure was not generic"
fi

echo "Fallback Server Production DB identity tests passed"
