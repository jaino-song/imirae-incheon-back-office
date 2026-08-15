#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
COMPOSE_FILE="$REPOSITORY_ROOT/backend/compose.lightsail.yml"
STATE_DIRECTORY="${DEPLOY_STATE_DIRECTORY:-/opt/babyjamjam}"
ENV_FILE="${BACKEND_ENV_FILE:-$STATE_DIRECTORY/backend.env}"
CURRENT_TAG_FILE="$STATE_DIRECTORY/current-image-tag"
PREVIOUS_TAG_FILE="$STATE_DIRECTORY/previous-image-tag"
TARGET_TAG="${1:-}"
PUBLIC_HEALTH_URL="${BACKEND_PUBLIC_HEALTH_URL:-http://127.0.0.1/health}"

if [[ -z "$TARGET_TAG" && -r "$PREVIOUS_TAG_FILE" ]]; then
    TARGET_TAG="$(<"$PREVIOUS_TAG_FILE")"
fi

if [[ -z "$TARGET_TAG" ]]; then
    echo "Pass an image tag or deploy at least two healthy versions before using automatic rollback." >&2
    exit 1
fi

if [[ ! -r "$ENV_FILE" ]]; then
    echo "Backend environment file is not readable: $ENV_FILE" >&2
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to verify the public backend health route." >&2
    exit 1
fi

if [[ "$PUBLIC_HEALTH_URL" != http://* && "$PUBLIC_HEALTH_URL" != https://* ]]; then
    echo "BACKEND_PUBLIC_HEALTH_URL must use http:// or https://: $PUBLIC_HEALTH_URL" >&2
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

docker compose -f "$COMPOSE_FILE" config --quiet
docker compose -f "$COMPOSE_FILE" up -d --no-build api caddy

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

caddy_container_id="$(docker compose -f "$COMPOSE_FILE" ps -q caddy)"
if [[ -z "$caddy_container_id" ]]; then
    echo "The Caddy container was not created." >&2
    exit 1
fi

proxy_is_healthy=false
for _attempt in $(seq 1 30); do
    caddy_status="$(docker inspect --format '{{.State.Status}}' "$caddy_container_id")"

    if [[ "$caddy_status" == "running" ]] && curl --fail --silent --location --proto '=http,https' --proto-redir '=http,https' --connect-timeout 5 --max-time 10 "$PUBLIC_HEALTH_URL" >/dev/null; then
        proxy_is_healthy=true
        break
    fi

    if [[ "$caddy_status" == "exited" || "$caddy_status" == "dead" ]]; then
        docker compose -f "$COMPOSE_FILE" logs --tail 100 caddy >&2
        echo "Rollback failed with Caddy state: $caddy_status" >&2
        exit 1
    fi

    sleep 2
done

if [[ "$proxy_is_healthy" != "true" ]]; then
    docker compose -f "$COMPOSE_FILE" logs --tail 100 api caddy >&2
    echo "Rollback timed out waiting for the public health check: $PUBLIC_HEALTH_URL" >&2
    exit 1
fi

if [[ -n "$current_tag" && "$current_tag" != "$TARGET_TAG" ]]; then
    printf '%s\n' "$current_tag" > "$PREVIOUS_TAG_FILE"
fi

printf '%s\n' "$TARGET_TAG" > "$CURRENT_TAG_FILE"
echo "Rolled back after API and public proxy health checks: $TARGET_TAG"
