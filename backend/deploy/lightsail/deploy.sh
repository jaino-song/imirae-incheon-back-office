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

if [[ ! -r "$ENV_FILE" ]]; then
    echo "Backend environment file is not readable: $ENV_FILE" >&2
    exit 1
fi

mkdir -p "$STATE_DIRECTORY"

export BACKEND_ENV_FILE="$ENV_FILE"
export BACKEND_IMAGE_TAG="$IMAGE_TAG"
export SCHEDULERS_ENABLED="${SCHEDULERS_ENABLED:-false}"

docker compose -f "$COMPOSE_FILE" config --quiet
docker compose -f "$COMPOSE_FILE" build --pull api
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

api_container_id="$(docker compose -f "$COMPOSE_FILE" ps -q api)"
if [[ -z "$api_container_id" ]]; then
    echo "The API container was not created." >&2
    exit 1
fi

for _attempt in $(seq 1 30); do
    health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_container_id")"

    if [[ "$health_status" == "healthy" ]]; then
        previous_tag=""
        if [[ -r "$CURRENT_TAG_FILE" ]]; then
            previous_tag="$(<"$CURRENT_TAG_FILE")"
        fi

        if [[ -n "$previous_tag" && "$previous_tag" != "$IMAGE_TAG" ]]; then
            printf '%s\n' "$previous_tag" > "$PREVIOUS_TAG_FILE"
        fi

        printf '%s\n' "$IMAGE_TAG" > "$CURRENT_TAG_FILE"
        echo "Deployed healthy backend image: $IMAGE_TAG"
        exit 0
    fi

    if [[ "$health_status" == "unhealthy" || "$health_status" == "exited" || "$health_status" == "dead" ]]; then
        docker compose -f "$COMPOSE_FILE" logs --tail 100 api >&2
        echo "Deployment failed with API state: $health_status" >&2
        exit 1
    fi

    sleep 2
done

docker compose -f "$COMPOSE_FILE" logs --tail 100 api >&2
echo "Deployment timed out waiting for the API health check." >&2
exit 1
