#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly SOURCE_OPERATOR="$SCRIPT_DIR/ci-operator.sh"
#
# These are fixed production defaults.  They remain mutable only after this
# file is sourced, which lets the isolated shell harness inject temporary
# paths and command wrappers without making the executable read test values
# from its environment.
INSTALLED_OPERATOR="/usr/local/sbin/babyjamjam-ci-operator"
LOG_DIRECTORY="/var/log/babyjamjam-deploy"
STATE_ROOT="/opt/babyjamjam/environments"
ROUTE_STATE_ROOT="/opt/babyjamjam/db-failover-state"
readonly ROUTE_STATE_FILE_NAME="db-route-state"
readonly DEPLOY_USER="ubuntu"
readonly DEPLOY_GROUP="ubuntu"

CMD_BASH="/bin/bash"
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
CMD_MV="/usr/bin/mv"
CMD_RM="/usr/bin/rm"
CMD_RUNUSER="/usr/sbin/runuser"
CMD_STAT="/usr/bin/stat"
CMD_TIMEOUT="/usr/bin/timeout"
CMD_UNLINK="/usr/bin/unlink"

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    readonly INSTALLED_OPERATOR LOG_DIRECTORY STATE_ROOT ROUTE_STATE_ROOT
    readonly CMD_BASH CMD_CHMOD CMD_CHOWN CMD_CMP CMD_CP CMD_DATE CMD_DIRNAME
    readonly CMD_DOCKER CMD_GIT CMD_CURL CMD_FLOCK CMD_INSTALL CMD_MKTEMP CMD_MV
    readonly CMD_RM CMD_RUNUSER CMD_STAT CMD_TIMEOUT CMD_UNLINK
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

    /usr/bin/id "$DEPLOY_USER" >/dev/null 2>&1 || die "Missing deploy user: $DEPLOY_USER"
    deploy_groups="$(/usr/bin/id -nG "$DEPLOY_USER")"
    group_list_contains docker "$deploy_groups" || die "$DEPLOY_USER must belong to the docker group."

    for required_command in "$CMD_RUNUSER" "$CMD_DOCKER" "$CMD_GIT" "$CMD_CURL" "$CMD_FLOCK" "$CMD_TIMEOUT" "$CMD_STAT" "$CMD_DATE" "$CMD_MKTEMP" "$CMD_DIRNAME"; do
        [[ -x "$required_command" ]] || die "Required command is missing: $required_command"
    done

    [[ -r "$SOURCE_OPERATOR" ]] || die "Missing operator source: $SOURCE_OPERATOR"
    "$CMD_BASH" -n "$SOURCE_OPERATOR"
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

