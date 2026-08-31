#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly COMPOSE_FILE="$SCRIPT_ROOT/compose.yml"
readonly INSTALLER="$SCRIPT_ROOT/install.sh"
readonly OPERATOR="$SCRIPT_ROOT/operator.sh"
readonly IDENTITY_HELPER="$SCRIPT_ROOT/production-db-identity.sh"
readonly IDENTITY_TEST="$SCRIPT_ROOT/production-db-identity.test.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    grep -Eq -- "$2" "$1" || fail "$3"
}

assert_not_contains() {
    if grep -Eq -- "$2" "$1"; then
        fail "$3"
    fi
}

[[ -r "$COMPOSE_FILE" ]] || fail "missing Fallback Server Compose file"
[[ -r "$INSTALLER" ]] || fail "missing Fallback Server installer"
[[ -r "$OPERATOR" ]] || fail "missing Fallback Server operator"
[[ -r "$IDENTITY_HELPER" ]] || fail "missing Production DB identity helper"
[[ -r "$IDENTITY_TEST" ]] || fail "missing Production DB identity tests"
assert_contains "$IDENTITY_HELPER" 'FALLBACK_PRODUCTION_DB_REF_SHA256' \
    "identity helper must require the approved Production DB ref digest"
assert_contains "$IDENTITY_HELPER" 'PROJECT_REF_PATTERN' \
    "identity helper must enforce a strict Supabase project URL"
assert_contains "$IDENTITY_HELPER" 'production_db_identity=failed' \
    "identity helper failures must use the generic marker"

assert_contains "$COMPOSE_FILE" '127\.0\.0\.1:3101:3001' \
    "Fallback Server API must bind only to loopback"
assert_contains "$COMPOSE_FILE" '^name:[[:space:]]+babyjamjam-fallback-server$' \
    "Compose project must use the Fallback Server identifier"
assert_contains "$COMPOSE_FILE" 'name:[[:space:]]+babyjamjam-fallback-server-valkey-data' \
    "Valkey volume must use the Fallback Server identifier"
assert_not_contains "$COMPOSE_FILE" '(^|["[:space:]-])0\.0\.0\.0:.*3001' \
    "Fallback Server API must not publish port 3001 publicly"
legacy_project_prefix='covenant'
legacy_project_suffix='standby'
assert_not_contains "$COMPOSE_FILE" "${legacy_project_prefix}-${legacy_project_suffix}|babyjamjam-${legacy_project_prefix}" \
    "Compose must not retain the old Covenant standby identifier"
for key in \
    SCHEDULERS_ENABLED \
    SERVICE_RECORD_AUTO_FINALIZE_ENABLED \
    CONTRACT_AUTO_FINALIZE_ENABLED \
    EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED \
    EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED \
    EFORMSIGN_RECONCILE_ALLOW_UNLOCKED; do
    assert_contains "$COMPOSE_FILE" "$key:[[:space:]]+\"false\"" \
        "$key must be hard-disabled in the Fallback Server runtime"
done
for key in ALIGO_API_KEY ALIGO_USER_ID ALIGO_SENDER_PHONE; do
    assert_contains "$COMPOSE_FILE" "$key:[[:space:]]+\"\"" \
        "$key must be blank until Covenant fixed egress is authorized"
done
assert_contains "$COMPOSE_FILE" 'pull_policy:[[:space:]]+never' \
    "Compose must not resolve a mutable image during activation"

assert_contains "$OPERATOR" 'ghcr\.io/jaino-song/babyjamjam-admin-backend' \
    "operator must use the fixed backend image repository"
assert_contains "$OPERATOR" 'org\.opencontainers\.image\.revision' \
    "operator must verify immutable image revision metadata"
assert_contains "$OPERATOR" 'running Fallback Server container does not match the recorded release' \
    "operator must verify the running container image against recorded state"
assert_contains "$OPERATOR" 'health/ready' \
    "operator must verify DB-backed readiness"
assert_contains "$OPERATOR" 'FALLBACK_PRODUCTION_DB_REF_SHA256' \
    "operator must require the Production DB identity digest"
assert_contains "$OPERATOR" 'validate_production_db_identity' \
    "operator must run the Production DB identity gate"
assert_contains "$OPERATOR" 'production_db_identity=ok' \
    "operator status must expose the safe Production DB identity marker"
assert_contains "$INSTALLER" 'production-db-identity\.sh' \
    "installer must stage and manifest the Production DB identity helper"
assert_contains "$INSTALLER" 'production-db-identity\.sh=\$\(sha256_file' \
    "installer must record the Production DB identity helper digest"
assert_contains "$OPERATOR" 'production-db-identity\.sh=\$identity_digest' \
    "operator must verify the Production DB identity helper digest"
assert_contains "$OPERATOR" 'wc -l <"\$BUNDLE_MANIFEST"\)" -eq 3' \
    "bundle manifest must include the Production DB identity helper"
assert_contains "$OPERATOR" 'public_routing=not_managed' \
    "operator status must keep DNS outside its authority"
assert_contains "$OPERATOR" 'exec 9>"\$LOCK_FILE"' \
    "operator must open its lock descriptor before acquiring the lock"
assert_not_contains "$OPERATOR" '(aws[[:space:]]|ssh[[:space:]]|cloudflared|vercel)' \
    "operator must not mutate external routing or cloud control planes"
assert_not_contains "$OPERATOR" 'prisma.*migrate|migrate.*deploy' \
    "Fallback Server deployment must not apply production migrations"

assert_contains "$INSTALLER" '/usr/local/libexec/babyjamjam-fallback-server' \
    "installer must use a fixed protected artifact directory"
assert_contains "$INSTALLER" '/opt/babyjamjam-fallback-server' \
    "installer must use a fixed protected state directory"
assert_not_contains "$INSTALLER" '(sudoers|authorized_keys|docker[[:space:]]+group)' \
    "installer must not broaden host privileges"
assert_not_contains "$OPERATOR" "${legacy_project_prefix}-${legacy_project_suffix}|babyjamjam-${legacy_project_prefix}" \
    "operator must not retain the old Covenant standby identifier"
assert_contains "$OPERATOR" 'environment=fallback-server' \
    "operator status must use the Fallback Server identifier"

bash -n "$OPERATOR"
bash -n "$INSTALLER"
bash -n "$IDENTITY_HELPER"
bash -n "$IDENTITY_TEST"
bash "$IDENTITY_TEST"

echo "Fallback Server contract tests passed"
