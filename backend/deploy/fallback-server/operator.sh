#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

readonly ARTIFACT_ROOT="/usr/local/libexec/babyjamjam-fallback-server"
readonly COMPOSE_FILE="$ARTIFACT_ROOT/compose.yml"
readonly ACTIVE_COMPOSE_FILE="$ARTIFACT_ROOT/compose.temporary-active.yml"
readonly DB_IDENTITY_HELPER="$ARTIFACT_ROOT/production-db-identity.sh"
readonly BUNDLE_MANIFEST="$ARTIFACT_ROOT/bundle.manifest"
readonly INSTALLED_OPERATOR="/usr/local/sbin/babyjamjam-fallback-server"
readonly STATE_ROOT="/opt/babyjamjam-fallback-server"
readonly STATE_DIRECTORY="$STATE_ROOT/state"
readonly ENV_FILE="$STATE_ROOT/backend.env"
readonly APPROVED_DB_REF_HASH_FILE="$STATE_ROOT/approved-production-db-ref.sha256"
readonly TEMPORARY_ACTIVE_APPROVAL_FILE="$STATE_ROOT/temporary-active-approval"
readonly TEMPORARY_STOP_UNIT="babyjamjam-fallback-temporary-active-stop"
readonly TEMPORARY_GUARD_TIMER="babyjamjam-fallback-temporary-active-guard.timer"
readonly RUNTIME_MODE_FILE="$STATE_DIRECTORY/runtime-mode"
readonly ACTIVE_EXPIRY_FILE="$STATE_DIRECTORY/temporary-active-expiry"
readonly APPROVAL_NONCES_FILE="$STATE_DIRECTORY/used-temporary-active-nonces"
readonly SCHEDULER_EVIDENCE_FILE="$STATE_ROOT/temporary-active-scheduler-evidence"
readonly ACTIVE_LINKAGE_FILE="$STATE_DIRECTORY/temporary-active-linkage"
readonly LOCK_FILE="$STATE_DIRECTORY/operator.lock"
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
    MESSAGE_TRIGGER_JOBS_WORKER_ENABLED
)
readonly ACTIVE_TRUE_ENV_KEYS=(
    SCHEDULERS_ENABLED
    SERVICE_RECORD_AUTO_FINALIZE_ENABLED
    CONTRACT_AUTO_FINALIZE_ENABLED
    EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED
    EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED
)

