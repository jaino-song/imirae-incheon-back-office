package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.FileService
import com.imirae.incheon.domain.models.FileItem
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class FileListUiState(
    val isLoading: Boolean = true,
    val files: List<FileItem> = emptyList(),
    val error: String? = null,
    val isDeleting: Boolean = false,
    val deleteSuccess: Boolean = false,
)

class FileListViewModel(private val fileService: FileService) {
    private val _uiState = MutableStateFlow(FileListUiState())
    val uiState: StateFlow<FileListUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun loadFiles() { scope.launch {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)
        when (val result = fileService.getFiles()) {
            is ApiResult.Success -> _uiState.value = _uiState.value.copy(isLoading = false, files = result.data)
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(isLoading = false, error = result.error.userMessage())
        }
    }}

    fun refresh() = loadFiles()

    fun deleteFile(id: String) { scope.launch {
        _uiState.value = _uiState.value.copy(isDeleting = true, deleteSuccess = false, error = null)
        when (val result = fileService.deleteFile(id)) {
            is ApiResult.Success -> {
                _uiState.value = _uiState.value.copy(isDeleting = false, deleteSuccess = true)
                loadFiles()
            }
            is ApiResult.Error -> _uiState.value = _uiState.value.copy(
                isDeleting = false,
                error = result.error.userMessage(),
            )
        }
    }}
}
