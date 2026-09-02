#!/usr/bin/env bash

backup_key_for_destination() {
    case "$1" in
        */babyjamjam-fallback-server) printf '%s\n' operator ;;
        */compose.yml) printf '%s\n' passive-compose ;;
        */compose.temporary-active.yml) printf '%s\n' active-compose ;;
        */production-db-identity.sh) printf '%s\n' db-helper ;;
        */babyjamjam-fallback-temporary-active-guard.service) printf '%s\n' guard-service ;;
        */babyjamjam-fallback-temporary-active-guard.timer) printf '%s\n' guard-timer ;;
        */bundle.manifest) printf '%s\n' manifest ;;
        *) return 1 ;;
    esac
}

rollback_destination_for_key() {
    case "$1" in
        operator) printf '%s\n' "$2" ;;
        passive-compose) printf '%s\n' "$3/compose.yml" ;;
        active-compose) printf '%s\n' "$3/compose.temporary-active.yml" ;;
        db-helper) printf '%s\n' "$3/production-db-identity.sh" ;;
        guard-service) printf '%s\n' "$4/babyjamjam-fallback-temporary-active-guard.service" ;;
        guard-timer) printf '%s\n' "$4/babyjamjam-fallback-temporary-active-guard.timer" ;;
        manifest) printf '%s\n' "$3/bundle.manifest" ;;
        *) return 1 ;;
    esac
}
