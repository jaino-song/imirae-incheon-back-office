#!/usr/bin/env bash

set -euo pipefail

readonly CONTROLLER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly FALLBACK_ROOT="$(cd "$CONTROLLER_ROOT/.." && pwd -P)"
readonly BUNDLE_ROOT="/usr/local/libexec/babyjamjam-failover-controller"
readonly CLI_PATH="/usr/local/sbin/babyjamjam-failover-controller"
readonly ENV_PATH="/opt/babyjamjam-fallback-server/controller.env"
readonly STATE_ROOT="/opt/babyjamjam-fallback-server"
readonly STATE_DIRECTORY="$STATE_ROOT/state"
readonly STATE_PATH="$STATE_DIRECTORY/failover-controller-state.json"

readonly CONFIG="$CONTROLLER_ROOT/config.mjs"
readonly MAIN="$CONTROLLER_ROOT/main.mjs"
readonly SERVER="$CONTROLLER_ROOT/server.mjs"
readonly RECEIVER="$CONTROLLER_ROOT/receiver.mjs"
readonly WORKER="$CONTROLLER_ROOT/worker.mjs"
readonly STATUS="$CONTROLLER_ROOT/fallback-status.mjs"
readonly STATE_STORE="$CONTROLLER_ROOT/state-store.mjs"
readonly PROBES="$CONTROLLER_ROOT/probes.mjs"
readonly POLICY="$CONTROLLER_ROOT/policy.mjs"
readonly SECURITY="$CONTROLLER_ROOT/security.mjs"
readonly DNS_CLIENT="$CONTROLLER_ROOT/vercel-dns-client.mjs"
readonly INSTALLER="$CONTROLLER_ROOT/install.sh"
readonly OPERATOR_MJS="$CONTROLLER_ROOT/operator.mjs"
readonly OPERATOR_SH="$CONTROLLER_ROOT/operator.sh"
readonly ENV_TEMPLATE="$CONTROLLER_ROOT/controller.env.tpl"
readonly TEST_ALL="$CONTROLLER_ROOT/test-all.sh"
readonly SYSTEMD_UNIT="$CONTROLLER_ROOT/systemd/babyjamjam-failover-controller.service"
readonly FALLBACK_OPERATOR="$FALLBACK_ROOT/operator.sh"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

require_file() {
    local file="$1"
    [[ -f "$file" && ! -L "$file" ]] || fail "missing required controller artifact: ${file#$FALLBACK_ROOT/}"
}

assert_contains() {
    local file="$1"
    local pattern="$2"
    local message="$3"
    grep -Eq -- "$pattern" "$file" || fail "$message"
}

assert_not_contains() {
    local file="$1"
    local pattern="$2"
    local message="$3"
    if grep -Eq -- "$pattern" "$file"; then
        fail "$message"
    fi
}

assert_active_contains() {
    local file="$1"
    local pattern="$2"
    local message="$3"
    grep -Ev '^[[:space:]]*(#|//|;|\*)' "$file" | grep -Eq -- "$pattern" || fail "$message"
}

assert_active_not_contains() {
    local file="$1"
    local pattern="$2"
    local message="$3"
    if grep -Ev '^[[:space:]]*(#|//|;|\*)' "$file" | grep -Eq -- "$pattern"; then
        fail "$message"
    fi
}

runtime_files=(
    "$CONFIG"
    "$MAIN"
    "$SERVER"
    "$RECEIVER"
    "$WORKER"
    "$STATUS"
    "$STATE_STORE"
    "$PROBES"
    "$POLICY"
    "$SECURITY"
    "$DNS_CLIENT"
    "$OPERATOR_MJS"
    "$OPERATOR_SH"
)
for file in "${runtime_files[@]}"; do
    require_file "$file"
done
require_file "$INSTALLER"
require_file "$OPERATOR_MJS"
require_file "$OPERATOR_SH"
require_file "$ENV_TEMPLATE"
require_file "$TEST_ALL"
require_file "$SYSTEMD_UNIT"
require_file "$FALLBACK_OPERATOR"

assert_contains "$CONFIG" "CONTROLLER_BIND_HOST[[:space:]]*=[[:space:]]*['\"]127\\.0\\.0\\.1['\"]" \
    'controller must bind to loopback only'
assert_contains "$CONFIG" "CONTROLLER_PORT[[:space:]]*=[[:space:]]*3102" \
    'controller must reserve loopback port 3102'
assert_contains "$CONFIG" "parseBoolean\([[:space:]]*env,[[:space:]]*['\"]FAILOVER_CONTROLLER_ENABLED['\"],[[:space:]]*false" \
    'controller enabled flag must default to false'
