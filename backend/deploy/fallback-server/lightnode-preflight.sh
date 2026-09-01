#!/usr/bin/env bash
set -euo pipefail
export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
fail(){ printf 'preflight=%s\n' "$1"; exit 1; }
[[ "$(uname -s)" == Linux ]] || fail linux
[[ "$(uname -m)" == x86_64 ]] || fail architecture
grep -Eq 'Ubuntu' /etc/os-release || fail os
[[ "$(getconf _NPROCESSORS_ONLN)" -ge 2 ]] || fail cpu
[[ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -ge 3670016 ]] || fail memory
read -r total free < <(df -Pk / | awk 'NR==2{print int($2/1000000),int($4/1048576)}')
[[ "$total" -ge 45 && "$free" -ge 20 ]] || fail disk
command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]] || fail node
command -v docker >/dev/null && docker info >/dev/null 2>&1 || fail docker
docker compose version >/dev/null 2>&1 || fail compose
command -v systemctl >/dev/null && systemctl is-system-running >/dev/null 2>&1 || fail systemd
command -v tailscale >/dev/null && tailscale status --json >/dev/null 2>&1 || fail tailscale
command -v ss >/dev/null || fail ss
for port in 3101 3102; do ! ss -ltn "sport = :$port" | grep -q LISTEN || fail "port_$port"; done
[[ ! -e /opt/babyjamjam-fallback-server/backend.env ]] || fail existing_env
[[ ! -e /opt/babyjamjam-fallback-server/temporary-active-approval ]] || fail existing_approval
[[ "$(docker ps -aq | wc -l | tr -d ' ')" == 0 ]] || fail containers
printf 'preflight=ok\n'
