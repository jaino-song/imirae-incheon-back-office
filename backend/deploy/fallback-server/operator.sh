#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

readonly ARTIFACT_ROOT="/usr/local/libexec/babyjamjam-fallback-server"
readonly COMPOSE_FILE="$ARTIFACT_ROOT/compose.yml"
readonly DB_IDENTITY_HELPER="$ARTIFACT_ROOT/production-db-identity.sh"
readonly BUNDLE_MANIFEST="$ARTIFACT_ROOT/bundle.manifest"
readonly INSTALLED_OPERATOR="/usr/local/sbin/babyjamjam-fallback-server"
readonly STATE_ROOT="/opt/babyjamjam-fallback-server"
readonly STATE_DIRECTORY="$STATE_ROOT/state"
readonly ENV_FILE="$STATE_ROOT/backend.env"
readonly APPROVED_DB_REF_HASH_FILE="$STATE_ROOT/approved-production-db-ref.sha256"
readonly LOCK_FILE="/run/lock/babyjamjam-fallback-server.lock"
readonly IMAGE_REPOSITORY="ghcr.io/jaino-song/babyjamjam-admin-backend"
readonly LOCAL_IMAGE_REPOSITORY="babyjamjam-backend"
readonly PROJECT_NAME="babyjamjam-fallback-server"
readonly LOOPBACK_READY_URL="http://127.0.0.1:3101/health/ready"
readonly COMPOSE_ENV_FILE="/dev/null"
readonly SHA_PATTERN='^[0-9a-f]{40}$'
readonly DIGEST_PATTERN='^sha256:[0-9a-f]{64}$'
readonly REQUIRED_ENV_KEYS=(
    DATABASE_URL
    DIRECT_URL
    JWT_SECRET
    KAKAO_CLIENT_ID
    KAKAO_CLIENT_SECRET
    KAKAO_CALLBACK_URL
    SUPABASE_URL
    SUPABASE_SERVICE_KEY
    EFORMSIGN_USER_EMAIL
    EFORMSIGN_API_URL
    EFORMSIGN_DOC_API_URL
    EFORMSIGN_API_KEY
    EFORMSIGN_PRIVATE_KEY
    EFORMSIGN_COMPANY_ID
    EFORMSIGN_WEBHOOK_SECRET
    PRODUCTION_FRONTEND_URL
    PRODUCTION_MOBILE_FRONTEND_URL
    MOBILE_SERVICE_RECORD_BASE_URL
)
readonly PASSIVE_ENV_KEYS=(
    SCHEDULERS_ENABLED
    SERVICE_RECORD_AUTO_FINALIZE_ENABLED
    CONTRACT_AUTO_FINALIZE_ENABLED
    EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED
    EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED
    EFORMSIGN_RECONCILE_ALLOW_UNLOCKED
)

usage() {
    cat >&2 <<'EOF'
Usage:
  babyjamjam-fallback-server status
  babyjamjam-fallback-server deploy <40-character-commit-sha> <sha256-image-digest>
  babyjamjam-fallback-server rollback
  babyjamjam-fallback-server stop

This operator manages only the loopback-bound, passive Fallback Server. It
does not change DNS, Cloudflare, Vercel, AWS, Aligo, migrations, or scheduler
ownership.
EOF
}

die() {
    echo "$*" >&2
    exit 1
}

require_root() {
    [[ "$EUID" -eq 0 ]] || die "The Fallback Server operator must run as root."
}

sha256_file() {
    local path="$1"
    local output

    if [[ -x /usr/bin/sha256sum ]]; then
        output="$(/usr/bin/sha256sum "$path")"
    elif [[ -x /usr/bin/shasum ]]; then
        output="$(/usr/bin/shasum -a 256 "$path")"
    else
        die "A SHA-256 utility is required."
    fi
    output="${output%% *}"
    [[ "$output" =~ ^[0-9a-f]{64}$ ]] || die "Unable to hash a protected Fallback Server artifact."
    printf '%s\n' "$output"
}