usage() {
    cat >&2 <<'EOF'
Usage:
  babyjamjam-fallback-server status
  babyjamjam-fallback-server deploy <40-character-commit-sha> <sha256-image-digest>
  babyjamjam-fallback-server temporary-active <40-character-commit-sha> <sha256-image-digest>
  babyjamjam-fallback-server rollback
  babyjamjam-fallback-server stop

This operator manages the loopback-bound Fallback Server. Ordinary deploy is
passive; temporary-active requires the separately approved expiry artifact. It
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
    local active_compose_digest
    local guard_service_digest
    local guard_timer_digest
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
    [[ -f "$ACTIVE_COMPOSE_FILE" && ! -L "$ACTIVE_COMPOSE_FILE" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$ACTIVE_COMPOSE_FILE")" == "root:root:640" ]] \
        || die "The protected temporary-active Compose artifact is missing or unsafe."
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
    active_compose_digest="$(sha256_file "$ACTIVE_COMPOSE_FILE")"
    identity_digest="$(sha256_file "$DB_IDENTITY_HELPER")"
    guard_service_digest="$(sha256_file /etc/systemd/system/babyjamjam-fallback-temporary-active-guard.service)"
    guard_timer_digest="$(sha256_file /etc/systemd/system/babyjamjam-fallback-temporary-active-guard.timer)"
    /usr/bin/grep -Fqx "operator.sh=$operator_digest" "$BUNDLE_MANIFEST" \
        || die "The installed Fallback Server operator does not match its manifest."
    /usr/bin/grep -Fqx "compose.yml=$compose_digest" "$BUNDLE_MANIFEST" \
        || die "The Fallback Server Compose artifact does not match its manifest."
    /usr/bin/grep -Fqx "compose.temporary-active.yml=$active_compose_digest" "$BUNDLE_MANIFEST" \
        || die "The temporary-active Compose artifact does not match its manifest."
    /usr/bin/grep -Fqx "production-db-identity.sh=$identity_digest" "$BUNDLE_MANIFEST" \
        || die "The Production DB identity helper does not match its manifest."
    /usr/bin/grep -Fqx "systemd/babyjamjam-fallback-temporary-active-guard.service=$guard_service_digest" "$BUNDLE_MANIFEST" \
        || die "The temporary-active expiry guard service does not match its manifest."
    /usr/bin/grep -Fqx "systemd/babyjamjam-fallback-temporary-active-guard.timer=$guard_timer_digest" "$BUNDLE_MANIFEST" \
        || die "The temporary-active expiry guard timer does not match its manifest."
    [[ "$(/usr/bin/wc -l <"$BUNDLE_MANIFEST")" -eq 6 ]] \
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

validate_state_boundary() {
    local metadata

    [[ -d "$STATE_ROOT" && ! -L "$STATE_ROOT" ]] \
        || die "The Fallback Server state root is missing or unsafe."
    metadata="$(/usr/bin/stat -c '%U:%G:%a' "$STATE_ROOT" 2>/dev/null)" \
        || die "The Fallback Server state root metadata is unavailable."
    [[ "$metadata" == "root:root:700" ]] \
        || die "The Fallback Server state root must be root:root mode 700."

    if [[ ! -e "$STATE_DIRECTORY" && ! -L "$STATE_DIRECTORY" ]]; then
        /usr/bin/install -d -o root -g root -m 700 "$STATE_DIRECTORY"
    fi
    [[ -d "$STATE_DIRECTORY" && ! -L "$STATE_DIRECTORY" ]] \
        || die "The Fallback Server state directory is missing or unsafe."
    metadata="$(/usr/bin/stat -c '%U:%G:%a' "$STATE_DIRECTORY" 2>/dev/null)" \
        || die "The Fallback Server state directory metadata is unavailable."
    [[ "$metadata" == "root:root:700" ]] \
        || die "The Fallback Server state directory must be root:root mode 700."

    [[ ! -L "$LOCK_FILE" ]] \
        || die "The Fallback Server operator lock path is a symbolic link."
    if [[ ! -e "$LOCK_FILE" ]]; then
        /usr/bin/install -o root -g root -m 600 /dev/null "$LOCK_FILE"
    fi
    [[ -f "$LOCK_FILE" && ! -L "$LOCK_FILE" ]] \
        || die "The Fallback Server operator lock path is missing or unsafe."
    metadata="$(/usr/bin/stat -c '%U:%G:%a' "$LOCK_FILE" 2>/dev/null)" \
        || die "The Fallback Server operator lock metadata is unavailable."
    [[ "$metadata" == "root:root:600" ]] \
        || die "The Fallback Server operator lock must be root:root mode 600."
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

runtime_env_for() {
    /usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null
}

discover_running_api_container() {
    local matches count
    matches="$(/usr/bin/docker ps -q --filter "label=com.docker.compose.project=$PROJECT_NAME" --filter 'label=com.docker.compose.service=api')" || return 1
    count="$(printf '%s\n' "$matches" | /usr/bin/awk 'NF {c++} END{print c+0}')"
    [[ "$count" == 0 ]] && return 0
    [[ "$count" == 1 ]] || return 1
    [[ "$matches" =~ ^[0-9a-f]{12,64}$ ]] || return 1
    printf '%s\n' "$matches"
}

stop_discovered_api_container() {
    local container_id remaining
    container_id="$(discover_running_api_container)" || return 1
    [[ -z "$container_id" ]] && return 0
    /usr/bin/docker stop "$container_id" >/dev/null 2>&1 || return 1
    remaining="$(discover_running_api_container)" || return 1
    [[ -z "$remaining" ]]
}

refuse_active_or_unknown_runtime() {
    local mode tag container_id gates key
    mode="$(read_state runtime-mode || true)"
    [[ -z "$mode" || "$mode" == "passive" ]] || die "An active or unknown Fallback runtime must be stopped first."
    tag="$(read_state current-image-tag || true)"
    if [[ ! "$tag" =~ $SHA_PATTERN ]]; then
        container_id="$(discover_running_api_container)" || die "The running Fallback runtime cannot be safely identified."
        [[ -z "$container_id" ]] && return 0
    else
        container_id="$(container_id_for "$tag" || true)"
    fi
    [[ -z "$container_id" ]] && return 0
    gates="$(runtime_env_for "$container_id" || true)"
    [[ -n "$gates" ]] || die "The running Fallback runtime cannot be safely identified."
    [[ "$gates" != *$'SCHEDULERS_ENABLED=true'* ]] || die "The running Fallback runtime is active."
    for key in "${ACTIVE_TRUE_ENV_KEYS[@]}"; do
        [[ "$gates" != *"$key=true"* ]] || die "The running Fallback runtime is active."
    done
    for key in "${PASSIVE_ENV_KEYS[@]}"; do
        [[ "$gates" == *"$key=false"* ]] || die "The running Fallback runtime is unsafe."
    done
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

active_compose() {
    /usr/bin/env \
        BACKEND_ENV_FILE="$ENV_FILE" \
        BACKEND_IMAGE="$LOCAL_IMAGE_REPOSITORY" \
        BACKEND_IMAGE_TAG="$1" \
        DATABASE_CONNECTION_MODE="shared" \
        /usr/bin/docker compose --env-file "$COMPOSE_ENV_FILE" \
        --project-directory "$ARTIFACT_ROOT" -f "$ACTIVE_COMPOSE_FILE" "${@:2}"
}

approval_value() {
    local key="$1"
    /usr/bin/awk -F= -v wanted="$key" '
        $1 == wanted { count += 1; value = substr($0, index($0, "=") + 1) }
        END { if (count == 1 && value != "") print value; else exit 1 }
    ' "$TEMPORARY_ACTIVE_APPROVAL_FILE"
}

validate_temporary_active_approval() {
    local schema incident_id condition_hash evidence_hash approval_tag approval_digest approval_db_hash approval_egress_hash issued nonce expiry now line_count

    [[ -f "$TEMPORARY_ACTIVE_APPROVAL_FILE" && ! -L "$TEMPORARY_ACTIVE_APPROVAL_FILE" ]] \
        || die "The temporary-active approval artifact is missing or unsafe."
    [[ "$(/usr/bin/stat -c '%U:%G:%a' "$TEMPORARY_ACTIVE_APPROVAL_FILE")" == "root:root:400" ]] \
        || die "The temporary-active approval artifact must be root:root mode 400."
    line_count="$(/usr/bin/wc -l <"$TEMPORARY_ACTIVE_APPROVAL_FILE")"
    [[ "$line_count" == "10" ]] || die "The temporary-active approval artifact schema is invalid."
    schema="$(approval_value schema_version || true)"
    incident_id="$(approval_value incident_id || true)"
    condition_hash="$(approval_value primary_scheduler_condition_ref_sha256 || true)"
    approval_tag="$(approval_value image_tag || true)"
    approval_digest="$(approval_value image_digest || true)"
    approval_db_hash="$(approval_value production_db_ref_sha256 || true)"
    approval_egress_hash="$(approval_value aligo_egress_ipv4_sha256 || true)"
    issued="$(approval_value issued_at_unix || true)"
    nonce="$(approval_value approval_nonce || true)"
    expiry="$(approval_value expires_at_unix || true)"
    [[ "$schema" == "1" && "$incident_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$ ]] \
        || die "The temporary-active approval artifact schema is invalid."
    [[ "$approval_tag" =~ $SHA_PATTERN && "$approval_digest" =~ $DIGEST_PATTERN \
        && "$approval_db_hash" =~ ^[0-9a-f]{64}$ && "$approval_egress_hash" =~ ^[0-9a-f]{64}$ \
        && "$condition_hash" =~ ^[0-9a-f]{64}$ && "$issued" =~ ^[0-9]{10,}$ \
        && "$nonce" =~ ^[a-f0-9]{32,128}$ && "$expiry" =~ ^[0-9]{10,}$ ]] || die "The temporary-active approval artifact schema is invalid."
    now="$(/usr/bin/date +%s)"
    (( issued <= now + 60 && issued <= expiry && expiry > now + 300 && expiry - issued <= 172800 )) \
        || die "The temporary-active approval timing is invalid."
    [[ ! -f "$APPROVAL_NONCES_FILE" ]] || ! /usr/bin/grep -Fqx "$nonce" "$APPROVAL_NONCES_FILE" \
        || die "The temporary-active approval nonce was already used."
    [[ "$approval_tag" == "$1" && "$approval_digest" == "$2" ]] \
        || die "The temporary-active approval does not match the requested immutable release."
    /usr/bin/grep -Fqx "$approval_db_hash" "$APPROVED_DB_REF_HASH_FILE" \
        || die "The temporary-active approval does not match the approved Production DB reference."
    [[ -f "$SCHEDULER_EVIDENCE_FILE" && ! -L "$SCHEDULER_EVIDENCE_FILE" \
        && "$(/usr/bin/stat -c '%U:%G:%a' "$SCHEDULER_EVIDENCE_FILE")" == "root:root:400" ]] \
        || die "The temporary-active scheduler evidence artifact is missing or unsafe."
    [[ "$(/usr/bin/wc -c <"$SCHEDULER_EVIDENCE_FILE")" -le 4096 ]] \
        || die "The temporary-active scheduler evidence artifact is oversized."
    evidence_hash="$(sha256_file "$SCHEDULER_EVIDENCE_FILE")"
    [[ "$condition_hash" == "$evidence_hash" ]] || die "The temporary-active approval does not match scheduler evidence."
    printf '%s %s %s %s\n' "$approval_egress_hash" "$nonce" "$incident_id" "$condition_hash"
}

claim_approval_nonce() {
    local nonce="$1" temporary
    [[ ! -f "$APPROVAL_NONCES_FILE" ]] || ! /usr/bin/grep -Fqx "$nonce" "$APPROVAL_NONCES_FILE" \
        || die "The temporary-active approval nonce was already used."
    temporary="$(/usr/bin/mktemp "$STATE_DIRECTORY/.used-temporary-active-nonces.XXXXXX")"
    [[ -f "$APPROVAL_NONCES_FILE" ]] && /usr/bin/cat "$APPROVAL_NONCES_FILE" >"$temporary"
    printf '%s\n' "$nonce" >>"$temporary"
    /usr/bin/chown root:root "$temporary" && /usr/bin/chmod 600 "$temporary" && /usr/bin/mv -f "$temporary" "$APPROVAL_NONCES_FILE"
}

validate_active_aligo_env() {
    local key
    for key in ALIGO_API_KEY ALIGO_USER_ID ALIGO_SENDER_PHONE; do
        /usr/bin/awk -F= -v wanted="$key" '
            $1 == wanted { count += 1; value=substr($0,index($0,"=")+1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); if ((value=="\"\"" || value=="\047\047" || value=="") ) invalid=1 }
            END{exit (count==1 && invalid!=1)?0:1}
        ' "$ENV_FILE" \
            || die "Temporary-active requires a nonempty Aligo credential."
    done
}

verify_image_identity() {
    local tag="$1" digest="$2" local_id immutable_id revision running_id="${3:-}"
    local_id="$(/usr/bin/docker image inspect --format '{{.Id}}' "$LOCAL_IMAGE_REPOSITORY:$tag")" || die "The local approved image is unavailable."
    immutable_id="$(/usr/bin/docker image inspect --format '{{.Id}}' "$IMAGE_REPOSITORY@$digest")" || die "The immutable approved image is unavailable."
    revision="$(/usr/bin/docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$LOCAL_IMAGE_REPOSITORY:$tag")" || die "The approved image revision is unavailable."
    [[ "$local_id" == "$immutable_id" && "$revision" == "$tag" ]] || die "The approved image identity does not match."
    if [[ -n "$running_id" ]]; then [[ "$running_id" == "$local_id" ]] || die "The running image identity does not match."; fi
}

egress_hash() {
    local endpoint="$1" value digest
    value="$(/usr/bin/curl --fail --silent --show-error --connect-timeout 3 --max-time 8 "$endpoint")" \
        || return 1
    [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
    digest="$(printf '%s' "$value" | /usr/bin/sha256sum | /usr/bin/awk '{print $1}')" || return 1
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    printf '%s\n' "$digest"
}

verify_approved_egress() {
    local expected_hash="$1" tag="$2" first_hash second_hash
    /usr/bin/docker network inspect "${PROJECT_NAME}_outbound" >/dev/null 2>&1 || die "The temporary-active outbound network is unavailable."
    first_hash="$(/usr/bin/docker run --rm --network "${PROJECT_NAME}_outbound" "$LOCAL_IMAGE_REPOSITORY:$tag" node -e 'fetch("https://api.ipify.org").then(r=>r.ok?r.text():Promise.reject()).then(x=>{x=x.trim();const p=x.split(".");if(!/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(x)||p.some(n=>Number(n)>255))throw 0;process.stdout.write(require("crypto").createHash("sha256").update(x).digest("hex"))}).catch(()=>process.exit(1))' 2>/dev/null)" || die "The first container egress observation failed."
    second_hash="$(/usr/bin/docker run --rm --network "${PROJECT_NAME}_outbound" "$LOCAL_IMAGE_REPOSITORY:$tag" node -e 'fetch("https://ifconfig.me/ip").then(r=>r.ok?r.text():Promise.reject()).then(x=>{x=x.trim();const p=x.split(".");if(!/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(x)||p.some(n=>Number(n)>255))throw 0;process.stdout.write(require("crypto").createHash("sha256").update(x).digest("hex"))}).catch(()=>process.exit(1))' 2>/dev/null)" || die "The second container egress observation failed."
    [[ "$first_hash" =~ ^[0-9a-f]{64}$ && "$second_hash" =~ ^[0-9a-f]{64}$ ]] || die "The container egress observation is invalid."
    [[ "$first_hash" == "$second_hash" && "$first_hash" == "$expected_hash" ]] \
        || die "The temporary-active egress observations do not match the approved hash."
}

clear_temporary_expiry_timer() {
    /usr/bin/systemctl stop "$TEMPORARY_STOP_UNIT.timer" >/dev/null 2>&1 || true
    /usr/bin/systemctl reset-failed "$TEMPORARY_STOP_UNIT.timer" >/dev/null 2>&1 || true
}

clear_temporary_active_state() {
    /usr/bin/rm -f "$RUNTIME_MODE_FILE" "$ACTIVE_EXPIRY_FILE" "$ACTIVE_LINKAGE_FILE"
    /usr/bin/systemctl disable "$TEMPORARY_GUARD_TIMER" >/dev/null 2>&1 || true
    /usr/bin/systemctl stop "$TEMPORARY_GUARD_TIMER" >/dev/null 2>&1 || true
}

cleanup_active_after_failure() {
    local tag="$1"
    active_compose "$tag" stop api >/dev/null 2>&1 || return 1
    if container_id_for "$tag" >/dev/null 2>&1; then return 1; fi
    clear_temporary_expiry_timer
    clear_temporary_active_state
    return 0
}

guard_expiry() {
    local expiry now tag mode container_id gates
    mode="$(read_state runtime-mode || true)"
    if [[ "$mode" != "temporary-active" ]]; then
        if [[ "$tag" =~ $SHA_PATTERN ]]; then
            container_id="$(container_id_for "$tag" || true)"
        else
            container_id="$(discover_running_api_container)" || return 1
        fi
        [[ -z "$container_id" ]] && return 0
        gates="$(/usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" 2>/dev/null || true)"
        if [[ "$gates" == *$'SCHEDULERS_ENABLED=true'* ]] || [[ -z "$gates" ]]; then
            if [[ "$tag" =~ $SHA_PATTERN ]]; then
                active_compose "$tag" stop api >/dev/null 2>&1 || return 1
                container_id_for "$tag" >/dev/null 2>&1 && return 1
            else
                stop_discovered_api_container || return 1
            fi
            clear_temporary_expiry_timer
            clear_temporary_active_state
        fi
        return 0
    fi
    expiry="$(read_state temporary-active-expiry || true)"
    [[ "$expiry" =~ ^[0-9]{10,}$ ]] || expiry=0
    now="$(/usr/bin/date +%s)"
    (( now < expiry )) && return 0
    if [[ "$tag" =~ $SHA_PATTERN ]]; then
        compose "$tag" stop api >/dev/null 2>&1 || return 1
        if container_id_for "$tag" >/dev/null 2>&1; then return 1; fi
    else
        stop_discovered_api_container || return 1
    fi
    # Do not stop this service from itself; disable prevents a future tick.
    clear_temporary_expiry_timer
    clear_temporary_active_state
}

schedule_temporary_expiry_stop() {
    local expiry="$1"
    clear_temporary_expiry_timer
    /usr/bin/systemd-run --unit="$TEMPORARY_STOP_UNIT" --on-calendar="@$expiry" \
        --timer-property=Persistent=true --service-type=oneshot "$INSTALLED_OPERATOR" stop >/dev/null \
        || die "The temporary-active expiry stop could not be scheduled."
    /usr/bin/systemctl is-active --quiet "$TEMPORARY_STOP_UNIT.timer" \
        || { clear_temporary_expiry_timer; die "The temporary-active expiry timer is not active."; }
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

verify_temporary_active_runtime() {
    local commit_sha="$1"
    local container_id key value

    container_id="$(container_id_for "$commit_sha")" \
        || die "The temporary-active Fallback Server API container is not running."
    for key in "${ACTIVE_TRUE_ENV_KEYS[@]}"; do
        value="$(/usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" \
            | /usr/bin/awk -F= -v wanted="$key" '$1 == wanted { count += 1; value = tolower($2) } END { if (count == 1) print value; else exit 1 }')" \
            || die "A temporary-active runtime gate is missing or duplicated."
        [[ "$value" == "true" ]] || die "A temporary-active runtime gate is not enabled."
    done
    for key in EFORMSIGN_RECONCILE_ALLOW_UNLOCKED MESSAGE_TRIGGER_JOBS_WORKER_ENABLED; do
        value="$(/usr/bin/docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id" \
            | /usr/bin/awk -F= -v wanted="$key" '$1 == wanted { count += 1; value = tolower($2) } END { if (count == 1) print value; else exit 1 }')" \
            || die "A temporary-active disabled runtime gate is missing or duplicated."
        [[ "$value" == "false" ]] || die "A temporary-active disabled runtime gate is not disabled."
    done
}

temporary_activate_release() {
    local commit_sha="$1" image_digest="$2" approval_data approval_egress_hash approval_nonce incident_id evidence_hash expiry current_tag current_digest container_id

    validate_release "$commit_sha" "$image_digest"
    refuse_active_or_unknown_runtime
    if [[ "$(read_state runtime-mode || true)" == "temporary-active" ]]; then
        die "An existing temporary-active runtime must be stopped before replacement."
    fi
    validate_env_file
    validate_production_db_identity
    approval_data="$(validate_temporary_active_approval "$commit_sha" "$image_digest")"
    read -r approval_egress_hash approval_nonce incident_id evidence_hash <<<"$approval_data"
    validate_active_aligo_env
    current_tag="$(read_state current-image-tag)" || die "No passive Fallback Server release is recorded."
    current_digest="$(read_state current-image-digest)" || die "No passive Fallback Server image digest is recorded."
    [[ "$current_tag" == "$commit_sha" && "$current_digest" == "$image_digest" ]] \
        || die "The temporary-active release must match the recorded passive release."
    verify_image_identity "$commit_sha" "$image_digest"
    verify_approved_egress "$approval_egress_hash" "$commit_sha"
    claim_approval_nonce "$approval_nonce"
    expiry="$(approval_value expires_at_unix)"
    schedule_temporary_expiry_stop "$expiry"
    write_state runtime-mode temporary-active
    write_state temporary-active-expiry "$expiry"
    write_state temporary-active-linkage "$incident_id $evidence_hash $approval_nonce"
    /usr/bin/systemctl enable --now "$TEMPORARY_GUARD_TIMER" >/dev/null \
        || { clear_temporary_expiry_timer; clear_temporary_active_state; die "The temporary-active reboot-safe expiry guard could not be enabled."; }
    if ! active_compose "$commit_sha" up -d --no-build; then
        cleanup_active_after_failure "$commit_sha" || die "The temporary-active cleanup could not confirm API stop."
        die "The temporary-active Fallback Server startup failed."
    fi
    if ! wait_until_ready "$commit_sha" || ! verify_temporary_active_runtime "$commit_sha"; then
        cleanup_active_after_failure "$commit_sha" || die "The temporary-active cleanup could not confirm API stop."
        die "The temporary-active Fallback Server runtime verification failed."
    fi
    if ! container_id="$(container_id_for "$commit_sha")"; then
        cleanup_active_after_failure "$commit_sha" || die "The temporary-active cleanup could not confirm API stop."
        die "The temporary-active API container is unavailable."
    fi
    if ! verify_image_identity "$commit_sha" "$image_digest" "$(/usr/bin/docker inspect --format '{{.Image}}' "$container_id")"; then
        cleanup_active_after_failure "$commit_sha" || die "The temporary-active cleanup could not confirm API stop."
        die "The temporary-active running image identity is invalid."
    fi
    (( $(/usr/bin/date +%s) < expiry )) || { cleanup_active_after_failure "$commit_sha" || die "The temporary-active cleanup could not confirm API stop."; die "The temporary-active approval expired during startup."; }
    printf '%s\n' \
        "environment=fallback-server" \
        "temporary_active=true" \
        "expiry_stop_scheduled=true" \
        "public_routing=not_managed"
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
    refuse_active_or_unknown_runtime
    [[ "$(read_state runtime-mode || true)" != "temporary-active" ]] \
        || die "Stop the temporary-active runtime before passive deployment."
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
    local runtime_mode expiry now

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
    runtime_mode="$(read_state runtime-mode || true)"
    if [[ -z "$runtime_mode" ]]; then
        [[ ! -e "$ACTIVE_EXPIRY_FILE" ]] || die "Fallback runtime state is inconsistent."
        runtime_mode="passive"
    fi
    if [[ "$runtime_mode" == "temporary-active" ]]; then
        expiry="$(read_state temporary-active-expiry)" || die "Temporary-active expiry state is missing."
        [[ "$(read_state temporary-active-linkage || true)" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}[[:space:]][0-9a-f]{64}[[:space:]][a-f0-9]{32,128}$ ]] \
            || die "Temporary-active approval linkage is missing or invalid."
        now="$(/usr/bin/date +%s)"
        [[ "$expiry" =~ ^[0-9]{10,}$ && "$now" -lt "$expiry" ]] || die "Temporary-active approval is expired."
        /usr/bin/systemctl is-enabled --quiet "$TEMPORARY_GUARD_TIMER" || die "Temporary-active guard is not enabled."
        /usr/bin/systemctl is-active --quiet "$TEMPORARY_GUARD_TIMER" || die "Temporary-active guard is not active."
        verify_temporary_active_runtime "$commit_sha"
    elif [[ "$runtime_mode" == "passive" ]]; then
        [[ ! -e "$ACTIVE_EXPIRY_FILE" ]] || die "Fallback runtime state is inconsistent."
        verify_passive_runtime "$commit_sha"
    else
        die "Fallback runtime mode is invalid."
    fi

    printf '%s\n' \
        "environment=fallback-server" \
        "current_tag=$commit_sha" \
        "current_digest=$image_digest" \
        "container_health=$container_health" \
        "restart_count=$restart_count" \
        "db_readiness=ok" \
        "production_db_identity=ok" \
        "public_routing=not_managed" \
        "runtime_mode=$runtime_mode" \
        "schedulers_enabled=$([[ "$runtime_mode" == temporary-active ]] && printf true || printf false)" \
        "document_jobs_accepting=$([[ "$runtime_mode" == temporary-active ]] && printf true || printf false)" \
        "document_jobs_worker=$([[ "$runtime_mode" == temporary-active ]] && printf true || printf false)"
}

rollback_release() {
    local current_digest
    local current_tag
    local previous_digest
    local previous_tag

    refuse_active_or_unknown_runtime
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
    if container_id_for "$current_tag" >/dev/null 2>&1; then
        die "The Fallback Server API container did not stop."
    fi
    clear_temporary_expiry_timer
    clear_temporary_active_state
    printf '%s\n' \
        "environment=fallback-server" \
        "runtime=stopped" \
        "public_routing=not_managed"
}

main() {
    local action="${1:-}"

    require_root
    validate_bundle
    validate_state_boundary
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
        temporary-active)
            [[ "$#" -eq 3 ]] || { usage; exit 1; }
            temporary_activate_release "$2" "$3"
            ;;
        guard-expiry)
            [[ "$#" -eq 1 ]] || { usage; exit 1; }
            guard_expiry
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
