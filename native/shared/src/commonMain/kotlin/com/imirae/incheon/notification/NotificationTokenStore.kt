package com.imirae.incheon.notification

import com.imirae.incheon.auth.SecureStorage

/**
 * The token and the provider that issued it. Keeping the platform alongside
 * the token prevents a future APNs/FCM registration from silently crossing
 * provider boundaries.
 */
data class StoredNotificationToken(
    val token: String,
    val platform: String,
)

/**
 * Persistent storage for the latest device token waiting for registration.
 *
 * FCM may deliver a token while the app is signed out, so this state must
 * outlive the Firebase service callback and the process that handled it.
 */
interface NotificationTokenStore {
    fun read(): StoredNotificationToken?
    fun write(token: String, platform: String)
    fun clear()
}

/**
 * Platform-backed storage. SecureStorage uses EncryptedSharedPreferences on
 * Android and the Keychain on iOS, so the token never needs a plaintext app
 * preference or an additional dependency.
 */
class SecureNotificationTokenStore(
    private val secureStorage: SecureStorage,
) : NotificationTokenStore {
    override fun read(): StoredNotificationToken? {
        val token = secureStorage.getString(TOKEN_KEY)?.trim()?.takeIf { it.isNotEmpty() }
            ?: return null
        val platform = secureStorage.getString(PLATFORM_KEY)?.trim()?.takeIf { it.isNotEmpty() }
            ?: DEFAULT_PLATFORM
        return StoredNotificationToken(token = token, platform = platform)
    }

    override fun write(token: String, platform: String) {
        secureStorage.putString(TOKEN_KEY, token)
        secureStorage.putString(PLATFORM_KEY, platform)
    }

    override fun clear() {
        secureStorage.remove(TOKEN_KEY)
        secureStorage.remove(PLATFORM_KEY)
    }

    private companion object {
        const val TOKEN_KEY = "notification_device_token"
        const val PLATFORM_KEY = "notification_device_token_platform"
        const val DEFAULT_PLATFORM = "android"
    }
}

/**
 * In-memory fallback retained for direct callers that do not use dependency
 * injection (for example, existing routing-only tests). Production bindings
 * always use SecureNotificationTokenStore.
 */
class InMemoryNotificationTokenStore(
    initial: StoredNotificationToken? = null,
) : NotificationTokenStore {
    private var stored: StoredNotificationToken? = initial

    override fun read(): StoredNotificationToken? = stored

    override fun write(token: String, platform: String) {
        stored = StoredNotificationToken(token = token, platform = platform)
    }

    override fun clear() {
        stored = null
    }
}
