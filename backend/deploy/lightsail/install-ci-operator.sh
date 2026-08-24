#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly SOURCE_OPERATOR="$SCRIPT_DIR/ci-operator.sh"
readonly SOURCE_DEPLOY_HELPER="$SCRIPT_DIR/deploy.sh"
readonly SOURCE_ROLLBACK_HELPER="$SCRIPT_DIR/rollback.sh"
readonly SOURCE_COMPOSE_FILE="$SCRIPT_DIR/../../compose.lightsail.yml"
#
# These are fixed production defaults.  They remain mutable only after this
# file is sourced, which lets the isolated shell harness inject temporary
# paths and command wrappers without making the executable read test values
# from its environment.
INSTALLED_OPERATOR="/usr/local/sbin/babyjamjam-ci-operator"
ARTIFACT_DIRECTORY="/usr/local/libexec/babyjamjam-ci-operator"
INSTALLED_OPERATOR_ARTIFACT="$ARTIFACT_DIRECTORY/ci-operator.sh"
INSTALLED_DEPLOY_ARTIFACT="$ARTIFACT_DIRECTORY/deploy.sh"
INSTALLED_ROLLBACK_ARTIFACT="$ARTIFACT_DIRECTORY/rollback.sh"
INSTALLED_COMPOSE_ARTIFACT="$ARTIFACT_DIRECTORY/compose.lightsail.yml"
LOG_DIRECTORY="/var/log/babyjamjam-deploy"
STATE_ROOT="/opt/babyjamjam/environments"
ROUTE_STATE_ROOT="/opt/babyjamjam/db-failover-state"
readonly ROUTE_STATE_FILE_NAME="db-route-state"
readonly DEPLOY_USER="ubuntu"
readonly DEPLOY_GROUP="ubuntu"
readonly REQUEST_HISTORY_LIMIT="32"

CMD_BASH="/bin/bash"
CMD_CAT="/bin/cat"
CMD_CHMOD="/bin/chmod"
CMD_CHOWN="/usr/bin/chown"
CMD_CMP="/usr/bin/cmp"
CMD_CP="/bin/cp"
CMD_DATE="/usr/bin/date"
CMD_DIRNAME="/usr/bin/dirname"
CMD_DOCKER="/usr/bin/docker"
CMD_GIT="/usr/bin/git"
CMD_CURL="/usr/bin/curl"
CMD_FLOCK="/usr/bin/flock"
CMD_INSTALL="/usr/bin/install"
CMD_MKTEMP="/usr/bin/mktemp"
CMD_MKDIR="/bin/mkdir"
CMD_MV="/usr/bin/mv"
CMD_RM="/usr/bin/rm"
CMD_RMDIR="/bin/rmdir"
CMD_RUNUSER="/usr/sbin/runuser"
CMD_STAT="/usr/bin/stat"
CMD_TIMEOUT="/usr/bin/timeout"
CMD_UNLINK="/usr/bin/unlink"

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    readonly INSTALLED_OPERATOR ARTIFACT_DIRECTORY INSTALLED_OPERATOR_ARTIFACT
    readonly INSTALLED_DEPLOY_ARTIFACT INSTALLED_ROLLBACK_ARTIFACT INSTALLED_COMPOSE_ARTIFACT
    readonly LOG_DIRECTORY STATE_ROOT ROUTE_STATE_ROOT
    readonly CMD_BASH CMD_CAT CMD_CHMOD CMD_CHOWN CMD_CMP CMD_CP CMD_DATE CMD_DIRNAME
    readonly CMD_DOCKER CMD_GIT CMD_CURL CMD_FLOCK CMD_INSTALL CMD_MKTEMP CMD_MV
    readonly CMD_MKDIR CMD_RM CMD_RMDIR CMD_RUNUSER CMD_STAT CMD_TIMEOUT CMD_UNLINK
fi

usage() {
    cat >&2 <<'EOF'
Usage:
  install-ci-operator.sh install [--replace]
  install-ci-operator.sh check
  install-ci-operator.sh uninstall
EOF
}

die() {
    echo "$*" >&2
    exit 1
}

require_root() {
    [[ "$EUID" -eq 0 ]] || die "Run this command as root."
}

group_list_contains() {
    local wanted_group="$1"
    local group_list="$2"

    [[ " $group_list " == *" $wanted_group "* ]]
}

verify_host_prerequisites() {
    local deploy_groups
    local required_command
    local source_script

    /usr/bin/id "$DEPLOY_USER" >/dev/null 2>&1 || die "Missing deploy user: $DEPLOY_USER"
    deploy_groups="$(/usr/bin/id -nG "$DEPLOY_USER")"
    if group_list_contains docker "$deploy_groups"; then
        die "$DEPLOY_USER must not belong to the docker group; root CI Docker execution requires its removal."
    fi

    for required_command in "$CMD_RUNUSER" "$CMD_DOCKER" "$CMD_GIT" "$CMD_CURL" "$CMD_FLOCK" "$CMD_TIMEOUT" "$CMD_STAT" "$CMD_DATE" "$CMD_MKTEMP" "$CMD_DIRNAME"; do
        [[ -x "$required_command" ]] || die "Required command is missing: $required_command"
    done

    for source_script in "$SOURCE_OPERATOR" "$SOURCE_DEPLOY_HELPER" "$SOURCE_ROLLBACK_HELPER"; do
        [[ -f "$source_script" && ! -L "$source_script" && -r "$source_script" ]] \
            || die "A required operator source is missing or invalid."
        "$CMD_BASH" -n "$source_script" || die "An operator source is not valid Bash."
    done
    [[ -f "$SOURCE_COMPOSE_FILE" && ! -L "$SOURCE_COMPOSE_FILE" && -r "$SOURCE_COMPOSE_FILE" ]] \
        || die "The required Compose source is missing or invalid."
}

