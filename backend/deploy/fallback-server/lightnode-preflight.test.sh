#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
bash -n "$ROOT/lightnode-preflight.sh"
grep -Fq 'preflight=ok' "$ROOT/lightnode-preflight.sh"
grep -Fq '3101 3102' "$ROOT/lightnode-preflight.sh"
! grep -Eq '([0-9]{1,3}\.){3}[0-9]{1,3}' "$ROOT/lightnode-preflight.sh"
echo 'LightNode preflight contract tests passed'
