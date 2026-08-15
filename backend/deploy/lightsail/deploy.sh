#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
COMPOSE_FILE="$REPOSITORY_ROOT/backend/compose.lightsail.yml"
STATE_DIRECTORY="${DEPLOY_STATE_DIRECTORY:-/opt/babyjamjam}"
ENV_FILE="${BACKEND_ENV_FILE:-$STATE_DIRECTORY/backend.env}"
CURRENT_TAG_FILE="$STATE_DIRECTORY/current-image-tag"
PREVIOUS_TAG_FILE="$STATE_DIRECTORY/previous-image-tag"
IMAGE_TAG="$(git -C "$REPOSITORY_ROOT" rev-parse --verify HEAD)"
PUBLIC_HEALTH_URL="${BACKEND_PUBLIC_HEALTH_URL:-http://127.0.0.1/health}"

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

if [[ -n "$(git -C "$REPOSITORY_ROOT" status --porcelain --untracked-files=all)" ]]; then
    echo "Refusing to tag a deployment from a dirty checkout: $REPOSITORY_ROOT" >&2
    git -C "$REPOSITORY_ROOT" status --short >&2
    exit 1
fi

mkdir -p "$STATE_DIRECTORY"

export BACKEND_ENV_FILE="$ENV_FILE"
export BACKEND_IMAGE_TAG="$IMAGE_TAG"

docker compose -f "$COMPOSE_FILE" config --quiet
docker compose -f "$COMPOSE_FILE" build --pull api
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

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
        echo "Deployment failed with API state: $health_status" >&2
        exit 1
    fi

    sleep 2
done

if [[ "$api_is_healthy" != "true" ]]; then
    docker compose -f "$COMPOSE_FILE" logs --tail 100 api >&2
    echo "Deployment timed out waiting for the API health check." >&2
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
        echo "Deployment failed with Caddy state: $caddy_status" >&2
        exit 1
    fi

    sleep 2
done

if [[ "$proxy_is_healthy" != "true" ]]; then
    docker compose -f "$COMPOSE_FILE" logs --tail 100 api caddy >&2
    echo "Deployment timed out waiting for the public health check: $PUBLIC_HEALTH_URL" >&2
    exit 1
fi

previous_tag=""
if [[ -r "$CURRENT_TAG_FILE" ]]; then
    previous_tag="$(<"$CURRENT_TAG_FILE")"
fi

if [[ -n "$previous_tag" && "$previous_tag" != "$IMAGE_TAG" ]]; then
    printf '%s\n' "$previous_tag" > "$PREVIOUS_TAG_FILE"
fi

printf '%s\n' "$IMAGE_TAG" > "$CURRENT_TAG_FILE"
echo "Deployed backend image after API and public proxy health checks: $IMAGE_TAG"
