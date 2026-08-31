#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly COMPOSE_FILE="$SCRIPT_ROOT/compose.yml"
readonly INSTALLER="$SCRIPT_ROOT/install.sh"
readonly OPERATOR="$SCRIPT_ROOT/operator.sh"

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

[[ -r "$COMPOSE_FILE" ]] || fail "missing Covenant standby Compose file"
[[ -r "$INSTALLER" ]] || fail "missing Covenant standby installer"
[[ -r "$OPERATOR" ]] || fail "missing Covenant standby operator"

assert_contains "$COMPOSE_FILE" '127\.0\.0\.1:3101:3001' \
    "standby API must bind only to loopback"
assert_not_contains "$COMPOSE_FILE" '(^|["[:space:]-])0\.0\.0\.0:.*3001' \
    "standby API must not publish port 3001 publicly"
for key in \
    SCHEDULERS_ENABLED \
    SERVICE_RECORD_AUTO_FINALIZE_ENABLED \
    CONTRACT_AUTO_FINALIZE_ENABLED \
    EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED \
    EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED \
    EFORMSIGN_RECONCILE_ALLOW_UNLOCKED; do
    assert_contains "$COMPOSE_FILE" "$key:[[:space:]]+\"false\"" \
        "$key must be hard-disabled in the standby runtime"
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
assert_contains "$OPERATOR" 'running Covenant standby container does not match the recorded release' \
    "operator must verify the running container image against recorded state"
assert_contains "$OPERATOR" 'health/ready' \
    "operator must verify DB-backed readiness"
assert_contains "$OPERATOR" 'public_routing=not_managed' \
    "operator status must keep DNS outside its authority"
assert_contains "$OPERATOR" 'exec 9>"\$LOCK_FILE"' \
    "operator must open its lock descriptor before acquiring the lock"
assert_not_contains "$OPERATOR" '(aws[[:space:]]|ssh[[:space:]]|cloudflared|vercel)' \
    "operator must not mutate external routing or cloud control planes"
assert_not_contains "$OPERATOR" 'prisma.*migrate|migrate.*deploy' \
    "standby deployment must not apply production migrations"

assert_contains "$INSTALLER" '/usr/local/libexec/babyjamjam-covenant-standby' \
    "installer must use a fixed protected artifact directory"
assert_contains "$INSTALLER" '/opt/babyjamjam-covenant' \
    "installer must use a fixed protected state directory"
assert_not_contains "$INSTALLER" '(sudoers|authorized_keys|docker[[:space:]]+group)' \
    "installer must not broaden host privileges"

bash -n "$OPERATOR"
bash -n "$INSTALLER"

echo "Covenant standby contract tests passed"
