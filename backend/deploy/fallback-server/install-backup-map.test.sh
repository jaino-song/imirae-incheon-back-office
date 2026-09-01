#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$ROOT/install-backup-map.sh"
operator=/tmp/bin/babyjamjam-fallback-server; artifacts=/tmp/artifacts; units=/tmp/units
for key in operator passive-compose active-compose db-helper guard-service guard-timer manifest; do
  dest="$(rollback_destination_for_key "$key" "$operator" "$artifacts" "$units")"
  [[ "$(backup_key_for_destination "$dest")" == "$key" ]]
done
! backup_key_for_destination /tmp/unknown >/dev/null
echo 'Fallback installer backup-map tests passed'
