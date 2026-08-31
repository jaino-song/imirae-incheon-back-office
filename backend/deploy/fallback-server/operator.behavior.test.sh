#!/usr/bin/env bash
# Behavioral contract for the pure approval/state guards. It executes a copied
# operator with its entrypoint removed, never Docker/systemd or external calls.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
COPY="$TMP/operator.sh"
sed '$d' "$ROOT/operator.sh" >"$COPY"
# shellcheck disable=SC1090
source "$COPY"
fail(){ echo "FAIL: $*" >&2; exit 1; }
calls=''
active_compose(){ calls+="stop "; return 0; }
container_id_for(){ return 1; }
clear_temporary_expiry_timer(){ calls+="timer "; }
clear_temporary_active_state(){ calls+="state "; }
cleanup_active_after_failure a || fail 'cleanup success path failed'
[[ "$calls" == 'stop timer state ' ]] || fail 'cleanup ordering changed'
calls=''
active_compose(){ calls+="stop "; return 1; }
cleanup_active_after_failure a && fail 'cleanup accepted stop failure'
[[ "$calls" == 'stop ' ]] || fail 'cleanup cleared state after stop failure'
# Execute the public validation primitives that do not touch providers.
validate_release "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
if ( validate_release bad "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ) 2>/dev/null; then fail 'bad release accepted'; fi
echo 'Fallback temporary-active behavioral tests passed'
