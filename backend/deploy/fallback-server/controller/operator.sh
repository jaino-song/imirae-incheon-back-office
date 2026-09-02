#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

readonly CONTROLLER_BUNDLE_ROOT="/usr/local/libexec/babyjamjam-failover-controller"
readonly CONTROLLER_OPERATOR="$CONTROLLER_BUNDLE_ROOT/operator.mjs"

[[ -f "$CONTROLLER_OPERATOR" && ! -L "$CONTROLLER_OPERATOR" ]] || {
    printf '%s\n' 'controller_operation=failed' >&2
    exit 1
}

exec /usr/bin/env node "$CONTROLLER_OPERATOR" "$@"
