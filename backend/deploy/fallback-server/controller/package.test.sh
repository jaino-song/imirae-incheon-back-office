#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly INSTALLER="$SCRIPT_ROOT/install.sh"
readonly OPERATOR="$SCRIPT_ROOT/operator.mjs"
readonly WRAPPER="$SCRIPT_ROOT/operator.sh"
readonly TEMPLATE="$SCRIPT_ROOT/controller.env.tpl"
readonly UNIT="$SCRIPT_ROOT/systemd/babyjamjam-failover-controller.service"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

assert_contains() {
    grep -Eq -- "$2" "$1" || fail "$3"
}

assert_not_contains() {
    if grep -Eiq -- "$2" "$1"; then
        fail "$3"
    fi
}

[[ -r "$INSTALLER" && -r "$OPERATOR" && -r "$WRAPPER" && -r "$TEMPLATE" && -r "$UNIT" ]] \
    || fail 'controller package source is incomplete'

assert_contains "$INSTALLER" '/usr/local/libexec/babyjamjam-failover-controller' \
    'installer must use the fixed controller bundle path'
assert_contains "$INSTALLER" '/usr/local/sbin/babyjamjam-failover-controller' \
    'installer must use the fixed controller CLI path'
assert_contains "$INSTALLER" '/opt/babyjamjam-fallback-server/controller.env' \
    'installer must use the fixed controller environment path'
assert_contains "$INSTALLER" 'Node.js 20 or newer' \
    'installer must require Node.js 20 or newer'
assert_not_contains "$INSTALLER" 'systemctl[[:space:]]+(enable|start)' \
    'installer must not enable or start the service'
assert_contains "$OPERATOR" 'OPERATOR_ACTIONS = Object\.freeze' \
    'CLI must expose only status, arm, and disarm'
assert_contains "$OPERATOR" 'automatic_failback' \
    'CLI must keep automatic failback disabled'
assert_contains "$OPERATOR" 'FALLBACK_STATUS_INVALID' \
    'arm must validate the fallback status'
assert_contains "$OPERATOR" 'DNS_NOT_PRIMARY' \
    'arm must require primary DNS'
assert_contains "$WRAPPER" 'CONTROLLER_BUNDLE_ROOT=.*failover-controller' \
    'wrapper must use the fixed controller bundle path'
assert_contains "$WRAPPER" 'CONTROLLER_OPERATOR=.*operator\.mjs' \
    'wrapper must invoke only the fixed operator module'

assert_contains "$TEMPLATE" '^FAILOVER_CONTROLLER_ENABLED=false$' \
    'controller must default to disabled'
assert_contains "$TEMPLATE" '^FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED=false$' \
    'live payload contract must default to unverified'
for key in \
    FAILOVER_SENTRY_CLIENT_SECRET \
    FAILOVER_SENTRY_INSTALLATION_ID \
    FAILOVER_SENTRY_ORGANIZATION_ID \
    FAILOVER_SENTRY_PROJECT_ID \
    FAILOVER_SENTRY_ALERT_ID \
    FAILOVER_SENTRY_MONITOR_ID \
    FAILOVER_PRIMARY_HEALTH_URL \
    FAILOVER_FALLBACK_HEALTH_URL \
    FAILOVER_VERCEL_API_TOKEN \
    FAILOVER_VERCEL_TEAM_ID \
    FAILOVER_VERCEL_DNS_RECORD_ID \
    FAILOVER_PRIMARY_IPV4 \
    FAILOVER_FALLBACK_IPV4; do
    assert_contains "$TEMPLATE" "^${key}=$" "$key must be blank in the template"
done

assert_contains "$UNIT" 'ExecStartPre=.*/operator\.mjs --check-bundle' \
    'service must validate the bundle before start'
assert_contains "$UNIT" 'ExecStart=.*/main\.mjs' \
    'service must bind through main.mjs only'
assert_contains "$UNIT" 'EnvironmentFile=-/opt/babyjamjam-fallback-server/controller\.env' \
    'service must use the fixed environment file'
assert_contains "$UNIT" 'NoNewPrivileges=true' 'service must drop privilege escalation'
assert_contains "$UNIT" 'PrivateTmp=true' 'service must isolate temporary files'
assert_contains "$UNIT" 'ProtectSystem=strict' 'service must protect the filesystem'
assert_contains "$UNIT" 'ProtectHome=true' 'service must protect home directories'
assert_contains "$UNIT" 'CapabilityBoundingSet=$' 'service must have no capabilities'
assert_contains "$UNIT" 'AmbientCapabilities=$' 'service must have no ambient capabilities'
assert_contains "$UNIT" 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6' \
    'service must restrict network families'
assert_contains "$UNIT" 'ReadWritePaths=/opt/babyjamjam-fallback-server/state' \
    'service must restrict writable paths to controller state'
assert_not_contains "$UNIT" 'cron|timer' 'service must not schedule polling'

bash -n "$INSTALLER" "$WRAPPER"
node --check "$OPERATOR"

printf '%s\n' 'Fallback controller package tests passed'
