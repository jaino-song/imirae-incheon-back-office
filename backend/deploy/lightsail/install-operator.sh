#!/bin/bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SOURCE_OPERATOR="$SCRIPT_DIR/operator-preview.sh"
readonly INSTALLED_OPERATOR="/usr/local/sbin/babyjamjam-preview-operator"
readonly SUDOERS_FILE="/etc/sudoers.d/babyjamjam-preview-operator"
readonly OPERATOR_USER="agent-lightsail-operator"
readonly DEPLOY_USER="ubuntu"

usage() {
    cat >&2 <<'EOF'
Usage:
  install-operator.sh install [--replace]
  install-operator.sh check
  install-operator.sh uninstall
EOF
}

die() {
    echo "$*" >&2
    exit 1
}

render_sudoers() {
    cat <<EOF
Cmnd_Alias BABYJAMJAM_PREVIEW_OPERATOR = $INSTALLED_OPERATOR
$OPERATOR_USER ALL=($DEPLOY_USER) NOPASSWD: NOSETENV: BABYJAMJAM_PREVIEW_OPERATOR
EOF
}

require_root() {
    [[ "$EUID" -eq 0 ]] || die "Run this command as root."
}

group_list_contains() {
    local wanted_group="$1"
    local group_list="$2"

    [[ " $group_list " == *" $wanted_group "* ]]
}

validate_group_membership() {
    local operator_groups="$1"
    local deploy_groups="$2"

    group_list_contains docker "$deploy_groups" || die "$DEPLOY_USER must belong to the docker group."
    if group_list_contains docker "$operator_groups"; then
        die "$OPERATOR_USER must not belong to the docker group."
    fi
}

verify_host_prerequisites() {
    local deploy_groups
    local operator_groups

    /usr/bin/id "$OPERATOR_USER" >/dev/null 2>&1 || die "Missing operator user: $OPERATOR_USER"
    /usr/bin/id "$DEPLOY_USER" >/dev/null 2>&1 || die "Missing deploy user: $DEPLOY_USER"
    operator_groups="$(/usr/bin/id -nG "$OPERATOR_USER")"
    deploy_groups="$(/usr/bin/id -nG "$DEPLOY_USER")"
    validate_group_membership "$operator_groups" "$deploy_groups"
    [[ -x /usr/sbin/visudo ]] || die "visudo is required."
    [[ -x /usr/sbin/runuser ]] || die "runuser is required."
    [[ -x /usr/bin/sudo ]] || die "sudo is required."
    [[ -r "$SOURCE_OPERATOR" ]] || die "Missing operator source: $SOURCE_OPERATOR"
    /bin/bash -n "$SOURCE_OPERATOR"
}

verify_installed_files() {
    local operator_metadata
    local sudoers_metadata

    [[ -x "$INSTALLED_OPERATOR" ]] || die "Installed operator is missing."
    [[ -r "$SUDOERS_FILE" ]] || die "Operator sudoers file is missing."

    operator_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$INSTALLED_OPERATOR")"
    sudoers_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$SUDOERS_FILE")"
    [[ "$operator_metadata" == "root:root:755" ]] || die "Unexpected operator ownership or mode: $operator_metadata"
    [[ "$sudoers_metadata" == "root:root:440" ]] || die "Unexpected sudoers ownership or mode: $sudoers_metadata"

    /usr/sbin/visudo -cf "$SUDOERS_FILE" >/dev/null
    if /usr/sbin/runuser -u "$OPERATOR_USER" -- /usr/bin/sudo -n true >/dev/null 2>&1; then
        die "$OPERATOR_USER has unexpected general passwordless sudo access."
    fi
    /usr/sbin/runuser -u "$OPERATOR_USER" -- \
        /usr/bin/sudo -n -u "$DEPLOY_USER" "$INSTALLED_OPERATOR" status >/dev/null
    echo "Lightsail preview operator installation is valid."
}

install_operator() (
    local replace_existing="${1:-}"
    local temporary_directory
    local operator_candidate
    local sudoers_candidate
    local had_operator=false
    local had_sudoers=false

    [[ -z "$replace_existing" || "$replace_existing" == "--replace" ]] || {
        usage
        return 2
    }

    require_root
    verify_host_prerequisites
    temporary_directory="$(/usr/bin/mktemp -d /var/tmp/babyjamjam-preview-operator.XXXXXX)"
    operator_candidate="$temporary_directory/operator"
    sudoers_candidate="$temporary_directory/sudoers"
    trap '/bin/rm -rf "$temporary_directory"' EXIT

    /usr/bin/install -o root -g root -m 0755 "$SOURCE_OPERATOR" "$operator_candidate"
    render_sudoers >"$sudoers_candidate"
    /bin/chown root:root "$sudoers_candidate"
    /bin/chmod 0440 "$sudoers_candidate"
    /usr/sbin/visudo -cf "$sudoers_candidate" >/dev/null

    if [[ -e "$INSTALLED_OPERATOR" ]]; then
        had_operator=true
    fi
    if [[ -e "$SUDOERS_FILE" ]]; then
        had_sudoers=true
    fi

    if [[ "$replace_existing" != "--replace" && ( "$had_operator" == "true" || "$had_sudoers" == "true" ) ]]; then
        if [[ "$had_operator" == "true" && "$had_sudoers" == "true" ]] \
            && /usr/bin/cmp -s "$operator_candidate" "$INSTALLED_OPERATOR" \
            && /usr/bin/cmp -s "$sudoers_candidate" "$SUDOERS_FILE"; then
            verify_installed_files
            return 0
        fi
        die "Operator files already exist; inspect them before using install --replace."
    fi

    if [[ "$had_operator" == "true" ]]; then
        /bin/cp -p "$INSTALLED_OPERATOR" "$temporary_directory/operator.previous"
    fi
    if [[ "$had_sudoers" == "true" ]]; then
        /bin/cp -p "$SUDOERS_FILE" "$temporary_directory/sudoers.previous"
    fi

    /usr/bin/install -o root -g root -m 0755 "$operator_candidate" "$INSTALLED_OPERATOR"
    /usr/bin/install -o root -g root -m 0440 "$sudoers_candidate" "$SUDOERS_FILE"

    if ! (verify_installed_files); then
        if [[ "$had_operator" == "true" ]]; then
            /usr/bin/install -o root -g root -m 0755 "$temporary_directory/operator.previous" "$INSTALLED_OPERATOR"
        else
            /bin/rm -f "$INSTALLED_OPERATOR"
        fi
        if [[ "$had_sudoers" == "true" ]]; then
            /usr/bin/install -o root -g root -m 0440 "$temporary_directory/sudoers.previous" "$SUDOERS_FILE"
        else
            /bin/rm -f "$SUDOERS_FILE"
        fi
        die "Installation verification failed and previous operator files were restored."
    fi
)

uninstall_operator() {
    require_root
    /bin/rm -f "$SUDOERS_FILE" "$INSTALLED_OPERATOR"
    echo "Removed the Lightsail preview operator command and sudoers rule."
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
