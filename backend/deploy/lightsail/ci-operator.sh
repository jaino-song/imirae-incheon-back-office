#!/usr/bin/env bash

set -euo pipefail

readonly REPOSITORY_ROOT="/opt/babyjamjam/repository"
readonly DEPLOY_WORKTREE_ROOT="/opt/babyjamjam/deploy-worktrees"
readonly STATE_ROOT="/opt/babyjamjam/environments"
readonly LOG_ROOT="/var/log/babyjamjam-deploy"
readonly IMAGE_REPOSITORY="ghcr.io/jaino-song/babyjamjam-admin-backend"
readonly LOCAL_IMAGE_REPOSITORY="babyjamjam-backend"
readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

usage() {
    cat >&2 <<'EOF'
Usage:
  babyjamjam-ci-operator status <preview|production>
  babyjamjam-ci-operator deploy <preview|production> <40-character-commit-sha> <sha256-image-digest>
EOF
}

die() {
    echo "$*" >&2
    exit 1
}

is_environment() {
    [[ "${1:-}" == "preview" || "${1:-}" == "production" ]]
}

is_commit_sha() {
    [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]]
}

is_image_digest() {
    [[ "${1:-}" =~ ^sha256:[0-9a-f]{64}$ ]]
}

validate_invocation() {
    local command_name="${1:-}"

    case "$command_name" in
        status)
            [[ "$#" -eq 2 ]] || return 1
            is_environment "$2"
            ;;
        deploy)
            [[ "$#" -eq 4 ]] || return 1
            is_environment "$2" && is_commit_sha "$3" && is_image_digest "$4"
            ;;
        *)
            return 1
            ;;
    esac
}

require_root() {
    [[ "$EUID" -eq 0 ]] || die "The CI operator must run as root through AWS Systems Manager."
}

run_as_deployer() {
    /usr/sbin/runuser -u ubuntu -- /usr/bin/env -i \
        HOME=/home/ubuntu \
        USER=ubuntu \
        LOGNAME=ubuntu \
        SHELL=/bin/bash \
        LC_ALL=C \
        PATH="$SAFE_PATH" \
        "$@"
}

configure_environment() {
    local environment="$1"

    case "$environment" in
        preview)
            DEPLOY_BRANCH="preview"
            EXPECTED_SCHEDULERS_ENABLED="false"
            PUBLIC_HEALTH_URL="https://preview.api.babyjamjam.com/health"
            COMPOSE_PROJECT="babyjamjam-backend-preview"
            BACKEND_CPU_LIMIT="0.5"
            BACKEND_MEMORY_LIMIT="1g"
            EDGE_NETWORK="babyjamjam-edge-preview"
            VALKEY_DATA_VOLUME="babyjamjam-backend-preview_valkey_data"
            ;;
        production)
            DEPLOY_BRANCH="main"
            EXPECTED_SCHEDULERS_ENABLED="true"
            PUBLIC_HEALTH_URL="https://api.babyjamjam.com/health"
            COMPOSE_PROJECT="babyjamjam-backend-production"
            BACKEND_CPU_LIMIT="1.5"
            BACKEND_MEMORY_LIMIT="2g"
            EDGE_NETWORK="babyjamjam-edge-production"
            VALKEY_DATA_VOLUME="babyjamjam-backend-production_valkey_data"
            ;;
        *)
            die "Unsupported deployment environment: $environment"
            ;;
    esac

    DEPLOY_ENVIRONMENT="$environment"
    DEPLOY_REF="refs/remotes/origin/$DEPLOY_BRANCH"
    DEPLOY_WORKTREE="$DEPLOY_WORKTREE_ROOT/$environment-ci"
    STATE_DIRECTORY="$STATE_ROOT/$environment"
    DEPLOY_LOCK_FILE="$STATE_DIRECTORY/operator.lock"
}

acquire_lock() {
    local lock_metadata

    [[ -d "$STATE_DIRECTORY" ]] || die "Deployment state directory is missing: $STATE_DIRECTORY"
    [[ -f "$DEPLOY_LOCK_FILE" && ! -L "$DEPLOY_LOCK_FILE" ]] \
        || die "Deployment lock is missing or invalid; reinstall the CI operator."
    lock_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$DEPLOY_LOCK_FILE")"
    [[ "$lock_metadata" == "ubuntu:ubuntu:640" ]] \
        || die "Unexpected deployment lock ownership or mode: $lock_metadata"
    exec 9>>"$DEPLOY_LOCK_FILE"
    /usr/bin/flock -n 9 || die "Another $DEPLOY_ENVIRONMENT deployment is already running."
}