assert_contains "$CONFIG" 'payloadContractVerified[[:space:]]*=[[:space:]]*parseBoolean' \
    'controller config must parse the live payload gate'
assert_contains "$CONFIG" 'FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED' \
    'live payload gate must be explicitly named in config'
assert_contains "$CONFIG" "statePath:[[:space:]]*DEFAULT_STATE_PATH" \
    'controller state path must be fixed by code'
assert_not_contains "$CONFIG" 'FAILOVER_STATE_PATH' \
    'controller state path must not be environment-controlled'
assert_active_not_contains "$CONFIG" '0\.0\.0\.0|\[::\]|(^|[^0-9])::([^0-9]|$)' \
    'controller config must not expose a public bind'
assert_active_not_contains "$SERVER" '0\.0\.0\.0|\[::\]|(^|[^0-9])::([^0-9]|$)' \
    'controller server must not expose a public bind'

controller_sources=(
    "$MAIN"
    "$SERVER"
    "$RECEIVER"
    "$WORKER"
    "$STATUS"
    "$STATE_STORE"
    "$PROBES"
    "$POLICY"
    "$SECURITY"
    "$DNS_CLIENT"
)
for file in "${controller_sources[@]}"; do
    assert_active_not_contains "$file" 'setInterval|OnCalendar|OnUnitActiveSec|systemd[[:space:]]+timer|(^|[^A-Za-z])cron([^A-Za-z]|$)' \
        "controller must not add periodic cron/timer polling: ${file#$CONTROLLER_ROOT/}"
done

assert_active_not_contains "$WORKER" 'switchToPrimary|switchBackToAws|autoFailback|FAILBACK_ENABLED|FALLBACK_TO_AWS' \
    'worker must not implement automatic Fallback-to-AWS failback'
assert_active_not_contains "$DNS_CLIENT" 'switchToPrimary|switchBackToAws|failbackToAws|FALLBACK_TO_AWS' \
    'DNS client must expose only the one-way fallback mutation'
assert_active_not_contains "$WORKER" '(^|[^A-Za-z])(eval|exec|spawn|fork|execSync|execFileSync)[[:space:]]*\(' \
    'worker must not execute arbitrary shell code'
assert_active_not_contains "$STATUS" '(^|[^A-Za-z])(eval|exec|spawn|fork|execSync|execFileSync)[[:space:]]*\(' \
    'status reader must not execute arbitrary shell code'
assert_active_not_contains "$OPERATOR_MJS" '(^|[^A-Za-z_.])(eval|exec|spawn|fork|execSync|execFileSync)[[:space:]]*\(|child_process[.]exec' \
    'controller operator must not execute arbitrary shell code'
assert_active_not_contains "$OPERATOR_SH" '(^|[^A-Za-z])eval([[:space:]]|$)|\$\{[^}]*\$\(' \
    'controller shell operator must not evaluate arbitrary input'

assert_contains "$STATUS" 'FALLBACK_OPERATOR_PATH.*babyjamjam-fallback-server' \
    'status reader must use the fixed Fallback Server operator path'
assert_contains "$STATUS" "FALLBACK_STATUS_ARGS[[:space:]]*=[[:space:]]*Object\.freeze\(\[['\"]status['\"]\]\)" \
    'status reader must use the fixed status action'
assert_contains "$STATUS" 'shell:[[:space:]]*false' \
    'status reader must disable shell execution'
assert_contains "$WORKER" 'getFallbackStatus|readFallbackStatus' \
    'worker must consume the fixed Fallback Server status reader'
assert_contains "$WORKER" 'environment.*fallback-server|fallback-server.*environment' \
    'worker must require the Fallback Server environment marker'
assert_contains "$WORKER" 'containerHealthy|restartCount|dbReady|productionDbIdentityCertified|passiveGatesHealthy' \
    'worker must require image/container/restart/database/passive status gates'

assert_contains "$OPERATOR_MJS" 'status' 'controller operator must provide status action'
assert_contains "$OPERATOR_MJS" 'arm' 'controller operator must provide arm action'
assert_contains "$OPERATOR_MJS" 'disarm' 'controller operator must provide disarm action'
assert_active_not_contains "$OPERATOR_MJS" '(^|[^A-Za-z_])(deploy|rollback|stop|manual-failback|failback)([^A-Za-z_]|$)' \
    'controller operator must expose only status, arm, and disarm'
assert_contains "$OPERATOR_SH" 'CONTROLLER_OPERATOR=.*operator\.mjs' \
    'controller shell wrapper must invoke the fixed operator module'
