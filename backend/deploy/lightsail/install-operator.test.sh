#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SCRIPT="$SCRIPT_DIR/install-operator.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_fails() {
    if ("$@") >/dev/null 2>&1; then
        fail "expected command to fail: $*"
    fi
}

if [[ ! -r "$INSTALL_SCRIPT" ]]; then
    fail "missing installer: $INSTALL_SCRIPT"
fi

# shellcheck source=backend/deploy/lightsail/install-operator.sh
source "$INSTALL_SCRIPT"

group_list_contains docker "ubuntu docker"
assert_fails group_list_contains docker "ubuntu users"
validate_group_membership "agent-lightsail-operator" "ubuntu docker"
assert_fails validate_group_membership "agent-lightsail-operator docker" "ubuntu docker"
assert_fails validate_group_membership "agent-lightsail-operator" "ubuntu users"

sudoers_rule="$(render_sudoers)"

[[ "$sudoers_rule" == *"agent-lightsail-operator ALL=(ubuntu) NOPASSWD: NOSETENV: BABYJAMJAM_PREVIEW_OPERATOR"* ]] \
    || fail "operator-to-ubuntu sudo rule is missing"
[[ "$sudoers_rule" == *"NOPASSWD: NOSETENV: BABYJAMJAM_PREVIEW_OPERATOR"* ]] \
    || fail "sudo environment injection must be disabled"
[[ "$sudoers_rule" == *"/usr/local/sbin/babyjamjam-preview-operator"* ]] \
    || fail "preview operator command is missing"
[[ "$sudoers_rule" != *"ALL=(ALL)"* ]] || fail "generic sudo access must not be granted"
[[ "$sudoers_rule" != *"deploy.sh"* ]] || fail "raw deploy script must not be granted"
[[ "$sudoers_rule" != *"rollback.sh"* ]] || fail "raw rollback script must not be granted"
[[ "$sudoers_rule" != *"production"* ]] || fail "production access must not be granted"

echo "install-operator tests passed"