validate_route_state_file() {
    local route_state_file="$1"
    local state_key
    local state_value
    local state_line
    local seen_state_keys=" "
    local required_key

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

ensure_route_state_file() {
    local environment="$1"
    local route_state_directory="$ROUTE_STATE_ROOT/$environment"
    local route_state_file="$route_state_directory/$ROUTE_STATE_FILE_NAME"
    local temporary_file
    local route_state_metadata

    ensure_route_state_directory "$environment"
    validate_no_symlink_path "$route_state_file"
    [[ ! -L "$route_state_file" ]] || die "Route state file must not be a symbolic link: $route_state_file"
    if [[ -e "$route_state_file" ]]; then
        [[ -f "$route_state_file" ]] || die "Route state file is not regular: $route_state_file"
        route_state_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$route_state_file")"
        [[ "$route_state_metadata" == "root:root:600" ]] \
            || die "Unexpected route state ownership or mode: $route_state_metadata"
        validate_route_state_file "$route_state_file"
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
    local environment
    local lock_file
    local state_directory

    for environment in preview production; do
        state_directory="$STATE_ROOT/$environment"
        lock_file="$state_directory/operator.lock"
        [[ -d "$state_directory" ]] || die "Deployment state directory is missing: $state_directory"
        [[ ! -L "$lock_file" ]] || die "Deployment lock must not be a symbolic link: $lock_file"
        if [[ ! -e "$lock_file" ]]; then
            "$CMD_INSTALL" -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0640 /dev/null "$lock_file"
        fi
        [[ -f "$lock_file" ]] || die "Deployment lock is not a regular file: $lock_file"
        "$CMD_CHOWN" "$DEPLOY_USER:$DEPLOY_GROUP" "$lock_file"
        "$CMD_CHMOD" 0640 "$lock_file"
        ensure_route_state_file "$environment"
    done
}

verify_installed_files() {
    local environment
    local lock_file
    local lock_metadata
    local log_metadata
    local operator_metadata
    local route_state_directory
    local route_state_directory_metadata
    local route_state_file
    local route_state_root_metadata
    local route_state_metadata

    [[ -x "$INSTALLED_OPERATOR" ]] || die "Installed CI operator is missing."
    [[ -d "$LOG_DIRECTORY" ]] || die "CI deployment log directory is missing."

    operator_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$INSTALLED_OPERATOR")"
    log_metadata="$("$CMD_STAT" -c '%U:%G:%a' "$LOG_DIRECTORY")"
    [[ "$operator_metadata" == "root:root:750" ]] \
        || die "Unexpected CI operator ownership or mode: $operator_metadata"
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
        [[ "$lock_metadata" == "ubuntu:ubuntu:640" ]] \
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
    done

    "$CMD_BASH" -n "$INSTALLED_OPERATOR"
    echo "Lightsail CI operator installation is valid."
}

install_operator() (
    local replace_existing="${1:-}"
    local temporary_directory
    local operator_candidate
    local had_operator=false

    [[ -z "$replace_existing" || "$replace_existing" == "--replace" ]] || {
        usage
        return 2
    }

    require_root
    verify_host_prerequisites
    ensure_deployment_locks
    temporary_directory="$("$CMD_MKTEMP" -d /var/tmp/babyjamjam-ci-operator.XXXXXX)"
    operator_candidate="$temporary_directory/operator"
    trap '"$CMD_RM" -rf "$temporary_directory"' EXIT

    "$CMD_INSTALL" -o root -g root -m 0750 "$SOURCE_OPERATOR" "$operator_candidate"

    if [[ -e "$INSTALLED_OPERATOR" ]]; then
        had_operator=true
    fi

    if [[ "$replace_existing" != "--replace" && "$had_operator" == "true" ]]; then
        if "$CMD_CMP" -s "$operator_candidate" "$INSTALLED_OPERATOR"; then
            "$CMD_INSTALL" -d -o root -g root -m 0700 "$LOG_DIRECTORY"
            verify_installed_files
            return 0
        fi
        die "The CI operator already exists; inspect it before using install --replace."
    fi

    if [[ "$had_operator" == "true" ]]; then
        "$CMD_CP" -p "$INSTALLED_OPERATOR" "$temporary_directory/operator.previous"
    fi

    "$CMD_INSTALL" -d -o root -g root -m 0700 "$LOG_DIRECTORY"
    "$CMD_INSTALL" -o root -g root -m 0750 "$operator_candidate" "$INSTALLED_OPERATOR"

    if ! (verify_installed_files); then
        if [[ "$had_operator" == "true" ]]; then
            "$CMD_INSTALL" -o root -g root -m 0750 \
                "$temporary_directory/operator.previous" "$INSTALLED_OPERATOR"
        else
            "$CMD_UNLINK" "$INSTALLED_OPERATOR" 2>/dev/null || true
        fi
        die "Installation verification failed and the previous CI operator was restored."
    fi
)

uninstall_operator() {
    require_root
    if [[ -e "$INSTALLED_OPERATOR" ]]; then
        "$CMD_UNLINK" "$INSTALLED_OPERATOR"
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
