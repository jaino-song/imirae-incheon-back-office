#!/bin/bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

if [[ "$EUID" -ne 0 ]]; then
    echo "The Lightsail deployment script must run as root." >&2
    exit 1
fi

readonly PROTECTED_ARTIFACT_DIRECTORY="/usr/local/libexec/babyjamjam-ci-operator"
readonly PROTECTED_OPERATOR_PATH="/usr/local/sbin/babyjamjam-ci-operator"
readonly PROTECTED_COMPOSE_FILE="$PROTECTED_ARTIFACT_DIRECTORY/compose.lightsail.yml"
readonly PROTECTED_BUNDLE_MANIFEST="$PROTECTED_ARTIFACT_DIRECTORY/bundle.manifest"
readonly PROTECTED_BUNDLE_MANIFEST_VERSION="1"
readonly PROTECTED_COMPOSE_ENV_FILE="/dev/null"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ "$SCRIPT_DIR" != "$PROTECTED_ARTIFACT_DIRECTORY" ]]; then
    echo "The repository deployment helper is retired; invoke the installed CI operator or protected bundle." >&2
    exit 1
fi

validate_protected_artifact_file() {
    local artifact_path="$1"
    local expected_mode="$2"
    local path_component
    local path_metadata
    local path_mode
    local path_permissions

    [[ "$artifact_path" == /* && -f "$artifact_path" && ! -L "$artifact_path" ]] \
        || {
            echo "A required protected deployment artifact is missing or invalid." >&2
            exit 1
        }
    path_component="$artifact_path"
    while [[ "$path_component" != "/" ]]; do
        [[ ! -L "$path_component" ]] || {
            echo "A protected deployment artifact path contains a symbolic link." >&2
            exit 1
        }
        path_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$path_component")" || {
            echo "Unable to inspect a protected deployment artifact." >&2
            exit 1
        }
        [[ "${path_metadata%%:*}" == root ]] || {
            echo "A protected deployment artifact path is not root-owned." >&2
            exit 1
        }
        path_mode="${path_metadata##*:}"
        path_permissions="${path_mode: -3}"
        [[ "${path_permissions:1:1}" != [2367] \
            && "${path_permissions:2:1}" != [2367] ]] || {
            echo "A protected deployment artifact path is group/world writable." >&2
            exit 1
        }
        path_component="$(/usr/bin/dirname "$path_component")"
    done
    [[ "$(/usr/bin/stat -c '%U:%G:%a' "$artifact_path")" == "root:root:$expected_mode" ]] || {
        echo "A protected deployment artifact has unexpected ownership or mode." >&2
        exit 1
    }
}

sha256_protected_artifact() {
    local artifact_path="$1"
    local digest_output

    if [[ -x /usr/bin/sha256sum ]]; then
        digest_output="$(/usr/bin/sha256sum "$artifact_path")" || return 1
    elif [[ -x /sbin/sha256sum ]]; then
        digest_output="$(/sbin/sha256sum "$artifact_path")" || return 1
    elif [[ -x /usr/bin/shasum ]]; then
        digest_output="$(/usr/bin/shasum -a 256 "$artifact_path")" || return 1
    else
        return 1
    fi
    digest_output="${digest_output%% *}"
    [[ "$digest_output" =~ ^[0-9a-f]{64}$ ]] || return 1
    printf '%s\n' "$digest_output"
}

validate_protected_bundle_manifest() {
    local manifest_line_count
    local entrypoint_digest
    local operator_digest
    local deploy_digest
    local rollback_digest
    local compose_digest

    [[ -f "$PROTECTED_BUNDLE_MANIFEST" && ! -L "$PROTECTED_BUNDLE_MANIFEST" ]] || {
        echo "The protected operator bundle manifest is missing or invalid." >&2
        exit 1
    }
    [[ "$(/usr/bin/stat -c '%U:%G:%a' "$PROTECTED_BUNDLE_MANIFEST")" == root:root:640 ]] || {
        echo "The protected operator bundle manifest has unexpected ownership or mode." >&2
        exit 1
    }
    manifest_line_count="$(/usr/bin/wc -l <"$PROTECTED_BUNDLE_MANIFEST")"
    [[ "$manifest_line_count" -eq 6 ]] || {
        echo "The protected operator bundle manifest is incomplete." >&2
        exit 1
    }
    entrypoint_digest="$(sha256_protected_artifact "$PROTECTED_OPERATOR_PATH")" || {
        echo "Unable to hash the installed CI operator entrypoint." >&2
        exit 1
    }
    operator_digest="$(sha256_protected_artifact "$PROTECTED_ARTIFACT_DIRECTORY/ci-operator.sh")" || {
        echo "Unable to hash the protected CI operator artifact." >&2
        exit 1
    }
    deploy_digest="$(sha256_protected_artifact "$PROTECTED_ARTIFACT_DIRECTORY/deploy.sh")" || {
        echo "Unable to hash the protected deploy artifact." >&2
        exit 1
    }
    rollback_digest="$(sha256_protected_artifact "$PROTECTED_ARTIFACT_DIRECTORY/rollback.sh")" || {
        echo "Unable to hash the protected rollback artifact." >&2
        exit 1
    }
    compose_digest="$(sha256_protected_artifact "$PROTECTED_COMPOSE_FILE")" || {
        echo "Unable to hash the protected Compose artifact." >&2
        exit 1
    }
    /usr/bin/grep -Fqx "version=$PROTECTED_BUNDLE_MANIFEST_VERSION" "$PROTECTED_BUNDLE_MANIFEST" || {
        echo "The protected operator bundle manifest version is unsupported." >&2
        exit 1
    }
    /usr/bin/grep -Fqx "entrypoint=root:root:750:$entrypoint_digest" "$PROTECTED_BUNDLE_MANIFEST" || {
        echo "The protected operator bundle entrypoint does not match its manifest." >&2
        exit 1
    }
    /usr/bin/grep -Fqx "ci-operator.sh=root:root:750:$operator_digest" "$PROTECTED_BUNDLE_MANIFEST" || {
        echo "The protected CI operator artifact does not match its manifest." >&2
        exit 1
    }
    /usr/bin/grep -Fqx "deploy.sh=root:root:750:$deploy_digest" "$PROTECTED_BUNDLE_MANIFEST" || {
        echo "The protected deploy artifact does not match its manifest." >&2
        exit 1
    }
    /usr/bin/grep -Fqx "rollback.sh=root:root:750:$rollback_digest" "$PROTECTED_BUNDLE_MANIFEST" || {
        echo "The protected rollback artifact does not match its manifest." >&2
        exit 1
    }
    /usr/bin/grep -Fqx "compose.lightsail.yml=root:root:640:$compose_digest" "$PROTECTED_BUNDLE_MANIFEST" || {
        echo "The protected Compose artifact does not match its manifest." >&2
        exit 1
    }
}

validate_protected_bundle_paths() {
    local artifact_path

    for artifact_path in "$PROTECTED_ARTIFACT_DIRECTORY"/*; do
        [[ -e "$artifact_path" || -L "$artifact_path" ]] || continue
        case "$artifact_path" in
            "$PROTECTED_ARTIFACT_DIRECTORY/ci-operator.sh"|"$PROTECTED_ARTIFACT_DIRECTORY/deploy.sh"|"$PROTECTED_ARTIFACT_DIRECTORY/rollback.sh"|"$PROTECTED_COMPOSE_FILE"|"$PROTECTED_BUNDLE_MANIFEST")
                ;;
            *)
                echo "The protected CI operator bundle contains an unexpected path." >&2
                exit 1
                ;;
        esac
    done
    for artifact_path in "$PROTECTED_ARTIFACT_DIRECTORY"/.[!.]* "$PROTECTED_ARTIFACT_DIRECTORY"/..?*; do
        [[ -e "$artifact_path" || -L "$artifact_path" ]] || continue
        echo "The protected CI operator bundle contains an unexpected path." >&2
        exit 1
    done
}

validate_protected_runtime_bundle() {
    local script_path="$SCRIPT_DIR/$(/usr/bin/basename "${BASH_SOURCE[0]}")"

    [[ "$script_path" == "$PROTECTED_ARTIFACT_DIRECTORY/deploy.sh" ]] || {
        echo "The protected deployment helper path is invalid." >&2
        exit 1
    }
    [[ -d "$PROTECTED_ARTIFACT_DIRECTORY" && ! -L "$PROTECTED_ARTIFACT_DIRECTORY" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$PROTECTED_ARTIFACT_DIRECTORY")" == root:root:700 ]] || {
        echo "The protected CI operator artifact directory is missing or unsafe." >&2
        exit 1
    }
    validate_protected_bundle_paths
    validate_protected_artifact_file "$script_path" 750
    validate_protected_artifact_file "$PROTECTED_OPERATOR_PATH" 750
    validate_protected_artifact_file "$PROTECTED_ARTIFACT_DIRECTORY/ci-operator.sh" 750
    validate_protected_artifact_file "$PROTECTED_ARTIFACT_DIRECTORY/rollback.sh" 750
    validate_protected_artifact_file "$PROTECTED_COMPOSE_FILE" 640
    validate_protected_artifact_file "$PROTECTED_BUNDLE_MANIFEST" 640
    validate_protected_bundle_manifest
}

validate_protected_runtime_bundle
cd "$PROTECTED_ARTIFACT_DIRECTORY"

if [[ -n "${BACKEND_COMPOSE_FILE:-}" && "$BACKEND_COMPOSE_FILE" != "$PROTECTED_COMPOSE_FILE" ]]; then
    echo "BACKEND_COMPOSE_FILE must reference the protected CI operator Compose artifact." >&2
    exit 1
fi
COMPOSE_FILE="$PROTECTED_COMPOSE_FILE"
ENVIRONMENT="${1:-${LIGHTSAIL_ENVIRONMENT:-}}"
STATE_ROOT="${LIGHTSAIL_STATE_ROOT:-/opt/babyjamjam}"
PUBLIC_HEALTH_REQUIRED="${BACKEND_PUBLIC_HEALTH_REQUIRED:-true}"
BUILD_IMAGE="${BACKEND_BUILD_IMAGE:-false}"

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
        echo "Usage: $0 <production|preview>" >&2
        exit 1
        ;;
esac

STATE_DIRECTORY="${DEPLOY_STATE_DIRECTORY:-$STATE_ROOT/environments/$ENVIRONMENT}"
ENV_FILE="${BACKEND_ENV_FILE:-$STATE_DIRECTORY/backend.env}"
CURRENT_TAG_FILE="$STATE_DIRECTORY/current-image-tag"
PREVIOUS_TAG_FILE="$STATE_DIRECTORY/previous-image-tag"
IMAGE_TAG="${BACKEND_IMAGE_TAG:-}"
DATABASE_CONNECTION_MODE="${DATABASE_CONNECTION_MODE:-shared}"
PUBLIC_HEALTH_URL="${BACKEND_PUBLIC_HEALTH_URL:-$DEFAULT_PUBLIC_HEALTH_URL}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-babyjamjam-backend-$ENVIRONMENT}"
NETWORK_ALIAS="${BACKEND_NETWORK_ALIAS:-api-$ENVIRONMENT}"
VALKEY_DATA_VOLUME="${VALKEY_DATA_VOLUME:-$DEFAULT_VALKEY_DATA_VOLUME}"
EDGE_NETWORK="${LIGHTSAIL_EDGE_NETWORK:-$DEFAULT_EDGE_NETWORK}"

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
    local path_prefix
    local path_without_root
    local path_component
    local path_type
    local path_metadata
    local path_owner
    local path_group
    local path_mode
    local path_permissions
    local -a path_components

    [[ "$ENV_FILE" == /* ]] || {
        echo "Backend environment file path must be absolute." >&2
        exit 1
    }
    path_without_root="${ENV_FILE#/}"
    [[ -n "$path_without_root" ]] || {
        echo "Backend environment file path must name a regular file." >&2
        exit 1
    }
    IFS='/' read -r -a path_components <<<"$path_without_root"
    path_prefix="/"
    for path_component in "${path_components[@]}"; do
        case "$path_component" in
            ''|.) continue ;;
            ..)
                echo "Backend environment file path must not contain '..'." >&2
                exit 1
                ;;
        esac
        path_prefix="${path_prefix%/}/$path_component"
        if [[ ! -e "$path_prefix" || -L "$path_prefix" ]]; then
            echo "Backend environment path component is missing or invalid." >&2
            exit 1
        fi
        path_type="$(/usr/bin/stat -c '%F' "$path_prefix")"
        path_metadata="$(/usr/bin/stat -c '%U:%G:%a' "$path_prefix")"
        path_owner="${path_metadata%%:*}"
        path_group="${path_metadata#*:}"
        path_group="${path_group%%:*}"
        path_mode="${path_metadata##*:}"
        if [[ "$path_owner:$path_group" != "root:root" ]]; then
            echo "Backend environment path component is not root-owned." >&2
            exit 1
        fi
        if [[ "$path_prefix" == "$ENV_FILE" ]]; then
            if [[ "$path_type" != "regular file" || "$path_metadata" != "root:root:600" ]]; then
                echo "Backend environment file must be root:root mode 0600." >&2
                exit 1
            fi
        else
            path_permissions="${path_mode: -3}"
            if [[ "$path_type" != "directory" \
                || "${path_permissions:1:1}" == [2367] \
                || "${path_permissions:2:1}" == [2367] ]]; then
                echo "Backend environment file is group/world accessible or has an unsafe ancestor." >&2
                exit 1
            fi
        fi
    done
    [[ "$path_prefix" == "$ENV_FILE" ]] || {
        echo "Backend environment file path must name a regular file." >&2
        exit 1
    }
}

validate_env_file_permissions

if [[ -z "$IMAGE_TAG" ]]; then
    echo "The installed deployment helper requires BACKEND_IMAGE_TAG from the CI operator." >&2
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

if [[ "$PUBLIC_HEALTH_REQUIRED" != "true" && "$PUBLIC_HEALTH_REQUIRED" != "false" ]]; then
    echo "BACKEND_PUBLIC_HEALTH_REQUIRED must be true or false." >&2
    exit 1
fi

if [[ "$BUILD_IMAGE" != "false" ]]; then
    echo "The protected deployment helper requires BACKEND_BUILD_IMAGE=false and a preloaded image." >&2
    exit 1
fi

if [[ "$DATABASE_CONNECTION_MODE" != "shared" && "$DATABASE_CONNECTION_MODE" != "direct" ]]; then
    echo "DATABASE_CONNECTION_MODE must be shared or direct." >&2
    exit 1
fi

if [[ "$ENVIRONMENT" == "preview" && "$(read_environment_value SCHEDULERS_ENABLED)" != "false" ]]; then
    echo "Preview deployments require SCHEDULERS_ENABLED=false in $ENV_FILE." >&2
    exit 1
fi

mkdir -p "$STATE_DIRECTORY"

export BACKEND_ENV_FILE="$ENV_FILE"
export BACKEND_IMAGE_TAG="$IMAGE_TAG"
export BACKEND_CPU_LIMIT="${BACKEND_CPU_LIMIT:-$DEFAULT_BACKEND_CPU_LIMIT}"
export BACKEND_MEMORY_LIMIT="${BACKEND_MEMORY_LIMIT:-$DEFAULT_BACKEND_MEMORY_LIMIT}"
export BACKEND_NETWORK_ALIAS="$NETWORK_ALIAS"
export COMPOSE_PROJECT_NAME="$PROJECT_NAME"
export LIGHTSAIL_EDGE_NETWORK="$EDGE_NETWORK"
export VALKEY_DATA_VOLUME
export DATABASE_CONNECTION_MODE

if ! docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1; then
    docker network create "$EDGE_NETWORK" >/dev/null 2>&1
fi

if ! docker volume inspect "$VALKEY_DATA_VOLUME" >/dev/null 2>&1; then
    docker volume create "$VALKEY_DATA_VOLUME" >/dev/null 2>&1
fi

docker compose --env-file "$PROTECTED_COMPOSE_ENV_FILE" \
    --project-directory "$PROTECTED_ARTIFACT_DIRECTORY" \
    -f "$COMPOSE_FILE" config --quiet >/dev/null 2>&1
if ! docker image inspect "${BACKEND_IMAGE:-babyjamjam-backend}:$IMAGE_TAG" >/dev/null 2>&1; then
    echo "BACKEND_BUILD_IMAGE=false requires a local image: ${BACKEND_IMAGE:-babyjamjam-backend}:$IMAGE_TAG" >&2
    exit 1
fi
docker compose --env-file "$PROTECTED_COMPOSE_ENV_FILE" \
    --project-directory "$PROTECTED_ARTIFACT_DIRECTORY" \
    -f "$COMPOSE_FILE" up -d --no-build --remove-orphans >/dev/null 2>&1
docker compose --env-file "$PROTECTED_COMPOSE_ENV_FILE" \
    --project-directory "$PROTECTED_ARTIFACT_DIRECTORY" \
    -f "$COMPOSE_FILE" up -d --no-build --no-deps --force-recreate api >/dev/null 2>&1

api_container_id="$(docker compose --env-file "$PROTECTED_COMPOSE_ENV_FILE" \
    --project-directory "$PROTECTED_ARTIFACT_DIRECTORY" \
    -f "$COMPOSE_FILE" ps -q api)"
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
        echo "Deployment failed with API state: $health_status" >&2
        exit 1
    fi

    sleep 2
done

if [[ "$api_is_healthy" != "true" ]]; then
    echo "Deployment timed out waiting for the API health check." >&2
    exit 1
fi

if [[ "$PUBLIC_HEALTH_REQUIRED" == "false" ]]; then
    echo "Started $ENVIRONMENT after the internal API health check only; deployment state was not recorded."
    echo "Deploy the shared edge, then rerun with BACKEND_PUBLIC_HEALTH_REQUIRED=true." >&2
    exit 0
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
echo "Deployed $ENVIRONMENT backend image after API and public proxy health checks: $IMAGE_TAG"
