package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*
import io.ktor.client.request.*
import kotlinx.serialization.json.Json

interface ChatService {
    suspend fun sendMessage(message: String, context: String? = null): ApiResult<ChatMessage>
    suspend fun getHistory(): ApiResult<ChatHistoryResponse>
}

class ChatServiceImpl(private val client: ApiClient) : ChatService {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    override suspend fun sendMessage(message: String, context: String?): ApiResult<ChatMessage> {
        return when (val result = client.postText("/ai/chat/stream") {
            setBody(ChatRequest(message = message, sessionId = context))
        }) {
            is ApiResult.Error -> result
            is ApiResult.Success -> parseStream(result.data)
        }
    }

    override suspend fun getHistory(): ApiResult<ChatHistoryResponse> = client.get(
        "/ai/chat/history?offset=0&limit=50",
    )

    private fun parseStream(body: String): ApiResult<ChatMessage> {
        val events = parseChatStreamEvents(body, json)

        val error = events.firstOrNull { it.type == "error" }?.error
        if (error != null) return ApiResult.Error(ApiError.Unknown(error))

        val content = events.mapNotNull { it.content }.joinToString(separator = "")
        val sessionId = events.lastOrNull { it.sessionId != null }?.sessionId
        val id = sessionId ?: "assistant-${content.hashCode()}"
        return ApiResult.Success(ChatMessage(id = id, role = "assistant", content = content))
    }
}

internal fun parseChatStreamEvents(
    body: String,
    json: Json = Json { ignoreUnknownKeys = true; isLenient = true },
): List<ChatStreamEvent> = body.lineSequence()
    .filter { it.startsWith("data:") }
    .mapNotNull { line ->
        line.removePrefix("data:").trim().takeIf { it.isNotEmpty() }?.let { payload ->
            runCatching { json.decodeFromString<ChatStreamEvent>(payload) }.getOrNull()
        }
    }
    .toList()
