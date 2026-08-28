package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.ClientService
import com.imirae.incheon.domain.models.Client
import com.imirae.incheon.domain.models.UpdateClientRequest
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ClientDetailUiState(
    val isLoading: Boolean = true,
    val client: Client? = null,
    val error: String? = null,
    val isEditing: Boolean = false,
    val isSaving: Boolean = false,
    val saveSuccess: Boolean = false,
    val isDeleting: Boolean = false,
    val deleteSuccess: Boolean = false,
)

class ClientDetailViewModel(private val clientService: ClientService) {
    private val _uiState = MutableStateFlow(ClientDetailUiState())
    val uiState: StateFlow<ClientDetailUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun loadClient(clientId: Int) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null, deleteSuccess = false)
            when (val result = clientService.getClient(clientId)) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    client = result.data,
                )
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = result.error.userMessage(),
                )
            }
        }
    }

    fun startEditing() {
        _uiState.value = _uiState.value.copy(isEditing = true, saveSuccess = false)
    }

    fun cancelEditing() {
        _uiState.value = _uiState.value.copy(isEditing = false)
    }

    fun updateClient(clientId: Int, request: UpdateClientRequest) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isSaving = true, saveSuccess = false, error = null)
            when (val result = clientService.updateClient(clientId, request)) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    saveSuccess = true,
                    isEditing = false,
                    client = result.data,
                )
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    error = result.error.userMessage(),
                )
            }
        }
    }

    fun deleteClient(clientId: Int) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isDeleting = true, error = null, deleteSuccess = false)
            when (val result = clientService.deleteClient(clientId)) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(
                    isDeleting = false,
                    deleteSuccess = true,
                )
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(
                    isDeleting = false,
                    error = result.error.userMessage(),
                )
            }
        }
    }

    fun refresh() {
        _uiState.value.client?.let { loadClient(it.id) }
    }
}
