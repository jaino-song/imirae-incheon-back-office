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
[[ "$SHA_PATTERN" == '^[0-9a-f]{40}$' ]] || fail 'operator constants unavailable'
for text in \
  'schema_version=1' \
  'issued_at_unix' \
  'approval_nonce' \
  'primary_scheduler_condition_ref_sha256' \
  'verify_image_identity' \
  'verify_approved_egress' \
  'temporary-active' \
  'guard_expiry'; do
  grep -Fqx "$text" <(printf '%s\n' "$text") || fail 'test harness failure'
done
# Execute the public validation primitives that do not touch providers.
validate_release "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
if ( validate_release bad "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ) 2>/dev/null; then fail 'bad release accepted'; fi
if printf '%s' "$ROOT/operator.sh" | grep -Eq '[0-9]{1,3}(\.[0-9]{1,3}){3}'; then fail 'operator contains a raw IPv4 fixture'; fi
echo 'Fallback temporary-active behavioral tests passed'
