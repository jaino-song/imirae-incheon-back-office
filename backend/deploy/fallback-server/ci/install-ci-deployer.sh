#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SOURCE="$SCRIPT_ROOT/ci-deployer.sh"
readonly DESTINATION="/usr/local/sbin/babyjamjam-fallback-ci-deployer"
readonly HELPER_SOURCE="$SCRIPT_ROOT/automatic-approval.mjs"
readonly HELPER_DIRECTORY="/usr/local/libexec/babyjamjam-fallback-server"
readonly HELPER_DESTINATION="$HELPER_DIRECTORY/automatic-approval.mjs"
readonly DISPATCHER_SOURCE="$SCRIPT_ROOT/ssh-dispatch.sh"
readonly DISPATCHER_DESTINATION="/usr/local/sbin/babyjamjam-fallback-ci-ssh-dispatch"
readonly DEPLOY_USER="babyjamjam-ci-deployer"
readonly SUDOERS_FILE="/etc/sudoers.d/babyjamjam-fallback-ci-deployer"
readonly STATE_ROOT="/opt/babyjamjam-fallback-server"

die() {
    echo "$*" >&2
    exit 1
}

[[ "$EUID" -eq 0 ]] || die "The Fallback CI deployer installer must run as root."
[[ -f "$SOURCE" && ! -L "$SOURCE" ]] || die "The Fallback CI deployer source is missing or unsafe."
[[ -f "$HELPER_SOURCE" && ! -L "$HELPER_SOURCE" ]] || die "The automatic approval helper source is missing or unsafe."
[[ -f "$DISPATCHER_SOURCE" && ! -L "$DISPATCHER_SOURCE" ]] || die "The forced-command SSH dispatcher source is missing or unsafe."
[[ -d "$HELPER_DIRECTORY" && ! -L "$HELPER_DIRECTORY" ]] || die "Install the protected Fallback operator bundle first."
[[ "$(stat -c '%u:%g' "$HELPER_DIRECTORY")" == "0:0" ]] || die "The protected Fallback helper directory must be root-owned."
id "$DEPLOY_USER" >/dev/null 2>&1 || die "Provision the dedicated deployment user before installing its authority."
if id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -Fxq docker; then
    die "The dedicated deployment user must not belong to the docker group."
fi
[[ -f "$STATE_ROOT/automatic-deploy-authority" && ! -L "$STATE_ROOT/automatic-deploy-authority" ]] \
    || die "Provision the root-owned automatic deployment authority artifact first."
[[ -f "$STATE_ROOT/approved-public-routing.sha256" && ! -L "$STATE_ROOT/approved-public-routing.sha256" ]] \
    || die "Provision the root-owned public routing identity hash first."
[[ "$(stat -c '%u:%g:%a' "$STATE_ROOT/automatic-deploy-authority")" == "0:0:400" \
    && "$(stat -c '%u:%g:%a' "$STATE_ROOT/approved-public-routing.sha256")" == "0:0:400" ]] \
    || die "Automatic deployment authority artifacts must be root-owned mode 400."

temporary_sudoers="$(mktemp /etc/sudoers.d/.babyjamjam-fallback-ci-deployer.XXXXXX)"
cleanup() { rm -f "$temporary_sudoers"; }
trap cleanup EXIT
printf '%s\n' \
    "$DEPLOY_USER ALL=(root) NOPASSWD: $DESTINATION status" \
    "$DEPLOY_USER ALL=(root) NOPASSWD: $DESTINATION replace *" \
    >"$temporary_sudoers"
chmod 440 "$temporary_sudoers"
visudo -cf "$temporary_sudoers" >/dev/null
bash -n "$SOURCE" "$DISPATCHER_SOURCE"
node --check "$HELPER_SOURCE"
install -o root -g root -m 750 "$SOURCE" "$DESTINATION"
install -o root -g root -m 750 "$HELPER_SOURCE" "$HELPER_DESTINATION"
install -o root -g root -m 755 "$DISPATCHER_SOURCE" "$DISPATCHER_DESTINATION"
install -o root -g root -m 440 "$temporary_sudoers" "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

printf '%s\n' \
    "Fallback CI deployer installed." \
    "SSH credentials remain separately provisioned and are not managed by this installer."