validate_bundle() {
    local compose_digest
    local identity_digest
    local operator_digest

    [[ "$0" == "$INSTALLED_OPERATOR" ]] \
        || die "Invoke the installed Fallback Server operator."
    [[ -d "$ARTIFACT_ROOT" && ! -L "$ARTIFACT_ROOT" ]] \
        || die "The protected Fallback Server artifact directory is missing or invalid."
    [[ "$(/usr/bin/stat -c '%U:%G:%a' "$ARTIFACT_ROOT")" == "root:root:700" ]] \
        || die "The protected Fallback Server artifact directory has unsafe ownership or mode."
    [[ -f "$COMPOSE_FILE" && ! -L "$COMPOSE_FILE" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$COMPOSE_FILE")" == "root:root:640" ]] \
        || die "The protected Fallback Server Compose artifact is missing or unsafe."
    [[ -f "$DB_IDENTITY_HELPER" && ! -L "$DB_IDENTITY_HELPER" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$DB_IDENTITY_HELPER")" == "root:root:750" ]] \
        || die "The protected Production DB identity helper is missing or unsafe."
    [[ -f "$BUNDLE_MANIFEST" && ! -L "$BUNDLE_MANIFEST" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$BUNDLE_MANIFEST")" == "root:root:640" ]] \
        || die "The Fallback Server bundle manifest is missing or unsafe."
    [[ "$(/usr/bin/stat -c '%U:%G:%a' "$INSTALLED_OPERATOR")" == "root:root:750" ]] \
        || die "The installed Fallback Server operator is missing or unsafe."

    operator_digest="$(sha256_file "$INSTALLED_OPERATOR")"
    compose_digest="$(sha256_file "$COMPOSE_FILE")"
    identity_digest="$(sha256_file "$DB_IDENTITY_HELPER")"
    /usr/bin/grep -Fqx "operator.sh=$operator_digest" "$BUNDLE_MANIFEST" \
        || die "The installed Fallback Server operator does not match its manifest."
    /usr/bin/grep -Fqx "compose.yml=$compose_digest" "$BUNDLE_MANIFEST" \
        || die "The Fallback Server Compose artifact does not match its manifest."
    /usr/bin/grep -Fqx "production-db-identity.sh=$identity_digest" "$BUNDLE_MANIFEST" \
        || die "The Production DB identity helper does not match its manifest."
    [[ "$(/usr/bin/wc -l <"$BUNDLE_MANIFEST")" -eq 3 ]] \
        || die "The Fallback Server bundle manifest is incomplete."
}

validate_env_file() {
    local key

    [[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] \
        || die "The Fallback Server environment file is missing or invalid."
    [[ "$(/usr/bin/stat -c '%U:%G:%a' "$ENV_FILE")" == "root:root:600" ]] \
        || die "The Fallback Server environment file must be root:root mode 600."

    for key in "${REQUIRED_ENV_KEYS[@]}"; do
        /usr/bin/awk -F= -v wanted="$key" '
            $1 == wanted {
                value = substr($0, index($0, "=") + 1)
                gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
                if (value != "" && value != "\"\"" && value != "\047\047") found += 1
            }
            END { exit found == 1 ? 0 : 1 }
        ' "$ENV_FILE" || die "The Fallback Server environment file is missing a required value."
    done
}

validate_production_db_identity() {
    local output

    output="$("$DB_IDENTITY_HELPER" "$ENV_FILE" "$APPROVED_DB_REF_HASH_FILE")" \
        || die "The Fallback Server Production DB identity check failed."
    [[ "$output" == "production_db_identity=ok" ]] \
        || die "The Fallback Server Production DB identity check failed."
}

validate_release() {
    local commit_sha="$1"
    local image_digest="$2"

    [[ "$commit_sha" =~ $SHA_PATTERN ]] || die "The release commit must be a 40-character lowercase SHA."
    [[ "$image_digest" =~ $DIGEST_PATTERN ]] || die "The image digest must be a SHA-256 digest."
}

compose() {
    /usr/bin/env \
        BACKEND_ENV_FILE="$ENV_FILE" \
        BACKEND_IMAGE="$LOCAL_IMAGE_REPOSITORY" \
        BACKEND_IMAGE_TAG="$1" \
        DATABASE_CONNECTION_MODE="shared" \
        /usr/bin/docker compose --env-file "$COMPOSE_ENV_FILE" \
        --project-directory "$ARTIFACT_ROOT" -f "$COMPOSE_FILE" "${@:2}"
}

read_state() {
    local name="$1"
    local path="$STATE_DIRECTORY/$name"
    local value

    [[ -f "$path" && ! -L "$path" ]] || return 1
    value="$(<"$path")"
    [[ -n "$value" ]] || return 1
    printf '%s\n' "$value"
}

write_state() {
    local name="$1"
    local value="$2"
    local temporary

    temporary="$(/usr/bin/mktemp "$STATE_DIRECTORY/.${name}.XXXXXX")"
    printf '%s\n' "$value" >"$temporary"
    /usr/bin/chown root:root "$temporary"
    /usr/bin/chmod 600 "$temporary"
    /usr/bin/mv -f "$temporary" "$STATE_DIRECTORY/$name"
}

pull_release_image() {
    local commit_sha="$1"
    local image_digest="$2"
    local immutable_reference="$IMAGE_REPOSITORY@$image_digest"
    local image_revision

    /usr/bin/docker pull "$immutable_reference" >/dev/null
    image_revision="$(/usr/bin/docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$immutable_reference")"
    [[ "$image_revision" == "$commit_sha" ]] \
        || die "The pulled image revision does not match the requested commit."
    /usr/bin/docker tag "$immutable_reference" "$LOCAL_IMAGE_REPOSITORY:$commit_sha"
}

