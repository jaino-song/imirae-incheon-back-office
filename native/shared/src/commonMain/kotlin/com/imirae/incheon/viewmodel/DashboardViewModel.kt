package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.ClientService
import com.imirae.incheon.data.remote.DocumentService
import com.imirae.incheon.data.remote.EmployeeService
import com.imirae.incheon.domain.models.Client
import com.imirae.incheon.domain.models.DashboardStats
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class DashboardUiState(
    val isLoading: Boolean = true,
    val stats: DashboardStats = DashboardStats(),
    val recentClients: List<Client> = emptyList(),
    val error: String? = null
)

class DashboardViewModel(
    private val clientService: ClientService,
    private val employeeService: EmployeeService,
    private val documentService: DocumentService
) {
    private val _uiState = MutableStateFlow(DashboardUiState())
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun loadDashboard() {
        scope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                val clientsResult = clientService.getClients(page = 1, limit = 5)
                val employeesResult = employeeService.getEmployees()
                val documentsResult = documentService.getDocuments()

                val totalClients = when (clientsResult) { is ApiResult.Success -> clientsResult.data.total; else -> 0 }
                val totalEmployees = when (employeesResult) { is ApiResult.Success -> employeesResult.data.size; else -> 0 }
                val recentClients = when (clientsResult) { is ApiResult.Success -> clientsResult.data.data; else -> emptyList() }
                val totalDocuments = when (documentsResult) { is ApiResult.Success -> documentsResult.data.size; else -> 0 }

                val firstError = listOfNotNull(
                    (clientsResult as? ApiResult.Error)?.error,
                    (employeesResult as? ApiResult.Error)?.error,
                    (documentsResult as? ApiResult.Error)?.error,
                ).firstOrNull()
                if (firstError != null) {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        recentClients = recentClients,
                        error = firstError.userMessage(),
                    )
                    return@launch
                }

                _uiState.value = DashboardUiState(
                    isLoading = false,
                    stats = DashboardStats(
                        totalClients = totalClients,
                        activeContracts = 0,
                        totalEmployees = totalEmployees,
                        pendingContracts = 0,
                        recentClients = recentClients,
                        totalDocuments = totalDocuments,
                        contractsSupported = false,
                    ),
                    recentClients = recentClients,
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = "대시보드를 불러올 수 없습니다")
            }
        }
    }

    fun refresh() = loadDashboard()
}
