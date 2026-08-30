package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.DocumentService
import com.imirae.incheon.data.remote.UpdateDocumentRequest
import com.imirae.incheon.domain.models.FileItem
import com.imirae.incheon.network.ApiError
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The backend stores contract documents in its branch-scoped document
 * resource. There is no `/contracts` endpoint, so this route renders the
 * canonical document records instead of inventing a parallel contract API.
 */
data class ContractListUiState(
    val isLoading: Boolean = true,
    val documents: List<FileItem> = emptyList(),
    val selectedDocument: FileItem? = null,
    val isDetailLoading: Boolean = false,
    val detailError: String? = null,
    val error: String? = null,
    val isDeleting: Boolean = false,
    val deletingId: String? = null,
    val deleteSuccess: Boolean = false,
    val isUpdating: Boolean = false,
    val updateSuccess: Boolean = false,
    val isCreating: Boolean = false,
    val createSuccess: Boolean = false,
)

private const val CREATE_UNSUPPORTED_MESSAGE = "계약 문서 업로드는 아직 지원되지 않습니다."
private const val INVALID_DOCUMENT_ID_MESSAGE = "계약 문서 식별자가 올바르지 않습니다."

class ContractListViewModel(private val documentService: DocumentService) {
    private val _uiState = MutableStateFlow(ContractListUiState())
    val uiState: StateFlow<ContractListUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun loadContracts() {
        scope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true,
                error = null,
                selectedDocument = null,
                isDetailLoading = false,
                detailError = null,
                deleteSuccess = false,
                updateSuccess = false,
                createSuccess = false,
            )
            when (val result = documentService.getDocuments()) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    documents = result.data,
                )
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = result.error.userMessage(),
                )
            }
        }
    }

    fun refresh() = loadContracts()

    fun loadContract(id: String) {
        if (id.isBlank()) {
            _uiState.value = _uiState.value.copy(
                isDetailLoading = false,
                detailError = INVALID_DOCUMENT_ID_MESSAGE,
                selectedDocument = null,
            )
            return
        }
        scope.launch {
            _uiState.value = _uiState.value.copy(isDetailLoading = true, detailError = null)
            when (val result = documentService.getDocument(id)) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(
                    isDetailLoading = false,
                    selectedDocument = result.data,
                )
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(
                    isDetailLoading = false,
                    detailError = result.error.userMessage(),
                )
            }
        }
    }

    fun deleteContract(id: String) {
        if (id.isBlank()) {
            _uiState.value = _uiState.value.copy(error = INVALID_DOCUMENT_ID_MESSAGE)
            return
        }
        scope.launch {
            _uiState.value = _uiState.value.copy(
                isDeleting = true,
                deletingId = id,
                deleteSuccess = false,
                error = null,
            )
            when (val result = documentService.deleteDocument(id)) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(
                    isDeleting = false,
                    deletingId = null,
                    documents = _uiState.value.documents.filterNot { it.id == id },
                    selectedDocument = _uiState.value.selectedDocument?.takeUnless { it.id == id },
                    deleteSuccess = true,
                )
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(
                    isDeleting = false,
                    deletingId = null,
                    error = result.error.userMessage(),
                )
            }
        }
    }

    fun updateContract(id: String, request: UpdateDocumentRequest) {
        if (id.isBlank()) {
            _uiState.value = _uiState.value.copy(error = INVALID_DOCUMENT_ID_MESSAGE)
            return
        }
        scope.launch {
            _uiState.value = _uiState.value.copy(
                isUpdating = true,
                updateSuccess = false,
                error = null,
            )
            when (val result = documentService.updateDocument(id, request)) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(
                    isUpdating = false,
                    selectedDocument = result.data,
                    documents = _uiState.value.documents.map { document ->
                        if (document.id == id) result.data else document
                    },
                    updateSuccess = true,
                )
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(
                    isUpdating = false,
                    error = result.error.userMessage(),
                )
            }
        }
    }

    /**
     * A document upload needs multipart data and a native picker flow that is
     * not declared by this route. Keep the capability explicit and typed
     * rather than issuing a request to the nonexistent `/contracts` family.
     */
    fun createContract(): ApiResult<Nothing> {
        _uiState.value = _uiState.value.copy(
            isCreating = false,
            createSuccess = false,
            error = CREATE_UNSUPPORTED_MESSAGE,
        )
        return ApiResult.Error(ApiError.Unsupported(CREATE_UNSUPPORTED_MESSAGE))
    }
}
