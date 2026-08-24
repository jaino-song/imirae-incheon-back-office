#!/bin/bash

set -euo pipefail

readonly REPOSITORY_ROOT="/opt/babyjamjam/repository"
readonly DEPLOY_WORKTREE_ROOT="/opt/babyjamjam/deploy-worktrees"
readonly ROOT_ARTIFACT_DIRECTORY="/usr/local/libexec/babyjamjam-ci-operator"
readonly INSTALLED_OPERATOR_PATH="/usr/local/sbin/babyjamjam-ci-operator"
readonly ROOT_OPERATOR_ARTIFACT="$ROOT_ARTIFACT_DIRECTORY/ci-operator.sh"
readonly ROOT_DEPLOY_ARTIFACT="$ROOT_ARTIFACT_DIRECTORY/deploy.sh"
readonly ROOT_ROLLBACK_ARTIFACT="$ROOT_ARTIFACT_DIRECTORY/rollback.sh"
readonly ROOT_COMPOSE_ARTIFACT="$ROOT_ARTIFACT_DIRECTORY/compose.lightsail.yml"
readonly STATE_ROOT="/opt/babyjamjam/environments"
readonly ROUTE_STATE_ROOT="/opt/babyjamjam/db-failover-state"
readonly LOG_ROOT="/var/log/babyjamjam-deploy"
readonly IMAGE_REPOSITORY="ghcr.io/jaino-song/babyjamjam-admin-backend"
readonly LOCAL_IMAGE_REPOSITORY="babyjamjam-backend"
readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
readonly ROUTE_STATE_FILE_NAME="db-route-state"
readonly ROUTE_STATE_FORMAT_VERSION="2"
readonly DB_PROBE_TIMEOUT_SECONDS="5"
readonly DB_RECONCILE_LOCK_WAIT_SECONDS="2"
readonly DB_RECONCILE_RETRY_AFTER_SECONDS="5"
readonly LOCK_CONTENTION_EXIT_STATUS="75"
readonly DIRECT_MINIMUM_HOLD_SECONDS="3600"
readonly SHARED_FAILBACK_SUCCESS_LIMIT="30"
readonly EMERGENCY_SHARED_SUCCESS_LIMIT="3"
readonly SHARED_FAILURE_LIMIT="3"
readonly DIRECT_SUCCESS_LIMIT="3"
readonly NORMAL_ROUNDTRIP_LIMIT="2"
readonly NORMAL_ROUNDTRIP_WINDOW_SECONDS="21600"
readonly HOST_ROUTE_COOLDOWN_SECONDS="300"
readonly REQUEST_HISTORY_LIMIT="32"
readonly SHARED_PROBE_MIN_INTERVAL_SECONDS="45"
readonly SHARED_PROBE_MAX_INTERVAL_SECONDS="90"
readonly SHARED_FAILBACK_MIN_ELAPSED_SECONDS="1740"
readonly UUID_PATTERN='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
readonly READY_NODE_SCRIPT='fetch("http://127.0.0.1:3001/health/ready").then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));'
readonly PROBE_NODE_SCRIPT='const { PrismaClient } = require("@prisma/client");
const mode = process.env["DATABASE_CONNECTION_MODE"];
const rawUrl = mode === "direct" ? process.env["DIRECT_URL"] : process.env["DATABASE_URL"];
if (mode !== "shared" && mode !== "direct" || !rawUrl) process.exit(2);
let parsedUrl;
try { parsedUrl = new URL(rawUrl); } catch { process.exit(2); }
parsedUrl.searchParams.set("connection_limit", "1");
const prisma = new PrismaClient({ datasources: { db: { url: parsedUrl.toString() } } });
let finished = false;
const finish = (exitCode) => {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  prisma.$disconnect().catch(() => undefined).finally(() => process.exit(exitCode));
};
const timeout = setTimeout(() => finish(1), 5000);
prisma.$queryRawUnsafe("SELECT 1").then(() => finish(0)).catch(() => finish(1));'
readonly SCHEDULERS_ENV_FORMAT='{{range .Config.Env}}{{if eq (index (split . "=") 0) "SCHEDULERS_ENABLED"}}{{println .}}{{end}}{{end}}'
readonly DATABASE_MODE_ENV_FORMAT='{{range .Config.Env}}{{if eq (index (split . "=") 0) "DATABASE_CONNECTION_MODE"}}{{println .}}{{end}}{{end}}'

usage() {
    cat >&2 <<'EOF'
Usage:
  babyjamjam-ci-operator status <preview|production>
  babyjamjam-ci-operator deploy <preview|production> <40-character-commit-sha> <sha256-image-digest>
  babyjamjam-ci-operator db-probe <preview|production> <shared|direct> <uuid>
  babyjamjam-ci-operator db-reconcile <preview|production> <uuid>
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

is_uuid() {
    [[ "${1:-}" =~ $UUID_PATTERN ]]
}

is_route() {
    [[ "${1:-}" == "shared" || "${1:-}" == "direct" ]]
}

is_state_token() {
    [[ "${1:-}" =~ ^[A-Za-z0-9._:-]{1,64}$ ]]
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
        db-probe)
            [[ "$#" -eq 4 ]] || return 1
            is_environment "$2" && is_route "$3" && is_uuid "$4"
            ;;
        db-reconcile)
            [[ "$#" -eq 3 ]] || return 1
            is_environment "$2" && is_uuid "$3"
            ;;
        *)
            return 1
            ;;
    esac
}

