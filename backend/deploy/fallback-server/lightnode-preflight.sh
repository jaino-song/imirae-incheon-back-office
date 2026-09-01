#!/usr/bin/env bash
# Read-only admission check for the temporary LightNode fallback host.
set -euo pipefail
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
readonly ARTIFACT_ROOT="${LIGHTNODE_PREFLIGHT_ARTIFACT_ROOT:-/usr/local/libexec/babyjamjam-fallback-server}"
readonly OPERATOR_PATH="${LIGHTNODE_PREFLIGHT_OPERATOR_PATH:-/usr/local/sbin/babyjamjam-fallback-server}"
readonly STATE_ROOT="${LIGHTNODE_PREFLIGHT_STATE_ROOT:-/opt/babyjamjam-fallback-server}"
readonly SYSTEMD_DIR="${LIGHTNODE_PREFLIGHT_SYSTEMD_DIR:-/etc/systemd/system}"
readonly OS_RELEASE="${LIGHTNODE_PREFLIGHT_OS_RELEASE:-/etc/os-release}"
readonly MEMINFO="${LIGHTNODE_PREFLIGHT_MEMINFO:-/proc/meminfo}"
readonly PROJECT_NAME='babyjamjam-fallback-server'
readonly CONTROLLER_ARTIFACT_ROOT='/usr/local/libexec/babyjamjam-fallback-controller'
readonly CONTROLLER_UNIT='babyjamjam-failover-controller.service'
readonly GUARD_SERVICE='babyjamjam-fallback-temporary-active-guard.service'
readonly GUARD_TIMER='babyjamjam-fallback-temporary-active-guard.timer'
fail() { printf 'preflight=%s\n' "$1" >&2; exit 1; }

# Only the offline test harness may inject command fixtures. Production lookup is
# always the fixed safe PATH above, and command output is never relayed.
command_path() {
  local command="$1"
  if [[ "${LIGHTNODE_PREFLIGHT_TEST_MODE:-}" == 1 && -n "${LIGHTNODE_PREFLIGHT_TEST_BIN:-}" ]]; then
    [[ -d "$LIGHTNODE_PREFLIGHT_TEST_BIN" && ! -L "$LIGHTNODE_PREFLIGHT_TEST_BIN" && -x "$LIGHTNODE_PREFLIGHT_TEST_BIN/$command" && ! -L "$LIGHTNODE_PREFLIGHT_TEST_BIN/$command" ]] || fail "command_$command"
    printf '%s\n' "$LIGHTNODE_PREFLIGHT_TEST_BIN/$command"; return
  fi
  command -v "$command" || fail "command_$command"
}
run_capture() {
  local name="$1" command; shift; command="$(command_path "$name")"
  RUN_OUTPUT=''; RUN_STATUS=0
  RUN_OUTPUT="$("$command" "$@" 2>&1)" || RUN_STATUS=$?
}
require_success() { run_capture "$@"; [[ "$RUN_STATUS" -eq 0 ]] || fail "${1}_command"; }
expected_owner() { if [[ "${LIGHTNODE_PREFLIGHT_TEST_MODE:-}" == 1 && -n "${LIGHTNODE_PREFLIGHT_TEST_OWNER:-}" ]]; then printf '%s' "$LIGHTNODE_PREFLIGHT_TEST_OWNER"; else printf 0; fi; }
expected_group() { if [[ "${LIGHTNODE_PREFLIGHT_TEST_MODE:-}" == 1 && -n "${LIGHTNODE_PREFLIGHT_TEST_GROUP:-}" ]]; then printf '%s' "$LIGHTNODE_PREFLIGHT_TEST_GROUP"; else printf 0; fi; }
safe_regular() { local metadata stat_command; [[ -f "$1" && ! -L "$1" ]] || return 1; stat_command="$(command_path stat)"; metadata="$("$stat_command" -c '%u:%g:%a' "$1" 2>/dev/null)" || return 1; [[ "$metadata" == "$(expected_owner):$(expected_group):$2" ]]; }
safe_directory() { local metadata stat_command; [[ -d "$1" && ! -L "$1" ]] || return 1; stat_command="$(command_path stat)"; metadata="$("$stat_command" -c '%u:%g:%a' "$1" 2>/dev/null)" || return 1; [[ "$metadata" == "$(expected_owner):$(expected_group):$2" ]]; }
absent() { [[ ! -e "$1" && ! -L "$1" ]]; }

