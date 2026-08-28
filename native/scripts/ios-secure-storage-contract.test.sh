#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_STORAGE="$NATIVE_ROOT/shared/src/iosMain/kotlin/com/imirae/incheon/auth/SecureStorage.kt"
MIGRATION="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/auth/LegacySecureStorageMigration.kt"

if [[ ! -f "$IOS_STORAGE" ]]; then
    echo "Missing iOS secure storage implementation: $IOS_STORAGE" >&2
    exit 2
fi

require_text() {
    local expected="$1"
    local description="$2"

    if ! grep -Fq -- "$expected" "$IOS_STORAGE"; then
        echo "iOS secure storage contract failure: $description" >&2
        exit 1
    fi
}

forbidden_text() {
    local forbidden="$1"
    local description="$2"

    if grep -Fq -- "$forbidden" "$IOS_STORAGE"; then
        echo "iOS secure storage contract failure: $description" >&2
        exit 1
    fi
}

require_text "platform.Security" "Keychain Security framework is not imported"
require_text "SecItemCopyMatching" "reads do not use Keychain lookup"
require_text "SecItemAdd" "writes do not add Keychain items"
require_text "SecItemUpdate" "writes do not update existing Keychain items"
require_text "SecItemDelete" "deletes do not use Keychain deletion"
require_text "kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly" "Keychain accessibility is not explicit"
require_text "LegacySecureStorageMigration" "legacy migration is not wired through the tested policy"
require_text "persistentDomainForName(KEYCHAIN_SERVICE)" "migration must read only the named suite persistent domain"
require_text "removeObjectForKey" "legacy values are not removed after secure persistence"
require_text "actual fun getString" "storage read contract is missing"
require_text "actual fun putString" "storage write contract is missing"
require_text "actual fun remove" "storage delete contract is missing"
require_text "actual fun clear" "logout/namespace clear contract is missing"

forbidden_text "dictionaryRepresentation()" "migration must not read the defaults search list"
forbidden_text "stringForKey" "reads still use plaintext UserDefaults"
forbidden_text "setObject" "writes still use plaintext UserDefaults"
forbidden_text "defaults?.removeObjectForKey" "single-key deletion bypasses Keychain"

if [[ ! -f "$MIGRATION" ]]; then
    echo "iOS secure storage contract failure: shared migration policy is missing" >&2
    exit 2
fi

for key in access_token refresh_token last_activity device_id active_refresh_token last_step_up; do
    if ! grep -Fq -- "\"$key\"" "$MIGRATION"; then
        echo "iOS secure storage contract failure: known secure-storage key $key is not enumerated" >&2
        exit 1
    fi
done

migration_line="$(grep -n -m1 ").migrate()" "$IOS_STORAGE" | cut -d: -f1)"
marker_line="$(grep -n -m1 "didMigrateLegacyDefaults = true" "$IOS_STORAGE" | cut -d: -f1)"
synchronize_line="$(awk -v start="$migration_line" -v end="$marker_line" 'NR > start && NR < end && /legacyDefaults\.synchronize\(\)/ { print NR; exit }' "$IOS_STORAGE")"

if [[ -z "$migration_line" || -z "$synchronize_line" || -z "$marker_line" ]]; then
    echo "iOS secure storage contract failure: migration completion markers are missing" >&2
    exit 1
fi

if (( synchronize_line <= migration_line || marker_line <= synchronize_line )); then
    echo "iOS secure storage contract failure: migration marker must follow secure writes and synchronization" >&2
    exit 1
fi

account_line="$(grep -n -m1 "val account = createKeychainString(key)" "$IOS_STORAGE" | cut -d: -f1)"
account_release_line="$(grep -n -m1 "CFRelease(account)" "$IOS_STORAGE" | cut -d: -f1)"
query_block_line="$(grep -n -m1 "block(query)" "$IOS_STORAGE" | cut -d: -f1)"

if [[ -z "$account_line" || -z "$account_release_line" || -z "$query_block_line" ]]; then
    echo "iOS secure storage contract failure: keyed query ownership markers are missing" >&2
    exit 1
fi

if (( account_release_line <= query_block_line )); then
    echo "iOS secure storage contract failure: account must remain alive through the Security.framework query" >&2
    exit 1
fi

echo "iOS secure storage source contract passed"
