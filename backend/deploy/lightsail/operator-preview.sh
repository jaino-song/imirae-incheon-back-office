#!/bin/bash

set -euo pipefail

readonly REPOSITORY_ROOT="/opt/babyjamjam/repository"
readonly DEPLOY_WORKTREE="/opt/babyjamjam/deploy-worktrees/preview"
readonly STATE_DIRECTORY="/opt/babyjamjam/environments/preview"
readonly LOCK_FILE="$STATE_DIRECTORY/operator.lock"
readonly PREVIEW_REF="refs/remotes/origin/preview"
readonly PREVIEW_PROJECT="babyjamjam-backend-preview"
readonly PREVIEW_HEALTH_URL="https://preview.api.babyjamjam.com/health"
readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

usage() {
    cat >&2 <<'EOF'
Usage:
  babyjamjam-preview-operator status
  babyjamjam-preview-operator deploy <40-character-preview-commit-sha>
  babyjamjam-preview-operator rollback
EOF
}

die() {
    echo "$*" >&2
    exit 1
}

is_commit_sha() {
    [[ "${1:-}" =~ ^[0-9a-f]{40}$ ]]
}

validate_invocation() {
    local command_name="${1:-}"

    case "$command_name" in
        status|rollback)
            [[ "$#" -eq 1 ]] || return 1
            ;;
        deploy)
            [[ "$#" -eq 2 ]] || return 1
            is_commit_sha "$2" || return 1
            ;;
        *)
            return 1
            ;;
    esac
}

run_sanitized() {
    /usr/bin/env -i \
        HOME=/home/ubuntu \
        USER=ubuntu \
        LOGNAME=ubuntu \
        SHELL=/bin/bash \
        LC_ALL=C \
        PATH="$SAFE_PATH" \
        "$@"
}

acquire_lock() {
    [[ -d "$STATE_DIRECTORY" ]] || die "Preview state directory is missing."
    exec 9>"$LOCK_FILE"
    /usr/bin/flock -n 9 || die "Another preview operator command is already running."
}

require_clean_worktree() {
    local worktree_path="$1"
    local dirty_state

    dirty_state="$(run_sanitized /usr/bin/git -C "$worktree_path" status --porcelain --untracked-files=all)"
    [[ -z "$dirty_state" ]] || die "Refusing to use a dirty deployment worktree: $worktree_path"
}

fetch_preview_ref() {
    run_sanitized /usr/bin/git -C "$REPOSITORY_ROOT" fetch --quiet --prune origin \
        "+refs/heads/preview:$PREVIEW_REF"
}

prepare_preview_worktree() {
    local requested_sha="$1"
    local resolved_sha

    [[ -d "$REPOSITORY_ROOT/.git" ]] || die "Lightsail repository is missing."

    fetch_preview_ref
    resolved_sha="$(run_sanitized /usr/bin/git -C "$REPOSITORY_ROOT" rev-parse --verify "$PREVIEW_REF^{commit}")"
    [[ "$resolved_sha" == "$requested_sha" ]] || die "Requested commit is not the current origin/preview commit."

    if [[ -e "$DEPLOY_WORKTREE" ]]; then
        [[ -d "$DEPLOY_WORKTREE/.git" || -f "$DEPLOY_WORKTREE/.git" ]] || die "Deployment worktree path is not a Git worktree."
        require_clean_worktree "$DEPLOY_WORKTREE"
        run_sanitized /usr/bin/git -C "$DEPLOY_WORKTREE" checkout --quiet --detach "$requested_sha"
    else
        /usr/bin/install -d -m 0750 "$(dirname "$DEPLOY_WORKTREE")"
        run_sanitized /usr/bin/git -C "$REPOSITORY_ROOT" worktree add --quiet --detach "$DEPLOY_WORKTREE" "$requested_sha"
    fi

    require_clean_worktree "$DEPLOY_WORKTREE"
}

read_recorded_tag() {
    local tag_file="$1"
    local tag_value

    if [[ ! -r "$tag_file" ]]; then
        echo "missing"
        return 0
    fi

    tag_value="$(<"$tag_file")"
    is_commit_sha "$tag_value" || die "Invalid deployment tag recorded in $tag_file"
    echo "$tag_value"
}

find_preview_api_container() {
    local container_ids

    container_ids="$(run_sanitized /usr/bin/docker ps \
        --filter "label=com.docker.compose.project=$PREVIEW_PROJECT" \
        --filter "label=com.docker.compose.service=api" \
        --format '{{.ID}}')"

    [[ -n "$container_ids" ]] || die "Preview API container is not running."
    [[ "$container_ids" != *$'\n'* ]] || die "Multiple preview API containers are running."
    echo "$container_ids"
}

status_preview() {
    local api_container_id
    local container_health
    local current_tag
    local image_name
    local public_health_body
    local restart_count
    local schedulers_enabled

    api_container_id="$(find_preview_api_container)"
    container_health="$(run_sanitized /usr/bin/docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_container_id")"
    image_name="$(run_sanitized /usr/bin/docker inspect --format '{{.Config.Image}}' "$api_container_id")"
    restart_count="$(run_sanitized /usr/bin/docker inspect --format '{{.RestartCount}}' "$api_container_id")"
    schedulers_enabled="$(
        run_sanitized /usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$api_container_id" \
            | /usr/bin/awk -F= '$1 == "SCHEDULERS_ENABLED" { print tolower($2) }'
    )"
    current_tag="$(read_recorded_tag "$STATE_DIRECTORY/current-image-tag")"

    [[ "$container_health" == "healthy" ]] || die "Preview API container is not healthy."
    [[ "$restart_count" == "0" ]] || die "Preview API container has restarted."
    [[ "$schedulers_enabled" == "false" ]] || die "Preview schedulers are not disabled."
    [[ "$current_tag" != "missing" ]] || die "Preview current deployment tag is missing."
    [[ "$image_name" == "babyjamjam-backend:$current_tag" ]] \
        || die "Preview API image does not match the recorded deployment tag."
    public_health_body="$(run_sanitized /usr/bin/curl --fail --silent --location \
        --proto '=https' --proto-redir '=https' \
        --connect-timeout 5 --max-time 10 \
        "$PREVIEW_HEALTH_URL")" || die "Preview public health check failed."
    printf '%s\n' "$public_health_body" \
        | /usr/bin/grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' \
        || die "Preview public health response is not ok."

    echo "preview_current_tag=$current_tag"
    echo "preview_previous_tag=$(read_recorded_tag "$STATE_DIRECTORY/previous-image-tag")"
    echo "preview_image=$image_name"
    echo "preview_container_health=$container_health"
    echo "preview_restart_count=$restart_count"
    echo "preview_schedulers_enabled=$schedulers_enabled"
    echo "preview_public_health=ok"
}

deploy_preview() {
    local requested_sha="$1"

    acquire_lock
    prepare_preview_worktree "$requested_sha"
    run_sanitized "$DEPLOY_WORKTREE/backend/deploy/lightsail/deploy.sh" preview
    status_preview
}

rollback_preview() {
    local script_root="$DEPLOY_WORKTREE"

    acquire_lock
    if [[ ! -d "$script_root" ]]; then
        script_root="$REPOSITORY_ROOT"
    fi
    require_clean_worktree "$script_root"
    run_sanitized "$script_root/backend/deploy/lightsail/rollback.sh" preview
    status_preview
}

main() {
    validate_invocation "$@" || {
        usage
        return 2
    }

    case "$1" in
        status)
            status_preview
            ;;
        deploy)
            deploy_preview "$2"
            ;;
        rollback)
            rollback_preview
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