container_id_for() {
    local commit_sha="$1"
    local container_id

    container_id="$(compose "$commit_sha" ps -q api)"
    [[ "$container_id" =~ ^[0-9a-f]{12,64}$ ]] || return 1
    printf '%s\n' "$container_id"
}

wait_until_ready() {
    local commit_sha="$1"
    local container_id
    local health

    for _attempt in $(/usr/bin/seq 1 60); do
        container_id="$(container_id_for "$commit_sha" || true)"
        if [[ -n "$container_id" ]]; then
            health="$(/usr/bin/docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")"
            if [[ "$health" == "healthy" ]] \
                && /usr/bin/curl --fail --silent --show-error \
                    --connect-timeout 2 --max-time 5 "$LOOPBACK_READY_URL" >/dev/null; then
                return 0
            fi
        fi
        /usr/bin/sleep 2
    done
    return 1
}

verify_passive_runtime() {
    local commit_sha="$1"
    local container_id
    local key
    local value

    container_id="$(container_id_for "$commit_sha")" \
        || die "The Fallback Server API container is not running."
    for key in "${PASSIVE_ENV_KEYS[@]}"; do
        value="$(/usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" \
            | /usr/bin/awk -F= -v wanted="$key" '$1 == wanted { count += 1; value = tolower($2) } END { if (count == 1) print value; else exit 1 }')" \
            || die "A passive Fallback runtime gate is missing or duplicated."
        [[ "$value" == "false" ]] || die "A passive Fallback runtime gate is not disabled."
    done
}

activate_release() {
    local commit_sha="$1"

    validate_production_db_identity
    compose "$commit_sha" up -d --no-build
    wait_until_ready "$commit_sha" || return 1
    verify_passive_runtime "$commit_sha"
}

deploy_release() {
    local commit_sha="$1"
    local image_digest="$2"
    local current_digest=""
    local current_tag=""

    validate_release "$commit_sha" "$image_digest"
    validate_env_file
    validate_production_db_identity
    current_tag="$(read_state current-image-tag || true)"
    current_digest="$(read_state current-image-digest || true)"
    if [[ -n "$current_tag" || -n "$current_digest" ]]; then
        [[ "$current_tag" =~ $SHA_PATTERN && "$current_digest" =~ $DIGEST_PATTERN ]] \
            || die "The recorded Fallback Server rollback state is incomplete."
        /usr/bin/docker image inspect "$LOCAL_IMAGE_REPOSITORY:$current_tag" >/dev/null 2>&1 \
            || die "The recorded Fallback Server rollback image is unavailable."
    fi
    pull_release_image "$commit_sha" "$image_digest"

    if ! activate_release "$commit_sha"; then
        if [[ "$current_tag" =~ $SHA_PATTERN && "$current_digest" =~ $DIGEST_PATTERN \
            && -n "$(/usr/bin/docker image inspect "$LOCAL_IMAGE_REPOSITORY:$current_tag" --format '{{.Id}}' 2>/dev/null || true)" ]]; then
            activate_release "$current_tag" \
                || die "The Fallback Server deployment failed and automatic rollback also failed."
        else
            compose "$commit_sha" stop api >/dev/null 2>&1 || true
        fi
        die "The Fallback Server deployment failed readiness or passive-runtime verification."
    fi

    if [[ "$current_tag" =~ $SHA_PATTERN && "$current_digest" =~ $DIGEST_PATTERN ]]; then
        write_state previous-image-tag "$current_tag"
        write_state previous-image-digest "$current_digest"
    fi
    write_state current-image-tag "$commit_sha"
    write_state current-image-digest "$image_digest"
    status_release
}

