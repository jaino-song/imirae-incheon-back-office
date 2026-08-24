#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_SCRIPT="$SCRIPT_DIR/ci-operator.sh"

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

    if [[ "$actual" != "$expected" ]]; then
        fail "expected '$expected', got '$actual'"
    fi
}

[[ -r "$OPERATOR_SCRIPT" ]] || fail "missing CI operator: $OPERATOR_SCRIPT"

# shellcheck source=backend/deploy/lightsail/ci-operator.sh
source "$OPERATOR_SCRIPT"

valid_sha="432bc4840b9a44a3357a442c9ef93b7cc9f41459"
valid_digest="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
valid_uuid="123e4567-e89b-12d3-a456-426614174000"

validate_invocation status preview
validate_invocation status production
validate_invocation deploy preview "$valid_sha" "$valid_digest"
validate_invocation deploy production "$valid_sha" "$valid_digest"
validate_invocation db-probe preview shared "$valid_uuid"
validate_invocation db-probe production direct "$valid_uuid"
validate_invocation db-reconcile preview "$valid_uuid"
validate_invocation db-reconcile production "$valid_uuid"

assert_fails validate_invocation deploy preview preview "$valid_digest"
assert_fails validate_invocation deploy preview "$valid_sha" sha256:short
assert_fails validate_invocation deploy development "$valid_sha" "$valid_digest"
assert_fails validate_invocation rollback production
assert_fails validate_invocation db-probe preview invalid-route "$valid_uuid"
assert_fails validate_invocation db-probe preview shared invalid-uuid
assert_fails validate_invocation db-probe preview shared 00000000-0000-0000-0000-000000000000
assert_fails validate_invocation db-reconcile preview invalid-uuid
assert_fails validate_invocation db-reconcile preview 123e4567-e89b-02d3-a456-426614174000
assert_fails validate_invocation db-reconcile development "$valid_uuid"

configure_environment preview
assert_equals "preview" "$DEPLOY_BRANCH"
assert_equals "false" "$EXPECTED_SCHEDULERS_ENABLED"
assert_equals "https://preview.api.babyjamjam.com/health" "$PUBLIC_HEALTH_URL"
assert_equals "$STATE_DIRECTORY/operator.lock" "$DEPLOY_LOCK_FILE"
assert_equals "$ROUTE_STATE_ROOT/preview/$ROUTE_STATE_FILE_NAME" "$ROUTE_STATE_FILE"

configure_environment production
assert_equals "main" "$DEPLOY_BRANCH"
assert_equals "true" "$EXPECTED_SCHEDULERS_ENABLED"
assert_equals "https://api.babyjamjam.com/health" "$PUBLIC_HEALTH_URL"
assert_equals "$ROUTE_STATE_ROOT/production/$ROUTE_STATE_FILE_NAME" "$ROUTE_STATE_FILE"

fetch_invocation=""

run_as_deployer() {
    fetch_invocation="$*"
}

configure_environment preview
fetch_environment_ref
assert_equals "/usr/bin/git -C $REPOSITORY_ROOT fetch --quiet --prune origin +refs/heads/preview:refs/remotes/origin/preview" "$fetch_invocation"

image_invocations=""

run_as_deployer() {
    image_invocations+="$*"$'\n'

    if [[ "$*" == *"inspect --format {{index .Config.Labels \"org.opencontainers.image.revision\"}}"* ]]; then
        echo "$valid_sha"
    fi
}

pull_release_image "$valid_sha" "$valid_digest"
[[ "$image_invocations" == *"pull $IMAGE_REPOSITORY@$valid_digest"* ]] || fail "immutable image was not pulled"
[[ "$image_invocations" == *"tag $IMAGE_REPOSITORY@$valid_digest $LOCAL_IMAGE_REPOSITORY:$valid_sha"* ]] || fail "verified image was not tagged locally"

migration_invocation=""

run_as_deployer() {
    migration_invocation="$*"
}

configure_environment preview
run_release_migrations "$valid_sha"
assert_equals "/usr/bin/env BACKEND_ENV_FILE=$STATE_DIRECTORY/backend.env BACKEND_IMAGE=$LOCAL_IMAGE_REPOSITORY BACKEND_IMAGE_TAG=$valid_sha BACKEND_CPU_LIMIT=0.5 BACKEND_MEMORY_LIMIT=1g BACKEND_NETWORK_ALIAS=api-preview COMPOSE_PROJECT_NAME=babyjamjam-backend-preview LIGHTSAIL_EDGE_NETWORK=babyjamjam-edge-preview VALKEY_DATA_VOLUME=babyjamjam-backend-preview_valkey_data /usr/bin/docker compose -f $DEPLOY_WORKTREE/backend/compose.lightsail.yml run --rm --no-deps --entrypoint /usr/local/bin/node api node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma" "$migration_invocation"

rollback_invocation=""

run_as_deployer() {
    rollback_invocation="$*"
}

run_rollback_script "$valid_sha"
[[ "$rollback_invocation" == *"BACKEND_ROLLBACK_PRESERVE_PREVIOUS_TAG=true"* ]] \
    || fail "automatic recovery must preserve the prior known-good rollback tag"

echo "ci-operator tests passed"
