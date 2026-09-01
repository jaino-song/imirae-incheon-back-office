#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"; SCRIPT="$ROOT/lightnode-preflight.sh"
bash -n "$SCRIPT"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BIN="$TMP/bin"; mkdir -p "$BIN"
printf 'ID=ubuntu\n' >"$TMP/os-release"; printf 'MemTotal: 4194304 kB\n' >"$TMP/meminfo"
fake(){ printf '#!/usr/bin/env bash\n%s\n' "$2" >"$BIN/$1"; chmod 700 "$BIN/$1"; }
fake uname '[[ "$1" == -s ]] && echo Linux || echo x86_64'
fake getconf 'echo "${CPU_COUNT:-2}"'
fake awk 'if [[ "$*" == *MemTotal* ]]; then echo "${MEMORY_KB:-4194304}"; else /usr/bin/awk "$@"; fi'
fake df 'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/vda %s 1 %s 1%% /\\n" "${DF_TOTAL:-50000000}" "${DF_FREE:-20971520}"'
fake node 'if [[ "$1" == -p ]]; then echo "${NODE_VERSION:-20.1.0}"; else "$LIGHTNODE_PREFLIGHT_REAL_NODE" "$@"; fi'
fake stat 'path="${!#}"; /usr/bin/stat -f "%u:%g:%Lp" "$path"'
fake sha256sum 'if [[ "$#" -eq 0 ]]; then shasum -a 256; else shasum -a 256 "$1"; fi'
fake docker 'key="$1 ${2:-}"; [[ "${DOCKER_FAIL:-}" == "$key" ]] && exit 9; case "$key" in "info ") :;; "compose version") echo v2;; "ps -aq") printf "%s" "${DOCKER_PS:-}";; "network ls") printf "%s" "${DOCKER_NETWORK:-}";; "volume ls") printf "%s" "${DOCKER_VOLUME:-}";; *) :;; esac'
fake systemctl '[[ "${SYSTEMCTL_FAIL:-}" == "$1" ]] && exit 9; case "$1" in is-system-running) echo "${SYSTEMD_STATE:-running}";; is-enabled) echo disabled;; *) :;; esac'
fake tailscale 'if [[ -n "${TAILSCALE_JSON:-}" ]]; then printf "%s" "$TAILSCALE_JSON"; else printf "%s" '\''{"BackendState":"Running","Self":{"ID":"id","Online":true,"TailscaleIPs":["100.1.1.1"]}}'\''; fi'
fake curl 'case "$*" in *api.ipify.org*) printf "%s" "${EGRESS_ONE:-203.0.113.8}";; *) printf "%s" "${EGRESS_TWO:-203.0.113.8}";; esac'
fake ss 'printf "%b\\n" "${SS_OUTPUT:-tcp LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*\\nudp UNCONN 0 0 0.0.0.0:41641 0.0.0.0:*}"'
run(){ local mode="$1"; shift; env LIGHTNODE_PREFLIGHT_TEST_MODE=1 LIGHTNODE_PREFLIGHT_TEST_OWNER="$(id -u)" LIGHTNODE_PREFLIGHT_TEST_GROUP="$(id -g)" LIGHTNODE_PREFLIGHT_TEST_BIN="$BIN" LIGHTNODE_PREFLIGHT_REAL_NODE="$(command -v node)" LIGHTNODE_PREFLIGHT_ARTIFACT_ROOT="$TMP/artifacts" LIGHTNODE_PREFLIGHT_OPERATOR_PATH="$TMP/operator" LIGHTNODE_PREFLIGHT_STATE_ROOT="$TMP/state-root" LIGHTNODE_PREFLIGHT_SYSTEMD_DIR="$TMP/units" LIGHTNODE_PREFLIGHT_OS_RELEASE="$TMP/os-release" LIGHTNODE_PREFLIGHT_MEMINFO="$TMP/meminfo" "$@" bash "$SCRIPT" "$mode"; }
ok(){ run "$@" >/dev/null; }; no(){ if run "$@" >/dev/null 2>&1; then echo "expected failure: $*" >&2; exit 1; fi; }

