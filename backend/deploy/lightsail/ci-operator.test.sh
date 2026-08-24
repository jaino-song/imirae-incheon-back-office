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

run_as_root() {
    image_invocations+="$*"$'\n'

    if [[ "$*" == *"inspect --format {{index .Config.Labels \"org.opencontainers.image.revision\"}}"* ]]; then
        echo "$valid_sha"
    fi
}

pull_release_image "$valid_sha" "$valid_digest"
[[ "$image_invocations" == *"pull $IMAGE_REPOSITORY@$valid_digest"* ]] || fail "immutable image was not pulled"
[[ "$image_invocations" == *"tag $IMAGE_REPOSITORY@$valid_digest $LOCAL_IMAGE_REPOSITORY:$valid_sha"* ]] || fail "verified image was not tagged locally"

migration_invocation=""

run_as_root() {
    migration_invocation="$*"
}

configure_environment preview
run_release_migrations "$valid_sha"
assert_equals "/usr/bin/env BACKEND_ENV_FILE=$STATE_DIRECTORY/backend.env BACKEND_IMAGE=$LOCAL_IMAGE_REPOSITORY BACKEND_IMAGE_TAG=$valid_sha BACKEND_CPU_LIMIT=0.5 BACKEND_MEMORY_LIMIT=1g BACKEND_NETWORK_ALIAS=api-preview COMPOSE_PROJECT_NAME=babyjamjam-backend-preview LIGHTSAIL_EDGE_NETWORK=babyjamjam-edge-preview VALKEY_DATA_VOLUME=babyjamjam-backend-preview_valkey_data /usr/bin/docker compose -f $ROOT_COMPOSE_ARTIFACT run --rm --no-deps --entrypoint /usr/local/bin/node api node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma" "$migration_invocation"

rollback_invocation=""

run_as_root() {
    rollback_invocation="$*"
}

run_rollback_script "$valid_sha"
[[ "$rollback_invocation" == *"BACKEND_ROLLBACK_PRESERVE_PREVIOUS_TAG=true"* ]] \
    || fail "automatic recovery must preserve the prior known-good rollback tag"
[[ "$rollback_invocation" == *"BACKEND_COMPOSE_FILE=$ROOT_COMPOSE_ARTIFACT"* \
    && "$rollback_invocation" == *"$ROOT_ROLLBACK_ARTIFACT preview $valid_sha"* ]] \
    || fail "automatic recovery must use only protected root artifacts"
[[ "$rollback_invocation" != *"$DEPLOY_WORKTREE"* ]] \
    || fail "automatic recovery must not execute an ubuntu-owned worktree artifact"

deploy_invocation=""
run_as_root() {
    deploy_invocation="$*"
}
run_deploy_script "$valid_sha"
[[ "$deploy_invocation" == *"BACKEND_COMPOSE_FILE=$ROOT_COMPOSE_ARTIFACT"* \
    && "$deploy_invocation" == *"$ROOT_DEPLOY_ARTIFACT preview"* ]] \
    || fail "deployment must use only protected root artifacts"
[[ "$deploy_invocation" != *"$DEPLOY_WORKTREE"* ]] \
    || fail "deployment must not execute an ubuntu-owned worktree artifact"

