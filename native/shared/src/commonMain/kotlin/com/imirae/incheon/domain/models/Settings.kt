package com.imirae.incheon.domain.models

import kotlinx.serialization.Serializable

@Serializable
data class UserSettings(
    val notifications: Boolean = true,
    /** These are local presentation preferences; the backend only persists notifications. */
    @kotlinx.serialization.Transient val language: String = "ko",
    @kotlinx.serialization.Transient val theme: String = "system",
)

@Serializable
data class NotificationPreferencesResponse(
    val emailNotificationsEnabled: Boolean,
    val updatedAt: String? = null,
)

@Serializable
data class UpdateNotificationPreferencesRequest(val emailNotificationsEnabled: Boolean)

@Serializable
data class VoucherPrice(
    val id: Int,
    val type: String? = null,
    val duration: String? = null,
    val fullPrice: String? = null,
    val grant: String? = null,
    val actualPrice: String? = null,
    val year: Int = 0,
) {
    val serviceType: String get() = type ?: "-"
    val price: Long get() = actualPrice?.toLongOrNull() ?: 0L
    val description: String? get() = duration?.let { "${it}일" }
}
