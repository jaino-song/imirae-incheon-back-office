#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

readonly ARTIFACT_ROOT="/usr/local/libexec/babyjamjam-covenant-standby"
readonly INSTALLED_OPERATOR="/usr/local/sbin/babyjamjam-covenant-standby"
readonly STATE_ROOT="/opt/babyjamjam-covenant"
readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

die() {
    echo "$*" >&2
    exit 1
}

sha256_file() {
    local output

    output="$(sha256sum "$1")"
    output="${output%% *}"
    [[ "$output" =~ ^[0-9a-f]{64}$ ]] || die "Unable to hash a standby artifact."
    printf '%s\n' "$output"
}

[[ "$EUID" -eq 0 ]] || die "The Covenant standby installer must run as root."
[[ -f "$SCRIPT_ROOT/operator.sh" && ! -L "$SCRIPT_ROOT/operator.sh" ]] \
    || die "The Covenant standby operator source is missing or invalid."
[[ -f "$SCRIPT_ROOT/compose.yml" && ! -L "$SCRIPT_ROOT/compose.yml" ]] \
    || die "The Covenant standby Compose source is missing or invalid."
for protected_path in "$ARTIFACT_ROOT" "$INSTALLED_OPERATOR" "$STATE_ROOT"; do
    [[ ! -L "$protected_path" ]] || die "A Covenant standby installation path is a symbolic link."
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
    "Covenant standby operator installed." \
    "Next: provision $STATE_ROOT/backend.env as root:root mode 600, then run status or deploy."
