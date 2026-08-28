package com.imirae.incheon.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class LegacySecureStorageMigrationTest {
    @Test
    fun knownLegacyKeysEnumerateEveryCurrentSecureStorageValue() {
        assertEquals(
            setOf(
                "access_token",
                "refresh_token",
                "last_activity",
                "device_id",
                "active_refresh_token",
                "last_step_up",
            ),
            knownLegacySecureStorageKeys,
        )
    }

    @Test
    fun persistentDomainFilteringIgnoresUnknownAndNonStringEntries() {
        val persistentDomain: Map<Any?, Any?> = linkedMapOf(
            "access_token" to "access-value",
            "refresh_token" to "refresh-value",
            "last_activity" to 1_700_000_000_000L,
            "unrelated_default" to listOf("ignored"),
            42 to "ignored",
        )

        assertEquals(
            mapOf(
                "access_token" to "access-value",
                "refresh_token" to "refresh-value",
            ),
            filterLegacySecureStorageEntries(persistentDomain),
        )
    }

    @Test
    fun knownStringValuesCanBeMigratedWithoutUnrelatedDefaults() {
        val persistentDomain: Map<Any?, Any?> = linkedMapOf(
            "access_token" to "access-value",
            "refresh_token" to "refresh-value",
            "last_activity" to "1700000000000",
            "device_id" to "device-value",
            "active_refresh_token" to "active-refresh-value",
            "last_step_up" to "1700000000000",
            "unrelated_default" to mapOf("nested" to "ignored"),
        )
        val legacy = filterLegacySecureStorageEntries(persistentDomain).toMutableMap()
        val secure = linkedMapOf<String, String>()

        LegacySecureStorageMigration(
            legacyEntries = { legacy.toMap() },
            persistInSecureStorage = { key, value -> secure[key] = value },
            removeFromLegacyStorage = { key -> legacy.remove(key) },
        ).migrate()

        assertEquals(
            mapOf(
                "access_token" to "access-value",
                "refresh_token" to "refresh-value",
                "last_activity" to "1700000000000",
                "device_id" to "device-value",
                "active_refresh_token" to "active-refresh-value",
                "last_step_up" to "1700000000000",
            ),
            secure,
        )
        assertTrue(legacy.isEmpty())
    }

    @Test
    fun successfulMigrationPersistsBeforeRemovingEveryLegacyValue() {
        val legacy = linkedMapOf(
            "access_token" to "access-value",
            "refresh_token" to "refresh-value",
        )
        val secure = linkedMapOf<String, String>()
        val operations = mutableListOf<String>()

        LegacySecureStorageMigration(
            legacyEntries = { legacy.toMap() },
            persistInSecureStorage = { key, value ->
                secure[key] = value
                operations += "persist:$key"
            },
            removeFromLegacyStorage = { key ->
                assertTrue(secure.containsKey(key))
                legacy.remove(key)
                operations += "remove:$key"
            },
        ).migrate()

        assertEquals(
            listOf(
                "persist:access_token",
                "remove:access_token",
                "persist:refresh_token",
                "remove:refresh_token",
            ),
            operations,
        )
        assertEquals(
            mapOf(
                "access_token" to "access-value",
                "refresh_token" to "refresh-value",
            ),
            secure,
        )
        assertTrue(legacy.isEmpty())
    }

    @Test
    fun failedSecurePersistenceLeavesLegacyValuesForRetry() {
        val legacy = linkedMapOf("access_token" to "access-value")
        val secure = linkedMapOf<String, String>()
        val removals = mutableListOf<String>()

        assertFailsWith<IllegalStateException> {
            LegacySecureStorageMigration(
                legacyEntries = { legacy.toMap() },
                persistInSecureStorage = { _, _ ->
                    throw IllegalStateException("secure persistence failed")
                },
                removeFromLegacyStorage = { key ->
                    removals += key
                    legacy.remove(key)
                },
            ).migrate()
        }

        assertTrue(secure.isEmpty())
        assertEquals(mapOf("access_token" to "access-value"), legacy)
        assertTrue(removals.isEmpty())
    }

    @Test
    fun failedMigrationCanRetryAndRemoveOnlyAfterLaterSecureSuccess() {
        val legacy = linkedMapOf("refresh_token" to "refresh-value")
        val secure = linkedMapOf<String, String>()
        var attempts = 0

        val migration = LegacySecureStorageMigration(
            legacyEntries = { legacy.toMap() },
            persistInSecureStorage = { key, value ->
                attempts += 1
                if (attempts == 1) {
                    throw IllegalStateException("secure persistence failed")
                }
                secure[key] = value
            },
            removeFromLegacyStorage = { key -> legacy.remove(key) },
        )

        assertFailsWith<IllegalStateException> { migration.migrate() }
        assertEquals(mapOf("refresh_token" to "refresh-value"), legacy)

        migration.migrate()

        assertEquals(mapOf("refresh_token" to "refresh-value"), secure)
        assertTrue(legacy.isEmpty())
    }

    @Test
    fun successfulMigrationIsIdempotentAfterLegacyNamespaceIsEmpty() {
        val legacy = linkedMapOf("refresh_token" to "refresh-value")
        val secure = linkedMapOf<String, String>()
        var secureWrites = 0

        val migration = LegacySecureStorageMigration(
            legacyEntries = { legacy.toMap() },
            persistInSecureStorage = { key, value ->
                secureWrites += 1
                secure[key] = value
            },
            removeFromLegacyStorage = { key -> legacy.remove(key) },
        )

        migration.migrate()
        migration.migrate()

        assertEquals(1, secureWrites)
        assertEquals(mapOf("refresh_token" to "refresh-value"), secure)
        assertTrue(legacy.isEmpty())
    }
}