check_host() {
  require_success uname -s; [[ "$RUN_OUTPUT" == Linux ]] || fail linux
  require_success uname -m; [[ "$RUN_OUTPUT" == x86_64 ]] || fail architecture
  grep -Eq '^ID=ubuntu|^ID_LIKE=.*ubuntu' "$OS_RELEASE" || fail os
  require_success getconf _NPROCESSORS_ONLN; [[ "$RUN_OUTPUT" =~ ^[0-9]+$ && "$RUN_OUTPUT" -ge 2 ]] || fail cpu
  require_success awk '/^MemTotal:/{print $2}' "$MEMINFO"; [[ "$RUN_OUTPUT" =~ ^[0-9]+$ && "$RUN_OUTPUT" -ge 4194304 ]] || fail memory
  require_success df -Pk /; read -r disk_total disk_free < <(awk 'NR==2 { print $2, $4 }' <<<"$RUN_OUTPUT")
  [[ "$disk_total" =~ ^[0-9]+$ && "$disk_free" =~ ^[0-9]+$ && "$disk_total" -ge 50000000 && "$disk_free" -ge 20971520 ]] || fail disk
  require_success node -p 'process.versions.node'; [[ "$RUN_OUTPUT" =~ ^([2-9][0-9]|1[0-9]{2,})\.[0-9]+\.[0-9]+ ]] || fail node
  require_success docker info; require_success docker compose version
  require_success systemctl is-system-running; [[ "$RUN_OUTPUT" == running ]] || fail systemd
}
check_tailscale() {
  require_success tailscale status --json
  local json result node_command; json="$(mktemp)"; printf '%s' "$RUN_OUTPUT" >"$json"; node_command="$(command_path node)"
  result="$("$node_command" - "$json" <<'NODE'
const fs=require('fs'); try { const s=JSON.parse(fs.readFileSync(process.argv[2],'utf8')), d=s.Self;
if (s.BackendState!=='Running'||!d||typeof d.ID!=='string'||!d.ID||d.Online!==true||!Array.isArray(d.TailscaleIPs)||!d.TailscaleIPs[0]) process.exit(1); process.stdout.write('ok'); } catch { process.exit(1); }
NODE
)" || { rm -f "$json"; fail tailscale_state; }; rm -f "$json"; [[ "$result" == ok ]] || fail tailscale_state
}
canonical_ipv4() { local node_command; node_command="$(command_path node)"; "$node_command" -e 'const p=process.argv[1].split("."); if(p.length!==4||p.some(x=>!/^(0|[1-9][0-9]{0,2})$/.test(x)||Number(x)>255))process.exit(1)' "$1" >/dev/null 2>&1; }
check_egress() {
  local first second digest
  require_success curl --fail --silent --show-error --max-time 10 https://api.ipify.org; first="${RUN_OUTPUT//$'\n'/}"
  require_success curl --fail --silent --show-error --max-time 10 https://ifconfig.me/ip; second="${RUN_OUTPUT//$'\n'/}"
  canonical_ipv4 "$first" && canonical_ipv4 "$second" && [[ "$first" == "$second" ]] || fail egress
  digest="$(printf '%s' "$first" | "$(command_path sha256sum)" | awk '{print $1}')"; [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || fail egress_hash
  if [[ -n "${LIGHTNODE_PREFLIGHT_EXPECTED_EGRESS_SHA256:-}" ]]; then [[ "${LIGHTNODE_PREFLIGHT_EXPECTED_EGRESS_SHA256}" =~ ^[0-9a-f]{64}$ && "$digest" == "${LIGHTNODE_PREFLIGHT_EXPECTED_EGRESS_SHA256}" ]] || fail egress_hash; fi
  printf 'egress_sha256=%s\n' "$digest"
}
check_listeners() {
  require_success ss -H -lntu
  local parsed node_command listener_file; listener_file="$(mktemp)"; printf '%s' "$RUN_OUTPUT" >"$listener_file"; node_command="$(command_path node)"; parsed="$("$node_command" - "$1" "$listener_file" <<'NODE'
const fs=require('fs'), mode=process.argv[2], lines=fs.readFileSync(process.argv[3],'utf8').trim().split('\n').filter(Boolean);
for(const l of lines){const c=l.trim().split(/\s+/); if(c.length<5||!['tcp','udp'].includes(c[0]))process.exit(1); const m=c[4].match(/^(\[[^\]]+\]|[^:]+):(\*|[0-9]+)$/); if(!m)process.exit(1); const host=m[1].replace(/^\[|\]$/g,''), port=m[2]==='*'?-1:Number(m[2]), loop=host==='127.0.0.1'||host==='::1', publicOK=(c[0]==='tcp'&&port===22)||(c[0]==='udp'&&port===41641), installedLoop=mode==='installed'&&loop&&c[0]==='tcp'&&(port===3101||port===3102); if(!loop&&!publicOK)process.exit(1); if(loop&&!installedLoop&&(port===3101||port===3102))process.exit(1);} process.stdout.write('ok');
NODE
)" || { rm -f "$listener_file"; fail listeners; }; rm -f "$listener_file"; [[ "$parsed" == ok ]] || fail listeners
}
check_no_docker_residue() {
  require_success docker ps -aq --filter "label=com.docker.compose.project=$PROJECT_NAME"; [[ -z "$RUN_OUTPUT" ]] || fail docker_ps
  require_success docker network ls --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME"; [[ -z "$RUN_OUTPUT" ]] || fail docker_network
  require_success docker volume ls --quiet --filter "label=com.docker.compose.project=$PROJECT_NAME"; [[ -z "$RUN_OUTPUT" ]] || fail docker_volume
}
check_fresh() {
  local path; for path in "$OPERATOR_PATH" "$ARTIFACT_ROOT" "$STATE_ROOT" "$SYSTEMD_DIR/$GUARD_SERVICE" "$SYSTEMD_DIR/$GUARD_TIMER" "$SYSTEMD_DIR/$CONTROLLER_UNIT" "$CONTROLLER_ARTIFACT_ROOT"; do absent "$path" || fail residue; done; check_no_docker_residue
}
digest() { "$(command_path sha256sum)" "$1" | awk '{print $1}'; }
check_manifest() {
  local manifest="$ARTIFACT_ROOT/bundle.manifest" entry; safe_regular "$manifest" 640 && [[ "$(wc -l <"$manifest")" -eq 6 ]] || fail manifest
  local expected=("operator.sh=$(digest "$OPERATOR_PATH")" "compose.yml=$(digest "$ARTIFACT_ROOT/compose.yml")" "compose.temporary-active.yml=$(digest "$ARTIFACT_ROOT/compose.temporary-active.yml")" "production-db-identity.sh=$(digest "$ARTIFACT_ROOT/production-db-identity.sh")" "systemd/$GUARD_SERVICE=$(digest "$SYSTEMD_DIR/$GUARD_SERVICE")" "systemd/$GUARD_TIMER=$(digest "$SYSTEMD_DIR/$GUARD_TIMER")")
  for entry in "${expected[@]}"; do grep -Fqx "$entry" "$manifest" || fail manifest; done
}
check_state() {
  local state="$STATE_ROOT/state" path runtime; safe_directory "$STATE_ROOT" 700 && safe_directory "$state" 700 || fail state
  for path in "$STATE_ROOT/backend.env" "$STATE_ROOT/approved-production-db-ref.sha256" "$STATE_ROOT/temporary-active-approval" "$STATE_ROOT/temporary-active-scheduler-evidence"; do if [[ -e "$path" || -L "$path" ]]; then case "$path" in *backend.env) safe_regular "$path" 600;; *approved-production-db-ref.sha256|*temporary-active-approval) safe_regular "$path" 400;; *) safe_regular "$path" 600;; esac || fail state; fi; done
  runtime="$state/runtime-mode"; if [[ -e "$runtime" || -L "$runtime" ]]; then safe_regular "$runtime" 600 && [[ "$(<"$runtime")" =~ ^(passive|temporary-active)$ ]] || fail state; if [[ "$(<"$runtime")" == temporary-active ]]; then for path in "$state/temporary-active-expiry" "$state/temporary-active-linkage" "$state/used-temporary-active-nonces"; do safe_regular "$path" 600 || fail state; done; [[ "$(<"$state/temporary-active-expiry")" =~ ^[0-9]{10,}$ && "$(<"$state/temporary-active-linkage")" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}[[:space:]][0-9a-f]{64}[[:space:]][a-f0-9]{32,128}$ ]] || fail state; fi; fi
}
check_installed() {
  safe_regular "$OPERATOR_PATH" 750 || fail operator; safe_directory "$ARTIFACT_ROOT" 700 || fail artifact_root
  safe_regular "$ARTIFACT_ROOT/compose.yml" 640 || fail compose; safe_regular "$ARTIFACT_ROOT/compose.temporary-active.yml" 640 || fail active_compose; safe_regular "$ARTIFACT_ROOT/production-db-identity.sh" 750 || fail identity_helper
  safe_regular "$SYSTEMD_DIR/$GUARD_SERVICE" 640 || fail guard_service; safe_regular "$SYSTEMD_DIR/$GUARD_TIMER" 640 || fail guard_timer
  check_manifest; check_state; require_success systemctl is-enabled "$GUARD_TIMER"; [[ "$RUN_OUTPUT" == enabled || "$RUN_OUTPUT" == disabled ]] || fail guard_timer; check_no_docker_residue
}
[[ $# -eq 1 && ( "$1" == fresh || "$1" == installed ) ]] || fail mode
check_host; check_tailscale; check_egress; check_listeners "$1"; if [[ "$1" == fresh ]]; then check_fresh; else check_installed; fi
printf 'preflight=ok mode=%s\n' "$1"
