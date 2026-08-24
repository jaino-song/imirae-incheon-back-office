#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
COMPOSE_FILE="$REPOSITORY_ROOT/backend/compose.lightsail.yml"
ENVIRONMENT="${1:-${LIGHTSAIL_ENVIRONMENT:-}}"
REQUESTED_TAG="${2:-}"
STATE_ROOT="${LIGHTSAIL_STATE_ROOT:-/opt/babyjamjam}"

case "$ENVIRONMENT" in
    production)
        DEFAULT_PUBLIC_HEALTH_URL="https://api.babyjamjam.com/health"
        DEFAULT_BACKEND_CPU_LIMIT="1.5"
        DEFAULT_BACKEND_MEMORY_LIMIT="2g"
        DEFAULT_VALKEY_DATA_VOLUME="babyjamjam-backend-production_valkey_data"
        DEFAULT_EDGE_NETWORK="babyjamjam-edge-production"
        ;;
    preview)
        DEFAULT_PUBLIC_HEALTH_URL="https://preview.api.babyjamjam.com/health"
        DEFAULT_BACKEND_CPU_LIMIT="0.5"
        DEFAULT_BACKEND_MEMORY_LIMIT="1g"
        DEFAULT_VALKEY_DATA_VOLUME="babyjamjam-backend-preview_valkey_data"
        DEFAULT_EDGE_NETWORK="babyjamjam-edge-preview"
        ;;
    *)
        echo "Usage: $0 <production|preview> [image-tag]" >&2
        exit 1
        ;;
esac

STATE_DIRECTORY="${DEPLOY_STATE_DIRECTORY:-$STATE_ROOT/environments/$ENVIRONMENT}"
ENV_FILE="${BACKEND_ENV_FILE:-$STATE_DIRECTORY/backend.env}"
CURRENT_TAG_FILE="$STATE_DIRECTORY/current-image-tag"
PREVIOUS_TAG_FILE="$STATE_DIRECTORY/previous-image-tag"
TARGET_TAG="$REQUESTED_TAG"
DATABASE_CONNECTION_MODE="${DATABASE_CONNECTION_MODE:-shared}"
PUBLIC_HEALTH_URL="${BACKEND_PUBLIC_HEALTH_URL:-$DEFAULT_PUBLIC_HEALTH_URL}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-babyjamjam-backend-$ENVIRONMENT}"
NETWORK_ALIAS="${BACKEND_NETWORK_ALIAS:-api-$ENVIRONMENT}"
VALKEY_DATA_VOLUME="${VALKEY_DATA_VOLUME:-$DEFAULT_VALKEY_DATA_VOLUME}"
EDGE_NETWORK="${LIGHTSAIL_EDGE_NETWORK:-$DEFAULT_EDGE_NETWORK}"
PRESERVE_PREVIOUS_TAG="${BACKEND_ROLLBACK_PRESERVE_PREVIOUS_TAG:-false}"

read_environment_value() {
    local wanted_key="$1"

    awk -v wanted_key="$wanted_key" '
        /^[[:space:]]*#/ { next }
        {
            separator = index($0, "=")
            if (separator == 0) next

            key = substr($0, 1, separator - 1)
            gsub(/[[:space:]]/, "", key)
            if (key != wanted_key) next

            value = substr($0, separator + 1)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
            quote = substr(value, 1, 1)
            if ((quote == "\"" || quote == "\047") && substr(value, length(value), 1) == quote) {
                value = substr(value, 2, length(value) - 2)
            }
            result = tolower(value)
        }
        END { print result }
    ' "$ENV_FILE"
}

validate_env_file_permissions() {
    local env_file_mode
    local permission_bits

    if [[ ! -f "$ENV_FILE" || -L "$ENV_FILE" ]]; then
        echo "Backend environment file is missing or invalid: $ENV_FILE" >&2
        exit 1
    fi
    if [[ ! -r "$ENV_FILE" ]]; then
        echo "Backend environment file is not readable: $ENV_FILE" >&2
        exit 1
    fi
    env_file_mode="$(/usr/bin/stat -c '%a' "$ENV_FILE")"
    if [[ ! "$env_file_mode" =~ ^0?[0-7]{3}$ ]]; then
        echo "Backend environment file mode is invalid: $ENV_FILE" >&2
        exit 1
    fi
    permission_bits="${env_file_mode: -3}"
    if [[ "${permission_bits:1:1}" != "0" || "${permission_bits:2:1}" != "0" ]]; then
        echo "Backend environment file is group/world accessible: $ENV_FILE" >&2
        exit 1
    fi
}

if [[ -z "$TARGET_TAG" && -r "$PREVIOUS_TAG_FILE" ]]; then
    TARGET_TAG="$(<"$PREVIOUS_TAG_FILE")"
fi

if [[ -z "$TARGET_TAG" ]]; then
    echo "Pass an image tag or deploy at least two healthy versions before using automatic rollback." >&2
    exit 1
fi

validate_env_file_permissions

