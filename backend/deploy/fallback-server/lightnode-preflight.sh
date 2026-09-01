#!/usr/bin/env bash
set -euo pipefail
fail(){ printf 'preflight=%s\n' "$1"; exit 1; }
[[ "$(uname -m)" == x86_64 ]] || fail architecture
grep -Eq 'Ubuntu' /etc/os-release || fail os
[[ "$(getconf _NPROCESSORS_ONLN)" -ge 2 ]] || fail cpu
[[ "$(awk '/MemTotal/{print int($2/1024/1024)}' /proc/meminfo)" -ge 4 ]] || fail memory
[[ "$(df -Pk / | awk 'NR==2{print int($4/1024/1024)}')" -ge 40 ]] || fail disk
for command in docker systemctl tailscale; do command -v "$command" >/dev/null || fail "$command"; done
for port in 3101 3102; do ! ss -ltn "sport = :$port" | grep -q LISTEN || fail "port_$port"; done
[[ ! -e /opt/babyjamjam-fallback-server/backend.env ]] || fail existing_env
[[ ! -e /opt/babyjamjam-fallback-server/temporary-active-approval ]] || fail existing_approval
[[ "$(docker ps -q | wc -l | tr -d ' ')" == 0 ]] || fail containers
printf 'preflight=ok\n'
