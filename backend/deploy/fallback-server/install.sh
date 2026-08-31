#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

readonly ARTIFACT_ROOT="/usr/local/libexec/babyjamjam-fallback-server"
readonly INSTALLED_OPERATOR="/usr/local/sbin/babyjamjam-fallback-server"
readonly STATE_ROOT="/opt/babyjamjam-fallback-server"
readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

die() {
    echo "$*" >&2
    exit 1
}

sha256_file() {
    local output

    output="$(sha256sum "$1")"
    output="${output%% *}"
    [[ "$output" =~ ^[0-9a-f]{64}$ ]] || die "Unable to hash a Fallback Server artifact."
    printf '%s\n' "$output"
}

[[ "$EUID" -eq 0 ]] || die "The Fallback Server installer must run as root."
[[ -f "$SCRIPT_ROOT/operator.sh" && ! -L "$SCRIPT_ROOT/operator.sh" ]] \
    || die "The Fallback Server operator source is missing or invalid."
[[ -f "$SCRIPT_ROOT/compose.yml" && ! -L "$SCRIPT_ROOT/compose.yml" ]] \
    || die "The Fallback Server Compose source is missing or invalid."
for protected_path in "$ARTIFACT_ROOT" "$INSTALLED_OPERATOR" "$STATE_ROOT"; do
    [[ ! -L "$protected_path" ]] || die "A Fallback Server installation path is a symbolic link."
done

install -d -o root -g root -m 700 "$ARTIFACT_ROOT"
install -d -o root -g root -m 700 "$STATE_ROOT"
install -d -o root -g root -m 700 "$STATE_ROOT/state"
install -o root -g root -m 750 "$SCRIPT_ROOT/operator.sh" "$INSTALLED_OPERATOR"
install -o root -g root -m 640 "$SCRIPT_ROOT/compose.yml" "$ARTIFACT_ROOT/compose.yml"

manifest="$(mktemp "$ARTIFACT_ROOT/.bundle.manifest.XXXXXX")"
printf '%s\n' \
    "operator.sh=$(sha256_file "$INSTALLED_OPERATOR")" \
    "compose.yml=$(sha256_file "$ARTIFACT_ROOT/compose.yml")" \
    >"$manifest"
chown root:root "$manifest"
chmod 640 "$manifest"
mv -f "$manifest" "$ARTIFACT_ROOT/bundle.manifest"

printf '%s\n' \
    "Fallback Server operator installed." \
    "Next: provision $STATE_ROOT/backend.env as root:root mode 600, then run status or deploy."
