package com.imirae.incheon.auth

import kotlinx.cinterop.ByteVar
import kotlinx.cinterop.CPointed
import kotlinx.cinterop.CPointer
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.readBytes
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.usePinned
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDataCreate
import platform.CoreFoundation.CFDataGetBytePtr
import platform.CoreFoundation.CFDataGetLength
import platform.CoreFoundation.CFDataRef
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFDictionarySetValue
import platform.CoreFoundation.CFDictionaryRef
import platform.CoreFoundation.CFRelease
import platform.CoreFoundation.CFStringCreateWithCString
import platform.CoreFoundation.CFStringRef
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFAllocatorDefault
import platform.CoreFoundation.kCFBooleanTrue
import platform.CoreFoundation.kCFStringEncodingUTF8
import platform.Foundation.NSUserDefaults
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.SecItemUpdate
import platform.Security.errSecDuplicateItem
import platform.Security.errSecItemNotFound
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccessible
import platform.Security.kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData

/**
 * iOS secure storage backed by the system Keychain.
 *
 * The named defaults suite is read only for the one-time migration of values
 * written by older releases. New reads and writes never fall back to it.
 */
actual class SecureStorage {
    private val legacyDefaults = NSUserDefaults(suiteName = KEYCHAIN_SERVICE)
    private var didMigrateLegacyDefaults = false

    actual fun getString(key: String): String? {
        ensureLegacyMigration()
        return readKeychainString(key)
    }

    actual fun putString(key: String, value: String) {
        ensureLegacyMigration()
        writeKeychainString(key, value)
    }

    actual fun remove(key: String) {
        ensureLegacyMigration()
        deleteKeychainItem(key)
        removeLegacyValue(key)
    }

    actual fun clear() {
        ensureLegacyMigration()
        deleteAllKeychainItems()
        legacyDefaults.removePersistentDomainForName(KEYCHAIN_SERVICE)
        legacyDefaults.synchronize()
    }

    private fun ensureLegacyMigration() {
        if (didMigrateLegacyDefaults) {
            return
        }

        LegacySecureStorageMigration(
            legacyEntries = ::legacyStringEntries,
            persistInSecureStorage = ::writeKeychainString,
            removeFromLegacyStorage = ::removeLegacyValue,
        ).migrate()
        legacyDefaults.synchronize()
        didMigrateLegacyDefaults = true
    }

    private fun legacyStringEntries(): Map<String, String> {
        val entries = linkedMapOf<String, String>()
        val dictionary = legacyDefaults.dictionaryRepresentation()

        dictionary.keys.forEach { rawKey ->
            val key = rawKey as? String
                ?: throw IllegalStateException("Legacy secure storage has an invalid key")
            val value = dictionary[key] as? String
                ?: throw IllegalStateException("Legacy secure storage has an invalid value")
            entries[key] = value
        }

        return entries
    }

    private fun removeLegacyValue(key: String) {
        legacyDefaults.removeObjectForKey(key)
    }

    private fun readKeychainString(key: String): String? {
        return memScoped {
            val result = alloc<CFTypeRefVar>()
            val status = withKeychainQuery(key) { query ->
                setDictionaryValue(query, kSecReturnData, kCFBooleanTrue)
                setDictionaryValue(query, kSecMatchLimit, kSecMatchLimitOne)
                SecItemCopyMatching(query, result.ptr)
            }
            if (status == errSecItemNotFound) {
                return@memScoped null
            }
            requireSuccess("read", status)

            val data = result.value as? CFDataRef
                ?: throw IllegalStateException("Keychain read returned an invalid value")
            try {
                val length = CFDataGetLength(data)
                if (length < 0 || length > Int.MAX_VALUE) {
                    throw IllegalStateException("Keychain read returned invalid data")
                }
                if (length == 0L) {
                    ""
                } else {
                    CFDataGetBytePtr(data)
                        ?.reinterpret<ByteVar>()
                        ?.readBytes(length.toInt())
                        ?.decodeToString()
                        ?: throw IllegalStateException("Keychain read returned invalid text")
                }
            } finally {
                CFRelease(data)
            }
        }
    }

    private fun writeKeychainString(key: String, value: String) {
        val bytes = value.encodeToByteArray()
        val data = if (bytes.isEmpty()) {
            CFDataCreate(kCFAllocatorDefault, null, 0)
        } else {
            bytes.usePinned { pinned ->
                CFDataCreate(
                    kCFAllocatorDefault,
                    pinned.addressOf(0).reinterpret(),
                    bytes.size.toLong(),
                )
            }
        } ?: throw IllegalStateException("Keychain write could not encode the value")

        try {
            val updateStatus = withKeychainQuery(key) { query ->
                withMutableDictionary { attributes ->
                    setDictionaryValue(attributes, kSecValueData, data)
                    SecItemUpdate(query, attributes)
                }
            }

            if (updateStatus == errSecSuccess) {
                return
            }
            if (updateStatus != errSecItemNotFound && updateStatus != errSecDuplicateItem) {
                requireSuccess("update", updateStatus)
            }

            val addStatus = withKeychainQuery(key) { item ->
                setDictionaryValue(item, kSecValueData, data)
                setDictionaryValue(item, kSecAttrAccessible, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
                SecItemAdd(item, null)
            }
            if (addStatus == errSecSuccess) {
                return
            }
            if (addStatus == errSecDuplicateItem) {
                val retryStatus = withKeychainQuery(key) { query ->
                    withMutableDictionary { attributes ->
                        setDictionaryValue(attributes, kSecValueData, data)
                        SecItemUpdate(query, attributes)
                    }
                }
                requireSuccess("retry update", retryStatus)
                return
            }
            requireSuccess("add", addStatus)
        } finally {
            CFRelease(data)
        }
    }

    private fun deleteKeychainItem(key: String) {
        val status = withKeychainQuery(key) { query -> SecItemDelete(query) }
        if (status != errSecSuccess && status != errSecItemNotFound) {
            requireSuccess("delete", status)
        }
    }

    private fun deleteAllKeychainItems() {
        val status = withKeychainQuery { query -> SecItemDelete(query) }
        if (status != errSecSuccess && status != errSecItemNotFound) {
            requireSuccess("clear", status)
        }
    }

    private inline fun <T> withKeychainQuery(
        key: String? = null,
        block: (CFDictionaryRef) -> T,
    ): T {
        return withMutableDictionary { query ->
            setDictionaryValue(query, kSecClass, kSecClassGenericPassword)
            val service = createKeychainString(KEYCHAIN_SERVICE)
            try {
                setDictionaryValue(query, kSecAttrService, service)
                if (key != null) {
                    val account = createKeychainString(key)
                    try {
                        // This dictionary has no retain callbacks, so keep the account's
                        // ownership until Security.framework has consumed the query.
                        setDictionaryValue(query, kSecAttrAccount, account)
                        block(query)
                    } finally {
                        CFRelease(account)
                    }
                } else {
                    block(query)
                }
            } finally {
                CFRelease(service)
            }
        }
    }

    private inline fun <T> withMutableDictionary(block: (CFDictionaryRef) -> T): T {
        val dictionary = CFDictionaryCreateMutable(kCFAllocatorDefault, 0, null, null)
            ?: throw IllegalStateException("Keychain query could not be created")
        try {
            return block(dictionary)
        } finally {
            CFRelease(dictionary)
        }
    }

    private fun setDictionaryValue(
        dictionary: CFDictionaryRef,
        key: CPointer<out CPointed>?,
        value: CPointer<out CPointed>?,
    ) {
        CFDictionarySetValue(dictionary, key, value)
    }

    private fun createKeychainString(value: String): CFStringRef {
        return CFStringCreateWithCString(kCFAllocatorDefault, value, kCFStringEncodingUTF8)
            ?: throw IllegalStateException("Keychain query string could not be created")
    }

    private fun requireSuccess(operation: String, status: Int): Unit {
        if (status != errSecSuccess) {
            throw IllegalStateException("Keychain $operation failed with status $status")
        }
    }

    private companion object {
        const val KEYCHAIN_SERVICE = "com.imirae.incheon.secure"
    }
}
