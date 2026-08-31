#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

readonly ARTIFACT_ROOT="/usr/local/libexec/babyjamjam-fallback-server"
readonly INSTALLED_OPERATOR="/usr/local/sbin/babyjamjam-fallback-server"
readonly STATE_ROOT="/opt/babyjamjam-fallback-server"
readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly IDENTITY_HELPER_SOURCE="$SCRIPT_ROOT/production-db-identity.sh"
readonly IDENTITY_HELPER_ARTIFACT="$ARTIFACT_ROOT/production-db-identity.sh"
readonly ACTIVE_COMPOSE_SOURCE="$SCRIPT_ROOT/compose.temporary-active.yml"
readonly ACTIVE_COMPOSE_ARTIFACT="$ARTIFACT_ROOT/compose.temporary-active.yml"
readonly APPROVED_DB_REF_HASH_FILE="$STATE_ROOT/approved-production-db-ref.sha256"

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

validate_existing_approval() {
    local metadata

    if [[ ! -e "$APPROVED_DB_REF_HASH_FILE" && ! -L "$APPROVED_DB_REF_HASH_FILE" ]]; then
        return 0
    fi
    [[ -f "$APPROVED_DB_REF_HASH_FILE" && ! -L "$APPROVED_DB_REF_HASH_FILE" ]] \
        || die "The approved Production DB ref file is missing or unsafe."
    metadata="$(stat -c '%u:%g:%a' "$APPROVED_DB_REF_HASH_FILE" 2>/dev/null)" \
        || die "The approved Production DB ref file metadata is unavailable."
    [[ "$metadata" == "0:0:400" ]] \
        || die "The approved Production DB ref file must be root-owned mode 400."
    awk '
        NR == 1 && $0 ~ /^[0-9a-f]{64}$/ { valid = 1; next }
        { invalid = 1 }
        END { exit (valid == 1 && invalid == 0) ? 0 : 1 }
    ' "$APPROVED_DB_REF_HASH_FILE" >/dev/null 2>&1 \
        || die "The approved Production DB ref file must contain one lowercase SHA-256 line."
}

[[ "$EUID" -eq 0 ]] || die "The Fallback Server installer must run as root."
[[ -f "$SCRIPT_ROOT/operator.sh" && ! -L "$SCRIPT_ROOT/operator.sh" ]] \
    || die "The Fallback Server operator source is missing or invalid."
[[ -f "$SCRIPT_ROOT/compose.yml" && ! -L "$SCRIPT_ROOT/compose.yml" ]] \
    || die "The Fallback Server Compose source is missing or invalid."
[[ -f "$IDENTITY_HELPER_SOURCE" && ! -L "$IDENTITY_HELPER_SOURCE" ]] \
    || die "The Fallback Server Production DB identity helper source is missing or invalid."
[[ -f "$ACTIVE_COMPOSE_SOURCE" && ! -L "$ACTIVE_COMPOSE_SOURCE" ]] \
    || die "The temporary-active Fallback Server Compose source is missing or invalid."
for protected_path in "$ARTIFACT_ROOT" "$INSTALLED_OPERATOR" "$STATE_ROOT" "$IDENTITY_HELPER_ARTIFACT" "$ACTIVE_COMPOSE_ARTIFACT" "$APPROVED_DB_REF_HASH_FILE"; do
    [[ ! -L "$protected_path" ]] || die "A Fallback Server installation path is a symbolic link."
done
validate_existing_approval

install -d -o root -g root -m 700 "$ARTIFACT_ROOT"
install -d -o root -g root -m 700 "$STATE_ROOT"
install -d -o root -g root -m 700 "$STATE_ROOT/state"
install -o root -g root -m 750 "$SCRIPT_ROOT/operator.sh" "$INSTALLED_OPERATOR"
install -o root -g root -m 640 "$SCRIPT_ROOT/compose.yml" "$ARTIFACT_ROOT/compose.yml"
install -o root -g root -m 640 "$ACTIVE_COMPOSE_SOURCE" "$ACTIVE_COMPOSE_ARTIFACT"
install -o root -g root -m 750 "$IDENTITY_HELPER_SOURCE" "$IDENTITY_HELPER_ARTIFACT"

manifest="$(mktemp "$ARTIFACT_ROOT/.bundle.manifest.XXXXXX")"
printf '%s\n' \
    "operator.sh=$(sha256_file "$INSTALLED_OPERATOR")" \
    "compose.yml=$(sha256_file "$ARTIFACT_ROOT/compose.yml")" \
    "compose.temporary-active.yml=$(sha256_file "$ACTIVE_COMPOSE_ARTIFACT")" \
    "production-db-identity.sh=$(sha256_file "$IDENTITY_HELPER_ARTIFACT")" \
    >"$manifest"
chown root:root "$manifest"
chmod 640 "$manifest"
mv -f "$manifest" "$ARTIFACT_ROOT/bundle.manifest"

printf '%s\n' \
    "Fallback Server operator installed." \
    "Next: provision $STATE_ROOT/backend.env as root:root mode 600 and $APPROVED_DB_REF_HASH_FILE as root:root mode 400, then run status or deploy."
