#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR="$SCRIPT_DIR/agent-preview-ssm.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_fails() {
    if ("$@") >/dev/null 2>&1; then
        fail "expected command to fail: $*"
    fi
}

[[ -x "$OPERATOR" ]] || fail "missing executable IAM preview SSM operator"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
fake_bin="$test_root/bin"
call_log="$test_root/aws-calls"
git_call_log="$test_root/git-calls"
mkdir -p "$fake_bin"

cat >"$fake_bin/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$AWS_CALL_LOG"

case "$*" in
    *"sts get-caller-identity"*)
        if [[ "${AWS_FAKE_PRINCIPAL:-operator}" == "operator" ]]; then
            printf '%s\n' 'arn:aws:iam::000000000000:user/agent-lightsail-operator'
        else
            printf '%s\n' 'arn:aws:iam::000000000000:user/unexpected-user'
        fi
        ;;
    *"ssm describe-instance-information"*)
        if [[ "${AWS_FAKE_TARGETS:-one}" == "one" ]]; then
            printf '%s\n' '{"InstanceInformationList":[{"InstanceId":"mi-00000000000000000","PingStatus":"Online"}]}'
        else
            printf '%s\n' '{"InstanceInformationList":[{"InstanceId":"mi-one","PingStatus":"Online"},{"InstanceId":"mi-two","PingStatus":"Online"}]}'
        fi
        ;;
    *"ssm send-command"*)
        printf '%s\n' '123e4567-e89b-12d3-a456-426614174000'
        ;;
    *"ssm list-command-invocations"*)
        printf '{"CommandInvocations":[{"InstanceId":"mi-00000000000000000","Status":"%s"}]}\n' "${AWS_FAKE_STATUS:-Success}"
        ;;
    *"ssm get-command-invocation"*)
        if [[ "${AWS_FAKE_STATUS:-Success}" == "Success" ]]; then
            printf '%s\n' '{"Status":"Success","StandardOutputContent":"environment=preview\ncurrent_tag=432bc4840b9a44a3357a442c9ef93b7cc9f41459\ncurrent_digest=sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\ncontainer_health=healthy\nrestart_count=0\nschedulers_enabled=false\npublic_health=ok\ndb_route=shared\nruntime_route=shared\ndb_readiness=ok\n","StandardErrorContent":""}'
        else
            printf '%s\n' '{"Status":"Failed","StandardOutputContent":"","StandardErrorContent":"sanitized operator failure"}'
        fi
        ;;
    *)
        printf 'unexpected aws invocation: %s\n' "$*" >&2
        exit 1
        ;;
esac
EOF
chmod 0755 "$fake_bin/aws"

cat >"$fake_bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$GIT_CALL_LOG"

case "$*" in
    *"rev-parse --show-toplevel")
        printf '%s\n' '/mock/babyjamjam-admin'
        ;;
    *"fetch --quiet --prune origin +refs/heads/preview:refs/remotes/origin/preview")
        ;;
    *"rev-parse --verify refs/remotes/origin/preview^{commit}")
        printf '%s\n' "${GIT_FAKE_PREVIEW_SHA:-432bc4840b9a44a3357a442c9ef93b7cc9f41459}"
        ;;
    *)
        printf 'unexpected git invocation: %s\n' "$*" >&2
        exit 1
        ;;
esac
EOF
chmod 0755 "$fake_bin/git"

valid_sha="432bc4840b9a44a3357a442c9ef93b7cc9f41459"
valid_digest="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
common_env=(
    "PATH=$fake_bin:$PATH"
    "AWS_CALL_LOG=$call_log"
    "GIT_CALL_LOG=$git_call_log"
    "AWS_PREVIEW_DEPLOY_DOCUMENT_NAME=preview-deploy-document"
    "AWS_PREVIEW_STATUS_DOCUMENT_NAME=preview-status-document"
    "BABYJAMJAM_SSM_POLL_INTERVAL_SECONDS=0"
)

deploy_output="$(env "${common_env[@]}" "$OPERATOR" deploy "$valid_sha" "$valid_digest")"
[[ "$deploy_output" == *$'environment=preview\n'* ]] || fail "deploy output omitted environment"
[[ "$deploy_output" == *$'restart_count=0\n'* ]] || fail "deploy output omitted restart count"
grep -Fq -- '--profile agent-lightsail-operator' "$call_log" || fail "AWS profile was not pinned"
grep -Fq -- '--region ap-northeast-2' "$call_log" || fail "AWS region was not pinned"
grep -Fq -- '--document-name preview-deploy-document' "$call_log" || fail "preview deploy document was not used"
grep -Fq -- 'tag:DeploymentTarget' "$call_log" || fail "deployment target tag was not used"
grep -Fq -- 'fetch --quiet --prune origin +refs/heads/preview:refs/remotes/origin/preview' "$git_call_log" \
    || fail "latest origin/preview was not fetched"
if grep -Eq 'AWS-RunShellScript|production' "$call_log"; then
    fail "unsafe SSM document reached AWS"
fi

: >"$call_log"
status_output="$(env "${common_env[@]}" "$OPERATOR" status)"
[[ "$status_output" == *$'environment=preview\n'* ]] || fail "status output omitted environment"
grep -Fq -- '--document-name preview-status-document' "$call_log" || fail "preview status document was not used"

assert_fails env "${common_env[@]}" "$OPERATOR" deploy invalid "$valid_digest"
assert_fails env "${common_env[@]}" "$OPERATOR" deploy "$valid_sha" sha256:short
assert_fails env "${common_env[@]}" GIT_FAKE_PREVIEW_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    "$OPERATOR" deploy "$valid_sha" "$valid_digest"
assert_fails env "${common_env[@]}" AWS_FAKE_PRINCIPAL=unexpected "$OPERATOR" status
assert_fails env "${common_env[@]}" AWS_FAKE_TARGETS=two "$OPERATOR" status
assert_fails env "${common_env[@]}" "$OPERATOR" production "$valid_sha" "$valid_digest"

: >"$call_log"
failure_output="$test_root/failure-output"
if env "${common_env[@]}" AWS_FAKE_STATUS=Failed "$OPERATOR" status >"$failure_output" 2>&1; then
    fail "failed SSM command unexpectedly succeeded"
fi
grep -Fq -- 'ssm get-command-invocation' "$call_log" || fail "failed SSM command did not retrieve diagnostics"
grep -Fq -- 'sanitized operator failure' "$failure_output" || fail "failed SSM diagnostics were not reported"

echo "agent preview SSM tests passed"