require_clean_worktree() {
    local worktree_path="$1"
    local dirty_state

    dirty_state="$(run_as_deployer /usr/bin/git -C "$worktree_path" status --porcelain --untracked-files=all)"
    [[ -z "$dirty_state" ]] || die "Refusing to use a dirty deployment worktree: $worktree_path"
}

fetch_environment_ref() {
    run_as_deployer /usr/bin/git -C "$REPOSITORY_ROOT" fetch --quiet --prune origin \
        "+refs/heads/$DEPLOY_BRANCH:$DEPLOY_REF"
}

prepare_deploy_worktree() {
    local requested_sha="$1"
    local resolved_sha

    [[ -d "$REPOSITORY_ROOT/.git" ]] || die "Lightsail repository is missing."

    fetch_environment_ref
    resolved_sha="$(run_as_deployer /usr/bin/git -C "$REPOSITORY_ROOT" rev-parse --verify "$DEPLOY_REF^{commit}")"
    [[ "$resolved_sha" == "$requested_sha" ]] \
        || die "Requested commit is not the current origin/$DEPLOY_BRANCH commit."

    if [[ -e "$DEPLOY_WORKTREE" ]]; then
        [[ -d "$DEPLOY_WORKTREE/.git" || -f "$DEPLOY_WORKTREE/.git" ]] \
            || die "Deployment worktree path is not a Git worktree."
        require_clean_worktree "$DEPLOY_WORKTREE"
        run_as_deployer /usr/bin/git -C "$DEPLOY_WORKTREE" checkout --quiet --detach "$requested_sha"
    else
        /usr/bin/install -d -o ubuntu -g ubuntu -m 0750 "$DEPLOY_WORKTREE_ROOT"
        run_as_deployer /usr/bin/git -C "$REPOSITORY_ROOT" worktree add \
            --quiet --detach "$DEPLOY_WORKTREE" "$requested_sha"
    fi

    require_clean_worktree "$DEPLOY_WORKTREE"
}

pull_release_image() {
    local requested_sha="$1"
    local requested_digest="$2"
    local immutable_reference="$IMAGE_REPOSITORY@$requested_digest"
    local image_revision

    run_as_deployer /usr/bin/docker pull "$immutable_reference"
    image_revision="$(run_as_deployer /usr/bin/docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$immutable_reference")"
    [[ "$image_revision" == "$requested_sha" ]] \
        || die "Pulled image revision does not match the requested commit."

    run_as_deployer /usr/bin/docker tag \
        "$immutable_reference" "$LOCAL_IMAGE_REPOSITORY:$requested_sha"
}

run_release_migrations() {
    local requested_sha="$1"

    run_as_deployer /usr/bin/env \
        BACKEND_ENV_FILE="$STATE_DIRECTORY/backend.env" \
        BACKEND_IMAGE="$LOCAL_IMAGE_REPOSITORY" \
        BACKEND_IMAGE_TAG="$requested_sha" \
        BACKEND_CPU_LIMIT="$BACKEND_CPU_LIMIT" \
        BACKEND_MEMORY_LIMIT="$BACKEND_MEMORY_LIMIT" \
        BACKEND_NETWORK_ALIAS="api-$DEPLOY_ENVIRONMENT" \
        COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT" \
        LIGHTSAIL_EDGE_NETWORK="$EDGE_NETWORK" \
        VALKEY_DATA_VOLUME="$VALKEY_DATA_VOLUME" \
        /usr/bin/docker compose \
        -f "$DEPLOY_WORKTREE/backend/compose.lightsail.yml" \
        run --rm --no-deps --entrypoint /usr/local/bin/node api \
        node_modules/prisma/build/index.js migrate deploy \
        --schema prisma/schema.prisma
}

read_optional_state() {
    local state_file="$1"

    if [[ ! -r "$state_file" ]]; then
        echo "missing"
        return 0
    fi

    local state_value
    state_value="$(<"$state_file")"
    [[ -n "$state_value" ]] || die "Empty deployment state file: $state_file"
    echo "$state_value"
}

