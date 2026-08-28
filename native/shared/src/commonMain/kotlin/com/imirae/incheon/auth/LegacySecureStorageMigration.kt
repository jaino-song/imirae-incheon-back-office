package com.imirae.incheon.auth

/**
 * Keys written through [SecureStorage] by the current authentication/session
 * flows. iOS legacy migration is intentionally limited to this allowlist so
 * unrelated defaults cannot be copied into the Keychain.
 */
internal val knownLegacySecureStorageKeys = setOf(
    "access_token",
    "refresh_token",
    "last_activity",
    "device_id",
    "active_refresh_token",
    "last_step_up",
)

/**
 * Extracts only known string values from a platform defaults domain.
 *
 * Foundation defaults can contain arbitrary key/value types. Unknown keys,
 * non-string keys, and non-string values are intentionally ignored so one
 * unrelated entry cannot block authentication migration.
 */
internal fun filterLegacySecureStorageEntries(
    entries: Map<Any?, *>,
    knownKeys: Set<String> = knownLegacySecureStorageKeys,
): Map<String, String> {
    val filtered = linkedMapOf<String, String>()
    entries.forEach { (rawKey, rawValue) ->
        val key = rawKey as? String ?: return@forEach
        if (key !in knownKeys) {
            return@forEach
        }

        val value = rawValue as? String ?: return@forEach
        filtered[key] = value
    }
    return filtered
}

/**
 * Moves legacy string values into the platform secure store.
 *
 * The legacy value is removed only after the secure-store write returns. A
 * failed write therefore leaves the legacy value available for a later retry,
 * while the secure storage caller remains responsible for failing closed.
 */
internal class LegacySecureStorageMigration(
    private val legacyEntries: () -> Map<String, String>,
    private val persistInSecureStorage: (String, String) -> Unit,
    private val removeFromLegacyStorage: (String) -> Unit,
) {
    fun migrate() {
        legacyEntries().forEach { (key, value) ->
            persistInSecureStorage(key, value)
            removeFromLegacyStorage(key)
        }
    }
}
