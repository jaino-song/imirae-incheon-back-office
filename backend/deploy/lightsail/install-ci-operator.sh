#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly SOURCE_OPERATOR="$SCRIPT_DIR/ci-operator.sh"
readonly INSTALLED_OPERATOR="/usr/local/sbin/babyjamjam-ci-operator"
readonly LOG_DIRECTORY="/var/log/babyjamjam-deploy"
readonly DEPLOY_USER="ubuntu"

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

    for required_command in /usr/sbin/runuser /usr/bin/docker /usr/bin/git /usr/bin/curl /usr/bin/flock; do
        [[ -x "$required_command" ]] || die "Required command is missing: $required_command"
    done

    [[ -r "$SOURCE_OPERATOR" ]] || die "Missing operator source: $SOURCE_OPERATOR"
    /bin/bash -n "$SOURCE_OPERATOR"
}

verify_installed_files() {
    local log_metadata
    local operator_metadata

    [[ -x "$INSTALLED_OPERATOR" ]] || die "Installed CI operator is missing."
    [[ -d "$LOG_DIRECTORY" ]] || die "CI deployment log directory is missing."

    operator_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$INSTALLED_OPERATOR")"
    log_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$LOG_DIRECTORY")"
    [[ "$operator_metadata" == "root:root:750" ]] \
        || die "Unexpected CI operator ownership or mode: $operator_metadata"
    [[ "$log_metadata" == "root:root:700" ]] \
        || die "Unexpected CI log directory ownership or mode: $log_metadata"

    /bin/bash -n "$INSTALLED_OPERATOR"
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
    temporary_directory="$(/usr/bin/mktemp -d /var/tmp/babyjamjam-ci-operator.XXXXXX)"
    operator_candidate="$temporary_directory/operator"
    trap '/bin/rm -rf "$temporary_directory"' EXIT

    /usr/bin/install -o root -g root -m 0750 "$SOURCE_OPERATOR" "$operator_candidate"

    if [[ -e "$INSTALLED_OPERATOR" ]]; then
        had_operator=true
    fi

    if [[ "$replace_existing" != "--replace" && "$had_operator" == "true" ]]; then
        if /usr/bin/cmp -s "$operator_candidate" "$INSTALLED_OPERATOR"; then
            /usr/bin/install -d -o root -g root -m 0700 "$LOG_DIRECTORY"
            verify_installed_files
            return 0
        fi
        die "The CI operator already exists; inspect it before using install --replace."
    fi

    if [[ "$had_operator" == "true" ]]; then
        /bin/cp -p "$INSTALLED_OPERATOR" "$temporary_directory/operator.previous"
    fi

    /usr/bin/install -d -o root -g root -m 0700 "$LOG_DIRECTORY"
    /usr/bin/install -o root -g root -m 0750 "$operator_candidate" "$INSTALLED_OPERATOR"

    if ! (verify_installed_files); then
        if [[ "$had_operator" == "true" ]]; then
            /usr/bin/install -o root -g root -m 0750 \
                "$temporary_directory/operator.previous" "$INSTALLED_OPERATOR"
        else
            /usr/bin/unlink "$INSTALLED_OPERATOR" 2>/dev/null || true
        fi
        die "Installation verification failed and the previous CI operator was restored."
    fi
)

uninstall_operator() {
    require_root
    if [[ -e "$INSTALLED_OPERATOR" ]]; then
        /usr/bin/unlink "$INSTALLED_OPERATOR"
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
