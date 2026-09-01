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
read_state(){ [[ "$1" == runtime-mode ]] && printf '%s\n' passive; [[ "$1" == current-image-tag ]] && return 1; }
container_id_for(){ return 1; }
discover_running_api_container(){ return 0; }
refuse_active_or_unknown_runtime || fail 'passive empty runtime refused'
read_state(){ [[ "$1" == runtime-mode ]] && printf '%s\n' temporary-active; }
if ( refuse_active_or_unknown_runtime ) 2>/dev/null; then fail 'active mode accepted'; fi
read_state(){ [[ "$1" == runtime-mode ]] && printf '%s\n' corrupt; }
if ( refuse_active_or_unknown_runtime ) 2>/dev/null; then fail 'corrupt mode accepted'; fi
read_state(){ [[ "$1" == runtime-mode ]] && printf '%s\n' passive; [[ "$1" == current-image-tag ]] && printf '%s\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; }
container_id_for(){ printf '%s\n' deadbeefdead; }
runtime_env_for(){ printf '%s\n' 'SCHEDULERS_ENABLED=true'; }
if ( refuse_active_or_unknown_runtime ) 2>/dev/null; then fail 'active gates accepted'; fi
# Execute the public validation primitives that do not touch providers.
validate_release "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
if ( validate_release bad "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ) 2>/dev/null; then fail 'bad release accepted'; fi

# Extending an active approval must never stop, recreate, or replace the API
# container. A failed new timer reservation must restore the old timer.
test_tag="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
test_digest="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
test_now="$(date +%s)"; test_old_expiry="$((test_now + 3600))"; test_new_expiry="$((test_now + 7200))"
test_old_linkage="incident-old $(printf 'b%.0s' {1..64}) $(printf 'c%.0s' {1..64})"
test_approval_egress="$(printf 'd%.0s' {1..64})"; test_approval_nonce="$(printf 'e%.0s' {1..64})"
test_evidence_hash="$(printf 'f%.0s' {1..64})"
read_state(){ case "$1" in runtime-mode) echo temporary-active;; current-image-tag) echo "$test_tag";; current-image-digest) echo "$test_digest";; temporary-active-expiry) echo "$test_old_expiry";; temporary-active-linkage) echo "$test_old_linkage";; esac; }
validate_release(){ :; }; validate_env_file(){ :; }; validate_production_db_identity(){ :; }
current_unix_time(){ echo "$test_now"; }
validate_temporary_active_approval(){ printf '%s %s %s %s\n' "$test_approval_egress" "$test_approval_nonce" incident-new "$test_evidence_hash"; }
approval_value(){ [[ "$1" == expires_at_unix ]] && echo "$test_new_expiry"; }
validate_active_aligo_env(){ :; }; verify_image_identity(){ :; }; verify_approved_egress(){ :; }
claim_approval_nonce(){ printf 'claim:%s\n' "$1" >>"$TMP/extend.calls"; }
container_id_for(){ echo deadbeefdead; }
running_image_id_for(){ echo sha256:running; }
verify_active_container_health(){ printf 'verify-health\n' >>"$TMP/extend.calls"; }
verify_temporary_active_runtime(){ printf 'verify-runtime\n' >>"$TMP/extend.calls"; }
verify_temporary_guard(){ printf 'verify-guard\n' >>"$TMP/extend.calls"; }
active_compose(){ fail 'extension touched active compose'; }
try_schedule_temporary_expiry_stop(){ printf 'schedule:%s\n' "$1" >>"$TMP/extend.calls"; }
write_state(){ printf 'write:%s:%s\n' "$1" "$2" >>"$TMP/extend.calls"; }
: >"$TMP/extend.calls"
extend_temporary_active_release "$test_tag" "$test_digest" >"$TMP/extend.out"
grep -Fqx 'temporary_active_extended=true' "$TMP/extend.out" || fail 'extension success marker missing'
grep -Fqx 'container_restarted=false' "$TMP/extend.out" || fail 'extension no-restart marker missing'
grep -Fqx "schedule:$test_new_expiry" "$TMP/extend.calls" || fail 'new expiry was not scheduled'
grep -Fqx "write:temporary-active-expiry:$test_new_expiry" "$TMP/extend.calls" || fail 'new expiry state was not written'

try_schedule_temporary_expiry_stop(){ printf 'schedule:%s\n' "$1" >>"$TMP/extend.calls"; [[ "$1" == "$test_old_expiry" ]]; }
: >"$TMP/extend.calls"
if ( extend_temporary_active_release "$test_tag" "$test_digest" ) >/dev/null 2>&1; then fail 'extension accepted a failed new timer'; fi
grep -Fqx "schedule:$test_new_expiry" "$TMP/extend.calls" || fail 'failed extension did not try the new timer'
grep -Fqx "schedule:$test_old_expiry" "$TMP/extend.calls" || fail 'failed extension did not restore the old timer'

try_schedule_temporary_expiry_stop(){ printf 'schedule:%s\n' "$1" >>"$TMP/extend.calls"; }
verify_temporary_active_runtime(){ local count; count="$(grep -c '^verify-runtime$' "$TMP/extend.calls" || true)"; printf 'verify-runtime\n' >>"$TMP/extend.calls"; [[ "$count" -eq 0 ]]; }
: >"$TMP/extend.calls"
if ( extend_temporary_active_release "$test_tag" "$test_digest" ) >/dev/null 2>&1; then fail 'extension accepted failed post-update verification'; fi
grep -Fqx "schedule:$test_new_expiry" "$TMP/extend.calls" || fail 'verification failure did not schedule the new timer'
grep -Fqx "schedule:$test_old_expiry" "$TMP/extend.calls" || fail 'verification failure did not restore the old timer'
grep -Fqx "write:temporary-active-expiry:$test_old_expiry" "$TMP/extend.calls" || fail 'verification failure did not restore old expiry state'
echo 'Fallback temporary-active behavioral tests passed'
