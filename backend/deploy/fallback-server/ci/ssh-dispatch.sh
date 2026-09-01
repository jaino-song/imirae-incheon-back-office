#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
readonly DEPLOYER="/usr/local/sbin/babyjamjam-fallback-ci-deployer"
export PATH="$SAFE_PATH"

die() {
    echo "The requested Fallback CI operation is not allowed." >&2
    exit 1
}

readonly original_command="${SSH_ORIGINAL_COMMAND:-}"
case "$original_command" in
    status)
        exec /usr/bin/sudo -n "$DEPLOYER" status
        ;;
    replace\ *)
        if [[ "$original_command" =~ ^replace\ ([0-9a-f]{40})\ (sha256:[0-9a-f]{64})$ ]]; then
            exec /usr/bin/sudo -n "$DEPLOYER" replace "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
        fi
        die
        ;;
    *)
        die
        ;;
esac
