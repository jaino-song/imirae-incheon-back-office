package com.imirae.incheon.domain.models

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class Notification(
    val id: Int,
    val title: String,
    val body: String,
    val data: JsonObject? = null,
    val sentAt: String,
    val readAt: String? = null,
    val isRead: Boolean = false,
)

@Serializable
data class UnreadCountResponse(val count: Int)
