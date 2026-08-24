#!/bin/bash

set -Eeuo pipefail

readonly INSTALLED_OPERATOR="/usr/local/sbin/babyjamjam-preview-operator"
readonly SUDOERS_FILE="/etc/sudoers.d/babyjamjam-preview-operator"

usage() {
    cat >&2 <<'EOF'
Usage:
  install-operator.sh install
  install-operator.sh check
  install-operator.sh uninstall
EOF
}

die() {
    echo "$*" >&2
    exit 1
}

require_root() {
    [[ "$EUID" -eq 0 ]] || die "Run this command as root."
}

retired() {
    die "The legacy preview operator is retired; use install-ci-operator.sh for the root-only CI operator."
}

uninstall_operator() {
    require_root
    /bin/rm -f "$SUDOERS_FILE" "$INSTALLED_OPERATOR"
    echo "Removed the retired Lightsail preview operator command and sudoers rule."
}

main() {
    case "${1:-}" in
        install|check)
            [[ "$#" -eq 1 ]] || {
                usage
                return 2
            }
            retired
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
