#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
WORKFLOW="$REPOSITORY_ROOT/.github/workflows/backend-ci.yml"
INFRASTRUCTURE_TEMPLATE="$SCRIPT_DIR/github-oidc-ssm.yaml"
INSTALLER="$SCRIPT_DIR/install-ci-operator.sh"
ROLLBACK_SCRIPT="$SCRIPT_DIR/rollback.sh"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy.sh"
CI_OPERATOR="$SCRIPT_DIR/ci-operator.sh"
PREVIEW_OPERATOR="$SCRIPT_DIR/operator-preview.sh"

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

assert_text_contains() {
    local text="$1"
    local pattern="$2"
    local description="$3"

    grep -Eq -- "$pattern" <<<"$text" || fail "$description"
}

assert_text_not_contains() {
    local text="$1"
    local pattern="$2"
    local description="$3"

    if grep -Eq -- "$pattern" <<<"$text"; then
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
assert_contains "$WORKFLOW" 'name:[[:space:]]*production' "main must retain a protected production approval job"
assert_contains "$WORKFLOW" 'AWS_PREVIEW_DEPLOY_ROLE_ARN' "preview must use a branch-scoped repository variable"
assert_contains "$WORKFLOW" 'AWS_PRODUCTION_DEPLOY_ROLE_ARN' "production must use a branch-scoped repository variable"
assert_contains "$WORKFLOW" 'cancel-in-progress:[[:space:]]*true' "superseded image builds must be cancelled"
assert_contains "$WORKFLOW" 'cancel-in-progress:[[:space:]]*false' "active deployments must not be cancelled"
assert_not_contains "$WORKFLOW" 'AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY' "workflow must not use long-lived AWS keys"

approval_job="$(sed -n '/^  approve-lightsail-production:/,/^  deploy-lightsail:/p' "$WORKFLOW")"
deploy_job="$(sed -n '/^  deploy-lightsail:/,$p' "$WORKFLOW")"
assert_text_contains "$approval_job" 'environment:[[:space:]]*$' "production approval must use a GitHub environment"
assert_text_contains "$approval_job" 'name:[[:space:]]*production' "production approval must use the protected environment"
assert_text_not_contains "$approval_job" 'id-token:' "the approval job must not receive an AWS OIDC token"
assert_text_contains "$deploy_job" 'id-token:[[:space:]]*write' "the deploy job must receive the AWS OIDC token"
assert_text_not_contains "$deploy_job" 'environment:' "branch-scoped deploy credentials must not change OIDC subject to an environment"
assert_text_contains "$deploy_job" 'needs\.approve-lightsail-production\.result == .success.' "main deployment must depend on successful approval"

assert_contains "$INFRASTRUCTURE_TEMPLATE" 'token.actions.githubusercontent.com:aud' "OIDC trust must pin the AWS audience"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'UpdateMethod:[[:space:]]*NewVersion' "SSM document names must remain stable across updates"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'repo:jaino-song/babyjamjam-admin:ref:refs/heads/preview' "preview trust must pin the preview branch"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'repo:jaino-song/babyjamjam-admin:ref:refs/heads/main' "production trust must pin the main branch"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'repo:jaino-song/babyjamjam-admin:environment:' "deploy roles must not trust every workflow using an environment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ssm:SendCommand' "deploy roles must only submit SSM commands"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ssm:DescribeInstanceInformation' "deploy roles must preflight SSM target uniqueness"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ssm:resourceTag/DeploymentTarget' "SSM target must be tag-scoped"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'allowedPattern:[[:space:]]*"\^\[0-9a-f\]\{40\}\$"' "SSM document must validate commit SHA"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'allowedPattern:[[:space:]]*"\^sha256:\[0-9a-f\]\{64\}\$"' "SSM document must validate image digest"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator deploy preview' "preview document must fix the target environment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator deploy production' "production document must fix the target environment"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'PreviewDbReconcileDocument:' "preview reconcile document must be defined"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ProductionDbReconcileDocument:' "production reconcile document must be defined"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'Name:[[:space:]]*babyjamjam-preview-db-failover' "preview reconcile document name must be fixed for the worker"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'Name:[[:space:]]*babyjamjam-production-db-failover' "production reconcile document name must be fixed for the worker"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'PreviewDbReconcileDocumentArn:' "preview reconcile document ARN must be exported"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'ProductionDbReconcileDocumentArn:' "production reconcile document ARN must be exported"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'Value:[[:space:]]*!Sub arn:\$\{AWS::Partition\}:ssm:\$\{AWS::Region\}:\$\{AWS::AccountId\}:document/\$\{PreviewDbReconcileDocument\}' "preview reconcile document ARN must be partition-aware and Ref-based"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'Value:[[:space:]]*!Sub arn:\$\{AWS::Partition\}:ssm:\$\{AWS::Region\}:\$\{AWS::AccountId\}:document/\$\{ProductionDbReconcileDocument\}' "production reconcile document ARN must be partition-aware and Ref-based"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'GetAtt[[:space:]]+(Preview|Production)DbReconcileDocument\.Arn' "SSM documents must not use an unsupported Arn GetAtt"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator db-reconcile preview "{{ RequestId }}"' "preview reconcile document must pass only its fixed environment and UUID"
assert_contains "$INFRASTRUCTURE_TEMPLATE" '/usr/local/sbin/babyjamjam-ci-operator db-reconcile production "{{ RequestId }}"' "production reconcile document must pass only its fixed environment and UUID"
assert_contains "$INFRASTRUCTURE_TEMPLATE" 'allowedPattern:[[:space:]]*"\^\[0-9a-fA-F\]\{8\}-' "reconcile document must validate UUID request IDs"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'db-reconcile.*CommitSha\|db-reconcile.*ImageDigest' "reconcile documents must not accept deployment parameters"
preview_deploy_role_section="$(sed -n '/^  PreviewDeployRole:/,/^  ProductionDeployRole:/p' "$INFRASTRUCTURE_TEMPLATE")"
production_deploy_role_section="$(sed -n '/^  ProductionDeployRole:/,/^Outputs:/p' "$INFRASTRUCTURE_TEMPLATE")"
assert_text_not_contains "$preview_deploy_role_section" 'DbReconcileDocument' "preview deploy role must not gain failover document access"
assert_text_not_contains "$production_deploy_role_section" 'DbReconcileDocument' "production deploy role must not gain failover document access"

assert_contains "$INSTALLER" 'root:root' "CI operator must remain root-owned"
assert_contains "$INSTALLER" '0750' "CI operator must not be executable by unprivileged users"
assert_contains "$INSTALLER" 'ubuntu:ubuntu:640' "shared deployment locks must be writable by the deploy user"
assert_contains "$CI_OPERATOR" 'acquire_lock' "deploy and reconcile must use the shared operator lock"
assert_contains "$CI_OPERATOR" 'db_reconcile()' "reconcile must be implemented by the CI operator"
assert_contains "$CI_OPERATOR" 'up -d --no-deps --force-recreate api' "route changes must recreate only the API service"
assert_contains "$CI_OPERATOR" 'EXPECTED_SCHEDULERS_ENABLED' "route verification must enforce scheduler ownership"
assert_contains "$CI_OPERATOR" 'run_public_liveness_check' "route verification must preserve the public liveness check"
assert_contains "$CI_OPERATOR" 'sharedOk' "reconcile output must expose only safe shared probe status"
assert_contains "$CI_OPERATOR" 'directOk' "reconcile output must expose only safe direct probe status"
assert_not_contains "$CI_OPERATOR" 'docker[[:space:]]+restart' "route changes must not use docker restart"
assert_not_contains "$CI_OPERATOR" 'docker[[:space:]]+compose[[:space:]]+run' "probes must not create a second Compose API instance"
assert_not_contains "$CI_OPERATOR" 'postgres(ql)?://' "operator source must not contain database URLs"
assert_contains "$PREVIEW_OPERATOR" 'DATABASE_CONNECTION_MODE' "preview deploys must preserve the active database route"
assert_contains "$PREVIEW_OPERATOR" 'docker inspect' "preview deploys must verify the active database route before recreation"
assert_contains "$DEPLOY_SCRIPT" 'DATABASE_CONNECTION_MODE' "deploy script must accept the persisted route mode"
assert_contains "$ROLLBACK_SCRIPT" 'DATABASE_CONNECTION_MODE' "rollback script must accept the persisted route mode"
assert_contains "$DEPLOY_SCRIPT" 'group/world accessible' "deploy script must reject exposed backend environment files"
assert_contains "$ROLLBACK_SCRIPT" 'group/world accessible' "rollback script must reject exposed backend environment files"
assert_not_contains "$INSTALLER" 'sudoers' "CI operator must not grant a new sudo path"
assert_contains "$ROLLBACK_SCRIPT" 'PRESERVE_PREVIOUS_TAG.*==.*false.*current_tag' "automatic recovery must be able to preserve known-good tag history"
assert_contains "$CI_OPERATOR" 'restore_state_value.*previous-image-tag.*previous_tag' "automatic recovery must restore the rollback tag captured before deployment"
assert_not_contains "$CI_OPERATOR" 'docker run --rm.*--env-file' "migrations must use Compose-compatible environment parsing"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'Action:[[:space:]]*[\"]?[*]' "IAM actions must not use wildcards"
assert_not_contains "$INFRASTRUCTURE_TEMPLATE" 'Principal:[[:space:]]*[\"]?[*]' "IAM trust must not use a wildcard principal"

migration_line="$(grep -n 'if ! run_release_migrations' "$CI_OPERATOR" | cut -d: -f1)"
activation_line="$(grep -n 'if run_deploy_script' "$CI_OPERATOR" | cut -d: -f1)"
[[ -n "$migration_line" && -n "$activation_line" && "$migration_line" -lt "$activation_line" ]] \
    || fail "release migrations must run before image activation"

echo "ci-automation contract tests passed"
