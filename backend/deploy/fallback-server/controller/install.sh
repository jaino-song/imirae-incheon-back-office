#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly BUNDLE_ROOT="/usr/local/libexec/babyjamjam-failover-controller"
readonly CLI_PATH="/usr/local/sbin/babyjamjam-failover-controller"
readonly CONTROLLER_ENV_PATH="/opt/babyjamjam-fallback-server/controller.env"
readonly STATE_ROOT="/opt/babyjamjam-fallback-server"
readonly STATE_DIRECTORY="$STATE_ROOT/state"
readonly UNIT_SOURCE="$SCRIPT_ROOT/systemd/babyjamjam-failover-controller.service"
readonly UNIT_PATH="/etc/systemd/system/babyjamjam-failover-controller.service"
readonly RUNTIME_MODULES=(
    config.mjs
    fallback-status.mjs
    main.mjs
    policy.mjs
    probes.mjs
    receiver.mjs
    security.mjs
    server.mjs
    state-store.mjs
    vercel-dns-client.mjs
    worker.mjs
)

die() {
    printf '%s\n' "$1" >&2
    exit 1
}

[[ "$EUID" -eq 0 ]] || die "Controller installer must run as root."

assert_regular_source() {
    local path="$1"
    [[ -f "$path" && ! -L "$path" ]] || die "Controller source file is missing or unsafe."
}

assert_not_symlink() {
    local path="$1"
    [[ ! -L "$path" ]] || die "Controller installation path is a symbolic link."
}

hash_file() {
    local output
    output="$(sha256sum "$1" 2>/dev/null)" || die "Unable to hash controller artifact."
    output="${output%% *}"
    [[ "$output" =~ ^[0-9a-f]{64}$ ]] || die "Unable to hash controller artifact."
    printf '%s\n' "$output"
}

validate_node() {
    local node_bin
    local node_major

    node_bin="$(command -v node 2>/dev/null || true)"
    [[ -n "$node_bin" && -x "$node_bin" ]] || die "Node.js 20 or newer is required."
    node_major="$("$node_bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
    [[ "$node_major" =~ ^[0-9]+$ ]] || die "Node.js 20 or newer is required."
    (( node_major >= 20 )) || die "Node.js 20 or newer is required."
}

validate_existing_env() {
    local metadata

    if [[ ! -e "$CONTROLLER_ENV_PATH" && ! -L "$CONTROLLER_ENV_PATH" ]]; then
        return 0
    fi
    [[ -f "$CONTROLLER_ENV_PATH" && ! -L "$CONTROLLER_ENV_PATH" ]] \
        || die "The controller environment file is missing or unsafe."
    metadata="$(stat -c '%u:%g:%a' "$CONTROLLER_ENV_PATH" 2>/dev/null)" \
        || die "The controller environment file metadata is unavailable."
    [[ "$metadata" == "0:0:600" ]] || die "The controller environment file must be root-owned mode 600."
}

validate_node
[[ ! -L "$SCRIPT_ROOT" ]] || die "The controller source directory is a symbolic link."
assert_regular_source "$SCRIPT_ROOT/operator.mjs"
assert_regular_source "$SCRIPT_ROOT/operator.sh"
assert_regular_source "$SCRIPT_ROOT/controller.env.tpl"
assert_regular_source "$UNIT_SOURCE"
for module in "${RUNTIME_MODULES[@]}"; do
    assert_regular_source "$SCRIPT_ROOT/$module"
done
validate_existing_env

for path in "$BUNDLE_ROOT" "$BUNDLE_ROOT/systemd" "$CLI_PATH" "$UNIT_PATH" "$STATE_ROOT" "$STATE_DIRECTORY"; do
    assert_not_symlink "$path"
done

install -d -o root -g root -m 700 "$BUNDLE_ROOT"
install -d -o root -g root -m 700 "$BUNDLE_ROOT/systemd"
install -d -o root -g root -m 700 "$STATE_ROOT"
install -d -o root -g root -m 700 "$STATE_DIRECTORY"

for module in "${RUNTIME_MODULES[@]}"; do
    destination="$BUNDLE_ROOT/$module"
    assert_not_symlink "$destination"
    install -o root -g root -m 640 "$SCRIPT_ROOT/$module" "$destination"
done
assert_not_symlink "$BUNDLE_ROOT/operator.mjs"
assert_not_symlink "$BUNDLE_ROOT/operator.sh"
assert_not_symlink "$BUNDLE_ROOT/controller.env.tpl"
assert_not_symlink "$BUNDLE_ROOT/systemd/babyjamjam-failover-controller.service"
install -o root -g root -m 750 "$SCRIPT_ROOT/operator.mjs" "$BUNDLE_ROOT/operator.mjs"
install -o root -g root -m 750 "$SCRIPT_ROOT/operator.sh" "$BUNDLE_ROOT/operator.sh"
install -o root -g root -m 640 "$SCRIPT_ROOT/controller.env.tpl" "$BUNDLE_ROOT/controller.env.tpl"
install -o root -g root -m 640 "$UNIT_SOURCE" "$BUNDLE_ROOT/systemd/babyjamjam-failover-controller.service"
install -o root -g root -m 750 "$SCRIPT_ROOT/operator.sh" "$CLI_PATH"
install -o root -g root -m 640 "$UNIT_SOURCE" "$UNIT_PATH"

manifest="$(mktemp "$BUNDLE_ROOT/.bundle.manifest.XXXXXX")"
{
    for module in "${RUNTIME_MODULES[@]}"; do
        printf '%s=%s\n' "$module" "$(hash_file "$BUNDLE_ROOT/$module")"
    done
    printf '%s=%s\n' "operator.mjs" "$(hash_file "$BUNDLE_ROOT/operator.mjs")"
    printf '%s=%s\n' "operator.sh" "$(hash_file "$BUNDLE_ROOT/operator.sh")"
    printf '%s=%s\n' "controller.env.tpl" "$(hash_file "$BUNDLE_ROOT/controller.env.tpl")"
    printf '%s=%s\n' \
        "systemd/babyjamjam-failover-controller.service" \
        "$(hash_file "$BUNDLE_ROOT/systemd/babyjamjam-failover-controller.service")"
} >"$manifest"
chown root:root "$manifest"
chmod 640 "$manifest"
mv -f "$manifest" "$BUNDLE_ROOT/bundle.manifest"

printf '%s\n' \
    "Fallback controller bundle installed." \
    "Service is not enabled or started; provision $CONTROLLER_ENV_PATH separately."
