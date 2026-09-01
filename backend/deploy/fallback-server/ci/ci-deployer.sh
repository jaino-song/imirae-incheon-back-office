#!/usr/bin/env bash

set -euo pipefail

readonly SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

readonly STATE_ROOT="/opt/babyjamjam-fallback-server"
readonly STATE_DIRECTORY="$STATE_ROOT/state"
readonly OPERATOR="/usr/local/sbin/babyjamjam-fallback-server"
readonly APPROVAL_HELPER="/usr/local/libexec/babyjamjam-fallback-server/automatic-approval.mjs"
readonly APPROVAL_FILE="$STATE_ROOT/temporary-active-approval"
readonly SCHEDULER_EVIDENCE_FILE="$STATE_ROOT/temporary-active-scheduler-evidence"
readonly APPROVED_DB_REF_HASH_FILE="$STATE_ROOT/approved-production-db-ref.sha256"
readonly APPROVED_PUBLIC_ROUTING_FILE="$STATE_ROOT/approved-public-routing.sha256"
readonly AUTOMATION_AUTHORITY_FILE="$STATE_ROOT/automatic-deploy-authority"
readonly ACTIVE_EXPIRY_FILE="$STATE_DIRECTORY/temporary-active-expiry"
readonly DEPLOY_USER="babyjamjam-ci-deployer"
readonly PUBLIC_API_HOST="api.babyjamjam.com"
readonly SHA_PATTERN='^[0-9a-f]{40}$'
readonly DIGEST_PATTERN='^sha256:[0-9a-f]{64}$'
readonly HASH_PATTERN='^[0-9a-f]{64}$'
readonly AUTOMATION_AUTHORITY_VALUE="github-main-lightnode-auto-deploy-v1"

die() {
    echo "$*" >&2
    exit 1
}

require_root_and_caller() {
    [[ "$EUID" -eq 0 ]] || die "The Fallback CI deployer must run through sudo."
    [[ "${SUDO_USER:-}" == "$DEPLOY_USER" ]] || die "The Fallback CI deployer caller is not authorized."
}

validate_protected_file() {
    local path="$1"
    local mode="$2"
    [[ -f "$path" && ! -L "$path" ]] || die "A protected Fallback deployment artifact is missing or unsafe."
    [[ "$(stat -c '%u:%g:%a' "$path")" == "0:0:$mode" ]] \
        || die "A protected Fallback deployment artifact has invalid ownership or mode."
}

read_single_line() {
    local path="$1"
    local pattern="$2"
    local value
    value="$(cat "$path")"
    [[ "$value" =~ $pattern && "$(wc -l <"$path")" -eq 1 ]] \
        || die "A protected Fallback deployment artifact is malformed."
    printf '%s\n' "$value"
}

approval_value() {
    local key="$1"
    awk -F= -v wanted="$key" '
        $1 == wanted { count += 1; value = substr($0, index($0, "=") + 1) }
        END { if (count == 1 && value != "") print value; else exit 1 }
    ' "$APPROVAL_FILE"
}

status_value() {
    local key="$1"
    local status_output="$2"
    awk -F= -v wanted="$key" '$1 == wanted { count += 1; value = substr($0, length($1) + 2) }
        END { if (count == 1 && value != "") print value; else exit 1 }' <<<"$status_output"
}

canonical_public_route_hash() {
    local records
    records="$(getent ahostsv4 "$PUBLIC_API_HOST" \
        | awk '$2 == "STREAM" && $1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { print $1 }' \
        | sort -u)"
    [[ -n "$records" ]] || die "The public API route could not be resolved."
    printf '%s\n' "$records" | sha256sum | awk '{ print $1 }'
}

require_fallback_route() {
    local approved_hash current_hash
    validate_protected_file "$APPROVED_PUBLIC_ROUTING_FILE" 400
    approved_hash="$(read_single_line "$APPROVED_PUBLIC_ROUTING_FILE" "$HASH_PATTERN")"
    current_hash="$(canonical_public_route_hash)"
    [[ "$current_hash" == "$approved_hash" ]] \
        || die "The public API route is not the approved Fallback target."
}

require_automation_authority() {
    local authority
    validate_protected_file "$AUTOMATION_AUTHORITY_FILE" 400
    authority="$(read_single_line "$AUTOMATION_AUTHORITY_FILE" '^github-main-lightnode-auto-deploy-v1$')"
    [[ "$authority" == "$AUTOMATION_AUTHORITY_VALUE" ]] \
        || die "Automatic Fallback deployment authority is invalid."
}

validated_status() {
    local output
    validate_protected_file "$OPERATOR" 750
    output="$($OPERATOR status)"
    [[ "$(status_value environment "$output")" == "fallback-server" \
        && "$(status_value container_health "$output")" == "healthy" \
        && "$(status_value restart_count "$output")" == "0" \
        && "$(status_value db_readiness "$output")" == "ok" \
        && "$(status_value production_db_identity "$output")" == "ok" \
        && "$(status_value runtime_mode "$output")" == "temporary-active" \
        && "$(status_value schedulers_enabled "$output")" == "true" \
        && "$(status_value document_jobs_accepting "$output")" == "true" \
        && "$(status_value document_jobs_worker "$output")" == "true" ]] \
        || die "The active Fallback runtime is not safe for automatic replacement."
    printf '%s\n' "$output"
}