validate_no_symlink_path() {
    local path="$1"
    local path_without_root
    local path_prefix
    local path_component
    local -a path_components

    [[ -n "$path" ]] || die "Path must not be empty."
    case "$path" in
        /*)
            path_prefix="/"
            path_without_root="${path#/}"
            ;;
        *)
            path_prefix=""
            path_without_root="$path"
            ;;
    esac

    IFS='/' read -r -a path_components <<<"$path_without_root"
    for path_component in "${path_components[@]}"; do
        case "$path_component" in
            ''|.)
                continue
                ;;
            ..)
                die "Path must not contain '..': $path"
                ;;
        esac
        if [[ "$path_prefix" == "/" ]]; then
            path_prefix="/$path_component"
        elif [[ -n "$path_prefix" ]]; then
            path_prefix="$path_prefix/$path_component"
        else
            path_prefix="$path_component"
        fi
        [[ ! -L "$path_prefix" ]] \
            || die "Path component must not be a symbolic link: $path_prefix"
    done
}

validate_route_state_parent() {
    local parent_directory
    local parent_metadata
    local parent_mode
    local parent_permissions

    validate_no_symlink_path "$ROUTE_STATE_ROOT"
    parent_directory="$("$CMD_DIRNAME" "$ROUTE_STATE_ROOT")"
    validate_no_symlink_path "$parent_directory"
    [[ -d "$parent_directory" && ! -L "$parent_directory" ]] \
        || die "Route state parent directory is missing or invalid: $parent_directory"
    parent_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$parent_directory")"
    parent_mode="${parent_metadata##*:}"
    parent_permissions="${parent_mode: -3}"
    [[ "${parent_metadata%%:*}" == "root" ]] \
        || die "Route state parent directory must be root-owned: $parent_metadata"
    [[ "${parent_permissions:1:1}" != [2367] && "${parent_permissions:2:1}" != [2367] ]] \
        || die "Route state parent directory must not be group/world writable: $parent_metadata"
}

ensure_route_state_directory() {
    local environment="$1"
    local route_state_directory="$ROUTE_STATE_ROOT/$environment"
    local route_state_root_metadata
    local route_state_directory_metadata

    [[ "$environment" == "preview" || "$environment" == "production" ]] \
        || die "Unsupported route state environment: $environment"
    validate_route_state_parent
    validate_no_symlink_path "$ROUTE_STATE_ROOT"
    [[ ! -L "$ROUTE_STATE_ROOT" ]] \
        || die "Route state root must not be a symbolic link: $ROUTE_STATE_ROOT"
    if [[ ! -e "$ROUTE_STATE_ROOT" ]]; then
        "$CMD_INSTALL" -d -o root -g root -m 0700 "$ROUTE_STATE_ROOT"
    fi
    [[ -d "$ROUTE_STATE_ROOT" && ! -L "$ROUTE_STATE_ROOT" ]] \
        || die "Route state root is missing or invalid: $ROUTE_STATE_ROOT"
    route_state_root_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$ROUTE_STATE_ROOT")"
    [[ "$route_state_root_metadata" == "root:root:700" ]] \
        || die "Unexpected route state root ownership or mode: $route_state_root_metadata"

    validate_no_symlink_path "$route_state_directory"
    [[ ! -L "$route_state_directory" ]] \
        || die "Route state directory must not be a symbolic link: $route_state_directory"
    if [[ ! -e "$route_state_directory" ]]; then
        "$CMD_INSTALL" -d -o root -g root -m 0700 "$route_state_directory"
    fi
    [[ -d "$route_state_directory" && ! -L "$route_state_directory" ]] \
        || die "Route state directory is missing or invalid: $route_state_directory"
    route_state_directory_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$route_state_directory")"
    [[ "$route_state_directory_metadata" == "root:root:700" ]] \
        || die "Unexpected route state directory ownership or mode: $route_state_directory_metadata"
}

is_route_state_counter() {
    [[ "${1:-}" =~ ^0$|^[1-9][0-9]{0,11}$ ]]
}

is_route_state_timestamp() {
    is_route_state_counter "${1:-}"
}

is_route_state_token() {
    [[ "${1:-}" =~ ^[A-Za-z0-9._:-]{1,64}$ ]]
}

is_route_state_uuid() {
    [[ "${1:-}" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]
}

validate_route_state_value() {
    local state_key="$1"
    local state_value="$2"

    case "$state_key" in
        version)
            [[ "$state_value" == "2" ]]
            ;;
        generation|transition_generation|shared_failure_count|direct_success_count|direct_failure_count|emergency_shared_success_count|shared_healthy_count)
            is_route_state_counter "$state_value"
            ;;
        transition_started_at|direct_activated_at|shared_healthy_started_at|shared_healthy_last_at|cooldown_until|last_probe_at)
            is_route_state_timestamp "$state_value"
            ;;
        transition_previous_route|transition_target_route|active_route|last_probe_route)
            [[ -z "$state_value" || "$state_value" == "shared" || "$state_value" == "direct" ]]
            ;;
        normal_roundtrip_history)
            validate_route_state_history "$state_value"
            ;;
        last_shared_ok|last_direct_ok)
            [[ "$state_value" == "true" || "$state_value" == "false" || "$state_value" == "null" ]]
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
            [[ -z "$state_value" ]] || is_route_state_uuid "$state_value"
            ;;
        request_history)
            validate_request_history "$state_value"
            ;;
        last_probe_result|last_result|terminal_reason)
            [[ -z "$state_value" ]] || is_route_state_token "$state_value"
            ;;
        *)
            return 1
            ;;
    esac
}

validate_route_state_history() {
    local history="${1:-}"
    local item
    local previous="0"
    local -a history_items

    [[ -z "$history" ]] && return 0
    [[ "$history" =~ ^(0|[1-9][0-9]{0,11})(,(0|[1-9][0-9]{0,11}))*$ ]] || return 1
    IFS=',' read -r -a history_items <<<"$history"
    for item in "${history_items[@]}"; do
        is_route_state_timestamp "$item" || return 1
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
        is_route_state_uuid "$request_id" || return 1
    done
}

validate_route_state_file() {
    local route_state_file="$1"
    local state_key
    local state_value
    local state_line
    local seen_state_keys=" "
    local required_key

    ROUTE_STATE_REQUEST_HISTORY_PRESENT=false
    ROUTE_STATE_LAST_REQUEST_ID=""
    while IFS= read -r state_line || [[ -n "$state_line" ]]; do
        [[ -z "$state_line" ]] && continue
        [[ "$state_line" == *=* ]] || die "Malformed route state."
        state_key="${state_line%%=*}"
        state_value="${state_line#*=}"
        [[ "$state_key" =~ ^[a-z_]+$ ]] || die "Malformed route state key."
        [[ "$seen_state_keys" != *" $state_key "* ]] || die "Duplicate route state key."
        seen_state_keys+="$state_key "
        validate_route_state_value "$state_key" "$state_value" \
            || die "Invalid route state value."
        case "$state_key" in
            last_request_id)
                ROUTE_STATE_LAST_REQUEST_ID="$state_value"
                ;;
            request_history)
                ROUTE_STATE_REQUEST_HISTORY_PRESENT=true
                ;;
        esac
    done <"$route_state_file"

    for required_key in \
        version generation active_route phase transition_previous_route \
        transition_target_route transition_started_at transition_generation \
        direct_activated_at shared_failure_count direct_success_count \
        direct_failure_count emergency_shared_success_count shared_healthy_count \
        shared_healthy_started_at shared_healthy_last_at normal_roundtrip_history \
        cooldown_until last_request_id last_probe_route last_probe_result \
        last_probe_at last_shared_ok last_direct_ok last_result terminal_reason; do
        [[ "$seen_state_keys" == *" $required_key "* ]] \
            || die "Route state is incomplete."
    done
}

cleanup_route_state_temp() {
    if [[ -n "${temporary_file:-}" ]]; then
        "$CMD_UNLINK" "$temporary_file" 2>/dev/null || true
        temporary_file=""
    fi
}

route_state_creation_failed() {
    cleanup_route_state_temp
    trap - RETURN
    die "Unable to create route state."
}

route_state_migration_failed() {
    cleanup_route_state_temp
    trap - RETURN
    die "Unable to migrate legacy route state."
}

migrate_legacy_route_state_file() {
    local route_state_file="$1"
    local route_state_directory
    local route_state_metadata
    local state_line
    local temporary_file

    [[ "${ROUTE_STATE_REQUEST_HISTORY_PRESENT:-false}" == false ]] || return 0
    validate_no_symlink_path "$route_state_file"
    [[ -f "$route_state_file" && ! -L "$route_state_file" ]] \
        || die "Route state file is missing or invalid: $route_state_file"
    route_state_directory="$("$CMD_DIRNAME" "$route_state_file")"
    validate_no_symlink_path "$route_state_directory"
    [[ -d "$route_state_directory" && ! -L "$route_state_directory" ]] \
        || die "Route state directory is missing or invalid: $route_state_directory"
    route_state_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$route_state_file")"
    [[ "$route_state_metadata" == "root:root:600" ]] \
        || die "Unexpected route state ownership or mode: $route_state_metadata"

    temporary_file="$("$CMD_MKTEMP" "$route_state_directory/.db-route-state.XXXXXX")" \
        || die "Unable to create temporary route state migration."
    trap cleanup_route_state_temp RETURN
    "$CMD_CHOWN" root:root "$temporary_file" || route_state_migration_failed
    "$CMD_CHMOD" 0600 "$temporary_file" || route_state_migration_failed
    if ! {
        while IFS= read -r state_line || [[ -n "$state_line" ]]; do
            printf '%s\n' "$state_line"
            if [[ "$state_line" == last_request_id=* ]]; then
                printf 'request_history=%s\n' "${ROUTE_STATE_LAST_REQUEST_ID:-}"
            fi
        done <"$route_state_file"
    } >"$temporary_file"; then
        route_state_migration_failed
    fi
    "$CMD_CHOWN" root:root "$temporary_file" || route_state_migration_failed
    "$CMD_CHMOD" 0600 "$temporary_file" || route_state_migration_failed
    [[ ! -L "$route_state_file" ]] || route_state_migration_failed
    [[ -f "$route_state_file" ]] || route_state_migration_failed
    "$CMD_MV" "$temporary_file" "$route_state_file" || route_state_migration_failed
    temporary_file=""
    "$CMD_CHOWN" root:root "$route_state_file" || die "Unable to set route state ownership."
    "$CMD_CHMOD" 0600 "$route_state_file" || die "Unable to set route state mode."
    trap - RETURN
}

ensure_route_state_file() {
    local environment="$1"
    local migrate_legacy_state="${2:-false}"
    local route_state_directory="$ROUTE_STATE_ROOT/$environment"
    local route_state_file="$route_state_directory/$ROUTE_STATE_FILE_NAME"
    local temporary_file
    local route_state_metadata

    [[ "$migrate_legacy_state" == true || "$migrate_legacy_state" == false ]] \
        || die "Invalid route state migration mode."

    ensure_route_state_directory "$environment"
    validate_no_symlink_path "$route_state_file"
    [[ ! -L "$route_state_file" ]] || die "Route state file must not be a symbolic link: $route_state_file"
    if [[ -e "$route_state_file" ]]; then
        [[ -f "$route_state_file" ]] || die "Route state file is not regular: $route_state_file"
        route_state_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$route_state_file")"
        [[ "$route_state_metadata" == "root:root:600" ]] \
            || die "Unexpected route state ownership or mode: $route_state_metadata"
        validate_route_state_file "$route_state_file"
        if [[ "$migrate_legacy_state" == true \
            && "$ROUTE_STATE_REQUEST_HISTORY_PRESENT" == false ]]; then
            migrate_legacy_route_state_file "$route_state_file"
            validate_route_state_file "$route_state_file"
        fi
        return 0
    fi

    temporary_file="$("$CMD_MKTEMP" "$route_state_directory/.db-route-state.XXXXXX")" \
        || die "Unable to create temporary route state."
    trap cleanup_route_state_temp RETURN
    "$CMD_CHOWN" root:root "$temporary_file" || route_state_creation_failed
    "$CMD_CHMOD" 0600 "$temporary_file" || route_state_creation_failed
    if ! {
        printf '%s\n' \
            'version=2' \
            'generation=0' \
            'active_route=shared' \
            'phase=SHARED_ACTIVE' \
            'transition_previous_route=' \
            'transition_target_route=' \
            'transition_started_at=0' \
            'transition_generation=0' \
            'direct_activated_at=0' \
            'shared_failure_count=0' \
            'direct_success_count=0' \
            'direct_failure_count=0' \
            'emergency_shared_success_count=0' \
            'shared_healthy_count=0' \
            'shared_healthy_started_at=0' \
            'shared_healthy_last_at=0' \
            'normal_roundtrip_history=' \
            'cooldown_until=0' \
            'last_request_id=' \
            'request_history=' \
            'last_probe_route=' \
            'last_probe_result=none' \
            'last_probe_at=0' \
            'last_shared_ok=null' \
            'last_direct_ok=null' \
            'last_result=initialized' \
            'terminal_reason='
    } >"$temporary_file"; then
        route_state_creation_failed
    fi
    "$CMD_CHOWN" root:root "$temporary_file" || route_state_creation_failed
    "$CMD_CHMOD" 0600 "$temporary_file" || route_state_creation_failed
    [[ ! -L "$route_state_file" ]] || route_state_creation_failed
    [[ ! -e "$route_state_file" ]] || route_state_creation_failed
    "$CMD_MV" "$temporary_file" "$route_state_file" || route_state_creation_failed
    temporary_file=""
    "$CMD_CHOWN" root:root "$route_state_file" || die "Unable to set route state ownership."
    "$CMD_CHMOD" 0600 "$route_state_file" || die "Unable to set route state mode."
    trap - RETURN
}

ensure_deployment_locks() {
    local migrate_legacy_state="${1:-false}"
    local environment
    local lock_file
    local state_directory

    [[ "$migrate_legacy_state" == true || "$migrate_legacy_state" == false ]] \
        || die "Invalid route state migration mode."

    for environment in preview production; do
        state_directory="$STATE_ROOT/$environment"
        lock_file="$state_directory/operator.lock"
        [[ -d "$state_directory" ]] || die "Deployment state directory is missing: $state_directory"
        [[ ! -L "$lock_file" ]] || die "Deployment lock must not be a symbolic link: $lock_file"
        if [[ ! -e "$lock_file" ]]; then
            "$CMD_INSTALL" -o root -g root -m 0600 /dev/null "$lock_file" \
                || die "Unable to create deployment lock: $lock_file"
        fi
        [[ -f "$lock_file" ]] || die "Deployment lock is not a regular file: $lock_file"
        "$CMD_CHOWN" root:root "$lock_file" \
            || die "Unable to set deployment lock ownership: $lock_file"
        "$CMD_CHMOD" 0600 "$lock_file" \
            || die "Unable to set deployment lock mode: $lock_file"
        ensure_route_state_file "$environment" "$migrate_legacy_state"
    done
}

verify_installed_files() {
    local artifact_directory_metadata
    local artifact_parent_directory
    local artifact_parent_metadata
    local artifact_parent_mode
    local artifact_parent_permissions
    local compose_metadata
    local deploy_metadata
    local environment
    local lock_file
    local lock_metadata
    local log_metadata
    local operator_metadata
    local operator_artifact_metadata
    local rollback_metadata
    local route_state_directory
    local route_state_directory_metadata
    local route_state_file
    local route_state_root_metadata
    local route_state_metadata

    [[ -x "$INSTALLED_OPERATOR" ]] || die "Installed CI operator is missing."
    artifact_parent_directory="$("$CMD_DIRNAME" "$ARTIFACT_DIRECTORY")"
    validate_no_symlink_path "$artifact_parent_directory"
    [[ -d "$artifact_parent_directory" && ! -L "$artifact_parent_directory" ]] \
        || die "CI operator artifact parent is missing or invalid."
    artifact_parent_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$artifact_parent_directory")"
    artifact_parent_mode="${artifact_parent_metadata##*:}"
    artifact_parent_permissions="${artifact_parent_mode: -3}"
    [[ "${artifact_parent_metadata%%:*}" == "root" \
        && "${artifact_parent_permissions:1:1}" != [2367] \
        && "${artifact_parent_permissions:2:1}" != [2367] ]] \
        || die "CI operator artifact parent is not a protected root boundary."
    validate_no_symlink_path "$ARTIFACT_DIRECTORY"
    [[ -d "$ARTIFACT_DIRECTORY" && ! -L "$ARTIFACT_DIRECTORY" ]] \
        || die "CI operator artifact directory is missing or invalid."
    [[ -f "$INSTALLED_OPERATOR_ARTIFACT" && ! -L "$INSTALLED_OPERATOR_ARTIFACT" ]] \
        || die "Protected CI operator artifact is missing or invalid."
    [[ -f "$INSTALLED_DEPLOY_ARTIFACT" && ! -L "$INSTALLED_DEPLOY_ARTIFACT" ]] \
        || die "Protected deploy artifact is missing or invalid."
    [[ -f "$INSTALLED_ROLLBACK_ARTIFACT" && ! -L "$INSTALLED_ROLLBACK_ARTIFACT" ]] \
        || die "Protected rollback artifact is missing or invalid."
    [[ -f "$INSTALLED_COMPOSE_ARTIFACT" && ! -L "$INSTALLED_COMPOSE_ARTIFACT" ]] \
        || die "Protected Compose artifact is missing or invalid."
    [[ -d "$LOG_DIRECTORY" ]] || die "CI deployment log directory is missing."

    artifact_directory_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$ARTIFACT_DIRECTORY")"
    operator_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$INSTALLED_OPERATOR")"
    operator_artifact_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$INSTALLED_OPERATOR_ARTIFACT")"
    deploy_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$INSTALLED_DEPLOY_ARTIFACT")"
    rollback_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$INSTALLED_ROLLBACK_ARTIFACT")"
    compose_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$INSTALLED_COMPOSE_ARTIFACT")"
    log_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$LOG_DIRECTORY")"
    [[ "$artifact_directory_metadata" == "root:root:700" ]] \
        || die "Unexpected CI artifact directory ownership or mode: $artifact_directory_metadata"
    [[ "$operator_metadata" == "root:root:750" ]] \
        || die "Unexpected CI operator ownership or mode: $operator_metadata"
    [[ "$operator_artifact_metadata" == "root:root:750" \
        && "$deploy_metadata" == "root:root:750" \
        && "$rollback_metadata" == "root:root:750" \
        && "$compose_metadata" == "root:root:640" ]] \
        || die "Unexpected protected deployment artifact ownership or mode."
    "$CMD_CMP" -s "$INSTALLED_OPERATOR" "$INSTALLED_OPERATOR_ARTIFACT" \
        || die "Installed operator does not match its protected artifact."
    [[ "$log_metadata" == "root:root:700" ]] \
        || die "Unexpected CI log directory ownership or mode: $log_metadata"
    validate_route_state_parent
    [[ -d "$ROUTE_STATE_ROOT" && ! -L "$ROUTE_STATE_ROOT" ]] \
        || die "Route state root is missing or invalid: $ROUTE_STATE_ROOT"
    route_state_root_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$ROUTE_STATE_ROOT")"
    [[ "$route_state_root_metadata" == "root:root:700" ]] \
        || die "Unexpected route state root ownership or mode: $route_state_root_metadata"

    for environment in preview production; do
        lock_file="$STATE_ROOT/$environment/operator.lock"
        route_state_directory="$ROUTE_STATE_ROOT/$environment"
        route_state_file="$ROUTE_STATE_ROOT/$environment/$ROUTE_STATE_FILE_NAME"
        [[ -f "$lock_file" && ! -L "$lock_file" ]] \
            || die "Deployment lock is missing or invalid: $lock_file"
        lock_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$lock_file")"
        [[ "$lock_metadata" == "root:root:600" ]] \
            || die "Unexpected deployment lock ownership or mode: $lock_metadata"
        [[ -d "$route_state_directory" && ! -L "$route_state_directory" ]] \
            || die "Route state directory is missing or invalid: $route_state_directory"
        route_state_directory_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$route_state_directory")"
        [[ "$route_state_directory_metadata" == "root:root:700" ]] \
            || die "Unexpected route state directory ownership or mode: $route_state_directory_metadata"
        [[ -f "$route_state_file" && ! -L "$route_state_file" ]] \
            || die "Route state file is missing or invalid: $route_state_file"
        route_state_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$route_state_file")"
        [[ "$route_state_metadata" == "root:root:600" ]] \
            || die "Unexpected route state ownership or mode: $route_state_metadata"
        validate_route_state_file "$route_state_file"
    done

    "$CMD_BASH" -n "$INSTALLED_OPERATOR" || die "Installed CI operator is not valid Bash."
    "$CMD_BASH" -n "$INSTALLED_DEPLOY_ARTIFACT" || die "Installed deploy artifact is not valid Bash."
    "$CMD_BASH" -n "$INSTALLED_ROLLBACK_ARTIFACT" || die "Installed rollback artifact is not valid Bash."
    echo "Lightsail CI operator installation is valid."
}

prepare_install_transaction_locks() {
    local environment
    local lock_file

    INSTALL_TRANSACTION_PREEXISTING_PREVIEW_LOCK=false
    INSTALL_TRANSACTION_PREEXISTING_PRODUCTION_LOCK=false

    # Acquire preview before even creating production's lock.  This gives the
    # transaction one deterministic order and avoids a partially prepared pair
    # of lock files that another deploy could observe as free.
    for environment in preview production; do
        lock_file="$STATE_ROOT/$environment/operator.lock"
        [[ -d "$STATE_ROOT/$environment" ]] || return 1
        [[ ! -L "$lock_file" ]] || return 1
        if [[ -e "$lock_file" ]]; then
            [[ -f "$lock_file" ]] || return 1
            if [[ "$environment" == preview ]]; then
                INSTALL_TRANSACTION_PREEXISTING_PREVIEW_LOCK=true
            else
                INSTALL_TRANSACTION_PREEXISTING_PRODUCTION_LOCK=true
            fi
        else
            "$CMD_INSTALL" -o root -g root -m 0600 /dev/null "$lock_file" \
                || return 1
        fi

        if [[ "$environment" == preview ]]; then
            exec 200>>"$lock_file" || return 1
            "$CMD_FLOCK" -n 200 || return 1
        else
            exec 201>>"$lock_file" || return 1
            "$CMD_FLOCK" -n 201 || return 1
        fi
    done
}

release_install_transaction_locks() {
    exec 200>&- 2>/dev/null || true
    exec 201>&- 2>/dev/null || true
}

cleanup_prepared_install_transaction_locks() {
    # Never unlink a lock path while its inode may still be the one held by a
    # flock descriptor.  A newly created lock is intentionally retained as an
    # empty, safe lock on every setup/transaction failure so a later operator
    # cannot observe an unlocked pathname during cleanup.
    release_install_transaction_locks
}

install_lock_prepare_exit() {
    local exit_status="${1:-0}"

    trap - EXIT
    cleanup_prepared_install_transaction_locks
    if [[ -n "${temporary_directory:-}" && -d "$temporary_directory" ]]; then
        "$CMD_RM" -rf "$temporary_directory" || exit_status=1
    fi
    exit "$exit_status"
}

cleanup_install_operator_temp() {
    local exit_status="${1:-0}"

    if [[ -n "${temporary_directory:-}" && -d "$temporary_directory" ]]; then
        "$CMD_RM" -rf "$temporary_directory" || exit_status=1
    fi
    exit "$exit_status"
}

capture_install_snapshot() {
    local path="$1"
    local snapshot_override="${2:-auto}"
    local snapshot_index="${#INSTALL_TRANSACTION_SNAPSHOT_PATHS[@]}"
    local snapshot_type
    local metadata

    [[ ! -L "$path" ]] || die "Installation path must not be a symbolic link: $path"
    INSTALL_TRANSACTION_SNAPSHOT_PATHS+=("$path")

    case "$snapshot_override" in
        auto)
            if [[ -f "$path" ]]; then
                snapshot_type="file"
            elif [[ -d "$path" ]]; then
                snapshot_type="directory"
            elif [[ -e "$path" ]]; then
                die "Installation path is not a regular file or directory: $path"
            else
                snapshot_type="absent"
            fi
            ;;
        absent)
            snapshot_type="absent"
            ;;
        lock-file|created-lock)
            [[ -f "$path" ]] || die "Installation lock is not a regular file: $path"
            snapshot_type="$snapshot_override"
            ;;
        *)
            die "Invalid installation snapshot override: $snapshot_override"
            ;;
    esac
    printf '%s\n' "$snapshot_type" >"$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.type"

    [[ "$snapshot_type" == absent ]] && return 0
    metadata="$("$CMD_STAT" -c '%U:%G:%a' "$path")" \
        || die "Unable to snapshot installation path: $path"
    printf '%s\n' "$metadata" >"$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.metadata"
    if [[ "$snapshot_type" == file || "$snapshot_type" == lock-file || "$snapshot_type" == created-lock ]]; then
        "$CMD_CP" -p "$path" "$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.data" \
            || die "Unable to snapshot installation file: $path"
    fi
}

restore_install_snapshot_metadata() {
    local path="$1"
    local metadata="$2"
    local owner="${metadata%%:*}"
    local group_and_mode="${metadata#*:}"
    local group="${group_and_mode%%:*}"
    local mode="${metadata##*:}"
    local restore_status=0

    "$CMD_CHOWN" "$owner:$group" "$path" || restore_status=1
    "$CMD_CHMOD" "$mode" "$path" || restore_status=1
    return "$restore_status"
}

restore_install_snapshot_entry() {
    local snapshot_index="$1"
    local path="${INSTALL_TRANSACTION_SNAPSHOT_PATHS[$snapshot_index]}"
    local snapshot_type
    local metadata
    local restore_status=0

    snapshot_type="$(<"$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.type")"
    case "$snapshot_type" in
        absent)
            if [[ -L "$path" || -f "$path" ]]; then
                "$CMD_UNLINK" "$path" || restore_status=1
            elif [[ -d "$path" ]]; then
                "$CMD_RMDIR" "$path" || restore_status=1
            elif [[ -e "$path" ]]; then
                restore_status=1
            fi
            ;;
        file)
            if [[ -L "$path" || -f "$path" ]]; then
                "$CMD_UNLINK" "$path" || restore_status=1
            elif [[ -e "$path" ]]; then
                restore_status=1
            fi
            if (( restore_status == 0 )); then
                "$CMD_CP" -p "$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.data" "$path" \
                    || restore_status=1
            fi
            if (( restore_status == 0 )); then
                metadata="$(<"$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.metadata")"
                restore_install_snapshot_metadata "$path" "$metadata" || restore_status=1
            fi
            ;;
        lock-file|created-lock)
            # Keep the inode that is held by the transaction flock.  Replacing
            # this pathname with unlink+copy would leave a new, unlocked inode
            # visible before the descriptor is released.
            if [[ ! -f "$path" || -L "$path" ]]; then
                restore_status=1
            fi
            if (( restore_status == 0 )); then
                if ! "$CMD_CMP" -s "$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.data" "$path"; then
                    "$CMD_CAT" "$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.data" >"$path" \
                        || restore_status=1
                fi
            fi
            if (( restore_status == 0 )); then
                metadata="$(<"$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.metadata")"
                restore_install_snapshot_metadata "$path" "$metadata" || restore_status=1
            fi
            ;;
        directory)
            if [[ -L "$path" ]]; then
                "$CMD_UNLINK" "$path" || restore_status=1
            elif [[ -e "$path" && ! -d "$path" ]]; then
                restore_status=1
            elif [[ ! -e "$path" ]]; then
                "$CMD_MKDIR" -p "$path" || restore_status=1
            fi
            if (( restore_status == 0 )); then
                metadata="$(<"$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.metadata")"
                restore_install_snapshot_metadata "$path" "$metadata" || restore_status=1
            fi
            ;;
        *)
            restore_status=1
            ;;
    esac
    return "$restore_status"
}

verify_install_snapshot_entry() {
    local snapshot_index="$1"
    local path="${INSTALL_TRANSACTION_SNAPSHOT_PATHS[$snapshot_index]}"
    local snapshot_type
    local actual_metadata
    local expected_metadata

    snapshot_type="$(<"$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.type")"
    case "$snapshot_type" in
        absent)
            [[ ! -e "$path" && ! -L "$path" ]]
            ;;
        file)
            [[ -f "$path" && ! -L "$path" ]] \
                && "$CMD_CMP" -s "$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.data" "$path" \
                && expected_metadata="$(<"$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.metadata")" \
                && actual_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$path")" \
                && [[ "$actual_metadata" == "$expected_metadata" ]]
            ;;
        lock-file|created-lock)
            [[ -f "$path" && ! -L "$path" ]] \
                && "$CMD_CMP" -s "$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.data" "$path" \
                && expected_metadata="$(<"$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.metadata")" \
                && actual_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$path")" \
                && [[ "$actual_metadata" == "$expected_metadata" ]]
            ;;
        directory)
            [[ -d "$path" && ! -L "$path" ]] \
                && expected_metadata="$(<"$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/$snapshot_index.metadata")" \
                && actual_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$path")" \
                && [[ "$actual_metadata" == "$expected_metadata" ]]
            ;;
        *)
            return 1
            ;;
    esac
}

verify_install_transaction_rollback() {
    local snapshot_index
    local path
    local snapshot_type

    for snapshot_index in "${!INSTALL_TRANSACTION_SNAPSHOT_PATHS[@]}"; do
        verify_install_snapshot_entry "$snapshot_index" || return 1
    done

    path="$INSTALLED_OPERATOR"
    snapshot_type="$(<"$INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY/0.type")"
    if [[ "$snapshot_type" == file ]]; then
        "$CMD_BASH" -n "$path" || return 1
    fi
}

rollback_install_transaction() {
    local rollback_status=0
    local snapshot_index

    set +e
    for (( snapshot_index = ${#INSTALL_TRANSACTION_SNAPSHOT_PATHS[@]} - 1; snapshot_index >= 0; snapshot_index-- )); do
        restore_install_snapshot_entry "$snapshot_index" || rollback_status=1
    done
    verify_install_transaction_rollback || rollback_status=1
    return "$rollback_status"
}

install_transaction_exit() {
    local exit_status="${1:-0}"

    trap - EXIT
    if [[ "${INSTALL_TRANSACTION_ACTIVE:-false}" == true ]]; then
        INSTALL_TRANSACTION_ACTIVE=false
        if rollback_install_transaction; then
            echo "Installation failed; the previous CI operator and route states were restored." >&2
        else
            echo "Installation failed and transaction rollback verification failed." >&2
            exit_status=1
        fi
    fi
    release_install_transaction_locks
    if [[ -n "${temporary_directory:-}" && -d "$temporary_directory" ]]; then
        "$CMD_RM" -rf "$temporary_directory" || exit_status=1
    fi
    exit "$exit_status"
}

installed_bundle_exists() {
    [[ -e "$INSTALLED_OPERATOR" || -L "$INSTALLED_OPERATOR" \
        || -e "$ARTIFACT_DIRECTORY" || -L "$ARTIFACT_DIRECTORY" ]]
}

installed_bundle_matches_candidates() {
    local operator_candidate="$1"
    local deploy_candidate="$2"
    local rollback_candidate="$3"
    local compose_candidate="$4"

    [[ -f "$INSTALLED_OPERATOR" && ! -L "$INSTALLED_OPERATOR" \
        && -d "$ARTIFACT_DIRECTORY" && ! -L "$ARTIFACT_DIRECTORY" \
        && -f "$INSTALLED_OPERATOR_ARTIFACT" && ! -L "$INSTALLED_OPERATOR_ARTIFACT" \
        && -f "$INSTALLED_DEPLOY_ARTIFACT" && ! -L "$INSTALLED_DEPLOY_ARTIFACT" \
        && -f "$INSTALLED_ROLLBACK_ARTIFACT" && ! -L "$INSTALLED_ROLLBACK_ARTIFACT" \
        && -f "$INSTALLED_COMPOSE_ARTIFACT" && ! -L "$INSTALLED_COMPOSE_ARTIFACT" ]] \
        || return 1
    "$CMD_CMP" -s "$operator_candidate" "$INSTALLED_OPERATOR" \
        && "$CMD_CMP" -s "$operator_candidate" "$INSTALLED_OPERATOR_ARTIFACT" \
        && "$CMD_CMP" -s "$deploy_candidate" "$INSTALLED_DEPLOY_ARTIFACT" \
        && "$CMD_CMP" -s "$rollback_candidate" "$INSTALLED_ROLLBACK_ARTIFACT" \
        && "$CMD_CMP" -s "$compose_candidate" "$INSTALLED_COMPOSE_ARTIFACT"
}

install_operator() (
    local replace_existing="${1:-}"
    local temporary_directory
    local operator_candidate
    local deploy_candidate
    local rollback_candidate
    local compose_candidate
    local artifact_parent_directory

    [[ -z "$replace_existing" || "$replace_existing" == "--replace" ]] || {
        usage
        return 2
    }

    require_root
    verify_host_prerequisites
    temporary_directory="$("$CMD_MKTEMP" -d /var/tmp/babyjamjam-ci-operator.XXXXXX)"
    operator_candidate="$temporary_directory/operator"
    deploy_candidate="$temporary_directory/deploy"
    rollback_candidate="$temporary_directory/rollback"
    compose_candidate="$temporary_directory/compose"
    artifact_parent_directory="$("$CMD_DIRNAME" "$ARTIFACT_DIRECTORY")"
    trap 'cleanup_install_operator_temp "$?"' EXIT

    "$CMD_INSTALL" -o root -g root -m 0750 "$SOURCE_OPERATOR" "$operator_candidate"
    "$CMD_INSTALL" -o root -g root -m 0750 "$SOURCE_DEPLOY_HELPER" "$deploy_candidate"
    "$CMD_INSTALL" -o root -g root -m 0750 "$SOURCE_ROLLBACK_HELPER" "$rollback_candidate"
    "$CMD_INSTALL" -o root -g root -m 0640 "$SOURCE_COMPOSE_FILE" "$compose_candidate"

    if [[ "$replace_existing" != "--replace" ]] && installed_bundle_exists; then
        installed_bundle_matches_candidates \
            "$operator_candidate" "$deploy_candidate" "$rollback_candidate" "$compose_candidate" \
            || die "The CI operator already exists; inspect it before using install --replace."
    fi

    INSTALL_TRANSACTION_SNAPSHOT_DIRECTORY="$("$CMD_MKTEMP" -d "$temporary_directory/snapshot.XXXXXX")"
    if ! prepare_install_transaction_locks; then
        cleanup_prepared_install_transaction_locks
        return 1
    fi
    trap 'install_lock_prepare_exit "$?"' EXIT

    # Recheck after acquiring both environment locks.  A concurrent
    # authorized installer may have changed the protected bundle after the
    # early comparison; plain install must not overwrite that newer bundle.
    if [[ "$replace_existing" != "--replace" ]] && installed_bundle_exists; then
        if ! installed_bundle_matches_candidates \
            "$operator_candidate" "$deploy_candidate" "$rollback_candidate" "$compose_candidate"; then
            die "The CI operator already exists; inspect it before using install --replace."
        fi
    fi

    INSTALL_TRANSACTION_SNAPSHOT_PATHS=()
    capture_install_snapshot "$INSTALLED_OPERATOR"
    capture_install_snapshot "$artifact_parent_directory"
    capture_install_snapshot "$ARTIFACT_DIRECTORY"
    capture_install_snapshot "$INSTALLED_OPERATOR_ARTIFACT"
    capture_install_snapshot "$INSTALLED_DEPLOY_ARTIFACT"
    capture_install_snapshot "$INSTALLED_ROLLBACK_ARTIFACT"
    capture_install_snapshot "$INSTALLED_COMPOSE_ARTIFACT"
    capture_install_snapshot "$LOG_DIRECTORY"
    capture_install_snapshot "$ROUTE_STATE_ROOT"
    capture_install_snapshot "$ROUTE_STATE_ROOT/preview"
    capture_install_snapshot "$ROUTE_STATE_ROOT/production"
    capture_install_snapshot "$ROUTE_STATE_ROOT/preview/$ROUTE_STATE_FILE_NAME"
    capture_install_snapshot "$ROUTE_STATE_ROOT/production/$ROUTE_STATE_FILE_NAME"
    if [[ "$INSTALL_TRANSACTION_PREEXISTING_PREVIEW_LOCK" == true ]]; then
        capture_install_snapshot "$STATE_ROOT/preview/operator.lock" lock-file
    else
        capture_install_snapshot "$STATE_ROOT/preview/operator.lock" created-lock
    fi
    if [[ "$INSTALL_TRANSACTION_PREEXISTING_PRODUCTION_LOCK" == true ]]; then
        capture_install_snapshot "$STATE_ROOT/production/operator.lock" lock-file
    else
        capture_install_snapshot "$STATE_ROOT/production/operator.lock" created-lock
    fi
    INSTALL_TRANSACTION_ACTIVE=true
    trap 'install_transaction_exit "$?"' EXIT

    if ! ensure_deployment_locks true; then
        return 1
    fi
    if ! "$CMD_INSTALL" -d -o root -g root -m 0700 "$LOG_DIRECTORY"; then
        return 1
    fi
    if [[ ! -e "$artifact_parent_directory" ]]; then
        if ! "$CMD_INSTALL" -d -o root -g root -m 0755 "$artifact_parent_directory"; then
            return 1
        fi
    elif [[ ! -d "$artifact_parent_directory" || -L "$artifact_parent_directory" ]]; then
        return 1
    fi
    if ! "$CMD_INSTALL" -d -o root -g root -m 0700 "$ARTIFACT_DIRECTORY"; then
        return 1
    fi
    if ! "$CMD_INSTALL" -o root -g root -m 0750 "$operator_candidate" "$INSTALLED_OPERATOR_ARTIFACT"; then
        return 1
    fi
    if ! "$CMD_INSTALL" -o root -g root -m 0750 "$deploy_candidate" "$INSTALLED_DEPLOY_ARTIFACT"; then
        return 1
    fi
    if ! "$CMD_INSTALL" -o root -g root -m 0750 "$rollback_candidate" "$INSTALLED_ROLLBACK_ARTIFACT"; then
        return 1
    fi
    if ! "$CMD_INSTALL" -o root -g root -m 0640 "$compose_candidate" "$INSTALLED_COMPOSE_ARTIFACT"; then
        return 1
    fi
    if ! "$CMD_INSTALL" -o root -g root -m 0750 "$operator_candidate" "$INSTALLED_OPERATOR"; then
        return 1
    fi
    if ! verify_installed_files; then
        return 1
    fi
    if ! installed_bundle_matches_candidates \
        "$operator_candidate" "$deploy_candidate" "$rollback_candidate" "$compose_candidate"; then
        return 1
    fi
    INSTALL_TRANSACTION_ACTIVE=false
)

uninstall_operator() {
    local artifact_path

    require_root
    if [[ -e "$INSTALLED_OPERATOR" ]]; then
        "$CMD_UNLINK" "$INSTALLED_OPERATOR"
    fi
    for artifact_path in \
        "$INSTALLED_OPERATOR_ARTIFACT" \
        "$INSTALLED_DEPLOY_ARTIFACT" \
        "$INSTALLED_ROLLBACK_ARTIFACT" \
        "$INSTALLED_COMPOSE_ARTIFACT"; do
        if [[ -f "$artifact_path" || -L "$artifact_path" ]]; then
            "$CMD_UNLINK" "$artifact_path"
        elif [[ -e "$artifact_path" ]]; then
            die "Refusing to remove a non-file operator artifact."
        fi
    done
    if [[ -d "$ARTIFACT_DIRECTORY" && ! -L "$ARTIFACT_DIRECTORY" ]]; then
        "$CMD_RMDIR" "$ARTIFACT_DIRECTORY"
    elif [[ -e "$ARTIFACT_DIRECTORY" || -L "$ARTIFACT_DIRECTORY" ]]; then
        die "Refusing to remove an invalid operator artifact directory."
    fi
    echo "Removed the Lightsail CI operator. Root-only diagnostic logs were retained."
}

main() {
    case "${1:-}" in
        install)
            [[ "$#" -le 2 ]] || {
                usage
                return 2
            }
            install_operator "${2:-}"
            ;;
        check)
            [[ "$#" -eq 1 ]] || {
                usage
                return 2
            }
            require_root
            verify_host_prerequisites
            verify_installed_files
            ;;
        uninstall)
            [[ "$#" -eq 1 ]] || {
                usage
                return 2
            }
            uninstall_operator
            ;;
        *)
            usage
            return 2
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