assert_contains "$OPERATOR_SH" 'exec[[:space:]]+/usr/bin/env[[:space:]]+node' \
    'controller shell wrapper must use the fixed Node executable'
assert_active_not_contains "$OPERATOR_SH" '(^|[^A-Za-z_])(deploy|rollback|stop|manual-failback|failback)([^A-Za-z_]|$)' \
    'controller shell wrapper must expose only status, arm, and disarm'

assert_contains "$INSTALLER" "${BUNDLE_ROOT//\//\\/}" \
    'controller installer must use the protected bundle path'
assert_contains "$INSTALLER" "${CLI_PATH//\//\\/}" \
    'controller installer must use the protected CLI path'
assert_contains "$INSTALLER" "${ENV_PATH//\//\\/}" \
    'controller installer must use the protected environment path'
assert_contains "$INSTALLER" "${STATE_ROOT//\//\\/}" \
    'controller installer must use the protected state directory'
assert_contains "$INSTALLER" 'STATE_DIRECTORY=.*STATE_ROOT/state' \
    'controller installer must create the controller state directory'
assert_contains "$INSTALLER" 'EUID.*-eq[[:space:]]+0|must run as root' \
    'controller installer must require root'
assert_contains "$INSTALLER" 'install[[:space:]]+-d[^\n]*-o[[:space:]]+root[^\n]*-g[[:space:]]+root[^\n]*-m[[:space:]]+700' \
    'controller installer must create root-owned mode-700 directories'
assert_contains "$INSTALLER" 'install[^\n]*-o[[:space:]]+root[^\n]*-g[[:space:]]+root[^\n]*-m[[:space:]]+750' \
    'controller installer must protect executable artifacts with root ownership and mode 750'
assert_contains "$INSTALLER" 'install[^\n]*-o[[:space:]]+root[^\n]*-g[[:space:]]+root[^\n]*-m[[:space:]]+640' \
    'controller installer must protect read-only artifacts with root ownership and mode 640'
assert_contains "$INSTALLER" 'chmod[[:space:]]+600|mode[[:space:]]+600|0600' \
    'controller installer must protect the controller environment/state with mode 600'
assert_contains "$INSTALLER" '! -L|not[[:space:]]+a[[:space:]]+symbolic[[:space:]]+link' \
    'controller installer must reject symlinked protected paths'
assert_not_contains "$INSTALLER" 'sudoers|authorized_keys|docker[[:space:]]+group' \
    'controller installer must not broaden host privileges'
assert_not_contains "$INSTALLER" 'prisma.*migrate|migrate.*deploy|ALIGO_' \
    'controller installer must not run migrations or enable Aligo'

assert_contains "$SYSTEMD_UNIT" 'ExecStart=/usr/bin/env node /usr/local/libexec/babyjamjam-failover-controller/main\.mjs' \
    'systemd unit must execute the fixed controller entrypoint'
assert_contains "$SYSTEMD_UNIT" 'EnvironmentFile=-?/opt/babyjamjam-fallback-server/controller\.env' \
    'systemd unit must use the fixed controller environment file'
assert_contains "$SYSTEMD_UNIT" 'NoNewPrivileges=true' \
    'systemd unit must set NoNewPrivileges'
assert_contains "$SYSTEMD_UNIT" 'ProtectSystem=strict' \
    'systemd unit must set ProtectSystem=strict'
assert_contains "$SYSTEMD_UNIT" 'ProtectHome=true' \
    'systemd unit must set ProtectHome'
assert_contains "$SYSTEMD_UNIT" 'PrivateTmp=true' \
    'systemd unit must set PrivateTmp'
assert_contains "$SYSTEMD_UNIT" '^User=root$' \
    'systemd unit must run the controller as root for protected state access'
assert_contains "$SYSTEMD_UNIT" '^UMask=0077$' \
    'systemd unit must use a private umask'
assert_contains "$SYSTEMD_UNIT" '^CapabilityBoundingSet=$' \
    'systemd unit must clear capability bounding set'
assert_contains "$SYSTEMD_UNIT" "ReadWritePaths=${STATE_DIRECTORY//\//\\/}" \
    'systemd unit write access must be limited to controller state'
assert_contains "$FALLBACK_OPERATOR" 'readonly LOCK_FILE="\$STATE_DIRECTORY/operator\.lock"' \
    'fallback operator lock must stay within the systemd writable state boundary'
assert_not_contains "$FALLBACK_OPERATOR" '/run/lock/babyjamjam-fallback-server\.lock' \
    'fallback operator must not lock outside the systemd writable state boundary'
assert_not_contains "$SYSTEMD_UNIT" 'ReadWritePaths=/([[:space:]]|$)' \
    'systemd unit must not grant root write access'
