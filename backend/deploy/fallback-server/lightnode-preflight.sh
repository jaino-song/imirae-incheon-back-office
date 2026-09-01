#!/usr/bin/env bash
# Read-only LightNode admission check.  Installed means staged only, before any runtime.
set -euo pipefail
readonly SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
readonly DEFAULT_ARTIFACT_ROOT='/usr/local/libexec/babyjamjam-fallback-server'
readonly DEFAULT_OPERATOR='/usr/local/sbin/babyjamjam-fallback-server'
readonly DEFAULT_STATE_ROOT='/opt/babyjamjam-fallback-server'
readonly DEFAULT_SYSTEMD_DIR='/etc/systemd/system'
readonly CONTROLLER_BUNDLE='/usr/local/libexec/babyjamjam-failover-controller'
readonly CONTROLLER_CLI='/usr/local/sbin/babyjamjam-failover-controller'
readonly CONTROLLER_UNIT='babyjamjam-failover-controller.service'
readonly GUARD_SERVICE='babyjamjam-fallback-temporary-active-guard.service'
readonly GUARD_TIMER='babyjamjam-fallback-temporary-active-guard.timer'
readonly PROJECT_LABEL='com.docker.compose.project=babyjamjam-fallback-server'
fail() { printf 'preflight=%s\n' "$1" >&2; exit 1; }

# Overrides exist solely for isolated fixtures. Production ignores them and keeps
# every location fixed under the protected paths above.
test_mode() { [[ "${LIGHTNODE_PREFLIGHT_TEST_MODE:-}" == 1 ]]; }
fixture() { if test_mode; then printf '%s' "${!1:-}"; fi; }
pick() { local value; value="$(fixture "$1")"; printf '%s' "${value:-$2}"; }
readonly ARTIFACT_ROOT="$(pick LIGHTNODE_PREFLIGHT_ARTIFACT_ROOT "$DEFAULT_ARTIFACT_ROOT")"
readonly OPERATOR_PATH="$(pick LIGHTNODE_PREFLIGHT_OPERATOR_PATH "$DEFAULT_OPERATOR")"
readonly STATE_ROOT="$(pick LIGHTNODE_PREFLIGHT_STATE_ROOT "$DEFAULT_STATE_ROOT")"
readonly SYSTEMD_DIR="$(pick LIGHTNODE_PREFLIGHT_SYSTEMD_DIR "$DEFAULT_SYSTEMD_DIR")"
readonly OS_RELEASE="$(pick LIGHTNODE_PREFLIGHT_OS_RELEASE /etc/os-release)"
readonly MEMINFO="$(pick LIGHTNODE_PREFLIGHT_MEMINFO /proc/meminfo)"

command_path() {
  local name="$1" bin
  bin="$(fixture LIGHTNODE_PREFLIGHT_TEST_BIN)"
  if [[ -n "$bin" ]]; then [[ -d "$bin" && ! -L "$bin" && -x "$bin/$name" && ! -L "$bin/$name" ]] || fail "command_$name"; printf '%s\n' "$bin/$name"; return; fi
  command -v "$name" || fail "command_$name"
}
run_capture() { local name="$1" cmd; shift; cmd="$(command_path "$name")"; RUN_OUTPUT=''; RUN_STATUS=0; RUN_OUTPUT="$("$cmd" "$@" 2>&1)" || RUN_STATUS=$?; }
require_success() { run_capture "$@"; [[ "$RUN_STATUS" == 0 ]] || fail "${1}_command"; }
owner() { local value; value="$(fixture LIGHTNODE_PREFLIGHT_TEST_OWNER)"; printf '%s' "${value:-0}"; }
group() { local value; value="$(fixture LIGHTNODE_PREFLIGHT_TEST_GROUP)"; printf '%s' "${value:-0}"; }
metadata() { local cmd; cmd="$(command_path stat)"; "$cmd" -c '%u:%g:%a' "$1" 2>/dev/null; }
safe_file() { [[ -f "$1" && ! -L "$1" ]] && [[ "$(metadata "$1")" == "$(owner):$(group):$2" ]]; }
safe_dir() { [[ -d "$1" && ! -L "$1" ]] && [[ "$(metadata "$1")" == "$(owner):$(group):$2" ]]; }
absent() { [[ ! -e "$1" && ! -L "$1" ]]; }

