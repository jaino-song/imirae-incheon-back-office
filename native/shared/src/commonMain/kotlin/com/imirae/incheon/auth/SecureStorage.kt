package com.imirae.incheon.auth

/**
 * Small common abstraction used by the auth state machine.  The platform
 * [SecureStorage] remains the public KMP boundary, while the abstraction
 * keeps the lifecycle deterministic in common tests without introducing a
 * plaintext fallback store.
 */
internal interface AuthStorage {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun remove(key: String)
    fun clear()
}

internal class SecureStorageAdapter(private val delegate: SecureStorage) : AuthStorage {
    override fun getString(key: String): String? = delegate.getString(key)
    override fun putString(key: String, value: String) = delegate.putString(key, value)
    override fun remove(key: String) = delegate.remove(key)
    override fun clear() = delegate.clear()
}

expect class SecureStorage {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun remove(key: String)
    fun clear()
}
