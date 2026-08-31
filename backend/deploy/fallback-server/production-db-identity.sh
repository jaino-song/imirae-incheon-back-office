#!/usr/bin/env bash

set -euo pipefail

readonly PROJECT_REF_PATTERN='^[a-z0-9]{20}$'
readonly HASH_PATTERN='^[0-9a-f]{64}$'

stat_owner_mode() {
    local path="$1"

    if stat -c '%u:%g:%a' "$path" >/dev/null 2>&1; then
        stat -c '%u:%g:%a' "$path"
    elif stat -f '%u:%g:%Lp' "$path" >/dev/null 2>&1; then
        stat -f '%u:%g:%Lp' "$path"
    else
        return 1
    fi
}

validate_env_file() {
    local env_file="$1"
    local require_root="$2"
    local metadata
    local owner_uid
    local owner_gid
    local mode

    [[ -n "$env_file" && -f "$env_file" && ! -L "$env_file" ]] || return 1
    [[ "$require_root" == true || "$require_root" == false ]] || return 1
    metadata="$(stat_owner_mode "$env_file" 2>/dev/null)" || return 1
    IFS=: read -r owner_uid owner_gid mode <<EOF_METADATA
$metadata
EOF_METADATA
    [[ "$mode" == 600 ]] || return 1
    if [[ "$require_root" == true && ( "$owner_uid" != 0 || "$owner_gid" != 0 ) ]]; then
        return 1
    fi
}

validate_env_syntax() {
    local env_file="$1"

    awk '
        BEGIN { bad = 0 }
        /^[[:space:]]*$/ || /^[[:space:]]*#/ { next }
        {
            if ($0 !~ /^[A-Z][A-Z0-9_]*=/) {
                bad = 1
                next
            }
            key = $0
            sub(/=.*/, "", key)
            count[key] += 1
        }
        END {
            for (key in count) {
                if (count[key] > 1) bad = 1
            }
            exit bad
        }
    ' "$env_file" >/dev/null 2>&1
}

unquote_value() {
    local raw="$1"
    local value="$raw"
    local first
    local last

    if [[ "$raw" == \"* ]]; then
        [[ "${#raw}" -ge 2 ]] || return 1
        first='"'
        last="${raw:${#raw}-1:1}"
        [[ "$last" == "$first" ]] || return 1
        value="${raw:1:${#raw}-2}"
    elif [[ "$raw" == \'* ]]; then
        [[ "${#raw}" -ge 2 ]] || return 1
        first="'"
        last="${raw:${#raw}-1:1}"
        [[ "$last" == "$first" ]] || return 1
        value="${raw:1:${#raw}-2}"
    elif [[ "$raw" == *\"* || "$raw" == *\'* ]]; then
        return 1
    fi

    [[ "$value" != *$'\r'* && "$value" != *$'\n'* ]] || return 1
    printf '%s' "$value"
}

validate_database_url() {
    local database_url="$1"
    local project_ref="$2"
    local authority
    local host_port
    local user_info
    local user
    local host

    [[ "$database_url" =~ ^postgres(ql)?://[^[:space:]]+$ ]] || return 1
    [[ "$database_url" != *\"* && "$database_url" != *\'* ]] || return 1

    authority="${database_url#*://}"
    host_port="${authority%%[/?#]*}"
    [[ -n "$host_port" ]] || return 1
    case "$host_port" in
        *'@'*'@'*) return 1 ;;
    esac

    if [[ "$host_port" == *@* ]]; then
        user_info="${host_port%@*}"
        host_port="${host_port##*@}"
        [[ -n "$user_info" ]] || return 1
        user="${user_info%%:*}"
        [[ "$user" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
    else
        user=''
    fi

    host="${host_port%%:*}"
    [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || return 1
    case "$host" in
        localhost|127.*|0.0.0.0) return 1 ;;
    esac
    [[ "$user" == *"$project_ref"* || "$host" == *"$project_ref"* ]] || return 1
}

hash_project_ref() {
    local project_ref="$1"
    local digest

    if command -v sha256sum >/dev/null 2>&1; then
        digest="$(printf '%s' "$project_ref" | sha256sum 2>/dev/null | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
        digest="$(printf '%s' "$project_ref" | shasum -a 256 2>/dev/null | awk '{print $1}')"
    else
        return 1
    fi
    [[ "$digest" =~ $HASH_PATTERN ]] || return 1
    printf '%s' "$digest"
}

check_production_db_identity_impl() {
    local env_file="$1"
    local require_root="$2"
    local line
    local key
    local raw_value
    local supabase_url=''
    local database_url=''
    local direct_url=''
    local expected_hash=''
    local supabase_count=0
    local database_count=0
    local direct_count=0
    local expected_hash_count=0
    local project_ref
    local computed_hash

    validate_env_file "$env_file" "$require_root" || return 1
    validate_env_syntax "$env_file" || return 1

    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ "$line" != *$'\r'* ]] || return 1
        [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
        [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || return 1
        key="${BASH_REMATCH[1]}"
        raw_value="${BASH_REMATCH[2]}"
        case "$key" in
            SUPABASE_URL)
                supabase_count=$((supabase_count + 1))
                supabase_url="$(unquote_value "$raw_value")" || return 1
                ;;
            DATABASE_URL)
                database_count=$((database_count + 1))
                database_url="$(unquote_value "$raw_value")" || return 1
                ;;
            DIRECT_URL)
                direct_count=$((direct_count + 1))
                direct_url="$(unquote_value "$raw_value")" || return 1
                ;;
            FALLBACK_PRODUCTION_DB_REF_SHA256)
                expected_hash_count=$((expected_hash_count + 1))
                expected_hash="$(unquote_value "$raw_value")" || return 1
                ;;
            *)
                ;;
        esac
    done <"$env_file"

    [[ "$supabase_count" -eq 1 ]] || return 1
    [[ "$database_count" -eq 1 ]] || return 1
    [[ "$direct_count" -eq 1 ]] || return 1
    [[ "$expected_hash_count" -eq 1 ]] || return 1
    [[ "$supabase_url" =~ ^https://([a-z0-9]{20})\.supabase\.co/?$ ]] || return 1
    project_ref="${BASH_REMATCH[1]}"
    [[ "$project_ref" =~ $PROJECT_REF_PATTERN ]] || return 1
    [[ "$expected_hash" =~ $HASH_PATTERN ]] || return 1

    validate_database_url "$database_url" "$project_ref" || return 1
    validate_database_url "$direct_url" "$project_ref" || return 1
    computed_hash="$(hash_project_ref "$project_ref")" || return 1
    [[ "$computed_hash" == "$expected_hash" ]] || return 1
}

check_production_db_identity() {
    local env_file="${1:-}"
    local require_root="${2:-true}"

    if check_production_db_identity_impl "$env_file" "$require_root"; then
        printf '%s\n' 'production_db_identity=ok'
        return 0
    fi
    printf '%s\n' 'production_db_identity=failed' >&2
    return 1
}

main() {
    [[ "$#" -eq 1 ]] || {
        printf '%s\n' 'production_db_identity=failed' >&2
        return 1
    }
    check_production_db_identity "$1" true
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