emit_status() {
    local output
    require_fallback_route
    output="$(validated_status)"
    printf '%s\n' "$output" | awk -F= '$1 != "public_routing" { print }'
    printf '%s\n' "public_routing=fallback"
}

write_automatic_approval() {
    local commit_sha="$1"
    local image_digest="$2"
    local condition_hash db_hash egress_hash incident_id issued_at nonce old_expiry temporary

    validate_protected_file "$APPROVAL_FILE" 400
    validate_protected_file "$SCHEDULER_EVIDENCE_FILE" 400
    validate_protected_file "$APPROVED_DB_REF_HASH_FILE" 400
    condition_hash="$(sha256sum "$SCHEDULER_EVIDENCE_FILE" | awk '{ print $1 }')"
    db_hash="$(read_single_line "$APPROVED_DB_REF_HASH_FILE" "$HASH_PATTERN")"
    egress_hash="$(approval_value aligo_egress_ipv4_sha256)"
    incident_id="$(approval_value incident_id)"
    old_expiry="$(read_single_line "$ACTIVE_EXPIRY_FILE" '^[0-9]{10,}$')"
    [[ "$condition_hash" =~ $HASH_PATTERN && "$egress_hash" =~ $HASH_PATTERN \
        && "$incident_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$ ]] \
        || die "The current active approval cannot authorize an automatic replacement."

    issued_at="$(date +%s)"
    nonce="$(openssl rand -hex 32)"
    [[ "$nonce" =~ ^[0-9a-f]{64}$ ]] || die "Unable to create an automatic approval nonce."

    temporary="$(mktemp "$STATE_ROOT/.automatic-approval.XXXXXX")"
    trap 'rm -f "${temporary:-}"' RETURN
    validate_protected_file "$APPROVAL_HELPER" 750
    node "$APPROVAL_HELPER" \
        "$commit_sha" "$image_digest" "$incident_id" "$condition_hash" "$db_hash" \
        "$egress_hash" "$issued_at" "$old_expiry" "$nonce" >"$temporary"
    chown root:root "$temporary"
    chmod 400 "$temporary"
    mv -f "$temporary" "$APPROVAL_FILE"
    trap - RETURN
}

replace_release() {
    local commit_sha="$1"
    local image_digest="$2"
    local before_status after_status backup
    [[ "$commit_sha" =~ $SHA_PATTERN && "$image_digest" =~ $DIGEST_PATTERN ]] \
        || die "The requested Fallback release identity is invalid."
    require_automation_authority
    require_fallback_route
    before_status="$(validated_status)"
    [[ "$(status_value current_tag "$before_status")" != "$commit_sha" \
        || "$(status_value current_digest "$before_status")" != "$image_digest" ]] \
        || {
            printf '%s\n' "$before_status" | awk -F= '$1 != "public_routing" { print }'
            printf '%s\n' "public_routing=fallback" "deployment_changed=false"
            return 0
        }

    validate_protected_file "$APPROVAL_FILE" 400
    backup="$(mktemp "$STATE_ROOT/.approval-backup.XXXXXX")"
    cp -p "$APPROVAL_FILE" "$backup"
    # The operator prints its own replacement summary (including a
    # public_routing=not_managed marker). Keep it on stderr so the caller's
    # stdout carries exactly one status block with unique keys.
    if ! write_automatic_approval "$commit_sha" "$image_digest" \
        || ! "$OPERATOR" replace-temporary-active "$commit_sha" "$image_digest" >&2; then
        cp -p "$backup" "$APPROVAL_FILE"
        rm -f "$backup"
        die "The automatic Fallback replacement failed; the previous approval was restored."
    fi
    rm -f "$backup"
    after_status="$(validated_status)"
    [[ "$(status_value current_tag "$after_status")" == "$commit_sha" \
        && "$(status_value current_digest "$after_status")" == "$image_digest" ]] \
        || die "The automatic Fallback replacement did not publish the requested immutable release."
    printf '%s\n' "$after_status" | awk -F= '$1 != "public_routing" { print }'
    printf '%s\n' "public_routing=fallback" "deployment_changed=true"
}

main() {
    require_root_and_caller
    case "${1:-}" in
        status)
            [[ "$#" -eq 1 ]] || die "Usage: babyjamjam-fallback-ci-deployer status"
            emit_status
            ;;
        replace)
            [[ "$#" -eq 3 ]] || die "Usage: babyjamjam-fallback-ci-deployer replace <commit-sha> <image-digest>"
            replace_release "$2" "$3"
            ;;
        *)
            die "Usage: babyjamjam-fallback-ci-deployer status|replace"
            ;;
    esac
}

main "$@"
