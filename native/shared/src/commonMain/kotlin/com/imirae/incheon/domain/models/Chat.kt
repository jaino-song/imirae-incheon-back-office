package com.imirae.incheon.domain.models

import kotlinx.serialization.Serializable

@Serializable
data class ChatMessage(
    val id: String = "",
    val role: String,
    val content: String,
    val timestamp: String? = null,
)

@Serializable
data class ChatRequest(
    val message: String,
    val sessionId: String? = null,
)

@Serializable
data class ChatHistoryResponse(
    val messages: List<ChatMessage> = emptyList(),
    val total: Int = 0,
    val hasMore: Boolean = false,
    val sessionId: String? = null,
    val isSessionActive: Boolean = false,
)

@Serializable
data class ChatStreamEvent(
    val type: String,
    val content: String? = null,
    val toolName: String? = null,
    val toolStatus: String? = null,
    val confirmationMessage: String? = null,
    val sessionId: String? = null,
    val error: String? = null,
)