# Modes are explicit; fresh rejects every protected residue and active loopback ports.
no ''; no wrong; ok fresh
touch "$TMP/operator"; no fresh; rm "$TMP/operator"
mkdir "$TMP/artifacts"; no fresh; rmdir "$TMP/artifacts"
no fresh TAILSCALE_JSON='{"BackendState":"Stopped","Self":{"ID":"id","Online":true,"TailscaleIPs":["100.1.1.1"]}}'
no fresh TAILSCALE_JSON='{"BackendState":"Running","Self":null}'
no fresh EGRESS_ONE=203.0.113.8 EGRESS_TWO=203.0.113.9
no fresh EGRESS_ONE=203.0.113.08
no fresh SS_OUTPUT='tcp LISTEN 0 4096 0.0.0.0:443 0.0.0.0:*'
no fresh SS_OUTPUT='tcp LISTEN 0 4096 127.0.0.1:3101 0.0.0.0:*'
no fresh SS_OUTPUT='garbage'
no fresh LIGHTNODE_PREFLIGHT_EXPECTED_EGRESS_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
no fresh CPU_COUNT=1; no fresh MEMORY_KB=4194303; no fresh DF_TOTAL=49999999; no fresh DF_FREE=20971519; no fresh NODE_VERSION=19.9.0
no fresh SYSTEMD_STATE=degraded; no fresh DOCKER_FAIL='info '; no fresh SYSTEMCTL_FAIL=is-system-running
no fresh DOCKER_PS=container-id; no fresh DOCKER_NETWORK=network-id; no fresh DOCKER_VOLUME=volume-id
privacy_output="$(run fresh)"; [[ "$privacy_output" != *203.0.113.8* && "$privacy_output" == egress_sha256=* ]] || { echo 'egress privacy failure' >&2; exit 1; }

if true; then
  mkdir -p "$TMP/artifacts" "$TMP/state-root/state" "$TMP/units"; chmod 700 "$TMP/artifacts" "$TMP/state-root" "$TMP/state-root/state"
  for item in operator artifacts/compose.yml artifacts/compose.temporary-active.yml artifacts/production-db-identity.sh units/babyjamjam-fallback-temporary-active-guard.service units/babyjamjam-fallback-temporary-active-guard.timer; do : >"$TMP/$item"; done
  chmod 750 "$TMP/operator" "$TMP/artifacts/production-db-identity.sh"; chmod 640 "$TMP/artifacts/compose.yml" "$TMP/artifacts/compose.temporary-active.yml" "$TMP/units"/*
  printf 'operator.sh=%s\ncompose.yml=%s\ncompose.temporary-active.yml=%s\nproduction-db-identity.sh=%s\nsystemd/babyjamjam-fallback-temporary-active-guard.service=%s\nsystemd/babyjamjam-fallback-temporary-active-guard.timer=%s\n' "$(shasum -a 256 "$TMP/operator"|awk '{print $1}')" "$(shasum -a 256 "$TMP/artifacts/compose.yml"|awk '{print $1}')" "$(shasum -a 256 "$TMP/artifacts/compose.temporary-active.yml"|awk '{print $1}')" "$(shasum -a 256 "$TMP/artifacts/production-db-identity.sh"|awk '{print $1}')" "$(shasum -a 256 "$TMP/units/babyjamjam-fallback-temporary-active-guard.service"|awk '{print $1}')" "$(shasum -a 256 "$TMP/units/babyjamjam-fallback-temporary-active-guard.timer"|awk '{print $1}')" >"$TMP/artifacts/bundle.manifest"; chmod 640 "$TMP/artifacts/bundle.manifest"
  ok installed SS_OUTPUT=$'tcp LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*\ntcp LISTEN 0 4096 127.0.0.1:3101 0.0.0.0:*\ntcp LISTEN 0 4096 [::1]:3102 [::]:*\nudp UNCONN 0 0 0.0.0.0:41641 0.0.0.0:*'
  printf broken >"$TMP/artifacts/bundle.manifest"; no installed
fi
echo 'LightNode preflight offline behavior tests passed'
