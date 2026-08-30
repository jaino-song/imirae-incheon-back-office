package com.imirae.incheon.auth

import kotlin.random.Random

sealed class SessionAction {
    data object Continue : SessionAction()
    data object ForceReAuth : SessionAction()
    data object RefreshToken : SessionAction()
}

class SessionPolicy private constructor(private val secureStorage: AuthStorage) {
    constructor(secureStorage: SecureStorage) : this(SecureStorageAdapter(secureStorage))

    internal constructor(secureStorage: AuthStorage, @Suppress("UNUSED_PARAMETER") testOnly: Unit = Unit) : this(secureStorage)
    private val idleTimeoutMs = 30 * 60 * 1000L // 30 minutes
    private val lastActivityKey = "last_activity"
    private val deviceIdKey = "device_id"
    private val activeRefreshTokenKey = "active_refresh_token"

    fun checkSession(): SessionAction {
        val lastActivity = secureStorage.getString(lastActivityKey)?.toLongOrNull() ?: return SessionAction.ForceReAuth
        val now = currentTimeMillis()
        return if (now - lastActivity > idleTimeoutMs) SessionAction.ForceReAuth else SessionAction.Continue
    }

    fun updateActivity() {
        secureStorage.putString(lastActivityKey, currentTimeMillis().toString())
    }

    fun getOrCreateDeviceId(): String {
        val existing = secureStorage.getString(deviceIdKey)
        if (!existing.isNullOrBlank()) {
            return existing
        }

        val generated = generateDeviceId()
        secureStorage.putString(deviceIdKey, generated)
        return generated
    }

    fun getDeviceId(): String? = secureStorage.getString(deviceIdKey)?.takeIf { it.isNotBlank() }

    fun initializeRefreshToken(refreshToken: String) {
        secureStorage.putString(activeRefreshTokenKey, refreshToken)
    }

    fun ensureRefreshTokenTracked(refreshToken: String) {
        if (secureStorage.getString(activeRefreshTokenKey).isNullOrBlank()) {
            secureStorage.putString(activeRefreshTokenKey, refreshToken)
        }
    }

    fun canUseRefreshToken(refreshToken: String): Boolean {
        val trackedRefreshToken = secureStorage.getString(activeRefreshTokenKey) ?: return false
        return trackedRefreshToken == refreshToken
    }

    fun rotateRefreshToken(usedRefreshToken: String, newRefreshToken: String): Boolean {
        val trackedRefreshToken = secureStorage.getString(activeRefreshTokenKey) ?: return false
        if (trackedRefreshToken != usedRefreshToken) {
            return false
        }
        secureStorage.putString(activeRefreshTokenKey, newRefreshToken)
        return true
    }

    fun clearSessionPolicyState() {
        secureStorage.remove(lastActivityKey)
        secureStorage.remove(activeRefreshTokenKey)
    }

    private fun generateDeviceId(): String {
        val randomSegment = buildString {
            repeat(20) {
                append(deviceAlphabet[Random.nextInt(deviceAlphabet.length)])
            }
        }
        return "device-${currentTimeMillis()}-$randomSegment"
    }

    private companion object {
        const val deviceAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
    }
}

expect fun currentTimeMillis(): Long
