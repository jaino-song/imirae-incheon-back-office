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

# Replacing an active release must preload and validate the immutable image
# before Compose touches the running API. A failed replacement must recreate
# the previous active image and restore its expiry/linkage state.
replace_source_tag="$(printf '1%.0s' {1..40})"
replace_source_digest="sha256:$(printf '2%.0s' {1..64})"
replace_target_tag="$(printf '3%.0s' {1..40})"
replace_target_digest="sha256:$(printf '4%.0s' {1..64})"
replace_old_expiry="$((test_now + 3600))"
replace_new_expiry="$((test_now + 7200))"
replace_old_linkage="replace-old $(printf '5%.0s' {1..64}) $(printf '6%.0s' {1..64})"
replace_evidence_hash="$(printf '7%.0s' {1..64})"
replace_nonce="$(printf '8%.0s' {1..64})"
read_state(){ case "$1" in runtime-mode) echo temporary-active;; current-image-tag) echo "$replace_source_tag";; current-image-digest) echo "$replace_source_digest";; temporary-active-expiry) echo "$replace_old_expiry";; temporary-active-linkage) echo "$replace_old_linkage";; esac; }
validate_temporary_active_approval(){ printf '%s %s %s %s\n' "$test_approval_egress" "$replace_nonce" replace-new "$replace_evidence_hash"; }
approval_value(){ [[ "$1" == expires_at_unix ]] && echo "$replace_new_expiry"; }
pull_release_image(){ printf 'pull:%s:%s\n' "$1" "$2" >>"$TMP/replace.calls"; }
container_id_for(){ [[ "$1" == "$replace_source_tag" ]] && echo oldcontainer || echo newcontainer; }
verify_active_container_health(){ printf 'health:%s\n' "$1" >>"$TMP/replace.calls"; }
verify_temporary_active_runtime(){ printf 'runtime:%s\n' "$1" >>"$TMP/replace.calls"; }
verify_image_identity(){ printf 'image:%s\n' "$1" >>"$TMP/replace.calls"; }
verify_approved_egress(){ printf 'egress:%s\n' "$2" >>"$TMP/replace.calls"; }
claim_approval_nonce(){ printf 'claim:%s\n' "$1" >>"$TMP/replace.calls"; }
try_schedule_temporary_expiry_stop(){ printf 'schedule:%s\n' "$1" >>"$TMP/replace.calls"; }
write_state(){ printf 'write:%s:%s\n' "$1" "$2" >>"$TMP/replace.calls"; }
active_compose(){ printf 'compose:%s:%s\n' "$1" "${*:2}" >>"$TMP/replace.calls"; }
wait_until_ready(){ printf 'ready:%s\n' "$1" >>"$TMP/replace.calls"; }
verify_temporary_guard(){ printf 'guard\n' >>"$TMP/replace.calls"; }
running_image_id_for(){ echo running-image; }
: >"$TMP/replace.calls"
replace_temporary_active_release "$replace_target_tag" "$replace_target_digest" >"$TMP/replace.out"
grep -Fqx 'temporary_active_replaced=true' "$TMP/replace.out" || fail 'active replacement success marker missing'
grep -Fqx 'image_preloaded=true' "$TMP/replace.out" || fail 'active replacement preload marker missing'
pull_line="$(grep -n '^pull:' "$TMP/replace.calls" | cut -d: -f1)"
compose_line="$(grep -n "^compose:$replace_target_tag:" "$TMP/replace.calls" | cut -d: -f1)"
[[ -n "$pull_line" && -n "$compose_line" && "$pull_line" -lt "$compose_line" ]] \
    || fail 'active replacement touched Compose before image preload'
grep -Fqx "write:previous-image-tag:$replace_source_tag" "$TMP/replace.calls" || fail 'previous tag was not recorded'
grep -Fqx "write:current-image-tag:$replace_target_tag" "$TMP/replace.calls" || fail 'new tag was not recorded'

verify_temporary_active_runtime(){
    local count
    count="$(grep -c '^runtime:' "$TMP/replace.calls" || true)"
    printf 'runtime:%s\n' "$1" >>"$TMP/replace.calls"
    [[ "$count" -ne 1 ]]
}
: >"$TMP/replace.calls"
if ( replace_temporary_active_release "$replace_target_tag" "$replace_target_digest" ) >/dev/null 2>&1; then
    fail 'active replacement accepted failed new-runtime verification'
fi
grep -Fqx "compose:$replace_target_tag:up -d --no-build --no-deps --force-recreate api" "$TMP/replace.calls" \
    || fail 'failed replacement did not try the new active image'
grep -Fqx "compose:$replace_source_tag:up -d --no-build --no-deps --force-recreate api" "$TMP/replace.calls" \
    || fail 'failed replacement did not restore the previous active image'
grep -Fqx "schedule:$replace_old_expiry" "$TMP/replace.calls" \
    || fail 'failed replacement did not restore the previous expiry timer'
grep -Fqx "write:temporary-active-linkage:$replace_old_linkage" "$TMP/replace.calls" \
    || fail 'failed replacement did not restore previous linkage'

pull_release_image(){ printf 'pull-failed:%s\n' "$1" >>"$TMP/replace.calls"; return 1; }
verify_temporary_active_runtime(){ printf 'runtime:%s\n' "$1" >>"$TMP/replace.calls"; }
: >"$TMP/replace.calls"
if ( replace_temporary_active_release "$replace_target_tag" "$replace_target_digest" ) >/dev/null 2>&1; then
    fail 'active replacement accepted a failed image preload'
fi
grep -Fqx "pull-failed:$replace_target_tag" "$TMP/replace.calls" \
    || fail 'active replacement did not attempt image preload'
if grep -Fq '^compose:' "$TMP/replace.calls"; then
    fail 'active replacement touched Compose after preload failure'
fi
# Lease status fields (ADR-010 GET /health/lease) are display-only for
# `status` and must degrade to "unknown" rather than fail, since the endpoint
# can be missing on a release that predates ADR-010 or momentarily
# unreachable over loopback.
lease_curl(){ printf '%s' '{"mode":"required","holderId":"lightnode","held":true}'; }
lease_out="$(lease_status_fields)"
[[ "$lease_out" == $'lease_mode=required\nlease_held=true' ]] \
    || fail 'lease fields did not report required/true'

lease_curl(){ printf '%s' '{"mode":"standby","holderId":"lightnode","held":false}'; }
lease_out="$(lease_status_fields)"
[[ "$lease_out" == $'lease_mode=standby\nlease_held=false' ]] \
    || fail 'lease fields did not report standby/false'

lease_curl(){ return 1; }
lease_out="$(lease_status_fields)"
[[ "$lease_out" == $'lease_mode=unknown\nlease_held=unknown' ]] \
    || fail 'lease fields did not degrade to unknown on curl failure'

lease_curl(){ printf '%s' '{"mode":"<script>","held":"yes"}'; }
lease_out="$(lease_status_fields)"
[[ "$lease_out" == $'lease_mode=unknown\nlease_held=unknown' ]] \
    || fail 'lease fields accepted an unexpected mode/held value'

echo 'Fallback temporary-active behavioral tests passed'