read_recorded_tag() {
    local tag_value
    tag_value="$(read_optional_state "$1")"

    [[ "$tag_value" == "missing" ]] || is_commit_sha "$tag_value" \
        || die "Invalid deployment tag recorded in $1"
    echo "$tag_value"
}

read_recorded_digest() {
    local digest_value
    digest_value="$(read_optional_state "$1")"

    [[ "$digest_value" == "missing" ]] || is_image_digest "$digest_value" \
        || die "Invalid image digest recorded in $1"
    echo "$digest_value"
}

write_state_value() {
    local state_file="$1"
    local state_value="$2"
    local temporary_file

    temporary_file="$(/usr/bin/mktemp "$STATE_DIRECTORY/.ci-state.XXXXXX")"
    if ! /usr/bin/chmod 0640 "$temporary_file" \
        || ! printf '%s\n' "$state_value" >"$temporary_file" \
        || ! /usr/bin/mv -f "$temporary_file" "$state_file"; then
        /usr/bin/unlink "$temporary_file" 2>/dev/null || true
        return 1
    fi
}

restore_state_value() {
    local state_file="$1"
    local state_value="$2"

    if [[ "$state_value" == "missing" ]]; then
        [[ ! -e "$state_file" ]] || /usr/bin/unlink "$state_file"
        return 0
    fi

    write_state_value "$state_file" "$state_value"
}

record_release_digest() {
    local previous_current_digest="$1"
    local requested_digest="$2"

    if [[ "$previous_current_digest" != "missing" && "$previous_current_digest" != "$requested_digest" ]]; then
        write_state_value "$STATE_DIRECTORY/previous-image-digest" "$previous_current_digest"
    fi
    write_state_value "$STATE_DIRECTORY/current-image-digest" "$requested_digest"
}

find_api_container() {
    local container_ids

    container_ids="$(run_as_deployer /usr/bin/docker ps \
        --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
        --filter "label=com.docker.compose.service=api" \
        --format '{{.ID}}')"

    [[ -n "$container_ids" ]] || die "$DEPLOY_ENVIRONMENT API container is not running."
    [[ "$container_ids" != *$'\n'* ]] || die "Multiple $DEPLOY_ENVIRONMENT API containers are running."
    echo "$container_ids"
}

status_environment() {
    local api_container_id
    local container_health
    local current_digest
    local current_tag
    local image_name
    local public_health_body
    local restart_count
    local schedulers_enabled

    api_container_id="$(find_api_container)"
    container_health="$(run_as_deployer /usr/bin/docker inspect \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$api_container_id")"
    image_name="$(run_as_deployer /usr/bin/docker inspect --format '{{.Config.Image}}' "$api_container_id")"
    restart_count="$(run_as_deployer /usr/bin/docker inspect --format '{{.RestartCount}}' "$api_container_id")"
    schedulers_enabled="$(
        run_as_deployer /usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$api_container_id" \
            | /usr/bin/awk -F= '$1 == "SCHEDULERS_ENABLED" { print tolower($2) }'
    )"
    current_tag="$(read_recorded_tag "$STATE_DIRECTORY/current-image-tag")"
    current_digest="$(read_recorded_digest "$STATE_DIRECTORY/current-image-digest")"

    [[ "$container_health" == "healthy" ]] || die "$DEPLOY_ENVIRONMENT API container is not healthy."
    [[ "$restart_count" == "0" ]] || die "$DEPLOY_ENVIRONMENT API container has restarted."
    [[ "$schedulers_enabled" == "$EXPECTED_SCHEDULERS_ENABLED" ]] \
        || die "$DEPLOY_ENVIRONMENT scheduler ownership is invalid."
    [[ "$current_tag" != "missing" ]] || die "$DEPLOY_ENVIRONMENT current deployment tag is missing."
    [[ "$image_name" == "$LOCAL_IMAGE_REPOSITORY:$current_tag" ]] \
        || die "$DEPLOY_ENVIRONMENT API image does not match the recorded deployment tag."

    public_health_body="$(run_as_deployer /usr/bin/curl --fail --silent --location \
        --proto '=https' --proto-redir '=https' \
        --connect-timeout 5 --max-time 10 \
        "$PUBLIC_HEALTH_URL")" || die "$DEPLOY_ENVIRONMENT public health check failed."
    printf '%s\n' "$public_health_body" \
        | /usr/bin/grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' \
        || die "$DEPLOY_ENVIRONMENT public health response is not ok."

    echo "environment=$DEPLOY_ENVIRONMENT"
    echo "current_tag=$current_tag"
    echo "current_digest=$current_digest"
    echo "container_health=$container_health"
    echo "restart_count=$restart_count"
    echo "schedulers_enabled=$schedulers_enabled"
    echo "public_health=ok"
}

