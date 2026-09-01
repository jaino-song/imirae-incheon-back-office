#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"; SCRIPT="$ROOT/lightnode-preflight.sh"
bash -n "$SCRIPT"
grep -Fqx "readonly CONTROLLER_BUNDLE='/usr/local/libexec/babyjamjam-failover-controller'" "$SCRIPT"
grep -Fqx "readonly CONTROLLER_CLI='/usr/local/sbin/babyjamjam-failover-controller'" "$SCRIPT"
grep -Fq 'root:root mode 400' "$ROOT/operator.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; BIN="$TMP/bin"; mkdir -p "$BIN"
printf 'ID=ubuntu\n' >"$TMP/os"; printf 'MemTotal: 3670016 kB\n' >"$TMP/mem"
ip(){ printf '%s.%s.%s.%s' "$1" "$2" "$3" "$4"; }
PUBLIC="$(ip 198 51 100 8)"; TAIL="$(ip 100 64 0 1)"; LOOP="$(ip 127 0 0 1)"; ANY="$(ip 0 0 0 0)"
fake(){ printf '#!/usr/bin/env bash\n%s\n' "$2" >"$BIN/$1"; chmod 700 "$BIN/$1"; }
fake uname '[[ "$1" == -s ]] && echo Linux || echo x86_64'
fake getconf 'echo "${CPU:-2}"'
fake awk 'if [[ "$*" == *MemTotal* ]]; then echo "${MEM:-3670016}"; else /usr/bin/awk "$@"; fi'
fake df 'printf "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda %s 1 %s 1%% /\n" "${TOTAL:-43945313}" "${FREE:-20971520}"'
fake node 'if [[ "$1" == -p ]]; then echo "${NODE_VERSION:-20.1.0}"; else "$REAL_NODE" "$@"; fi'
fake stat 'path="${!#}"; case "$path" in */o|*/production-db-identity.sh) mode=750;; */a) mode=700;; */s|*/s/state) mode=700;; */operator.lock) mode=600;; *) mode=640;; esac; printf "%s:%s:%s\\n" "$LIGHTNODE_PREFLIGHT_TEST_OWNER" "$LIGHTNODE_PREFLIGHT_TEST_GROUP" "$mode"'
fake sha256sum '[[ "${HASH_FAIL:-}" == 1 ]] && exit 9; "$REAL_NODE" -e "const fs=require(\"fs\"),c=require(\"crypto\");const b=process.argv[1]?fs.readFileSync(process.argv[1]):fs.readFileSync(0);console.log(c.createHash(\"sha256\").update(b).digest(\"hex\"),process.argv[1]||\"-\")" "$@"'
fake find '[[ "${FIND_FAIL:-}" == 1 ]] && exit 9; for p in "$1"/*; do [[ -e "$p" || -L "$p" ]] && printf "%s\\n" "$p"; done; exit 0'
fake docker 'key="$1 ${2:-}"; [[ "${DOCKER_FAIL:-}" == "$key" ]] && exit 9; case "$key" in "info ") :;; "compose version") :;; "ps -aq") printf "%s" "${CONTAINERS:-}";; "volume ls") printf "%s" "${VOLUMES:-}";; "network ls") if [[ "$*" == *format* ]]; then printf "%b" "${NETWORKS:-bridge\nhost\nnone}"; else printf "%s" "${LABELS:-}"; fi;; *) :;; esac'
fake systemctl 'case "$1" in is-system-running) echo "${SYSTEMD:-running}";; is-enabled) echo "${TIMER_OUTPUT:-disabled}"; exit "${TIMER_STATUS:-1}";; esac'
fake tailscale 'if [[ -n "${TAIL_JSON:-}" ]]; then printf "%s" "$TAIL_JSON"; else printf "{\x22BackendState\x22:\x22Running\x22,\x22Self\x22:{\x22ID\x22:\x22id\x22,\x22Online\x22:true,\x22TailscaleIPs\x22:[\x22%s\x22]}}" "$TAIL"; fi'
fake curl '[[ "${CURL_FAIL:-}" == 1 ]] && exit 9; case "$*" in *ipify*) printf "%s" "${E1:-$PUBLIC}";; *) printf "%s" "${E2:-$PUBLIC}";; esac'
fake ss '[[ "${SS_FAIL:-}" == 1 ]] && exit 9; printf "%b" "${LISTENERS:-tcp LISTEN 0 1 $ANY:22 $ANY:*\nudp UNCONN 0 0 $ANY:41641 $ANY:*}"'
run(){ local mode="$1"; shift; env LIGHTNODE_PREFLIGHT_TEST_MODE=1 LIGHTNODE_PREFLIGHT_TEST_BIN="$BIN" REAL_NODE="$(command -v node)" PUBLIC="$PUBLIC" TAIL="$TAIL" LOOP="$LOOP" ANY="$ANY" LIGHTNODE_PREFLIGHT_TEST_OWNER="$(id -u)" LIGHTNODE_PREFLIGHT_TEST_GROUP="$(id -g)" LIGHTNODE_PREFLIGHT_ARTIFACT_ROOT="$TMP/a" LIGHTNODE_PREFLIGHT_OPERATOR_PATH="$TMP/o" LIGHTNODE_PREFLIGHT_STATE_ROOT="$TMP/s" LIGHTNODE_PREFLIGHT_SYSTEMD_DIR="$TMP/u" LIGHTNODE_PREFLIGHT_OS_RELEASE="$TMP/os" LIGHTNODE_PREFLIGHT_MEMINFO="$TMP/mem" "$@" bash "$SCRIPT" "$mode"; }
ok(){ run "$@" >/dev/null; }; no(){ if run "$@" >/dev/null 2>&1; then echo "expected failure: $*" >&2; exit 1; fi; }