# Status must derive the route from authoritative state and reuse the complete
# runtime invariant. The running container is deliberately not allowed to
# choose a different route.
(
configure_environment preview
ROUTE_STATE_ACTIVE_ROUTE=direct
status_verified_route_file="$(mktemp /tmp/ci-operator-status-route.XXXXXX)"
trap 'rm -f "$status_verified_route_file"' EXIT
ensure_route_state() { :; }
load_route_state() { :; }
validate_backend_env_file() { :; }
load_current_release_identity() {
    CURRENT_ROUTE_IMAGE_TAG="$valid_sha"
    CURRENT_ROUTE_IMAGE_DIGEST="$valid_digest"
}
find_api_container() { printf '%s\n' status-api; }
read_recorded_tag() { printf '%s\n' "$valid_sha"; }
read_recorded_digest() { printf '%s\n' "$valid_digest"; }
verify_api_runtime() {
    printf '%s\n' "$1" >"$status_verified_route_file"
    return "${status_runtime_result:-0}"
}
run_as_root() {
    case "$*" in
        *"{{.Config.Image}}"*) printf '%s\n' "$LOCAL_IMAGE_REPOSITORY:$valid_sha" ;;
        *"{{.RestartCount}}"*) printf '0\n' ;;
        *"{{if .State.Health}}"*) printf 'healthy\n' ;;
        *"{{range .Config.Env}}"*) printf 'SCHEDULERS_ENABLED=false\n' ;;
        *curl*) printf '{"status":"ok"}\n' ;;
        *) : ;;
    esac
}
status_runtime_result=0
status_output="$(status_environment)"
[[ "$(<"$status_verified_route_file")" == direct ]] || fail "status did not verify the persisted route"
[[ "$status_output" == *$'db_route=direct\n'* ]] || fail "status did not expose db_route"
[[ "$status_output" == *$'runtime_route=direct\n'* ]] || fail "status did not expose runtime_route"
[[ "$status_output" == *$'db_readiness=ok\n'* ]] || fail "status did not expose db readiness"
status_runtime_result=1
assert_fails status_environment
)

# Exercise the actual runtime invariant in both accepting and refusing
# directions. Each failure model represents an observation that deploy and
# rollback status checks must reject.
configure_environment preview
CURRENT_ROUTE_IMAGE_TAG="$valid_sha"
CURRENT_ROUTE_IMAGE_DIGEST="$valid_digest"
CURRENT_DIGEST_FILE="/tmp/ci-operator-runtime-digest"
printf '%s\n' "$valid_digest" >"$CURRENT_DIGEST_FILE"
runtime_failure_mode=none
find_api_container_optional() { printf '%s\n' api-container; }
read_recorded_digest() { printf '%s\n' "$valid_digest"; }
run_internal_ready_check() { [[ "$runtime_failure_mode" != internal_ready_503 ]]; }
run_public_ready_check() { [[ "$runtime_failure_mode" != readiness_503 ]]; }
run_public_liveness_check() { [[ "$runtime_failure_mode" != liveness_failure ]]; }
run_as_root() {
    case "$*" in
        *"docker ps"*)
            if [[ "$runtime_failure_mode" == multiple_api ]]; then
                printf 'api-one\napi-two\n'
            else
                printf 'api-one\n'
            fi
            ;;
        *"{{if .State.Health}}"*) printf 'healthy\n' ;;
        *"{{.RestartCount}}"*) printf '0\n' ;;
        *"{{.Id}}"*) printf 'sha256:runtime-image\n' ;;
        *"{{.Config.Image}}"*) printf '%s\n' "$LOCAL_IMAGE_REPOSITORY:$valid_sha" ;;
        *"{{.Image}}"*) printf 'sha256:runtime-image\n' ;;
        *"{{index .Config.Labels"*) printf '%s\n' "$valid_sha" ;;
        *"{{join .RepoDigests"*) printf '%s@%s\n' "$IMAGE_REPOSITORY" "$valid_digest" ;;
        *"{{range .Config.Env"*)
            if [[ "$runtime_failure_mode" == scheduler_malformed ]]; then
                printf 'SCHEDULERS_ENABLED=false=malformed\nDATABASE_CONNECTION_MODE=direct\n'
            elif [[ "$runtime_failure_mode" == route_mismatch ]]; then
                printf 'SCHEDULERS_ENABLED=false\nDATABASE_CONNECTION_MODE=shared\n'
            elif [[ "$runtime_failure_mode" == route_malformed ]]; then
                printf 'SCHEDULERS_ENABLED=false\nDATABASE_CONNECTION_MODE=direct=malformed\n'
            else
                printf 'SCHEDULERS_ENABLED=false\nDATABASE_CONNECTION_MODE=direct\n'
            fi
            ;;
        *) : ;;
    esac
}
runtime_failure_mode=none
verify_api_runtime direct || fail "runtime invariant rejected a healthy direct deployment"
for runtime_failure_mode in route_mismatch scheduler_malformed route_malformed readiness_503 image_digest_mismatch multiple_api; do
    if [[ "$runtime_failure_mode" == image_digest_mismatch ]]; then
        run_as_root() {
            case "$*" in
                *"{{.Config.Image}}"*) printf '%s\n' "$LOCAL_IMAGE_REPOSITORY:0000000000000000000000000000000000000000" ;;
                *) : ;;
            esac
        }
    fi
    assert_fails verify_api_runtime direct
    if [[ "$runtime_failure_mode" == image_digest_mismatch ]]; then
        # Restore the complete mock for the next adversarial direction.
        unset -f run_as_root
        run_as_root() {
            case "$*" in
                *"docker ps"*)
                    if [[ "$runtime_failure_mode" == multiple_api ]]; then
                        printf 'api-one\napi-two\n'
                    else
                        printf 'api-one\n'
                    fi
                    ;;
                *"{{if .State.Health}}"*) printf 'healthy\n' ;;
                *"{{.RestartCount}}"*) printf '0\n' ;;
                *"{{.Id}}"*) printf 'sha256:runtime-image\n' ;;
                *"{{.Config.Image}}"*) printf '%s\n' "$LOCAL_IMAGE_REPOSITORY:$valid_sha" ;;
                *"{{.Image}}"*) printf 'sha256:runtime-image\n' ;;
                *"{{join .RepoDigests"*) printf '%s@%s\n' "$IMAGE_REPOSITORY" "$valid_digest" ;;
                *"{{range .Config.Env"*) printf 'SCHEDULERS_ENABLED=false\nDATABASE_CONNECTION_MODE=direct\n' ;;
                *) : ;;
            esac
        }
    fi