parse_node() {
  local program="$1" payload="$2" node result
  node="$(command_path node)"
  result="$(printf '%s' "$payload" | "$node" -e "$program")" || fail parser
  [[ "$result" == ok ]] || fail parser
}
check_host() {
  require_success uname -s; [[ "$RUN_OUTPUT" == Linux ]] || fail linux
  require_success uname -m; [[ "$RUN_OUTPUT" == x86_64 ]] || fail architecture
  grep -Eq '^ID=ubuntu|^ID_LIKE=.*ubuntu' "$OS_RELEASE" || fail os
  require_success getconf _NPROCESSORS_ONLN; [[ "$RUN_OUTPUT" =~ ^[0-9]+$ && "$RUN_OUTPUT" -ge 2 ]] || fail cpu
  require_success awk '/^MemTotal:/{print $2}' "$MEMINFO"; [[ "$RUN_OUTPUT" =~ ^[0-9]+$ && "$RUN_OUTPUT" -ge 3670016 ]] || fail memory
  require_success df -Pk /
  parse_node 'const l=require("fs").readFileSync(0,"utf8").trim().split("\n"); if(l.length!==2)process.exit(1); const p=l[1].trim().split(/\s+/); if(p.length!==6||!p.slice(1,4).every(x=>/^\d+$/.test(x)))process.exit(1); const total=BigInt(p[1])*1024n,free=BigInt(p[3])*1024n; if(total<45000000000n||free<21474836480n)process.exit(1); process.stdout.write("ok")' "$RUN_OUTPUT"
  require_success node -p 'process.versions.node'; [[ "$RUN_OUTPUT" =~ ^([2-9][0-9]|1[0-9]{2,})\.[0-9]+\.[0-9]+$ ]] || fail node
  require_success docker info; require_success docker compose version
  require_success systemctl is-system-running; [[ "$RUN_OUTPUT" == running ]] || fail systemd
}
check_tailscale() {
  require_success tailscale status --json
  local node; node="$(command_path node)"
  TAILSCALE_IPS_JSON="$(printf '%s' "$RUN_OUTPUT" | "$node" -e 'try { const s=JSON.parse(require("fs").readFileSync(0,"utf8")),d=s.Self,net=require("net"); if(s.BackendState!=="Running"||!d||typeof d.ID!=="string"||!d.ID||d.Online!==true||!Array.isArray(d.TailscaleIPs)||d.TailscaleIPs.length===0||d.TailscaleIPs.some(x=>typeof x!=="string"||net.isIP(x)===0))process.exit(1); process.stdout.write(JSON.stringify(d.TailscaleIPs)) } catch { process.exit(1) }')" || fail parser
  [[ "$TAILSCALE_IPS_JSON" == \[*\] ]] || fail parser
}
check_egress() {
  local one two digest hashcmd
  require_success curl --fail --silent --show-error --max-time 10 https://api.ipify.org; one="${RUN_OUTPUT//$'\n'/}"
  require_success curl --fail --silent --show-error --max-time 10 https://ifconfig.me/ip; two="${RUN_OUTPUT//$'\n'/}"
  parse_node 'const a=require("fs").readFileSync(0,"utf8").split("\n"); const valid=x=>{const p=x.split(".");return p.length===4&&p.every(v=>/^(0|[1-9][0-9]{0,2})$/.test(v)&&Number(v)<=255)}; if(a.length!==2||a[0]!==a[1]||!valid(a[0]))process.exit(1); process.stdout.write("ok")' "$one"$'\n'"$two"
  hashcmd="$(command_path sha256sum)"; digest="$(printf '%s' "$one" | "$hashcmd" | awk '{print $1}')" || fail egress_hash
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || fail egress_hash; printf 'egress_sha256=%s\n' "$digest"
}
check_listeners() {
  require_success ss -H -lntupe
  local mode="$1"
  local node result; node="$(command_path node)"
  result="$(PREFLIGHT_LISTENER_MODE="$mode" PREFLIGHT_TAILSCALE_IPS="$TAILSCALE_IPS_JSON" printf '%s' "$RUN_OUTPUT" | PREFLIGHT_LISTENER_MODE="$mode" PREFLIGHT_TAILSCALE_IPS="$TAILSCALE_IPS_JSON" "$node" -e 'let tails;try{tails=new Set(JSON.parse(process.env.PREFLIGHT_TAILSCALE_IPS||"[]"))}catch{process.exit(1)}const lines=require("fs").readFileSync(0,"utf8").trim().split("\n").filter(Boolean);for(const l of lines){const c=l.trim().split(/\s+/),m=c[4]?.match(/^(\[[^\]]+\]|[^:]+):(\*|[0-9]+)$/);if(c.length<5||!["tcp","udp"].includes(c[0])||!m)process.exit(1);const h=m[1].replace(/^\[|\]$/g,""),p=m[2]==="*"?-1:Number(m[2]),loop=h==="127.0.0.1"||h==="::1",tailscaled=l.includes("users:((\"tailscaled\",")&&l.includes("cgroup:/system.slice/tailscaled.service");const publicOK=(c[0]==="tcp"&&p===22)||(c[0]==="udp"&&p===41641&&tailscaled)||(c[0]==="tcp"&&tails.has(h)&&tailscaled);if((p===3101||p===3102)||(!loop&&!publicOK))process.exit(1)}process.stdout.write("ok")')" || fail listeners
  [[ "$result" == ok ]] || fail listeners
}
check_docker_empty() {
  require_success docker ps -aq; [[ -z "$RUN_OUTPUT" ]] || fail docker_containers
  require_success docker volume ls --quiet; [[ -z "$RUN_OUTPUT" ]] || fail docker_volumes
  require_success docker network ls --format '{{.Name}}'
  parse_node 'const a=require("fs").readFileSync(0,"utf8").trim().split("\n").filter(Boolean);if(a.some(x=>!["bridge","host","none"].includes(x)))process.exit(1);process.stdout.write("ok")' "$RUN_OUTPUT"
  require_success docker ps -aq --filter "label=$PROJECT_LABEL"; [[ -z "$RUN_OUTPUT" ]] || fail docker_label
  require_success docker network ls --quiet --filter "label=$PROJECT_LABEL"; [[ -z "$RUN_OUTPUT" ]] || fail docker_label
  require_success docker volume ls --quiet --filter "label=$PROJECT_LABEL"; [[ -z "$RUN_OUTPUT" ]] || fail docker_label
}
check_fresh() {
  local p; for p in "$OPERATOR_PATH" "$ARTIFACT_ROOT" "$STATE_ROOT" "$SYSTEMD_DIR/$GUARD_SERVICE" "$SYSTEMD_DIR/$GUARD_TIMER" "$CONTROLLER_BUNDLE" "$CONTROLLER_CLI" "$SYSTEMD_DIR/$CONTROLLER_UNIT"; do absent "$p" || fail residue; done; check_docker_empty
}
digest() { run_capture sha256sum "$1"; [[ "$RUN_STATUS" == 0 && "$RUN_OUTPUT" =~ ^([0-9a-f]{64})[[:space:]] ]] || fail manifest; printf '%s\n' "${BASH_REMATCH[1]}"; }
check_manifest() {
  local m="$ARTIFACT_ROOT/bundle.manifest" e; safe_file "$m" 640 && [[ "$(wc -l <"$m")" -eq 6 ]] || fail manifest
  local expected=("operator.sh=$(digest "$OPERATOR_PATH")" "compose.yml=$(digest "$ARTIFACT_ROOT/compose.yml")" "compose.temporary-active.yml=$(digest "$ARTIFACT_ROOT/compose.temporary-active.yml")" "production-db-identity.sh=$(digest "$ARTIFACT_ROOT/production-db-identity.sh")" "systemd/$GUARD_SERVICE=$(digest "$SYSTEMD_DIR/$GUARD_SERVICE")" "systemd/$GUARD_TIMER=$(digest "$SYSTEMD_DIR/$GUARD_TIMER")")
  for e in "${expected[@]}"; do grep -Fqx "$e" "$m" || fail manifest; done
}
check_staged_state() {
  local p entry; safe_dir "$STATE_ROOT" 700 && safe_dir "$STATE_ROOT/state" 700 || fail state
  for p in "$STATE_ROOT/backend.env" "$STATE_ROOT/approved-production-db-ref.sha256" "$STATE_ROOT/temporary-active-approval" "$STATE_ROOT/temporary-active-scheduler-evidence" "$STATE_ROOT/state/runtime-mode" "$STATE_ROOT/state/temporary-active-expiry" "$STATE_ROOT/state/temporary-active-linkage" "$STATE_ROOT/state/used-temporary-active-nonces"; do absent "$p" || fail state; done
  run_capture find "$STATE_ROOT/state" -mindepth 1 -maxdepth 1 -print; [[ "$RUN_STATUS" == 0 ]] || fail state
  while IFS= read -r entry; do [[ -z "$entry" || "$entry" == "$STATE_ROOT/state/operator.lock" ]] || fail state; done <<<"$RUN_OUTPUT"
  if [[ -e "$STATE_ROOT/state/operator.lock" || -L "$STATE_ROOT/state/operator.lock" ]]; then safe_file "$STATE_ROOT/state/operator.lock" 600 || fail state; fi
}
check_timer() {
  run_capture systemctl is-enabled "$GUARD_TIMER"
  [[ "$RUN_STATUS" == 1 && "$RUN_OUTPUT" == disabled ]] || fail guard_timer
}
check_installed() {
  safe_file "$OPERATOR_PATH" 750 || fail operator; safe_dir "$ARTIFACT_ROOT" 700 || fail artifact_root
  safe_file "$ARTIFACT_ROOT/compose.yml" 640 || fail compose; safe_file "$ARTIFACT_ROOT/compose.temporary-active.yml" 640 || fail active_compose; safe_file "$ARTIFACT_ROOT/production-db-identity.sh" 750 || fail identity_helper
  safe_file "$SYSTEMD_DIR/$GUARD_SERVICE" 640 || fail guard_service; safe_file "$SYSTEMD_DIR/$GUARD_TIMER" 640 || fail guard_timer
  for p in "$CONTROLLER_BUNDLE" "$CONTROLLER_CLI" "$SYSTEMD_DIR/$CONTROLLER_UNIT"; do absent "$p" || fail controller_residue; done
  check_manifest; check_staged_state; check_timer; check_docker_empty
}
[[ $# == 1 && ( "$1" == fresh || "$1" == installed ) ]] || fail mode
check_host; check_tailscale; check_egress; check_listeners "$1"; if [[ "$1" == fresh ]]; then check_fresh; else check_installed; fi
printf 'preflight=ok mode=%s\n' "$1"