if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to verify the public backend health route." >&2
    exit 1
fi

if [[ "$PUBLIC_HEALTH_URL" != http://* && "$PUBLIC_HEALTH_URL" != https://* ]]; then
    echo "BACKEND_PUBLIC_HEALTH_URL must use http:// or https://: $PUBLIC_HEALTH_URL" >&2
    exit 1
fi

if [[ "$PRESERVE_PREVIOUS_TAG" != "true" && "$PRESERVE_PREVIOUS_TAG" != "false" ]]; then
    echo "BACKEND_ROLLBACK_PRESERVE_PREVIOUS_TAG must be true or false." >&2
    exit 1
fi

if [[ "$DATABASE_CONNECTION_MODE" != "shared" && "$DATABASE_CONNECTION_MODE" != "direct" ]]; then
    echo "DATABASE_CONNECTION_MODE must be shared or direct." >&2
    exit 1
fi

if [[ "$ENVIRONMENT" == "preview" && "$(read_environment_value SCHEDULERS_ENABLED)" != "false" ]]; then
    echo "Preview rollbacks require SCHEDULERS_ENABLED=false in $ENV_FILE." >&2
    exit 1
fi

if ! docker image inspect "${BACKEND_IMAGE:-babyjamjam-backend}:$TARGET_TAG" >/dev/null 2>&1; then
    echo "Rollback image is not present locally: ${BACKEND_IMAGE:-babyjamjam-backend}:$TARGET_TAG" >&2
    exit 1
fi

current_tag=""
if [[ -r "$CURRENT_TAG_FILE" ]]; then
    current_tag="$(<"$CURRENT_TAG_FILE")"
fi

export BACKEND_ENV_FILE="$ENV_FILE"
export BACKEND_IMAGE_TAG="$TARGET_TAG"
export BACKEND_CPU_LIMIT="${BACKEND_CPU_LIMIT:-$DEFAULT_BACKEND_CPU_LIMIT}"
export BACKEND_MEMORY_LIMIT="${BACKEND_MEMORY_LIMIT:-$DEFAULT_BACKEND_MEMORY_LIMIT}"
export BACKEND_NETWORK_ALIAS="$NETWORK_ALIAS"
export COMPOSE_PROJECT_NAME="$PROJECT_NAME"
export LIGHTSAIL_EDGE_NETWORK="$EDGE_NETWORK"
export VALKEY_DATA_VOLUME
export DATABASE_CONNECTION_MODE

if ! docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1; then
    echo "The shared edge network does not exist: $EDGE_NETWORK" >&2
    exit 1
fi

if ! docker volume inspect "$VALKEY_DATA_VOLUME" >/dev/null 2>&1; then
    echo "The $ENVIRONMENT Valkey volume does not exist: $VALKEY_DATA_VOLUME" >&2
    exit 1
fi

docker compose -f "$COMPOSE_FILE" config --quiet
docker compose -f "$COMPOSE_FILE" up -d --no-build api

api_container_id="$(docker compose -f "$COMPOSE_FILE" ps -q api)"
if [[ -z "$api_container_id" ]]; then
    echo "The API container was not created." >&2
    exit 1
fi

api_is_healthy=false
for _attempt in $(seq 1 30); do
    health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_container_id")"

    if [[ "$health_status" == "healthy" ]]; then
        api_is_healthy=true
        break
    fi

    if [[ "$health_status" == "unhealthy" || "$health_status" == "exited" || "$health_status" == "dead" ]]; then
        docker compose -f "$COMPOSE_FILE" logs --tail 100 api >&2
        echo "Rollback failed with API state: $health_status" >&2
        exit 1
    fi

    sleep 2
done

if [[ "$api_is_healthy" != "true" ]]; then
    docker compose -f "$COMPOSE_FILE" logs --tail 100 api >&2
    echo "Rollback timed out waiting for the API health check." >&2
    exit 1
fi

public_route_is_healthy=false
for _attempt in $(seq 1 30); do
    if curl --fail --silent --location --proto '=http,https' --proto-redir '=http,https' --connect-timeout 5 --max-time 10 "$PUBLIC_HEALTH_URL" >/dev/null; then
        public_route_is_healthy=true
        break
    fi

    sleep 2
done

if [[ "$public_route_is_healthy" != "true" ]]; then
    docker compose -f "$COMPOSE_FILE" logs --tail 100 api >&2
    echo "Rollback timed out waiting for the public health check: $PUBLIC_HEALTH_URL" >&2
    exit 1
fi

if [[ "$PRESERVE_PREVIOUS_TAG" == "false" && -n "$current_tag" && "$current_tag" != "$TARGET_TAG" ]]; then
    printf '%s\n' "$current_tag" > "$PREVIOUS_TAG_FILE"
fi

printf '%s\n' "$TARGET_TAG" > "$CURRENT_TAG_FILE"
echo "Rolled back $ENVIRONMENT after API and public proxy health checks: $TARGET_TAG"