done
rm -f "$CURRENT_DIGEST_FILE"

# Exercise the host-boundary checks on the Linux deployment host where GNU
# stat and root ownership are available. macOS local runs retain the static
# contract checks above and report this host-only harness as skipped.
if [[ "$(uname -s)" == Linux && "$EUID" -eq 0 ]]; then
    boundary_root="$(mktemp -d /opt/babyjamjam-env-boundary.XXXXXX)"
    boundary_real="$boundary_root/real"
    boundary_env_file="$boundary_real/backend.env"
    mkdir -m 0700 "$boundary_real"
    printf '%s\n' 'DATABASE_URL=postgresql://db-user:db-password@example.invalid/db' >"$boundary_env_file"
    chown root:root "$boundary_root" "$boundary_real" "$boundary_env_file"
    chmod 0700 "$boundary_root" "$boundary_real"
    chmod 0600 "$boundary_env_file"
    BACKEND_ENV_FILE="$boundary_env_file"
    validate_backend_env_file || fail "root:root 0600 environment file was rejected"

    boundary_rejection_without_secret() {
        local boundary_output
        local boundary_status

        set +e
        boundary_output="$(validate_backend_env_file 2>&1)"
        boundary_status=$?
        set -e
        [[ "$boundary_status" -ne 0 ]] || fail "unsafe environment boundary was accepted"
        [[ "$boundary_output" != *"db-password"* ]] \
            || fail "environment validation emitted secret content"
    }

    chmod 0640 "$boundary_env_file"
    boundary_rejection_without_secret
    chmod 0600 "$boundary_env_file"
    if /usr/bin/id ubuntu >/dev/null 2>&1; then
        chown ubuntu:ubuntu "$boundary_env_file"
        boundary_rejection_without_secret
        chown root:root "$boundary_env_file"
    fi
    chmod 0770 "$boundary_real"
    boundary_rejection_without_secret
    chmod 0700 "$boundary_real"

    boundary_secret_source="$boundary_root/secret-source"
    printf '%s\n' 'DATABASE_URL=postgresql://db-user:db-password@example.invalid/db' >"$boundary_secret_source"
    chown root:root "$boundary_secret_source"
    chmod 0600 "$boundary_secret_source"
    rm -f "$boundary_env_file"
    ln -s "$boundary_secret_source" "$boundary_env_file"
    boundary_rejection_without_secret
    rm -f "$boundary_env_file"
    ln -s "$boundary_real" "$boundary_root/link"
    BACKEND_ENV_FILE="$boundary_root/link/backend.env"
    boundary_rejection_without_secret
    rm -f "$boundary_root/link"

    rm -rf "$boundary_root"
    echo "Linux environment-boundary tests passed"
else
    echo "Linux environment-boundary tests skipped on this host"
fi

echo "ci-operator tests passed"