validate_root_artifact_file() {
    local artifact_path="$1"
    local expected_mode="$2"
    local path_component
    local path_metadata
    local path_mode
    local path_permissions

    [[ "$artifact_path" == /* && -f "$artifact_path" && ! -L "$artifact_path" ]] \
        || die "A required root deployment artifact is missing or invalid."
    path_component="$artifact_path"
    while [[ "$path_component" != "/" ]]; do
        [[ ! -L "$path_component" ]] \
            || die "A root deployment artifact path contains a symbolic link."
        path_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$path_component")" \
            || die "Unable to inspect a root deployment artifact."
        [[ "${path_metadata%%:*}" == "root" ]] \
            || die "A root deployment artifact path is not root-owned."
        path_mode="${path_metadata##*:}"
        path_permissions="${path_mode: -3}"
        [[ "${path_permissions:1:1}" != [2367] \
            && "${path_permissions:2:1}" != [2367] ]] \
            || die "A root deployment artifact path is group/world writable."
        path_component="$(/usr/bin/dirname "$path_component")"
    done
    [[ "$(/usr/bin/stat -c '%U:%G:%a' "$artifact_path")" == "root:root:$expected_mode" ]] \
        || die "A root deployment artifact has unexpected ownership or mode."
}

validate_root_artifacts() {
    local artifact_directory_metadata

    [[ -d "$ROOT_ARTIFACT_DIRECTORY" && ! -L "$ROOT_ARTIFACT_DIRECTORY" ]] \
        || die "The root deployment artifact directory is missing or invalid."
    artifact_directory_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$ROOT_ARTIFACT_DIRECTORY")" \
        || die "Unable to inspect the root deployment artifact directory."
    [[ "$artifact_directory_metadata" == "root:root:700" ]] \
        || die "The root deployment artifact directory has unexpected ownership or mode."
    validate_root_artifact_file "$ROOT_OPERATOR_ARTIFACT" 750
    validate_root_artifact_file "$ROOT_DEPLOY_ARTIFACT" 750
    validate_root_artifact_file "$ROOT_ROLLBACK_ARTIFACT" 750
    validate_root_artifact_file "$ROOT_COMPOSE_ARTIFACT" 640
    validate_root_artifact_file "$INSTALLED_OPERATOR_PATH" 750
    /usr/bin/cmp -s "$ROOT_OPERATOR_ARTIFACT" "$INSTALLED_OPERATOR_PATH" \
        || die "The installed operator does not match its protected artifact."
}

require_root() {
    [[ "$EUID" -eq 0 ]] || die "The CI operator must run as root through AWS Systems Manager."
    local deploy_groups

    deploy_groups="$(/usr/bin/id -nG ubuntu 2>/dev/null)" \
        || die "Unable to inspect ubuntu group membership."
    [[ " $deploy_groups " != *" docker "* ]] \
        || die "ubuntu must not belong to the docker group; root CI Docker execution requires its removal."
    validate_root_artifacts
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

run_as_root() {
    /usr/bin/env -i \
        HOME=/root \
        USER=root \
        LOGNAME=root \
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
    BACKEND_ENV_FILE="$STATE_DIRECTORY/backend.env"
    ROUTE_STATE_DIRECTORY="$ROUTE_STATE_ROOT/$environment"
    ROUTE_STATE_FILE="$ROUTE_STATE_DIRECTORY/$ROUTE_STATE_FILE_NAME"
    COMPOSE_FILE="$ROOT_COMPOSE_ARTIFACT"
    CURRENT_TAG_FILE="$STATE_DIRECTORY/current-image-tag"
    CURRENT_DIGEST_FILE="$STATE_DIRECTORY/current-image-digest"
    PUBLIC_READY_URL="${PUBLIC_HEALTH_URL%/}/ready"
}

acquire_lock() {
    local wait_seconds="${1:-0}"
    local lock_metadata
    local lock_status

    [[ "$wait_seconds" =~ ^[0-9]+$ ]] || die "Invalid deployment lock wait interval."
    [[ -d "$STATE_DIRECTORY" ]] || die "Deployment state directory is missing: $STATE_DIRECTORY"
    [[ -f "$DEPLOY_LOCK_FILE" && ! -L "$DEPLOY_LOCK_FILE" ]] \
        || die "Deployment lock is missing or invalid; reinstall the CI operator."
    lock_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$DEPLOY_LOCK_FILE")"
    [[ "$lock_metadata" == "root:root:600" ]] \
        || die "Unexpected deployment lock ownership or mode: $lock_metadata"
    exec 9>>"$DEPLOY_LOCK_FILE"
    if [[ "$wait_seconds" == "0" ]]; then
        /usr/bin/flock -n 9 || die "Another $DEPLOY_ENVIRONMENT deployment is already running."
        return 0
    fi

    if /usr/bin/flock -E "$LOCK_CONTENTION_EXIT_STATUS" -w "$wait_seconds" 9; then
        return 0
    else
        lock_status=$?
    fi
    [[ "$lock_status" -eq "$LOCK_CONTENTION_EXIT_STATUS" ]] \
        || die "Unable to acquire the $DEPLOY_ENVIRONMENT deployment lock."
    return "$LOCK_CONTENTION_EXIT_STATUS"
}

current_epoch() {
    /usr/bin/date +%s
}

validate_backend_env_file() {
    local path_prefix
    local path_without_root
    local path_component
    local path_type
    local path_metadata
    local path_owner
    local path_group
    local path_mode
    local path_permissions
    local -a path_components

    [[ "$BACKEND_ENV_FILE" == /* ]] \
        || die "Backend environment file path must be absolute."
    path_without_root="${BACKEND_ENV_FILE#/}"
    [[ -n "$path_without_root" ]] \
        || die "Backend environment file path must name a regular file."
    IFS='/' read -r -a path_components <<<"$path_without_root"
    path_prefix="/"
    for path_component in "${path_components[@]}"; do
        case "$path_component" in
            ''|.)
                continue
                ;;
            ..)
                die "Backend environment file path must not contain '..'."
                ;;
        esac
        path_prefix="${path_prefix%/}/$path_component"
        [[ -e "$path_prefix" && ! -L "$path_prefix" ]] \
            || die "Backend environment path component is missing or invalid: $path_prefix"
        path_type="$(/usr/bin/stat -c '%F' "$path_prefix")" \
            || die "Unable to inspect backend environment path component."
        path_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$path_prefix")" \
            || die "Unable to inspect backend environment path ownership."
        path_owner="${path_metadata%%:*}"
        path_group="${path_metadata#*:}"
        path_group="${path_group%%:*}"
        path_mode="${path_metadata##*:}"
        [[ "$path_owner:$path_group" == "root:root" ]] \
            || die "Backend environment path component is not root-owned: $path_prefix"
        if [[ "$path_prefix" == "$BACKEND_ENV_FILE" ]]; then
            [[ "$path_type" == "regular file" && "$path_metadata" == "root:root:600" ]] \
                || die "Backend environment file must be root:root mode 0600."
        else
            [[ "$path_type" == "directory" ]] \
                || die "Backend environment ancestor is not a directory: $path_prefix"
            path_permissions="${path_mode: -3}"
            [[ "${path_permissions:1:1}" != [2367] \
                && "${path_permissions:2:1}" != [2367] ]] \
                || die "Backend environment ancestor is group/world writable: $path_prefix"
        fi
    done
    [[ "$path_prefix" == "$BACKEND_ENV_FILE" ]] \
        || die "Backend environment file path must name a regular file."
}

write_route_state() {
    local temporary_file
    local route_state_directory_metadata

    [[ -d "$ROUTE_STATE_DIRECTORY" && ! -L "$ROUTE_STATE_DIRECTORY" ]] \
        || die "Route state directory is missing or invalid."
    route_state_directory_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$ROUTE_STATE_DIRECTORY")"
    [[ "$route_state_directory_metadata" == "root:root:700" ]] \
        || die "Unexpected route state directory ownership or mode: $route_state_directory_metadata"
    [[ ! -L "$ROUTE_STATE_FILE" ]] || die "Route state file must not be a symbolic link."

    temporary_file="$(/usr/bin/mktemp "$ROUTE_STATE_DIRECTORY/.db-route-state.XXXXXX")"
    if ! {
        /usr/bin/chown root:root "$temporary_file"
        /usr/bin/chmod 0600 "$temporary_file"
        printf 'version=%s\n' "$ROUTE_STATE_VERSION"
        printf 'generation=%s\n' "$ROUTE_STATE_GENERATION"
        printf 'active_route=%s\n' "$ROUTE_STATE_ACTIVE_ROUTE"
        printf 'phase=%s\n' "$ROUTE_STATE_PHASE"
        printf 'transition_previous_route=%s\n' "$ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE"
        printf 'transition_target_route=%s\n' "$ROUTE_STATE_TRANSITION_TARGET_ROUTE"
        printf 'transition_started_at=%s\n' "$ROUTE_STATE_TRANSITION_STARTED_AT"
        printf 'transition_generation=%s\n' "$ROUTE_STATE_TRANSITION_GENERATION"
        printf 'direct_activated_at=%s\n' "$ROUTE_STATE_DIRECT_ACTIVATED_AT"
        printf 'shared_failure_count=%s\n' "$ROUTE_STATE_SHARED_FAILURE_COUNT"
        printf 'direct_success_count=%s\n' "$ROUTE_STATE_DIRECT_SUCCESS_COUNT"
        printf 'direct_failure_count=%s\n' "$ROUTE_STATE_DIRECT_FAILURE_COUNT"
        printf 'emergency_shared_success_count=%s\n' "$ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT"
        printf 'shared_healthy_count=%s\n' "$ROUTE_STATE_SHARED_SUCCESS_COUNT"
        printf 'shared_healthy_started_at=%s\n' "$ROUTE_STATE_SHARED_SUCCESS_STARTED_AT"
        printf 'shared_healthy_last_at=%s\n' "$ROUTE_STATE_SHARED_SUCCESS_LAST_AT"
        printf 'normal_roundtrip_history=%s\n' "$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY"
        printf 'cooldown_until=%s\n' "$ROUTE_STATE_COOLDOWN_UNTIL"
        printf 'last_request_id=%s\n' "$ROUTE_STATE_LAST_REQUEST_ID"
        printf 'request_history=%s\n' "$ROUTE_STATE_REQUEST_HISTORY"
        printf 'last_probe_route=%s\n' "$ROUTE_STATE_LAST_PROBE_ROUTE"
        printf 'last_probe_result=%s\n' "$ROUTE_STATE_LAST_PROBE_RESULT"
        printf 'last_probe_at=%s\n' "$ROUTE_STATE_LAST_PROBE_AT"
        printf 'last_shared_ok=%s\n' "$ROUTE_STATE_LAST_SHARED_OK"
        printf 'last_direct_ok=%s\n' "$ROUTE_STATE_LAST_DIRECT_OK"
        printf 'last_result=%s\n' "$ROUTE_STATE_LAST_RESULT"
        printf 'terminal_reason=%s\n' "$ROUTE_STATE_TERMINAL_REASON"
    } >"$temporary_file"; then
        /usr/bin/unlink "$temporary_file" 2>/dev/null || true
        die "Unable to write route state."
    fi

    /usr/bin/chown root:root "$temporary_file"
    /usr/bin/chmod 0600 "$temporary_file"
    /usr/bin/mv -f "$temporary_file" "$ROUTE_STATE_FILE"
    /usr/bin/chown root:root "$ROUTE_STATE_FILE"
    /usr/bin/chmod 0600 "$ROUTE_STATE_FILE"
}

initialize_route_state() {
    local now

    now="$(current_epoch)"
    ROUTE_STATE_VERSION="$ROUTE_STATE_FORMAT_VERSION"
    ROUTE_STATE_GENERATION="0"
    ROUTE_STATE_ACTIVE_ROUTE="shared"
    ROUTE_STATE_PHASE="SHARED_ACTIVE"
    ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE=""
    ROUTE_STATE_TRANSITION_TARGET_ROUTE=""
    ROUTE_STATE_TRANSITION_STARTED_AT="0"
    ROUTE_STATE_TRANSITION_GENERATION="0"
    ROUTE_STATE_DIRECT_ACTIVATED_AT="0"
    ROUTE_STATE_SHARED_FAILURE_COUNT="0"
    ROUTE_STATE_DIRECT_SUCCESS_COUNT="0"
    ROUTE_STATE_DIRECT_FAILURE_COUNT="0"
    ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT="0"
    ROUTE_STATE_SHARED_SUCCESS_COUNT="0"
    ROUTE_STATE_SHARED_SUCCESS_STARTED_AT="0"
    ROUTE_STATE_SHARED_SUCCESS_LAST_AT="0"
    ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY=""
    ROUTE_STATE_COOLDOWN_UNTIL="0"
    ROUTE_STATE_LAST_REQUEST_ID=""
    ROUTE_STATE_REQUEST_HISTORY=""
    ROUTE_STATE_LAST_PROBE_ROUTE=""
    ROUTE_STATE_LAST_PROBE_RESULT="none"
    ROUTE_STATE_LAST_PROBE_AT="0"
    ROUTE_STATE_LAST_SHARED_OK="null"
    ROUTE_STATE_LAST_DIRECT_OK="null"
    ROUTE_STATE_LAST_RESULT="initialized"
    ROUTE_STATE_TERMINAL_REASON=""
    write_route_state
}

ensure_route_state() {
    local route_state_metadata
    local route_state_directory_metadata

    [[ -d "$ROUTE_STATE_DIRECTORY" && ! -L "$ROUTE_STATE_DIRECTORY" ]] \
        || die "Route state directory is missing or invalid."
    route_state_directory_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$ROUTE_STATE_DIRECTORY")"
    [[ "$route_state_directory_metadata" == "root:root:700" ]] \
        || die "Unexpected route state directory ownership or mode: $route_state_directory_metadata"
    if [[ ! -e "$ROUTE_STATE_FILE" ]]; then
        initialize_route_state
        return 0
    fi
    [[ -f "$ROUTE_STATE_FILE" && ! -L "$ROUTE_STATE_FILE" ]] \
        || die "Route state file is missing or invalid."
    route_state_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$ROUTE_STATE_FILE")"
    [[ "$route_state_metadata" == "root:root:600" ]] \
        || die "Unexpected route state ownership or mode: $route_state_metadata"
}

set_route_state_defaults() {
    ROUTE_STATE_VERSION=""
    ROUTE_STATE_GENERATION=""
    ROUTE_STATE_ACTIVE_ROUTE=""
    ROUTE_STATE_PHASE=""
    ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE=""
    ROUTE_STATE_TRANSITION_TARGET_ROUTE=""
    ROUTE_STATE_TRANSITION_STARTED_AT=""
    ROUTE_STATE_TRANSITION_GENERATION=""
    ROUTE_STATE_DIRECT_ACTIVATED_AT=""
    ROUTE_STATE_SHARED_FAILURE_COUNT=""
    ROUTE_STATE_DIRECT_SUCCESS_COUNT=""
    ROUTE_STATE_DIRECT_FAILURE_COUNT=""
    ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT=""
    ROUTE_STATE_SHARED_SUCCESS_COUNT=""
    ROUTE_STATE_SHARED_SUCCESS_STARTED_AT=""
    ROUTE_STATE_SHARED_SUCCESS_LAST_AT=""
    ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY=""
    ROUTE_STATE_COOLDOWN_UNTIL=""
    ROUTE_STATE_LAST_REQUEST_ID=""
    ROUTE_STATE_REQUEST_HISTORY=""
    ROUTE_STATE_REQUEST_HISTORY_NEEDS_PERSIST=false
    ROUTE_STATE_LAST_PROBE_ROUTE=""
    ROUTE_STATE_LAST_PROBE_RESULT=""
    ROUTE_STATE_LAST_PROBE_AT=""
    ROUTE_STATE_LAST_SHARED_OK=""
    ROUTE_STATE_LAST_DIRECT_OK=""
    ROUTE_STATE_LAST_RESULT=""
    ROUTE_STATE_TERMINAL_REASON=""
}

validate_state_counter() {
    [[ "${1:-}" =~ ^0$|^[1-9][0-9]{0,11}$ ]]
}

validate_state_timestamp() {
    [[ "${1:-}" =~ ^0$|^[1-9][0-9]{0,11}$ ]]
}

validate_state_boolean() {
    [[ "${1:-}" == "true" || "${1:-}" == "false" || "${1:-}" == "null" ]]
}

validate_state_history() {
    local history="${1:-}"
    local item
    local previous="0"

    [[ -z "$history" ]] && return 0
    [[ "$history" =~ ^(0|[1-9][0-9]{0,11})(,(0|[1-9][0-9]{0,11}))*$ ]] || return 1
    IFS=',' read -r -a history_items <<<"$history"
    for item in "${history_items[@]}"; do
        validate_state_timestamp "$item" || return 1
        (( item >= previous )) || return 1
        previous="$item"
    done
}

validate_request_history() {
    local history="${1:-}"
    local request_id
    local history_count=0

    [[ -z "$history" ]] && return 0
    IFS=',' read -r -a request_history_items <<<"$history"
    history_count="${#request_history_items[@]}"
    (( history_count <= REQUEST_HISTORY_LIMIT )) || return 1
    for request_id in "${request_history_items[@]}"; do
        is_uuid "$request_id" || return 1
    done
}

validate_state_value() {
    local state_key="$1"
    local state_value="$2"

    case "$state_key" in
        version)
            [[ "$state_value" == "$ROUTE_STATE_FORMAT_VERSION" ]]
            ;;
        generation|transition_generation|shared_failure_count|direct_success_count|direct_failure_count|emergency_shared_success_count|shared_healthy_count)
            validate_state_counter "$state_value"
            ;;
        transition_started_at|direct_activated_at|shared_healthy_started_at|shared_healthy_last_at|cooldown_until|last_probe_at)
            validate_state_timestamp "$state_value"
            ;;
        transition_previous_route|transition_target_route|active_route|last_probe_route)
            [[ -z "$state_value" ]] || is_route "$state_value"
            ;;
        normal_roundtrip_history)
            validate_state_history "$state_value"
            ;;
        last_shared_ok|last_direct_ok)
            validate_state_boolean "$state_value"
            ;;
        phase)
            [[ "$state_value" == "SHARED_ACTIVE" \
                || "$state_value" == "SWITCHING_TO_DIRECT" \
                || "$state_value" == "DIRECT_ACTIVE" \
                || "$state_value" == "RECOVERING_SHARED" \
                || "$state_value" == "SWITCHING_TO_SHARED" \
                || "$state_value" == "BLOCKED" \
                || "$state_value" == "DEGRADED" ]]
            ;;
        last_request_id)
            [[ -z "$state_value" ]] || is_uuid "$state_value"
            ;;
        request_history)
            validate_request_history "$state_value"
            ;;
        last_probe_result|last_result|terminal_reason)
            [[ -z "$state_value" ]] || is_state_token "$state_value"
            ;;
        *)
            return 1
            ;;
    esac
}

load_route_state() {
    local state_key
    local state_value
    local state_line
    local required_state_key
    local seen_state_keys=" "
    local request_history_present=false

    ensure_route_state
    set_route_state_defaults
    while IFS= read -r state_line || [[ -n "$state_line" ]]; do
        [[ -z "$state_line" ]] && continue
        [[ "$state_line" == *=* ]] || die "Malformed route state."
        state_key="${state_line%%=*}"
        state_value="${state_line#*=}"
        [[ "$state_key" =~ ^[a-z_]+$ ]] || die "Malformed route state key."
        [[ "$seen_state_keys" != *" $state_key "* ]] || die "Duplicate route state key."
        seen_state_keys+="$state_key "
        validate_state_value "$state_key" "$state_value" \
            || die "Invalid route state value."
        case "$state_key" in
            version) ROUTE_STATE_VERSION="$state_value" ;;
            generation) ROUTE_STATE_GENERATION="$state_value" ;;
            active_route) ROUTE_STATE_ACTIVE_ROUTE="$state_value" ;;
            phase) ROUTE_STATE_PHASE="$state_value" ;;
            transition_previous_route) ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE="$state_value" ;;
            transition_target_route) ROUTE_STATE_TRANSITION_TARGET_ROUTE="$state_value" ;;
            transition_started_at) ROUTE_STATE_TRANSITION_STARTED_AT="$state_value" ;;
            transition_generation) ROUTE_STATE_TRANSITION_GENERATION="$state_value" ;;
            direct_activated_at) ROUTE_STATE_DIRECT_ACTIVATED_AT="$state_value" ;;
            shared_failure_count) ROUTE_STATE_SHARED_FAILURE_COUNT="$state_value" ;;
            direct_success_count) ROUTE_STATE_DIRECT_SUCCESS_COUNT="$state_value" ;;
            direct_failure_count) ROUTE_STATE_DIRECT_FAILURE_COUNT="$state_value" ;;
            emergency_shared_success_count) ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT="$state_value" ;;
            shared_healthy_count) ROUTE_STATE_SHARED_SUCCESS_COUNT="$state_value" ;;
            shared_healthy_started_at) ROUTE_STATE_SHARED_SUCCESS_STARTED_AT="$state_value" ;;
            shared_healthy_last_at) ROUTE_STATE_SHARED_SUCCESS_LAST_AT="$state_value" ;;
            normal_roundtrip_history) ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY="$state_value" ;;
            cooldown_until) ROUTE_STATE_COOLDOWN_UNTIL="$state_value" ;;
            last_request_id) ROUTE_STATE_LAST_REQUEST_ID="$state_value" ;;
            request_history)
                ROUTE_STATE_REQUEST_HISTORY="$state_value"
                request_history_present=true
                ;;
            last_probe_route) ROUTE_STATE_LAST_PROBE_ROUTE="$state_value" ;;
            last_probe_result) ROUTE_STATE_LAST_PROBE_RESULT="$state_value" ;;
            last_probe_at) ROUTE_STATE_LAST_PROBE_AT="$state_value" ;;
            last_shared_ok) ROUTE_STATE_LAST_SHARED_OK="$state_value" ;;
            last_direct_ok) ROUTE_STATE_LAST_DIRECT_OK="$state_value" ;;
            last_result) ROUTE_STATE_LAST_RESULT="$state_value" ;;
            terminal_reason) ROUTE_STATE_TERMINAL_REASON="$state_value" ;;
        esac
    done <"$ROUTE_STATE_FILE"

    for required_state_key in \
        version generation active_route phase transition_previous_route \
        transition_target_route transition_started_at transition_generation \
        direct_activated_at shared_failure_count direct_success_count \
        direct_failure_count emergency_shared_success_count shared_healthy_count \
        shared_healthy_started_at shared_healthy_last_at normal_roundtrip_history \
        cooldown_until last_request_id last_probe_route last_probe_result \
        last_probe_at last_shared_ok last_direct_ok last_result terminal_reason; do
        [[ "$seen_state_keys" == *" $required_state_key "* ]] \
            || die "Route state is missing key: $required_state_key"
    done

    [[ "$ROUTE_STATE_VERSION" == "$ROUTE_STATE_FORMAT_VERSION" ]] \
        || die "Unsupported route state version; refusing implicit migration."
    if [[ "$request_history_present" != true ]]; then
        # Version 2 state files written before request history was introduced
        # have one durable request marker. Preserve it as the initial bounded
        # history before allowing a reconcile to run. The marker is persisted
        # by the next reconcile write so read-only status checks remain safe.
        ROUTE_STATE_REQUEST_HISTORY="$ROUTE_STATE_LAST_REQUEST_ID"
        validate_request_history "$ROUTE_STATE_REQUEST_HISTORY" \
            || die "Unable to seed request history from route state."
        ROUTE_STATE_REQUEST_HISTORY_NEEDS_PERSIST=true
    fi
    validate_state_counter "$ROUTE_STATE_GENERATION" \
        || die "Route state generation is missing."
    is_route "$ROUTE_STATE_ACTIVE_ROUTE" \
        || die "Route state active route is missing."
    [[ -n "$ROUTE_STATE_PHASE" && -n "$ROUTE_STATE_LAST_RESULT" ]] \
        || die "Route state phase or result is missing."
    [[ -n "$ROUTE_STATE_TRANSITION_STARTED_AT" \
        && -n "$ROUTE_STATE_TRANSITION_GENERATION" \
        && -n "$ROUTE_STATE_DIRECT_ACTIVATED_AT" \
        && -n "$ROUTE_STATE_SHARED_FAILURE_COUNT" \
        && -n "$ROUTE_STATE_DIRECT_SUCCESS_COUNT" \
        && -n "$ROUTE_STATE_DIRECT_FAILURE_COUNT" \
        && -n "$ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT" \
        && -n "$ROUTE_STATE_SHARED_SUCCESS_STARTED_AT" \
        && -n "$ROUTE_STATE_SHARED_SUCCESS_LAST_AT" \
        && -n "$ROUTE_STATE_SHARED_SUCCESS_COUNT" \
        && -n "$ROUTE_STATE_COOLDOWN_UNTIL" \
        && -n "$ROUTE_STATE_LAST_PROBE_RESULT" \
        && -n "$ROUTE_STATE_LAST_PROBE_AT" \
        && -n "$ROUTE_STATE_LAST_SHARED_OK" \
        && -n "$ROUTE_STATE_LAST_DIRECT_OK" ]] \
        || die "Route state is incomplete."

    case "$ROUTE_STATE_PHASE" in
        SWITCHING_TO_DIRECT)
            [[ "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" \
                && "$ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE" == "shared" \
                && "$ROUTE_STATE_TRANSITION_TARGET_ROUTE" == "direct" \
                && "$ROUTE_STATE_TRANSITION_STARTED_AT" != "0" \
                && "$ROUTE_STATE_TRANSITION_GENERATION" != "0" \
                && "$ROUTE_STATE_TRANSITION_GENERATION" -le "$ROUTE_STATE_GENERATION" ]] \
                || die "Invalid Shared-to-Direct transition metadata."
            ;;
        SWITCHING_TO_SHARED)
            [[ "$ROUTE_STATE_ACTIVE_ROUTE" == "direct" \
                && "$ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE" == "direct" \
                && "$ROUTE_STATE_TRANSITION_TARGET_ROUTE" == "shared" \
                && "$ROUTE_STATE_TRANSITION_STARTED_AT" != "0" \
                && "$ROUTE_STATE_TRANSITION_GENERATION" != "0" \
                && "$ROUTE_STATE_TRANSITION_GENERATION" -le "$ROUTE_STATE_GENERATION" ]] \
                || die "Invalid Direct-to-Shared transition metadata."
            ;;
        *)
            [[ -z "$ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE" \
                && -z "$ROUTE_STATE_TRANSITION_TARGET_ROUTE" \
                && "$ROUTE_STATE_TRANSITION_STARTED_AT" == "0" \
                && "$ROUTE_STATE_TRANSITION_GENERATION" == "0" ]] \
                || die "Unexpected transition metadata outside switching phase."
            ;;
    esac
}

reset_shared_success_window() {
    ROUTE_STATE_SHARED_SUCCESS_COUNT="0"
    ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT="0"
    ROUTE_STATE_SHARED_SUCCESS_STARTED_AT="0"
    ROUTE_STATE_SHARED_SUCCESS_LAST_AT="0"
}

record_probe_result() {
    local route="$1"
    local result="$2"
    local now="$3"

    is_route "$route" || die "Invalid probe route."
    is_state_token "$result" || die "Invalid probe result."
    validate_state_timestamp "$now" || die "Invalid probe timestamp."
    ROUTE_STATE_LAST_PROBE_ROUTE="$route"
    ROUTE_STATE_LAST_PROBE_RESULT="$result"
    ROUTE_STATE_LAST_PROBE_AT="$now"
}

prepare_probe_image() {
    local tagged_image_name
    local tagged_image_id
    local tagged_repository_digests
    local immutable_image_name
    local immutable_image_id

    load_current_release_identity
    [[ "$CURRENT_ROUTE_IMAGE_TAG" != "missing" ]] || return 1
    [[ "$CURRENT_ROUTE_IMAGE_DIGEST" != "missing" ]] || return 1

    tagged_image_name="$LOCAL_IMAGE_REPOSITORY:$CURRENT_ROUTE_IMAGE_TAG"
    immutable_image_name="$IMAGE_REPOSITORY@$CURRENT_ROUTE_IMAGE_DIGEST"
    tagged_image_id="$(run_as_root /usr/bin/docker image inspect \
        --format '{{.Id}}' "$tagged_image_name" 2>/dev/null)" || return 1
    [[ -n "$tagged_image_id" ]] || return 1
    tagged_repository_digests="$(run_as_root /usr/bin/docker image inspect \
        --format '{{join .RepoDigests "\\n"}}' "$tagged_image_name" 2>/dev/null)" || return 1
    [[ "$tagged_repository_digests" == *"@$CURRENT_ROUTE_IMAGE_DIGEST"* ]] || return 1
    immutable_image_id="$(run_as_root /usr/bin/docker image inspect \
        --format '{{.Id}}' "$immutable_image_name" 2>/dev/null)" || return 1
    [[ "$immutable_image_id" == "$tagged_image_id" ]] || return 1

    PROBE_IMAGE_REFERENCE="$immutable_image_name"
}

run_probe_query() {
    local route="$1"

    is_route "$route" || return 1
    validate_backend_env_file || return 1
    prepare_probe_image || return 1
    run_as_root /usr/bin/timeout --kill-after=1s "${DB_PROBE_TIMEOUT_SECONDS}s" \
        /usr/bin/docker run --rm --pull=never \
        --network "${COMPOSE_PROJECT}_backend" \
        --env-file "$BACKEND_ENV_FILE" \
        --env "DATABASE_CONNECTION_MODE=$route" \
        --entrypoint /usr/local/bin/node \
        "$PROBE_IMAGE_REFERENCE" -e "$PROBE_NODE_SCRIPT" \
        >/dev/null 2>&1
}

probe_route() {
    local route="$1"

    is_route "$route" || die "Invalid probe route."
    if run_probe_query "$route"; then
        return 0
    fi
    return 1
}

run_internal_ready_check() {
    local api_container_id="$1"

    run_as_root /usr/bin/timeout --kill-after=1s 10s \
        /usr/bin/docker exec "$api_container_id" /usr/local/bin/node -e "$READY_NODE_SCRIPT" \
        >/dev/null 2>&1
}

run_public_ready_check() {
    run_as_root /usr/bin/curl --fail --silent --show-error --location \
        --proto '=https' --proto-redir '=https' \
        --connect-timeout 5 --max-time 10 "$PUBLIC_READY_URL" \
        >/dev/null 2>&1
}

run_public_liveness_check() {
    run_as_root /usr/bin/curl --fail --silent --show-error --location \
        --proto '=https' --proto-redir '=https' \
        --connect-timeout 5 --max-time 10 "$PUBLIC_HEALTH_URL" \
        >/dev/null 2>&1
}

verify_api_image_identity() {
    local api_container_id="$1"
    local expected_image_name
    local expected_image_id
    local actual_image_name
    local actual_image_id
    local recorded_digest
    local repository_digests

    expected_image_name="$LOCAL_IMAGE_REPOSITORY:$CURRENT_ROUTE_IMAGE_TAG"
    expected_image_id="$(run_as_root /usr/bin/docker image inspect \
        --format '{{.Id}}' "$expected_image_name")" || return 1
    actual_image_name="$(run_as_root /usr/bin/docker inspect \
        --format '{{.Config.Image}}' "$api_container_id")" || return 1
    actual_image_id="$(run_as_root /usr/bin/docker inspect \
        --format '{{.Image}}' "$api_container_id")" || return 1
    [[ "$actual_image_name" == "$expected_image_name" ]] || return 1
    [[ "$actual_image_id" == "$expected_image_id" ]] || return 1

    recorded_digest="$(read_recorded_digest "$CURRENT_DIGEST_FILE")" || return 1
    [[ "$recorded_digest" != "missing" ]] || return 1
    repository_digests="$(run_as_root /usr/bin/docker image inspect \
        --format '{{join .RepoDigests "\\n"}}' "$expected_image_name")" || return 1
    [[ "$repository_digests" == *"@$recorded_digest"* ]] || return 1
}

verify_api_runtime() {
    local route="$1"
    local api_container_id
    local container_count
    local container_health
    local restart_count
    local schedulers_enabled
    local runtime_route

    is_route "$route" || die "Invalid route for runtime verification."
    api_container_id="$(find_api_container_optional)" || return 1
    container_count="$(run_as_root /usr/bin/docker ps \
        --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
        --filter "label=com.docker.compose.service=api" \
        --format '{{.ID}}' | /usr/bin/wc -l | /usr/bin/tr -d ' ')" || return 1
    [[ "$container_count" == "1" ]] || return 1
    container_health="$(run_as_root /usr/bin/docker inspect \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$api_container_id")" || return 1
    restart_count="$(run_as_root /usr/bin/docker inspect \
        --format '{{.RestartCount}}' "$api_container_id")" || return 1
    schedulers_enabled="$(run_as_root /usr/bin/docker inspect \
        --format "$SCHEDULERS_ENV_FORMAT" "$api_container_id" \
        | /usr/bin/awk -F= '$1 == "SCHEDULERS_ENABLED" { count += 1; if (NF == 2) value = tolower($2); else malformed = 1 } END { if (count == 1 && malformed != 1) print value; else exit 1 }')" || return 1
    [[ "$container_health" == "healthy" ]] || return 1
    [[ "$restart_count" == "0" ]] || return 1
    [[ "$schedulers_enabled" == "$EXPECTED_SCHEDULERS_ENABLED" ]] || return 1
    runtime_route="$(run_as_root /usr/bin/docker inspect \
        --format "$DATABASE_MODE_ENV_FORMAT" "$api_container_id" \
        | /usr/bin/awk -F= \
            '$1 == "DATABASE_CONNECTION_MODE" { count += 1; if (NF == 2) value = tolower($2); else malformed = 1 } END { if (count == 1 && malformed != 1) print value; else exit 1 }')" \
        || return 1
    [[ "$runtime_route" == "$route" ]] || return 1
    RUNTIME_ROUTE="$runtime_route"
    verify_api_image_identity "$api_container_id" || return 1
    run_internal_ready_check "$api_container_id" || return 1
    run_public_ready_check || return 1
    run_public_liveness_check || return 1
}

recreate_api_for_route() {
    local route="$1"

    is_route "$route" || die "Invalid route for API recreation."
    validate_backend_env_file
    [[ "$CURRENT_ROUTE_IMAGE_TAG" != "missing" ]] || die "Current image tag is missing."
    [[ "$CURRENT_ROUTE_IMAGE_DIGEST" != "missing" ]] || die "Current image digest is missing."
    run_as_root /usr/bin/env \
        BACKEND_ENV_FILE="$BACKEND_ENV_FILE" \
        BACKEND_IMAGE="$LOCAL_IMAGE_REPOSITORY" \
        BACKEND_IMAGE_TAG="$CURRENT_ROUTE_IMAGE_TAG" \
        BACKEND_CPU_LIMIT="$BACKEND_CPU_LIMIT" \
        BACKEND_MEMORY_LIMIT="$BACKEND_MEMORY_LIMIT" \
        BACKEND_NETWORK_ALIAS="api-$DEPLOY_ENVIRONMENT" \
        COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT" \
        DATABASE_CONNECTION_MODE="$route" \
        LIGHTSAIL_EDGE_NETWORK="$EDGE_NETWORK" \
        VALKEY_DATA_VOLUME="$VALKEY_DATA_VOLUME" \
        /usr/bin/docker compose -f "$COMPOSE_FILE" \
        up -d --no-deps --force-recreate api \
        >/dev/null 2>&1
}

load_current_release_identity() {
    CURRENT_ROUTE_IMAGE_TAG="$(read_recorded_tag "$CURRENT_TAG_FILE")"
    CURRENT_ROUTE_IMAGE_DIGEST="$(read_recorded_digest "$CURRENT_DIGEST_FILE")"
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

    run_as_root /usr/bin/docker pull "$immutable_reference" >/dev/null 2>&1
    image_revision="$(run_as_root /usr/bin/docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$immutable_reference")"
    [[ "$image_revision" == "$requested_sha" ]] \
        || die "Pulled image revision does not match the requested commit."

    run_as_root /usr/bin/docker tag \
        "$immutable_reference" "$LOCAL_IMAGE_REPOSITORY:$requested_sha"
}

run_release_migrations() {
    local requested_sha="$1"

    run_as_root /usr/bin/env \
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
        -f "$ROOT_COMPOSE_ARTIFACT" \
        run --rm --no-deps --entrypoint /usr/local/bin/node api \
        node_modules/prisma/build/index.js migrate deploy \
        --schema prisma/schema.prisma \
        >/dev/null 2>&1
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

    container_ids="$(run_as_root /usr/bin/docker ps \
        --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
        --filter "label=com.docker.compose.service=api" \
        --format '{{.ID}}')"

    [[ -n "$container_ids" ]] || die "$DEPLOY_ENVIRONMENT API container is not running."
    [[ "$container_ids" != *$'\n'* ]] || die "Multiple $DEPLOY_ENVIRONMENT API containers are running."
    echo "$container_ids"
}

find_api_container_optional() {
    local container_ids

    container_ids="$(run_as_root /usr/bin/docker ps \
        --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
        --filter "label=com.docker.compose.service=api" \
        --format '{{.ID}}')" || return 1
    [[ -n "$container_ids" && "$container_ids" != *$'\n'* ]] || return 1
    echo "$container_ids"
}

reconcile_output() {
    local result="$1"
    local shared_ok="${RECONCILE_SHARED_OK:-null}"
    local direct_ok="${RECONCILE_DIRECT_OK:-null}"
    local active_route
    local history_json
    local previous_route_json
    local target_route_json
    local terminal_reason_json

    is_route "$ROUTE_STATE_ACTIVE_ROUTE" || die "Invalid active route for reconcile output."
    active_route="$(printf '%s' "$ROUTE_STATE_ACTIVE_ROUTE" | /usr/bin/tr '[:lower:]' '[:upper:]')"

    is_state_token "$result" || die "Invalid reconcile result."
    [[ "$ROUTE_STATE_PHASE" == "SHARED_ACTIVE" \
        || "$ROUTE_STATE_PHASE" == "SWITCHING_TO_DIRECT" \
        || "$ROUTE_STATE_PHASE" == "DIRECT_ACTIVE" \
        || "$ROUTE_STATE_PHASE" == "RECOVERING_SHARED" \
        || "$ROUTE_STATE_PHASE" == "SWITCHING_TO_SHARED" \
        || "$ROUTE_STATE_PHASE" == "BLOCKED" \
        || "$ROUTE_STATE_PHASE" == "DEGRADED" ]] \
        || die "Invalid reconcile phase."
    [[ "$shared_ok" == "true" || "$shared_ok" == "false" || "$shared_ok" == "null" ]] \
        || die "Invalid shared probe result."
    [[ "$direct_ok" == "true" || "$direct_ok" == "false" || "$direct_ok" == "null" ]] \
        || die "Invalid direct probe result."

    if [[ -n "$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY" ]]; then
        history_json="[$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY]"
    else
        history_json="[]"
    fi
    if [[ -n "$ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE" ]]; then
        previous_route_json="\"$(printf '%s' "$ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE" | /usr/bin/tr '[:lower:]' '[:upper:]')\""
    else
        previous_route_json="null"
    fi
    if [[ -n "$ROUTE_STATE_TRANSITION_TARGET_ROUTE" ]]; then
        target_route_json="\"$(printf '%s' "$ROUTE_STATE_TRANSITION_TARGET_ROUTE" | /usr/bin/tr '[:lower:]' '[:upper:]')\""
    else
        target_route_json="null"
    fi
    if [[ -n "$ROUTE_STATE_TERMINAL_REASON" ]]; then
        terminal_reason_json="\"$ROUTE_STATE_TERMINAL_REASON\""
    else
        terminal_reason_json="null"
    fi

    ROUTE_STATE_LAST_RESULT="$result"
    ROUTE_STATE_LAST_SHARED_OK="$shared_ok"
    ROUTE_STATE_LAST_DIRECT_OK="$direct_ok"
    if [[ "${RECONCILE_OUTPUT_PERSIST:-true}" == "true" ]]; then
        write_route_state
    fi

    printf '{"schemaVersion":1,"source":"babyjamjam-db-failover-host","controlPlaneOk":true,"environment":"%s","requestId":"%s","hostGeneration":%s,"activeRoute":"%s","phase":"%s","result":"%s","sharedOk":%s,"directOk":%s,"sharedFailureCount":%s,"directSuccessCount":%s,"directFailureCount":%s,"emergencySharedSuccessCount":%s,"sharedHealthyCount":%s,"directActivatedAt":%s,"sharedHealthyStartedAt":%s,"sharedHealthyLastAt":%s,"cooldownUntil":%s,"recentNormalRoundTrips":%s,"transition":{"previousRoute":%s,"targetRoute":%s,"startedAt":%s,"generation":%s,"terminalReason":%s},"terminalReason":%s}\n' \
        "$DEPLOY_ENVIRONMENT" "$RECONCILE_REQUEST_ID" "$ROUTE_STATE_GENERATION" \
        "$active_route" "$ROUTE_STATE_PHASE" "$result" "$shared_ok" "$direct_ok" \
        "$ROUTE_STATE_SHARED_FAILURE_COUNT" "$ROUTE_STATE_DIRECT_SUCCESS_COUNT" \
        "$ROUTE_STATE_DIRECT_FAILURE_COUNT" "$ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT" \
        "$ROUTE_STATE_SHARED_SUCCESS_COUNT" "$ROUTE_STATE_DIRECT_ACTIVATED_AT" \
        "$ROUTE_STATE_SHARED_SUCCESS_STARTED_AT" "$ROUTE_STATE_SHARED_SUCCESS_LAST_AT" \
        "$ROUTE_STATE_COOLDOWN_UNTIL" "$history_json" "$previous_route_json" \
        "$target_route_json" "$ROUTE_STATE_TRANSITION_STARTED_AT" \
        "$ROUTE_STATE_TRANSITION_GENERATION" "$terminal_reason_json" \
        "$terminal_reason_json"
}

lock_deferred_output() {
    local request_id="$1"

    is_uuid "$request_id" || die "Invalid lock deferral request ID."
    printf '{"schemaVersion":1,"source":"babyjamjam-db-failover-lock","controlPlaneOk":true,"environment":"%s","requestId":"%s","status":"DEFERRED","reason":"operator_lock_busy","retryAfterSeconds":%s}\n' \
        "$DEPLOY_ENVIRONMENT" "$request_id" "$DB_RECONCILE_RETRY_AFTER_SECONDS"
}

clear_transition_metadata() {
    ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE=""
    ROUTE_STATE_TRANSITION_TARGET_ROUTE=""
    ROUTE_STATE_TRANSITION_STARTED_AT="0"
    ROUTE_STATE_TRANSITION_GENERATION="0"
}

mark_reconcile_blocked() {
    local reason="$1"

    is_state_token "$reason" || die "Invalid blocked reason."
    ROUTE_STATE_PHASE="BLOCKED"
    ROUTE_STATE_TERMINAL_REASON="$reason"
    ROUTE_STATE_LAST_RESULT="$reason"
    clear_transition_metadata
    write_route_state
    reconcile_output "$reason"
    return 1
}

mark_reconcile_degraded() {
    local reason="$1"

    is_state_token "$reason" || die "Invalid degraded reason."
    ROUTE_STATE_PHASE="DEGRADED"
    ROUTE_STATE_TERMINAL_REASON="$reason"
    ROUTE_STATE_LAST_RESULT="$reason"
    clear_transition_metadata
    write_route_state
    reconcile_output "$reason"
    return 1
}

prune_normal_roundtrip_history() {
    local now="$1"
    local cutoff
    local item
    local pruned_history=""

    validate_state_timestamp "$now" || die "Invalid current timestamp."
    validate_state_history "$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY" \
        || die "Invalid normal roundtrip history."
    cutoff=$((now - NORMAL_ROUNDTRIP_WINDOW_SECONDS))
    if [[ -n "$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY" ]]; then
        IFS=',' read -r -a roundtrip_history_items <<<"$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY"
        for item in "${roundtrip_history_items[@]}"; do
            if (( item >= cutoff )); then
                if [[ -n "$pruned_history" ]]; then
                    pruned_history+=",$item"
                else
                    pruned_history="$item"
                fi
            fi
        done
    fi
    ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY="$pruned_history"
}

request_history_contains() {
    local request_id="$1"
    local history_item

    is_uuid "$request_id" || die "Invalid request history lookup ID."
    validate_request_history "$ROUTE_STATE_REQUEST_HISTORY" \
        || die "Invalid request history."
    [[ -n "$ROUTE_STATE_REQUEST_HISTORY" ]] || return 1
    IFS=',' read -r -a request_history_items <<<"$ROUTE_STATE_REQUEST_HISTORY"
    for history_item in "${request_history_items[@]}"; do
        [[ "$history_item" == "$request_id" ]] && return 0
    done
    return 1
}

remember_request_id() {
    local request_id="$1"
    local history_item
    local next_history=""

    is_uuid "$request_id" || die "Invalid request history ID."
    validate_request_history "$ROUTE_STATE_REQUEST_HISTORY" \
        || die "Invalid request history."
    if [[ -n "$ROUTE_STATE_REQUEST_HISTORY" ]]; then
        IFS=',' read -r -a request_history_items <<<"$ROUTE_STATE_REQUEST_HISTORY"
        for history_item in "${request_history_items[@]}"; do
            [[ "$history_item" == "$request_id" ]] && continue
            if [[ -n "$next_history" ]]; then
                next_history+=",$history_item"
            else
                next_history="$history_item"
            fi
        done
    fi
    if [[ -n "$next_history" ]]; then
        next_history+=",$request_id"
    else
        next_history="$request_id"
    fi
    IFS=',' read -r -a request_history_items <<<"$next_history"
    while ((${#request_history_items[@]} > REQUEST_HISTORY_LIMIT)); do
        request_history_items=("${request_history_items[@]:1}")
    done
    ROUTE_STATE_REQUEST_HISTORY="$(IFS=','; printf '%s' "${request_history_items[*]}")"
}

reserve_normal_roundtrip() {
    local now="$1"
    local history_count=0

    prune_normal_roundtrip_history "$now"
    if [[ -n "$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY" ]]; then
        IFS=',' read -r -a roundtrip_history_items <<<"$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY"
        history_count="${#roundtrip_history_items[@]}"
    fi
    if (( history_count >= NORMAL_ROUNDTRIP_LIMIT )); then
        mark_reconcile_blocked "transition_budget_exhausted"
        return 1
    fi
    if [[ -n "$ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY" ]]; then
        ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY+=",$now"
    else
        ROUTE_STATE_NORMAL_ROUNDTRIP_HISTORY="$now"
    fi
    return 0
}

record_shared_success() {
    local now="$1"
    local previous_success_at="$ROUTE_STATE_SHARED_SUCCESS_LAST_AT"
    local elapsed

    validate_state_timestamp "$now" || die "Invalid shared probe timestamp."
    validate_state_timestamp "$previous_success_at" || die "Invalid shared success timestamp."
    ROUTE_STATE_SHARED_SUCCESS_ACCEPTED="false"
    ROUTE_STATE_SHARED_SUCCESS_RESET="false"
    if [[ "$previous_success_at" == "0" ]]; then
        ROUTE_STATE_SHARED_SUCCESS_COUNT="1"
        ROUTE_STATE_SHARED_SUCCESS_STARTED_AT="$now"
        ROUTE_STATE_SHARED_SUCCESS_LAST_AT="$now"
        ROUTE_STATE_SHARED_SUCCESS_ACCEPTED="true"
        return 0
    fi
    if (( now <= previous_success_at )); then
        if (( now == previous_success_at )); then
            return 0
        fi
        ROUTE_STATE_SHARED_SUCCESS_COUNT="1"
        ROUTE_STATE_SHARED_SUCCESS_STARTED_AT="$now"
        ROUTE_STATE_SHARED_SUCCESS_LAST_AT="$now"
        ROUTE_STATE_SHARED_SUCCESS_ACCEPTED="true"
        ROUTE_STATE_SHARED_SUCCESS_RESET="true"
        return 0
    fi
    elapsed=$((now - previous_success_at))
    if (( elapsed < SHARED_PROBE_MIN_INTERVAL_SECONDS )); then
        return 0
    fi
    if (( elapsed > SHARED_PROBE_MAX_INTERVAL_SECONDS )); then
        ROUTE_STATE_SHARED_SUCCESS_COUNT="1"
        ROUTE_STATE_SHARED_SUCCESS_STARTED_AT="$now"
        ROUTE_STATE_SHARED_SUCCESS_LAST_AT="$now"
        ROUTE_STATE_SHARED_SUCCESS_ACCEPTED="true"
        ROUTE_STATE_SHARED_SUCCESS_RESET="true"
    else
        ROUTE_STATE_SHARED_SUCCESS_COUNT=$((ROUTE_STATE_SHARED_SUCCESS_COUNT + 1))
        ROUTE_STATE_SHARED_SUCCESS_LAST_AT="$now"
        ROUTE_STATE_SHARED_SUCCESS_ACCEPTED="true"
    fi
}

transition_route() {
    local previous_route="$1"
    local target_route="$2"
    local transition_phase
    local now

    is_route "$previous_route" || die "Invalid previous route."
    is_route "$target_route" || die "Invalid target route."
    [[ "$previous_route" != "$target_route" ]] || die "Route transition is a no-op."
    now="$(current_epoch)"
    if [[ "$target_route" == "direct" ]] \
        && (( ROUTE_STATE_COOLDOWN_UNTIL > now )); then
        ROUTE_STATE_LAST_RESULT="no_switch_cooldown_active"
        ROUTE_STATE_TERMINAL_REASON=""
        write_route_state
        reconcile_output "no_switch_cooldown_active"
        return 0
    fi
    if [[ "$target_route" == "direct" ]]; then
        reserve_normal_roundtrip "$now" || return 1
    fi

    load_current_release_identity
    [[ "$CURRENT_ROUTE_IMAGE_TAG" != "missing" ]] || die "Current image tag is missing."
    [[ "$CURRENT_ROUTE_IMAGE_DIGEST" != "missing" ]] || die "Current image digest is missing."

    if [[ "$target_route" == "direct" ]]; then
        transition_phase="SWITCHING_TO_DIRECT"
    else
        transition_phase="SWITCHING_TO_SHARED"
    fi
    ROUTE_STATE_PHASE="$transition_phase"
    ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE="$previous_route"
    ROUTE_STATE_TRANSITION_TARGET_ROUTE="$target_route"
    ROUTE_STATE_TRANSITION_STARTED_AT="$now"
    ROUTE_STATE_TRANSITION_GENERATION="$ROUTE_STATE_GENERATION"
    ROUTE_STATE_LAST_RESULT="transition_started"
    ROUTE_STATE_TERMINAL_REASON=""
    write_route_state

    if recreate_api_for_route "$target_route" \
        && verify_api_runtime "$target_route"; then
        ROUTE_STATE_ACTIVE_ROUTE="$target_route"
        if [[ "$target_route" == "direct" ]]; then
            ROUTE_STATE_PHASE="DIRECT_ACTIVE"
            ROUTE_STATE_DIRECT_ACTIVATED_AT="$now"
            ROUTE_STATE_SHARED_FAILURE_COUNT="0"
            ROUTE_STATE_DIRECT_SUCCESS_COUNT="0"
            ROUTE_STATE_DIRECT_FAILURE_COUNT="0"
            reset_shared_success_window
        else
            ROUTE_STATE_PHASE="SHARED_ACTIVE"
            ROUTE_STATE_DIRECT_ACTIVATED_AT="0"
            ROUTE_STATE_SHARED_FAILURE_COUNT="0"
            ROUTE_STATE_DIRECT_SUCCESS_COUNT="0"
            ROUTE_STATE_DIRECT_FAILURE_COUNT="0"
            reset_shared_success_window
        fi
        ROUTE_STATE_COOLDOWN_UNTIL=$((now + HOST_ROUTE_COOLDOWN_SECONDS))
        clear_transition_metadata
        ROUTE_STATE_LAST_RESULT="route_switched"
        write_route_state
        reconcile_output "route_switched"
        return 0
    fi

    ROUTE_STATE_PHASE="$transition_phase"
    ROUTE_STATE_LAST_RESULT="compensation_started"
    write_route_state
    if recreate_api_for_route "$previous_route" \
        && verify_api_runtime "$previous_route"; then
        ROUTE_STATE_ACTIVE_ROUTE="$previous_route"
        ROUTE_STATE_PHASE="$([[ "$previous_route" == "direct" ]] && echo DIRECT_ACTIVE || echo SHARED_ACTIVE)"
        ROUTE_STATE_SHARED_FAILURE_COUNT="0"
        ROUTE_STATE_DIRECT_SUCCESS_COUNT="0"
        ROUTE_STATE_DIRECT_FAILURE_COUNT="0"
        reset_shared_success_window
        clear_transition_metadata
        ROUTE_STATE_LAST_RESULT="transition_failed_compensated"
        ROUTE_STATE_TERMINAL_REASON=""
        write_route_state
        reconcile_output "transition_failed_compensated"
        return 0
    fi

    ROUTE_STATE_ACTIVE_ROUTE="$previous_route"
    mark_reconcile_degraded "compensation_failed"
}

compensate_stale_transition() {
    local previous_route="$ROUTE_STATE_TRANSITION_PREVIOUS_ROUTE"
    local target_route="$ROUTE_STATE_TRANSITION_TARGET_ROUTE"
    local transition_generation="$ROUTE_STATE_TRANSITION_GENERATION"
    local transition_phase="$ROUTE_STATE_PHASE"

    if [[ "$transition_phase" == "SWITCHING_TO_DIRECT" ]]; then
        [[ "$ROUTE_STATE_ACTIVE_ROUTE" == "shared" \
            && "$previous_route" == "shared" \
            && "$target_route" == "direct" ]] \
            || {
                mark_reconcile_degraded "stale_transition_compensation_failed"
                return 1
            }
    elif [[ "$transition_phase" == "SWITCHING_TO_SHARED" ]]; then
        [[ "$ROUTE_STATE_ACTIVE_ROUTE" == "direct" \
            && "$previous_route" == "direct" \
            && "$target_route" == "shared" ]] \
            || {
                mark_reconcile_degraded "stale_transition_compensation_failed"
                return 1
            }
    else
        mark_reconcile_degraded "stale_transition_compensation_failed"
        return 1
    fi
    [[ "$transition_generation" -le "$ROUTE_STATE_GENERATION" \
        && "$ROUTE_STATE_TRANSITION_STARTED_AT" != "0" ]] \
        || {
            mark_reconcile_degraded "stale_transition_compensation_failed"
            return 1
        }

    load_current_release_identity
    [[ "$CURRENT_ROUTE_IMAGE_TAG" != "missing" \
        && "$CURRENT_ROUTE_IMAGE_DIGEST" != "missing" ]] \
        || {
            mark_reconcile_degraded "stale_transition_compensation_failed"
            return 1
        }

    ROUTE_STATE_LAST_RESULT="stale_transition_compensation_started"
    write_route_state
    if recreate_api_for_route "$previous_route" \
        && verify_api_runtime "$previous_route"; then
        ROUTE_STATE_ACTIVE_ROUTE="$previous_route"
        if [[ "$previous_route" == "direct" ]]; then
            ROUTE_STATE_PHASE="DIRECT_ACTIVE"
        else
            ROUTE_STATE_PHASE="SHARED_ACTIVE"
            ROUTE_STATE_DIRECT_ACTIVATED_AT="0"
        fi
        ROUTE_STATE_SHARED_FAILURE_COUNT="0"
        ROUTE_STATE_DIRECT_SUCCESS_COUNT="0"
        ROUTE_STATE_DIRECT_FAILURE_COUNT="0"
        reset_shared_success_window
        clear_transition_metadata
        ROUTE_STATE_TERMINAL_REASON=""
        ROUTE_STATE_LAST_RESULT="stale_transition_compensated"
        write_route_state
        reconcile_output "stale_transition_compensated"
        return 0
    fi

    ROUTE_STATE_ACTIVE_ROUTE="$previous_route"
    mark_reconcile_degraded "stale_transition_compensation_failed"
}

reconcile_shared_active() {
    local now="$1"

    RECONCILE_SHARED_OK=null
    RECONCILE_DIRECT_OK=null
    if probe_route shared >/dev/null 2>&1; then
        RECONCILE_SHARED_OK=true
        ROUTE_STATE_SHARED_FAILURE_COUNT="0"
        ROUTE_STATE_DIRECT_SUCCESS_COUNT="0"
        ROUTE_STATE_DIRECT_FAILURE_COUNT="0"
        reset_shared_success_window
        record_probe_result shared ok "$now"
        ROUTE_STATE_LAST_RESULT="shared_healthy"
        write_route_state
        reconcile_output "no_switch_shared_healthy"
        return 0
    fi

    RECONCILE_SHARED_OK=false
    ROUTE_STATE_SHARED_FAILURE_COUNT=$((ROUTE_STATE_SHARED_FAILURE_COUNT + 1))
    record_probe_result shared failed "$now"
    if ! probe_route direct >/dev/null 2>&1; then
        RECONCILE_DIRECT_OK=false
        ROUTE_STATE_DIRECT_SUCCESS_COUNT="0"
        ROUTE_STATE_DIRECT_FAILURE_COUNT=$((ROUTE_STATE_DIRECT_FAILURE_COUNT + 1))
        record_probe_result direct failed "$now"
        mark_reconcile_blocked "both_routes_failed"
        return 1
    fi

    RECONCILE_DIRECT_OK=true
    ROUTE_STATE_DIRECT_FAILURE_COUNT="0"
    ROUTE_STATE_DIRECT_SUCCESS_COUNT=$((ROUTE_STATE_DIRECT_SUCCESS_COUNT + 1))
    record_probe_result direct ok "$now"
    if (( ROUTE_STATE_DIRECT_SUCCESS_COUNT >= DIRECT_SUCCESS_LIMIT )); then
        transition_route shared direct
        return $?
    fi

    ROUTE_STATE_LAST_RESULT="shared_failed_direct_healthy"
    write_route_state
    reconcile_output "no_switch_waiting_for_evidence"
}

reconcile_direct_active() {
    local now="$1"
    local direct_probe_ok=false
    local shared_probe_ok=false
    local direct_hold_elapsed=false

    RECONCILE_SHARED_OK=null
    RECONCILE_DIRECT_OK=null
    if probe_route direct >/dev/null 2>&1; then
        RECONCILE_DIRECT_OK=true
        direct_probe_ok=true
        ROUTE_STATE_DIRECT_FAILURE_COUNT="0"
    else
        RECONCILE_DIRECT_OK=false
        ROUTE_STATE_DIRECT_FAILURE_COUNT=$((ROUTE_STATE_DIRECT_FAILURE_COUNT + 1))
    fi

    if probe_route shared >/dev/null 2>&1; then
        RECONCILE_SHARED_OK=true
        shared_probe_ok=true
        record_shared_success "$now"
    else
        RECONCILE_SHARED_OK=false
        reset_shared_success_window
    fi

    if [[ "$direct_probe_ok" != "true" && "$shared_probe_ok" != "true" ]]; then
        record_probe_result direct failed "$now"
        mark_reconcile_blocked "both_routes_failed"
        return 1
    fi

    if [[ "$direct_probe_ok" == "true" ]]; then
        ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT="0"
        record_probe_result direct ok "$now"
    else
        record_probe_result direct failed "$now"
        if [[ "$shared_probe_ok" == "true" ]]; then
            if [[ "$ROUTE_STATE_SHARED_SUCCESS_ACCEPTED" == "true" ]]; then
                if [[ "$ROUTE_STATE_SHARED_SUCCESS_RESET" == "true" ]]; then
                    ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT="1"
                else
                    ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT=$((ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT + 1))
                fi
            fi
        fi
    fi

    if [[ "$direct_probe_ok" != "true" && "$shared_probe_ok" == "true" \
        && "$ROUTE_STATE_EMERGENCY_SHARED_SUCCESS_COUNT" -ge "$EMERGENCY_SHARED_SUCCESS_LIMIT" ]]; then
        transition_route direct shared
        return $?
    fi

    if [[ "$direct_probe_ok" != "true" && "$shared_probe_ok" == "true" ]]; then
        ROUTE_STATE_PHASE="RECOVERING_SHARED"
    else
        ROUTE_STATE_PHASE="DIRECT_ACTIVE"
    fi

    if [[ "$ROUTE_STATE_DIRECT_ACTIVATED_AT" != "0" ]] \
        && (( now >= ROUTE_STATE_DIRECT_ACTIVATED_AT )) \
        && (( now - ROUTE_STATE_DIRECT_ACTIVATED_AT >= DIRECT_MINIMUM_HOLD_SECONDS )); then
        direct_hold_elapsed=true
    fi
    if [[ "$direct_probe_ok" == "true" && "$shared_probe_ok" == "true" \
        && "$direct_hold_elapsed" == "true" \
        && "$ROUTE_STATE_SHARED_SUCCESS_COUNT" -ge "$SHARED_FAILBACK_SUCCESS_LIMIT" \
        && "$ROUTE_STATE_SHARED_SUCCESS_STARTED_AT" != "0" \
        && "$ROUTE_STATE_SHARED_SUCCESS_LAST_AT" != "0" \
        && $((now - ROUTE_STATE_SHARED_SUCCESS_STARTED_AT)) -ge "$SHARED_FAILBACK_MIN_ELAPSED_SECONDS" \
        && "$ROUTE_STATE_COOLDOWN_UNTIL" -le "$now" ]]; then
        transition_route direct shared
        return $?
    fi

    if [[ "$direct_probe_ok" == "true" && "$shared_probe_ok" == "true" ]]; then
        ROUTE_STATE_LAST_RESULT="direct_healthy_shared_recovering"
    elif [[ "$direct_probe_ok" == "true" ]]; then
        ROUTE_STATE_LAST_RESULT="direct_healthy_shared_failed"
    else
        ROUTE_STATE_LAST_RESULT="shared_healthy_emergency_wait"
    fi
    write_route_state
    reconcile_output "no_switch_waiting_for_evidence"
}

db_probe() {
    local route="$1"
    local request_id="$2"

    is_route "$route" || die "Invalid probe route."
    is_uuid "$request_id" || die "Invalid probe request ID."
    acquire_lock
    validate_backend_env_file
    if probe_route "$route" >/dev/null 2>&1; then
        printf 'db_probe=ok environment=%s route=%s request_id=%s\n' \
            "$DEPLOY_ENVIRONMENT" "$route" "$request_id"
        return 0
    fi
    printf 'db_probe=failed environment=%s route=%s request_id=%s\n' \
        "$DEPLOY_ENVIRONMENT" "$route" "$request_id"
    return 1
}

db_reconcile() {
    local request_id="$1"
    local now
    local lock_status

    is_uuid "$request_id" || die "Invalid reconcile request ID."
    RECONCILE_REQUEST_ID="$request_id"
    if acquire_lock "$DB_RECONCILE_LOCK_WAIT_SECONDS"; then
        :
    else
        lock_status=$?
        if [[ "$lock_status" -eq "$LOCK_CONTENTION_EXIT_STATUS" ]]; then
            lock_deferred_output "$request_id"
            return 0
        fi
        return "$lock_status"
    fi
    ensure_route_state
    load_route_state
    RECONCILE_SHARED_OK=null
    RECONCILE_DIRECT_OK=null
    RECONCILE_OUTPUT_PERSIST=true

    if request_history_contains "$request_id"; then
        RECONCILE_SHARED_OK="$ROUTE_STATE_LAST_SHARED_OK"
        RECONCILE_DIRECT_OK="$ROUTE_STATE_LAST_DIRECT_OK"
        RECONCILE_OUTPUT_PERSIST=false
        if [[ "$ROUTE_STATE_REQUEST_HISTORY_NEEDS_PERSIST" == true ]]; then
            write_route_state
            ROUTE_STATE_REQUEST_HISTORY_NEEDS_PERSIST=false
        fi
        reconcile_output "$ROUTE_STATE_LAST_RESULT"
        return 0
    fi

    validate_backend_env_file
    now="$(current_epoch)"
    prune_normal_roundtrip_history "$now"
    ROUTE_STATE_GENERATION=$((ROUTE_STATE_GENERATION + 1))
    ROUTE_STATE_LAST_REQUEST_ID="$request_id"
    remember_request_id "$request_id"
    ROUTE_STATE_REQUEST_HISTORY_NEEDS_PERSIST=false
    ROUTE_STATE_LAST_RESULT="reconcile_started"
    write_route_state

    if [[ "$ROUTE_STATE_PHASE" == "BLOCKED" || "$ROUTE_STATE_PHASE" == "DEGRADED" ]]; then
        ROUTE_STATE_LAST_RESULT="terminal_state"
        write_route_state
        reconcile_output "terminal_state"
        return 0
    fi
    ROUTE_STATE_TERMINAL_REASON=""
    if [[ "$ROUTE_STATE_PHASE" == SWITCHING_* ]]; then
        compensate_stale_transition
        return $?
    fi

    case "$ROUTE_STATE_ACTIVE_ROUTE" in
        shared)
            [[ "$ROUTE_STATE_PHASE" == "SHARED_ACTIVE" ]] || die "Shared route state phase is invalid."
            reconcile_shared_active "$now"
            ;;
        direct)
            [[ "$ROUTE_STATE_PHASE" == "DIRECT_ACTIVE" || "$ROUTE_STATE_PHASE" == "RECOVERING_SHARED" ]] \
                || die "Direct route state phase is invalid."
            reconcile_direct_active "$now"
            ;;
        *)
            die "Route state active route is invalid."
            ;;
    esac
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
    local runtime_route

    ensure_route_state
    load_route_state
    validate_backend_env_file
    load_current_release_identity
    RUNTIME_ROUTE=""
    verify_api_runtime "$ROUTE_STATE_ACTIVE_ROUTE" \
        || die "$DEPLOY_ENVIRONMENT API runtime invariant is not satisfied."
    runtime_route="${RUNTIME_ROUTE:-$ROUTE_STATE_ACTIVE_ROUTE}"

    api_container_id="$(find_api_container)"
    container_health="$(run_as_root /usr/bin/docker inspect \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$api_container_id")"
    image_name="$(run_as_root /usr/bin/docker inspect --format '{{.Config.Image}}' "$api_container_id")"
    restart_count="$(run_as_root /usr/bin/docker inspect --format '{{.RestartCount}}' "$api_container_id")"
    schedulers_enabled="$(
        run_as_root /usr/bin/docker inspect --format "$SCHEDULERS_ENV_FORMAT" "$api_container_id" \
            | /usr/bin/awk -F= '$1 == "SCHEDULERS_ENABLED" { count += 1; if (NF == 2) value = tolower($2); else malformed = 1 } END { if (count == 1 && malformed != 1) print value; else exit 1 }'
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

    public_health_body="$(run_as_root /usr/bin/curl --fail --silent --location \
        --proto '=https' --proto-redir '=https' \
        --connect-timeout 5 --max-time 10 \
        "$PUBLIC_HEALTH_URL")" || die "$DEPLOY_ENVIRONMENT public health check failed."
    printf '%s\n' "$public_health_body" \
        | /usr/bin/grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' \
        || die "$DEPLOY_ENVIRONMENT public health response is not ok."

    echo "environment=$DEPLOY_ENVIRONMENT"
    echo "current_tag=$current_tag"
    echo "current_digest=$current_digest"
    echo "db_route=$ROUTE_STATE_ACTIVE_ROUTE"
    echo "runtime_route=$runtime_route"
    echo "db_readiness=ok"
    echo "container_health=$container_health"
    echo "restart_count=$restart_count"
    echo "schedulers_enabled=$schedulers_enabled"
    echo "public_health=ok"
}

run_deploy_script() {
    local requested_sha="$1"
    local route_mode="shared"

    if [[ -e "$ROUTE_STATE_FILE" ]]; then
        load_route_state
        route_mode="$ROUTE_STATE_ACTIVE_ROUTE"
    fi
    run_as_root /usr/bin/env \
        BACKEND_BUILD_IMAGE=false \
        BACKEND_COMPOSE_FILE="$ROOT_COMPOSE_ARTIFACT" \
        BACKEND_IMAGE="$LOCAL_IMAGE_REPOSITORY" \
        BACKEND_IMAGE_TAG="$requested_sha" \
        BACKEND_SKIP_REPOSITORY_GIT_CHECK=true \
        DATABASE_CONNECTION_MODE="$route_mode" \
        "$ROOT_DEPLOY_ARTIFACT" "$DEPLOY_ENVIRONMENT"
}

run_rollback_script() {
    local rollback_tag="$1"
    local route_mode="shared"

    if [[ -e "$ROUTE_STATE_FILE" ]]; then
        load_route_state
        route_mode="$ROUTE_STATE_ACTIVE_ROUTE"
    fi

    run_as_root /usr/bin/env \
        BACKEND_COMPOSE_FILE="$ROOT_COMPOSE_ARTIFACT" \
        BACKEND_IMAGE="$LOCAL_IMAGE_REPOSITORY" \
        BACKEND_ROLLBACK_PRESERVE_PREVIOUS_TAG=true \
        DATABASE_CONNECTION_MODE="$route_mode" \
        "$ROOT_ROLLBACK_ARTIFACT" \
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
    ensure_route_state
    validate_backend_env_file
    prepare_deploy_worktree "$requested_sha"

    current_tag="$(read_recorded_tag "$STATE_DIRECTORY/current-image-tag")"
    [[ "$current_tag" != "missing" ]] || die "A known-good current image is required before CI deployment."
    run_as_root /usr/bin/docker image inspect "$LOCAL_IMAGE_REPOSITORY:$current_tag" >/dev/null 2>&1 \
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

    if run_deploy_script "$requested_sha" >"$log_file" 2>&1 \
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
            acquire_lock
            status_environment
            ;;
        deploy)
            deploy_environment "$3" "$4"
            ;;
        db-probe)
            db_probe "$3" "$4"
            ;;
        db-reconcile)
            db_reconcile "$3"
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
