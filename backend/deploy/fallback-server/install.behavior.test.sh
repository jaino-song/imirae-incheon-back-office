#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if [[ "$(id -u)" -ne 0 ]]; then echo 'Fallback installer behavioral test skipped: root required'; exit 0; fi
run(){ FALLBACK_INSTALL_ARTIFACT_ROOT="$TMP/artifacts" FALLBACK_INSTALL_OPERATOR_PATH="$TMP/bin/operator" FALLBACK_INSTALL_STATE_ROOT="$TMP/state" FALLBACK_INSTALL_SYSTEMD_DIR="$TMP/systemd" FALLBACK_INSTALL_SKIP_DAEMON_RELOAD=true bash "$ROOT/install.sh" >/dev/null; }
run
test "$(wc -l <"$TMP/artifacts/bundle.manifest")" = 6
test "$(stat -c %a "$TMP/artifacts/bundle.manifest")" = 640
rm "$TMP/artifacts/bundle.manifest"
run
test -f "$TMP/artifacts/bundle.manifest"
grep -Fq 'compose.temporary-active.yml=' "$TMP/artifacts/bundle.manifest"
grep -Fq 'guard.timer' "$TMP/artifacts/bundle.manifest"
echo 'Fallback installer behavioral tests passed'