run_deploy_script() {
    run_as_deployer /usr/bin/env \
        BACKEND_BUILD_IMAGE=false \
        BACKEND_IMAGE="$LOCAL_IMAGE_REPOSITORY" \
        "$DEPLOY_WORKTREE/backend/deploy/lightsail/deploy.sh" "$DEPLOY_ENVIRONMENT"
}

run_rollback_script() {
    local rollback_tag="$1"

    run_as_deployer /usr/bin/env \
        BACKEND_IMAGE="$LOCAL_IMAGE_REPOSITORY" \
        BACKEND_ROLLBACK_PRESERVE_PREVIOUS_TAG=true \
        "$DEPLOY_WORKTREE/backend/deploy/lightsail/rollback.sh" \
        "$DEPLOY_ENVIRONMENT" "$rollback_tag"
}

deploy_environment() {
    local requested_sha="$1"
    local requested_digest="$2"
    local current_digest
    local current_tag
    local log_file
    local previous_digest
    local previous_tag
    local status_output

    acquire_lock
    prepare_deploy_worktree "$requested_sha"

    current_tag="$(read_recorded_tag "$STATE_DIRECTORY/current-image-tag")"
    [[ "$current_tag" != "missing" ]] || die "A known-good current image is required before CI deployment."
    run_as_deployer /usr/bin/docker image inspect "$LOCAL_IMAGE_REPOSITORY:$current_tag" >/dev/null \
        || die "The recorded rollback image is not available locally."

    current_digest="$(read_recorded_digest "$STATE_DIRECTORY/current-image-digest")"
    previous_digest="$(read_recorded_digest "$STATE_DIRECTORY/previous-image-digest")"
    previous_tag="$(read_recorded_tag "$STATE_DIRECTORY/previous-image-tag")"

    /usr/bin/install -d -o root -g root -m 0700 "$LOG_ROOT"
    log_file="$(/usr/bin/mktemp "$LOG_ROOT/$DEPLOY_ENVIRONMENT.XXXXXX.log")"
    /usr/bin/chmod 0600 "$log_file"

    if ! pull_release_image "$requested_sha" "$requested_digest" >>"$log_file" 2>&1; then
        die "Image pull or provenance validation failed. Diagnostic log retained at $log_file"
    fi

    if ! run_release_migrations "$requested_sha" >>"$log_file" 2>&1; then
        die "Database migration failed before image activation. Diagnostic log retained at $log_file"
    fi

    if run_deploy_script >"$log_file" 2>&1 \
        && record_release_digest "$current_digest" "$requested_digest" >>"$log_file" 2>&1 \
        && status_output="$(status_environment 2>>"$log_file")"; then
        /usr/bin/unlink "$log_file"
        printf '%s\n' "$status_output"
        return 0
    fi

    if run_rollback_script "$current_tag" >>"$log_file" 2>&1 \
        && restore_state_value "$STATE_DIRECTORY/current-image-digest" "$current_digest" \
        && restore_state_value "$STATE_DIRECTORY/previous-image-digest" "$previous_digest" \
        && restore_state_value "$STATE_DIRECTORY/previous-image-tag" "$previous_tag" \
        && status_environment >>"$log_file" 2>&1; then
        die "Deployment failed and the previous healthy image was restored. Diagnostic log retained at $log_file"
    fi

    die "Deployment and automatic recovery both failed. Diagnostic log retained at $log_file"
}

main() {
    validate_invocation "$@" || {
        usage
        return 2
    }
    require_root
    configure_environment "$2"

    case "$1" in
        status)
            status_environment
            ;;
        deploy)
            deploy_environment "$3" "$4"
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