assert_not_contains "$SYSTEMD_UNIT" 'ExecStart=.*(sh|bash)[[:space:]]+-c' \
    'systemd unit must not execute a shell command'
assert_not_contains "$SYSTEMD_UNIT" 'OnCalendar|OnUnitActiveSec|timer' \
    'systemd unit must not define a timer'

env_keys=(
    FAILOVER_CONTROLLER_ENABLED
    FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED
    FAILOVER_SENTRY_CLIENT_SECRET
    FAILOVER_SENTRY_INSTALLATION_ID
    FAILOVER_SENTRY_ORGANIZATION_ID
    FAILOVER_SENTRY_PROJECT_ID
    FAILOVER_SENTRY_ALERT_ID
    FAILOVER_SENTRY_MONITOR_ID
    FAILOVER_PRIMARY_HEALTH_URL
    FAILOVER_FALLBACK_HEALTH_URL
    FAILOVER_VERCEL_API_TOKEN
    FAILOVER_VERCEL_TEAM_ID
    FAILOVER_VERCEL_DNS_RECORD_ID
    FAILOVER_PRIMARY_IPV4
    FAILOVER_FALLBACK_IPV4
    FAILOVER_EXPECTED_IMAGE_TAG
    FAILOVER_EXPECTED_IMAGE_DIGEST
)
for key in "${env_keys[@]}"; do
    count="$(grep -Ec "^${key}=" "$ENV_TEMPLATE")"
    [[ "$count" -eq 1 ]] || fail "controller env template must contain exactly one ${key} key"
done
assert_contains "$ENV_TEMPLATE" '^FAILOVER_CONTROLLER_ENABLED=false$' \
    'controller env template must default the controller disabled'
assert_contains "$ENV_TEMPLATE" '^FAILOVER_LIVE_SENTRY_PAYLOAD_CONTRACT_VERIFIED=false$' \
    'controller env template must default the live payload gate false'
for secret_key in \
    FAILOVER_SENTRY_CLIENT_SECRET \
    FAILOVER_VERCEL_API_TOKEN; do
    assert_contains "$ENV_TEMPLATE" "^${secret_key}=$" \
        "controller env template must leave ${secret_key} blank"
done
for release_key in \
    FAILOVER_EXPECTED_IMAGE_TAG \
    FAILOVER_EXPECTED_IMAGE_DIGEST; do
    assert_contains "$ENV_TEMPLATE" "^${release_key}=$" \
        "controller env template must leave ${release_key} blank"
done
if grep -En '(AKIA[0-9A-Z]{16}|sk_live_[0-9A-Za-z]+|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|postgresql?://[^[:space:]]+:[^@[:space:]]+@)' "$ENV_TEMPLATE"; then
    fail 'controller env template contains a secret literal'
fi

assert_not_contains "$MAIN" 'FAILOVER_CONTROLLER_ENABLED[[:space:]]*=[[:space:]]*true' \
    'controller main must not force-enable failover'
assert_active_not_contains "$OPERATOR_MJS" 'process\.argv\.slice\([[:space:]]*2[[:space:]]*\).*exec|child_process.*exec' \
    'controller operator must not pass arbitrary CLI input to a shell'
for file in "${controller_sources[@]}" "$OPERATOR_MJS" "$OPERATOR_SH"; do
    assert_not_contains "$file" '/usr/local/libexec/babyjamjam-covenant|babyjamjam-covenant-standby|covenant-standby' \
        "controller package must not retain old Covenant standby identifiers: ${file#$CONTROLLER_ROOT/}"
    assert_not_contains "$file" 'prisma[[:space:]]+migrate|migrate[[:space:]]+deploy' \
        "controller package must not run database migrations: ${file#$CONTROLLER_ROOT/}"
    assert_not_contains "$file" 'ALIGO_API_KEY|ALIGO_USER_ID|ALIGO_SENDER_PHONE' \
        "controller package must not mutate or enable Aligo: ${file#$CONTROLLER_ROOT/}"
done
assert_not_contains "$ENV_TEMPLATE" 'ALIGO_API_KEY|ALIGO_USER_ID|ALIGO_SENDER_PHONE' \
    'controller env template must not add Aligo credentials'
assert_not_contains "$SYSTEMD_UNIT" 'ALIGO_API_KEY|ALIGO_USER_ID|ALIGO_SENDER_PHONE' \
    'controller systemd unit must not add Aligo credentials'

bash -n "$TEST_ALL"
bash -n "$INSTALLER"
bash -n "$OPERATOR_SH"

echo 'Fallback Server controller contract tests passed'
