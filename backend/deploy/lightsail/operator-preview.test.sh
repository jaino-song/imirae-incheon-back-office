#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_SCRIPT="$SCRIPT_DIR/operator-preview.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_fails() {
    if ("$@") >/dev/null 2>&1; then
        fail "expected command to fail: $*"
    fi
}

assert_equals() {
    local expected="$1"
    local actual="$2"

    if [[ "$actual" != "$expected" ]]; then
        fail "expected '$expected', got '$actual'"
    fi
}

if [[ ! -r "$OPERATOR_SCRIPT" ]]; then
    fail "missing operator script: $OPERATOR_SCRIPT"
fi

# shellcheck source=backend/deploy/lightsail/operator-preview.sh
source "$OPERATOR_SCRIPT"

valid_sha="d94bb54b5cd4add05074ef47945e9970f3528a1f"

validate_invocation status
validate_invocation deploy "$valid_sha"
validate_invocation rollback

assert_fails validate_invocation status unexpected
assert_fails validate_invocation deploy
assert_fails validate_invocation deploy preview
assert_fails validate_invocation deploy "${valid_sha}extra"
assert_fails validate_invocation rollback "$valid_sha"
assert_fails validate_invocation production

sanitized_environment="$({
    BACKEND_ENV_FILE=/tmp/attacker.env \
    COMPOSE_PROJECT_NAME=attacker \
    DOCKER_HOST=tcp://attacker.invalid \
    GIT_DIR=/tmp/attacker.git \
    LIGHTSAIL_STATE_ROOT=/tmp/attacker-state \
    run_sanitized /usr/bin/env
})"

assert_equals "" "$(printf '%s\n' "$sanitized_environment" | grep -E '^(BACKEND_ENV_FILE|COMPOSE_PROJECT_NAME|DOCKER_HOST|GIT_DIR|LIGHTSAIL_STATE_ROOT)=' || true)"
assert_equals "/home/ubuntu" "$(printf '%s\n' "$sanitized_environment" | awk -F= '$1 == "HOME" { print $2 }')"
assert_equals "ubuntu" "$(printf '%s\n' "$sanitized_environment" | awk -F= '$1 == "USER" { print $2 }')"

mock_current_tag="$valid_sha"
mock_image_name="babyjamjam-backend:$valid_sha"
mock_public_health='{"status":"ok"}'

find_preview_api_container() {
    echo "preview-api-container"
}

read_recorded_tag() {
    if [[ "$1" == *"current-image-tag" ]]; then
        echo "$mock_current_tag"
    else
        echo "0000000000000000000000000000000000000000"
    fi
}

run_sanitized() {
    if [[ "$1" == "/usr/bin/curl" ]]; then
        printf '%s\n' "$mock_public_health"
        return 0
    fi

    case "${4:-}" in
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')
            echo "healthy"
            ;;
        '{{.Config.Image}}')
            echo "$mock_image_name"
            ;;
        '{{.RestartCount}}')
            echo "0"
            ;;
        '{{range .Config.Env}}{{println .}}{{end}}')
            echo "SCHEDULERS_ENABLED=false"
            ;;
        *)
            fail "unexpected sanitized mock invocation: $*"
            ;;
    esac
}

status_output="$(status_preview)"
[[ "$status_output" == *"preview_current_tag=$valid_sha"* ]] || fail "status did not report the current tag"
[[ "$status_output" == *"preview_public_health=ok"* ]] || fail "status did not report public health"

mock_image_name="babyjamjam-backend:0000000000000000000000000000000000000000"
assert_fails status_preview

mock_image_name="babyjamjam-backend:$valid_sha"
mock_public_health='{"status":"degraded"}'
assert_fails status_preview

echo "operator-preview tests passed"