status_release() {
    local commit_sha
    local container_health
    local container_id
    local immutable_image_id
    local image_digest
    local image_revision
    local local_image_id
    local restart_count
    local running_image_id

    validate_env_file
    validate_production_db_identity
    commit_sha="$(read_state current-image-tag)" || die "No healthy Fallback Server release is recorded."
    image_digest="$(read_state current-image-digest)" || die "No Fallback Server image digest is recorded."
    validate_release "$commit_sha" "$image_digest"
    container_id="$(container_id_for "$commit_sha")" || die "The Fallback Server API container is not running."
    local_image_id="$(/usr/bin/docker image inspect --format '{{.Id}}' "$LOCAL_IMAGE_REPOSITORY:$commit_sha")" \
        || die "The recorded Fallback Server image is missing."
    immutable_image_id="$(/usr/bin/docker image inspect --format '{{.Id}}' "$IMAGE_REPOSITORY@$image_digest")" \
        || die "The recorded immutable Fallback Server image is missing."
    [[ "$local_image_id" == "$immutable_image_id" ]] \
        || die "The recorded Fallback Server tag does not match its immutable digest."
    running_image_id="$(/usr/bin/docker inspect --format '{{.Image}}' "$container_id")"
    [[ "$running_image_id" == "$local_image_id" ]] \
        || die "The running Fallback Server container does not match the recorded release."
    image_revision="$(/usr/bin/docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$LOCAL_IMAGE_REPOSITORY:$commit_sha")"
    [[ "$image_revision" == "$commit_sha" ]] \
        || die "The recorded Fallback Server image revision is invalid."
    container_health="$(/usr/bin/docker inspect --format '{{.State.Health.Status}}' "$container_id")"
    restart_count="$(/usr/bin/docker inspect --format '{{.RestartCount}}' "$container_id")"
    [[ "$container_health" == "healthy" ]] || die "The Fallback Server API container is not healthy."
    [[ "$restart_count" == "0" ]] || die "The Fallback Server API container has restarted."
    /usr/bin/curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
        "$LOOPBACK_READY_URL" >/dev/null || die "The Fallback Server readiness endpoint failed."
    verify_passive_runtime "$commit_sha"

    printf '%s\n' \
        "environment=fallback-server" \
        "current_tag=$commit_sha" \
        "current_digest=$image_digest" \
        "container_health=$container_health" \
        "restart_count=$restart_count" \
        "db_readiness=ok" \
        "production_db_identity=ok" \
        "public_routing=not_managed" \
        "schedulers_enabled=false" \
        "document_jobs_accepting=false" \
        "document_jobs_worker=false"
}

rollback_release() {
    local current_digest
    local current_tag
    local previous_digest
    local previous_tag

    current_tag="$(read_state current-image-tag)" || die "No current Fallback Server release is recorded."
    current_digest="$(read_state current-image-digest)" || die "No current Fallback Server digest is recorded."
    previous_tag="$(read_state previous-image-tag)" || die "No previous Fallback Server release is recorded."
    previous_digest="$(read_state previous-image-digest)" || die "No previous Fallback Server digest is recorded."
    validate_release "$previous_tag" "$previous_digest"
    /usr/bin/docker image inspect "$LOCAL_IMAGE_REPOSITORY:$previous_tag" >/dev/null 2>&1 \
        || die "The previous Fallback Server image is not present locally."
    activate_release "$previous_tag" || die "The Fallback Server rollback failed."
    write_state current-image-tag "$previous_tag"
    write_state current-image-digest "$previous_digest"
    write_state previous-image-tag "$current_tag"
    write_state previous-image-digest "$current_digest"
    status_release
}

stop_release() {
    local current_tag

    current_tag="$(read_state current-image-tag)" || die "No current Fallback Server release is recorded."
    compose "$current_tag" stop api >/dev/null
    printf '%s\n' \
        "environment=fallback-server" \
        "runtime=stopped" \
        "public_routing=not_managed"
}

main() {
    local action="${1:-}"

    require_root
    validate_bundle
    /usr/bin/install -d -o root -g root -m 700 "$STATE_DIRECTORY"
    exec 9>"$LOCK_FILE"
    /usr/bin/flock -w 5 9 || die "Another Fallback Server operation is active."

    case "$action" in
        status)
            [[ "$#" -eq 1 ]] || { usage; exit 1; }
            status_release
            ;;
        deploy)
            [[ "$#" -eq 3 ]] || { usage; exit 1; }
            deploy_release "$2" "$3"
            ;;
        rollback)
            [[ "$#" -eq 1 ]] || { usage; exit 1; }
            rollback_release
            ;;
        stop)
            [[ "$#" -eq 1 ]] || { usage; exit 1; }
            stop_release
            ;;
        *)
            usage
            exit 1
            ;;
    esac
}

main "$@"