# Explicit fresh mode, boundaries, privacy, parser failures, and default Docker network allowance.
no ''; no unexpected; ok fresh
no fresh CPU=1; no fresh MEM=3670015; no fresh TOTAL=43945312; no fresh FREE=20971519; no fresh NODE_VERSION=19.9.0
no fresh SYSTEMD=degraded; no fresh DOCKER_FAIL='info '; no fresh NETWORKS=$'bridge\nhost\nother'
no fresh CURL_FAIL=1; no fresh SS_FAIL=1
no fresh CONTAINERS=x; no fresh VOLUMES=x; no fresh LABELS=x
no fresh TAIL_JSON='{}'; no fresh E1="$PUBLIC" E2="$(ip 198 51 100 9)"; no fresh E1="$(ip 198 51 100 08)"
no fresh LISTENERS="tcp LISTEN 0 1 $ANY:443 $ANY:*"; no fresh LISTENERS='bad'
privacy="$(run fresh)"; [[ "$privacy" == egress_sha256=* && "$privacy" != *"$PUBLIC"* ]] || exit 1
touch "$TMP/o"; no fresh; rm "$TMP/o"; mkdir "$TMP/a"; no fresh; rmdir "$TMP/a"
mkdir -p "$TMP/controller"; no fresh LIGHTNODE_PREFLIGHT_ARTIFACT_ROOT="$TMP/controller"; rmdir "$TMP/controller"

# Production ignores an attempted redirect (it reaches the real, non-fixture host check instead).
override_output="$(env LIGHTNODE_PREFLIGHT_TEST_BIN="$BIN" LIGHTNODE_PREFLIGHT_ARTIFACT_ROOT="$TMP/a" bash "$SCRIPT" fresh 2>&1 || true)"; [[ "$override_output" == *preflight=linux* ]] || { echo 'production override accepted' >&2; exit 1; }

# Build the exact staged-only installed fixture; runtime state, secrets, approvals, evidence, and Docker residue all fail.
mkdir -p "$TMP/a" "$TMP/s/state" "$TMP/u"; chmod 700 "$TMP/a" "$TMP/s" "$TMP/s/state"
for p in o a/compose.yml a/compose.temporary-active.yml a/production-db-identity.sh u/babyjamjam-fallback-temporary-active-guard.service u/babyjamjam-fallback-temporary-active-guard.timer; do : >"$TMP/$p"; done
chmod 750 "$TMP/o" "$TMP/a/production-db-identity.sh"; chmod 640 "$TMP/a/compose.yml" "$TMP/a/compose.temporary-active.yml" "$TMP/u"/*
printf 'operator.sh=%s\ncompose.yml=%s\ncompose.temporary-active.yml=%s\nproduction-db-identity.sh=%s\nsystemd/babyjamjam-fallback-temporary-active-guard.service=%s\nsystemd/babyjamjam-fallback-temporary-active-guard.timer=%s\n' "$(shasum -a 256 "$TMP/o"|awk '{print $1}')" "$(shasum -a 256 "$TMP/a/compose.yml"|awk '{print $1}')" "$(shasum -a 256 "$TMP/a/compose.temporary-active.yml"|awk '{print $1}')" "$(shasum -a 256 "$TMP/a/production-db-identity.sh"|awk '{print $1}')" "$(shasum -a 256 "$TMP/u/babyjamjam-fallback-temporary-active-guard.service"|awk '{print $1}')" "$(shasum -a 256 "$TMP/u/babyjamjam-fallback-temporary-active-guard.timer"|awk '{print $1}')" >"$TMP/a/bundle.manifest"; chmod 640 "$TMP/a/bundle.manifest"
ok installed TIMER_OUTPUT=disabled TIMER_STATUS=1
no installed TIMER_OUTPUT=enabled TIMER_STATUS=0; no installed TIMER_OUTPUT=enabled TIMER_STATUS=1; no installed TIMER_OUTPUT=disabled TIMER_STATUS=0
no installed LISTENERS="tcp LISTEN 0 1 $LOOP:3101 $ANY:*"; no installed LISTENERS='tcp LISTEN 0 1 [::1]:3102 [::]:*'
no installed CONTAINERS=x; no installed VOLUMES=x; no installed NETWORKS=$'bridge\nhost\nextra'
for p in backend.env approved-production-db-ref.sha256 temporary-active-approval temporary-active-scheduler-evidence state/runtime-mode state/temporary-active-expiry state/temporary-active-linkage state/used-temporary-active-nonces; do : >"$TMP/s/$p"; chmod 600 "$TMP/s/$p"; no installed; rm "$TMP/s/$p"; done
: >"$TMP/s/temporary-active-scheduler-evidence"; chmod 400 "$TMP/s/temporary-active-scheduler-evidence"; no installed; rm "$TMP/s/temporary-active-scheduler-evidence"
: >"$TMP/s/state/operator.lock"; chmod 600 "$TMP/s/state/operator.lock"; ok installed; rm "$TMP/s/state/operator.lock"
no installed HASH_FAIL=1; no installed FIND_FAIL=1
printf broken >"$TMP/a/bundle.manifest"; no installed
! grep -Eq '([0-9]{1,3}\.){3}[0-9]{1,3}' "$ROOT/lightnode-preflight.test.sh"
echo 'LightNode preflight offline behavior tests passed'
