package com.imirae.incheon.auth

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
