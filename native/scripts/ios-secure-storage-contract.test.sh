#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_STORAGE="$NATIVE_ROOT/shared/src/iosMain/kotlin/com/imirae/incheon/auth/SecureStorage.kt"

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
require_text "dictionaryRepresentation()" "legacy defaults are not inspected for migration"
require_text "removeObjectForKey" "legacy values are not removed after secure persistence"
require_text "actual fun getString" "storage read contract is missing"
require_text "actual fun putString" "storage write contract is missing"
require_text "actual fun remove" "storage delete contract is missing"
require_text "actual fun clear" "logout/namespace clear contract is missing"

forbidden_text "stringForKey" "reads still use plaintext UserDefaults"
forbidden_text "setObject" "writes still use plaintext UserDefaults"
forbidden_text "defaults?.removeObjectForKey" "single-key deletion bypasses Keychain"

echo "iOS secure storage source contract passed"
