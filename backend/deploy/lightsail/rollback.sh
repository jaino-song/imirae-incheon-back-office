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
export SCHEDULERS_ENABLED="${SCHEDULERS_ENABLED:-false}"

docker compose -f "$COMPOSE_FILE" config --quiet
docker compose -f "$COMPOSE_FILE" up -d --no-build api caddy

api_container_id="$(docker compose -f "$COMPOSE_FILE" ps -q api)"
for _attempt in $(seq 1 30); do
    health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_container_id")"

    if [[ "$health_status" == "healthy" ]]; then
        if [[ -n "$current_tag" && "$current_tag" != "$TARGET_TAG" ]]; then
            printf '%s\n' "$current_tag" > "$PREVIOUS_TAG_FILE"
        fi

        printf '%s\n' "$TARGET_TAG" > "$CURRENT_TAG_FILE"
        echo "Rolled back to healthy backend image: $TARGET_TAG"
        exit 0
    fi

    if [[ "$health_status" == "unhealthy" || "$health_status" == "exited" || "$health_status" == "dead" ]]; then
        docker compose -f "$COMPOSE_FILE" logs --tail 100 api >&2
        echo "Rollback failed with API state: $health_status" >&2
        exit 1
    fi

    sleep 2
done

docker compose -f "$COMPOSE_FILE" logs --tail 100 api >&2
echo "Rollback timed out waiting for the API health check." >&2
exit 1
