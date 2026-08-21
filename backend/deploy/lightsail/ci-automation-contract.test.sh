#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
WORKFLOW="$REPOSITORY_ROOT/.github/workflows/backend-ci.yml"
INFRASTRUCTURE_TEMPLATE="$SCRIPT_DIR/github-oidc-ssm.yaml"
INSTALLER="$SCRIPT_DIR/install-ci-operator.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_contains() {
    local file="$1"
    local pattern="$2"
    local description="$3"

    grep -Eq -- "$pattern" "$file" || fail "$description"
}

assert_not_contains() {
    local file="$1"
    local pattern="$2"
    local description="$3"

    if grep -Eq -- "$pattern" "$file"; then
        fail "$description"
    fi
}

[[ -r "$INFRASTRUCTURE_TEMPLATE" ]] || fail "missing OIDC/SSM template"
[[ -r "$INSTALLER" ]] || fail "missing CI operator installer"

assert_contains "$WORKFLOW" 'packages:[[:space:]]*write' "workflow must publish the immutable image"
assert_contains "$WORKFLOW" 'id-token:[[:space:]]*write' "deploy job must use GitHub OIDC"
assert_contains "$WORKFLOW" 'docker/build-push-action@[0-9a-f]{40}' "Docker build action must be commit-pinned"
assert_contains "$WORKFLOW" 'aws-actions/configure-aws-credentials@[0-9a-f]{40}' "AWS credential action must be commit-pinned"
assert_contains "$WORKFLOW" 'persist-credentials:[[:space:]]*false' "checkout credentials must not persist"
assert_contains "$WORKFLOW" 'cache-to:[[:space:]]*type=gha' "workflow must cache Docker layers"
assert_contains "$WORKFLOW" 'aws ssm send-command' "workflow must deploy through SSM"
assert_contains "$WORKFLOW" 'aws ssm describe-instance-information' "workflow must preflight a unique online SSM node"
assert_contains "$WORKFLOW" 'max-concurrency[[:space:]]+1' "SSM must execute on at most one target at a time"
assert_contains "$WORKFLOW" 'schedulers_enabled' "deployment verification must check scheduler ownership"
assert_contains "$WORKFLOW" 'environment:[[:space:]]*$' "workflow must use GitHub environments"
assert_contains "$WORKFLOW" "github.ref_name == 'main' && 'production' \|\| 'preview'" "main must use the protected production environment"
assert_contains "$WORKFLOW" 'cancel-in-progress:[[:space:]]*true' "superseded image builds must be cancelled"
assert_contains "$WORKFLOW" 'cancel-in-progress:[[:space:]]*false' "active deployments must not be cancelled"
assert_not_contains "$WORKFLOW" 'AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY' "workflow must not use long-lived AWS keys"

assert_contains "$INFRASTRUCTURE_TEMPLATE" 'token.actions.githubusercontent.com:aud' "OIDC trust must pin the AWS audience"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'UpdateMethod:[[:space:]]*NewVersion' "SSM document names must remain stable across updates"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'repo:jaino-song/babyjamjam-admin:environment:preview' "preview trust must be environment-scoped"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'repo:jaino-song/babyjamjam-admin:environment:production' "production trust must be environment-scoped"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ssm:SendCommand' "deploy roles must only submit SSM commands"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ssm:DescribeInstanceInformation' "deploy roles must preflight SSM target uniqueness"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ssm:resourceTag/DeploymentTarget' "SSM target must be tag-scoped"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'allowedPattern:[[:space:]]*"\^\[0-9a-f\]\{40\}\$"' "SSM document must validate commit SHA"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'allowedPattern:[[:space:]]*"\^sha256:\[0-9a-f\]\{64\}\$"' "SSM document must validate image digest"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator deploy preview' "preview document must fix the target environment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator deploy production' "production document must fix the target environment"

assert_contains "$INSTALLER" 'root:root' "CI operator must remain root-owned"
assert_contains "$INSTALLER" '0750' "CI operator must not be executable by unprivileged users"
assert_not_contains "$INSTALLER" 'sudoers' "CI operator must not grant a new sudo path"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'Action:[[:space:]]*[\"]?[*]' "IAM actions must not use wildcards"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'Principal:[[:space:]]*[\"]?[*]' "IAM trust must not use a wildcard principal"

echo "ci-automation contract tests passed"
