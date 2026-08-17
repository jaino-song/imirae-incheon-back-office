#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
COMPOSE_FILE="$REPOSITORY_ROOT/backend/compose.lightsail.edge.yml"
PRODUCTION_EDGE_NETWORK="${PRODUCTION_EDGE_NETWORK:-babyjamjam-edge-production}"
PREVIEW_EDGE_NETWORK="${PREVIEW_EDGE_NETWORK:-babyjamjam-edge-preview}"
CADDY_CONFIG_VOLUME="${CADDY_CONFIG_VOLUME:-babyjamjam-backend_caddy_config}"
CADDY_DATA_VOLUME="${CADDY_DATA_VOLUME:-babyjamjam-backend_caddy_data}"
PRODUCTION_CADDY_SITE_ADDRESS="${PRODUCTION_CADDY_SITE_ADDRESS:-api.babyjamjam.com}"
PRODUCTION_CADDY_UPSTREAM="${PRODUCTION_CADDY_UPSTREAM:-api-production:3001}"
PREVIEW_CADDY_SITE_ADDRESS="${PREVIEW_CADDY_SITE_ADDRESS:-preview.api.babyjamjam.com}"
PREVIEW_CADDY_UPSTREAM="${PREVIEW_CADDY_UPSTREAM:-api-preview:3001}"
PRODUCTION_HEALTH_URL="${PRODUCTION_PUBLIC_HEALTH_URL:-https://api.babyjamjam.com/health}"
PREVIEW_HEALTH_URL="${PREVIEW_PUBLIC_HEALTH_URL:-https://preview.api.babyjamjam.com/health}"

if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to verify the public backend health routes." >&2
    exit 1
fi

if [[ -n "$(git -C "$REPOSITORY_ROOT" status --porcelain --untracked-files=all)" ]]; then
    echo "Refusing to deploy the edge from a dirty checkout: $REPOSITORY_ROOT" >&2
    git -C "$REPOSITORY_ROOT" status --short >&2
    exit 1
fi

for edge_network in "$PRODUCTION_EDGE_NETWORK" "$PREVIEW_EDGE_NETWORK"; do
    if ! docker network inspect "$edge_network" >/dev/null 2>&1; then
        docker network create "$edge_network" >/dev/null
    fi
done

if ! docker volume inspect "$CADDY_CONFIG_VOLUME" >/dev/null 2>&1; then
    docker volume create "$CADDY_CONFIG_VOLUME" >/dev/null
fi

if ! docker volume inspect "$CADDY_DATA_VOLUME" >/dev/null 2>&1; then
    docker volume create "$CADDY_DATA_VOLUME" >/dev/null
fi

export CADDY_CONFIG_VOLUME
export CADDY_DATA_VOLUME
export PREVIEW_CADDY_SITE_ADDRESS
export PREVIEW_CADDY_UPSTREAM
export PREVIEW_EDGE_NETWORK
export PRODUCTION_CADDY_SITE_ADDRESS
export PRODUCTION_CADDY_UPSTREAM
export PRODUCTION_EDGE_NETWORK

docker compose -f "$COMPOSE_FILE" config --quiet
docker run --rm \
    --network none \
    --read-only \
    --tmpfs /config \
    --tmpfs /data \
    --env PREVIEW_CADDY_SITE_ADDRESS \
    --env PREVIEW_CADDY_UPSTREAM \
    --env PRODUCTION_CADDY_SITE_ADDRESS \
    --env PRODUCTION_CADDY_UPSTREAM \
    --volume "$REPOSITORY_ROOT/backend/deploy/lightsail/Caddyfile:/etc/caddy/Caddyfile:ro" \
    caddy:2.10.2-alpine validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -f "$COMPOSE_FILE" up -d --force-recreate --remove-orphans caddy

caddy_container_id="$(docker compose -f "$COMPOSE_FILE" ps -q caddy)"
if [[ -z "$caddy_container_id" ]]; then
    echo "The shared Caddy container was not created." >&2
    exit 1
fi

for health_url in "$PRODUCTION_HEALTH_URL" "$PREVIEW_HEALTH_URL"; do
    route_is_healthy=false

    for _attempt in $(seq 1 30); do
        caddy_status="$(docker inspect --format '{{.State.Status}}' "$caddy_container_id")"

        if [[ "$caddy_status" == "running" ]] && curl --fail --silent --location --proto '=http,https' --proto-redir '=http,https' --connect-timeout 5 --max-time 10 "$health_url" >/dev/null; then
            route_is_healthy=true
            break
        fi

        if [[ "$caddy_status" == "exited" || "$caddy_status" == "dead" ]]; then
            docker compose -f "$COMPOSE_FILE" logs --tail 100 caddy >&2
            echo "Edge deployment failed with Caddy state: $caddy_status" >&2
            exit 1
        fi

        sleep 2
    done

    if [[ "$route_is_healthy" != "true" ]]; then
        docker compose -f "$COMPOSE_FILE" logs --tail 100 caddy >&2
        echo "Edge deployment timed out waiting for the public health check: $health_url" >&2
        exit 1
    fi
done

echo "Deployed the shared Caddy edge after production and preview health checks."
