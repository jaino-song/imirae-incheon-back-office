package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.ChatService
import com.imirae.incheon.domain.models.ChatMessage
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class ChatUiState(
    val isLoading: Boolean = false,
    val messages: List<ChatMessage> = emptyList(),
    val sessionId: String? = null,
    val isSending: Boolean = false,
    val error: String? = null
)

class ChatViewModel(private val chatService: ChatService) {
    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun loadHistory() { scope.launch {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        when (val result = chatService.getHistory()) {
            is ApiResult.Success -> _uiState.value = _uiState.value.copy(
                isLoading = false,
                messages = result.data.messages.mapIndexed { index, message ->
                    if (message.id.isBlank()) {
                        message.copy(id = "${message.role}-$index-${message.content.hashCode()}")
                    } else {
                        message
                    }
                },
                sessionId = result.data.sessionId,
            )
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.error.userMessage())
        }
    }}

    fun sendMessage(message: String) { scope.launch {
        _uiState.value = _uiState.value.copy(isSending = true, error = null)
        when (val result = chatService.sendMessage(message, _uiState.value.sessionId)) {
            is ApiResult.Success -> {
                val updated = _uiState.value.messages + result.data
                _uiState.value = _uiState.value.copy(
                    isSending = false,
                    messages = updated,
                    sessionId = result.data.id.takeUnless { it.startsWith("assistant-") } ?: _uiState.value.sessionId,
                )
            }
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(isSending = false, error = result.error.userMessage())
        }
    }}
}
