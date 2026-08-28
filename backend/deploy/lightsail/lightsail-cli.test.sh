#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/lightsail-cli.sh"
WORKFLOW="$SCRIPT_DIR/../../../.github/workflows/lightsail-operations.yml"
INFRASTRUCTURE_TEMPLATE="$SCRIPT_DIR/github-oidc-ssm.yaml"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    local path="$1"
    local pattern="$2"
    local message="$3"

    grep -Eq -- "$pattern" "$path" || fail "$message"
}

assert_not_contains() {
    local path="$1"
    local pattern="$2"
    local message="$3"

    if grep -Eq -- "$pattern" "$path"; then
        fail "$message"
    fi
}

[[ -x "$CLI" ]] || fail "missing executable local Lightsail CLI"
[[ -r "$WORKFLOW" ]] || fail "missing fixed-purpose Lightsail operations workflow"

assert_contains "$CLI" 'gh workflow run lightsail-operations\.yml' "CLI must dispatch through GitHub"
assert_contains "$CLI" 'gh run watch' "CLI must wait for the dispatched operation by default"
assert_contains "$CLI" 'operator-upgrade' "CLI must expose the operator maintenance action"
assert_not_contains "$CLI" 'aws[[:space:]]' "CLI must not require local AWS credentials"
assert_not_contains "$CLI" '(ssh|AWS-RunShellScript)' "CLI must not expose a general remote shell"

assert_contains "$WORKFLOW" '^run-name:.*request_id' "workflow runs must include the unique local request id"
assert_contains "$WORKFLOW" 'environment:[[:space:]]*production' "production operations must retain required-reviewer approval"
assert_contains "$WORKFLOW" 'id-token:[[:space:]]*write' "remote operations must use short-lived GitHub OIDC credentials"
assert_contains "$WORKFLOW" 'AWS_PREVIEW_STATUS_DOCUMENT_NAME' "preview status must use a fixed document"
assert_contains "$WORKFLOW" 'AWS_PRODUCTION_STATUS_DOCUMENT_NAME' "production status must use a fixed document"
assert_contains "$WORKFLOW" 'AWS_OPERATOR_UPGRADE_DOCUMENT_NAME' "operator maintenance must use a fixed document"
assert_not_contains "$WORKFLOW" 'AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY' "workflow must not use long-lived AWS keys"

assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator status preview' "preview status document must fix its environment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator status production' "production status document must fix its environment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'OperatorUpgradeDocument' "infrastructure must define a fixed operator upgrade document"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'refs/heads/main' "operator upgrades must be pinned to main"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" '^[[:space:]]+Command:' "maintenance must not accept an arbitrary command parameter"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
fake_bin="$test_root/bin"
call_log="$test_root/gh-calls"
mkdir -p "$fake_bin"

cat >"$fake_bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$GH_CALL_LOG"
case "$*" in
    "auth status") ;;
    "workflow run "*) ;;
    "run list "*) printf '%s\n' '424242' ;;
    "run watch "*) ;;
    *) exit 1 ;;
esac
EOF
chmod 0755 "$fake_bin/gh"

cat >"$fake_bin/uuidgen" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '123E4567-E89B-42D3-A456-426614174000'
EOF
chmod 0755 "$fake_bin/uuidgen"

common_env=(
    "PATH=$fake_bin:/usr/bin:/bin"
    "GH_CALL_LOG=$call_log"
    "BABYJAMJAM_RUN_DISCOVERY_INTERVAL_SECONDS=0"
)

env "${common_env[@]}" "$CLI" status preview
grep -Fq -- 'workflow run lightsail-operations.yml --ref preview' "$call_log" \
    || fail "preview status must run from the preview branch"
grep -Fq -- '-f operation=status -f environment=preview' "$call_log" \
    || fail "preview status inputs were not fixed"

: >"$call_log"
env "${common_env[@]}" "$CLI" deploy production
grep -Fq -- 'workflow run lightsail-operations.yml --ref main' "$call_log" \
    || fail "production deploy must run from main"
grep -Fq -- '-f operation=deploy -f environment=production' "$call_log" \
    || fail "production deploy inputs were not fixed"

: >"$call_log"
env "${common_env[@]}" "$CLI" operator-upgrade
grep -Fq -- '-f operation=operator-upgrade -f environment=production' "$call_log" \
    || fail "operator upgrades must use the production-approved path"

if env "${common_env[@]}" "$CLI" deploy dev >/dev/null 2>&1; then
    fail "unsupported deployment environment was accepted"
fi
if env "${common_env[@]}" "$CLI" shell preview >/dev/null 2>&1; then
    fail "arbitrary operation was accepted"
fi

echo "local Lightsail CLI tests passed"
