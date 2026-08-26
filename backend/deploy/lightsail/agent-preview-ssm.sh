#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly OPERATOR_PROFILE="agent-lightsail-operator"
readonly OPERATOR_REGION="ap-northeast-2"
readonly DEPLOYMENT_TARGET_TAG="babyjamjam-admin-server"
readonly DEFAULT_POLL_INTERVAL_SECONDS="5"
readonly MAX_POLL_ATTEMPTS="360"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || fail "Required command is unavailable: $1"
}

aws_operator() {
    aws --profile "$OPERATOR_PROFILE" --region "$OPERATOR_REGION" "$@"
}

read_status_value() {
    local status_output="$1"
    local wanted_key="$2"

    awk -F= -v wanted_key="$wanted_key" '$1 == wanted_key { print substr($0, length($1) + 2) }' \
        <<<"$status_output"
}

validate_status_output() {
    local status_output="$1"
    local expected_sha="${2:-}"
    local expected_digest="${3:-}"
    local environment
    local current_tag
    local current_digest
    local container_health
    local restart_count
    local schedulers_enabled
    local public_health
    local db_route
    local runtime_route
    local db_readiness

    environment="$(read_status_value "$status_output" environment)"
    current_tag="$(read_status_value "$status_output" current_tag)"
    current_digest="$(read_status_value "$status_output" current_digest)"
    container_health="$(read_status_value "$status_output" container_health)"
    restart_count="$(read_status_value "$status_output" restart_count)"
    schedulers_enabled="$(read_status_value "$status_output" schedulers_enabled)"
    public_health="$(read_status_value "$status_output" public_health)"
    db_route="$(read_status_value "$status_output" db_route)"
    runtime_route="$(read_status_value "$status_output" runtime_route)"
    db_readiness="$(read_status_value "$status_output" db_readiness)"

    [[ "$environment" == "preview" ]] || fail "SSM status returned an unexpected environment."
    [[ "$current_tag" =~ ^[0-9a-f]{40}$ ]] || fail "SSM status returned an invalid commit tag."
    [[ "$current_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "SSM status returned an invalid image digest."
    [[ "$container_health" == "healthy" ]] || fail "Preview container is not healthy."
    [[ "$restart_count" == "0" ]] || fail "Preview container has restarted."
    [[ "$schedulers_enabled" == "false" ]] || fail "Preview scheduler ownership is invalid."
    [[ "$public_health" == "ok" ]] || fail "Preview public health is not ok."
    [[ "$db_route" == "shared" || "$db_route" == "direct" ]] || fail "Preview database route is invalid."
    [[ "$runtime_route" == "$db_route" ]] || fail "Preview runtime and database routes do not match."
    [[ "$db_readiness" == "ok" ]] || fail "Preview database readiness is not ok."

    if [[ -n "$expected_sha" ]]; then
        [[ "$current_tag" == "$expected_sha" ]] || fail "Preview commit does not match the requested candidate."
    fi
    if [[ -n "$expected_digest" ]]; then
        [[ "$current_digest" == "$expected_digest" ]] || fail "Preview digest does not match the requested candidate."
    fi

    printf '%s\n' \
        "environment=$environment" \
        "current_tag=$current_tag" \
        "current_digest=$current_digest" \
        "container_health=$container_health" \
        "restart_count=$restart_count" \
        "schedulers_enabled=$schedulers_enabled" \
        "public_health=$public_health" \
        "db_route=$db_route" \
        "runtime_route=$runtime_route" \
        "db_readiness=$db_readiness"
}

require_command aws
require_command jq
require_command awk

action="${1:-}"
document_name=""
expected_sha=""
expected_digest=""
parameters_json=""

case "$action" in
    status)
        [[ "$#" -eq 1 ]] || fail "Usage: $0 status"
        document_name="${AWS_PREVIEW_STATUS_DOCUMENT_NAME:-}"
        ;;
    deploy)
        [[ "$#" -eq 3 ]] || fail "Usage: $0 deploy <40-character-preview-sha> <sha256-image-digest>"
        require_command git
        expected_sha="$2"
        expected_digest="$3"
        [[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || fail "Preview commit must be a lowercase 40-character SHA."
        [[ "$expected_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Image digest must be a lowercase sha256 digest."
        repository_root="$(git -C "$SCRIPT_DIR/../../.." rev-parse --show-toplevel)"
        git -C "$repository_root" fetch --quiet --prune origin \
            +refs/heads/preview:refs/remotes/origin/preview
        remote_preview_sha="$(git -C "$repository_root" rev-parse --verify \
            'refs/remotes/origin/preview^{commit}')"
        [[ "$expected_sha" == "$remote_preview_sha" ]] \
            || fail "Preview commit is not the current origin/preview commit."
        document_name="${AWS_PREVIEW_DEPLOY_DOCUMENT_NAME:-}"
        parameters_json="$(jq -cn \
            --arg commit_sha "$expected_sha" \
            --arg image_digest "$expected_digest" \
            '{CommitSha:[$commit_sha],ImageDigest:[$image_digest]}')"
        ;;
    *)
        fail "Usage: $0 status | deploy <40-character-preview-sha> <sha256-image-digest>"
        ;;
esac

[[ "$document_name" =~ ^[A-Za-z0-9_.-]{1,128}$ ]] \
    || fail "The required fixed Preview SSM document name is missing or invalid."

poll_interval="${BABYJAMJAM_SSM_POLL_INTERVAL_SECONDS:-$DEFAULT_POLL_INTERVAL_SECONDS}"
[[ "$poll_interval" =~ ^[0-9]+$ && "$poll_interval" -le 30 ]] \
    || fail "SSM poll interval must be an integer from 0 to 30."

operator_arn="$(aws_operator sts get-caller-identity --query Arn --output text)"
case "$operator_arn" in
    */agent-lightsail-operator) ;;
    *) fail "AWS caller is not the approved IAM operator." ;;
esac

managed_nodes="$(aws_operator ssm describe-instance-information \
    --filters "Key=tag:DeploymentTarget,Values=$DEPLOYMENT_TARGET_TAG" \
    --output json)"
managed_node_count="$(jq '.InstanceInformationList | length' <<<"$managed_nodes")"
online_node_count="$(jq '[.InstanceInformationList[] | select(.PingStatus == "Online")] | length' \
    <<<"$managed_nodes")"
if [[ "$managed_node_count" -ne 1 || "$online_node_count" -ne 1 ]]; then
    fail "The Preview target must resolve to exactly one online managed node."
fi
expected_node_id="$(jq -r '.InstanceInformationList[0].InstanceId' <<<"$managed_nodes")"

targets="$(jq -cn \
    --arg tag_value "$DEPLOYMENT_TARGET_TAG" \
    '[{Key:"tag:DeploymentTarget",Values:[$tag_value]}]')"

send_command_args=(
    ssm send-command
    --document-name "$document_name"
)
if [[ -n "$parameters_json" ]]; then
    send_command_args+=(--parameters "$parameters_json")
fi
send_command_args+=(
    --targets "$targets"
    --max-concurrency 1
    --max-errors 0
    --timeout-seconds 1800
    --comment "agent-lightsail-operator $action preview"
    --query 'Command.CommandId'
    --output text
)
command_id="$(aws_operator "${send_command_args[@]}")"
[[ "$command_id" =~ ^[0-9a-f-]{36}$ ]] || fail "SSM returned an invalid command identifier."

managed_node_id=""
final_status="TimedOut"
for _attempt in $(seq 1 "$MAX_POLL_ATTEMPTS"); do
    invocation_json="$(aws_operator ssm list-command-invocations \
        --command-id "$command_id" \
        --details \
        --output json)"
    invocation_count="$(jq '.CommandInvocations | length' <<<"$invocation_json")"
    [[ "$invocation_count" -le 1 ]] || fail "SSM resolved the command to multiple managed nodes."
    if [[ "$invocation_count" -eq 0 ]]; then
        sleep "$poll_interval"
        continue
    fi

    managed_node_id="$(jq -r '.CommandInvocations[0].InstanceId' <<<"$invocation_json")"
    final_status="$(jq -r '.CommandInvocations[0].Status' <<<"$invocation_json")"
    case "$final_status" in
        Pending|InProgress|Delayed)
            sleep "$poll_interval"
            ;;
        *)
            break
            ;;
    esac
done

[[ -n "$managed_node_id" ]] || fail "SSM command did not reach the Preview managed node."
[[ "$managed_node_id" == "$expected_node_id" ]] || fail "SSM command ran on an unexpected managed node."

command_result="$(aws_operator ssm get-command-invocation \
    --command-id "$command_id" \
    --instance-id "$managed_node_id" \
    --output json)"
result_status="$(jq -r '.Status // "Unknown"' <<<"$command_result")"
status_output="$(jq -r '.StandardOutputContent // ""' <<<"$command_result")"
error_output="$(jq -r '.StandardErrorContent // ""' <<<"$command_result")"

if [[ "$final_status" != "Success" || "$result_status" != "Success" ]]; then
    [[ -z "$status_output" ]] || printf '%s\n' "$status_output" >&2
    [[ -z "$error_output" ]] || printf '%s\n' "$error_output" >&2
    fail "SSM Preview $action ended with status: $final_status"
fi

validate_status_output "$status_output" "$expected_sha" "$expected_digest"
