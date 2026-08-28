package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.ClientService
import com.imirae.incheon.data.remote.DocumentService
import com.imirae.incheon.data.remote.EmployeeService
import com.imirae.incheon.domain.models.Client
import com.imirae.incheon.domain.models.Contract
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
    val recentContracts: List<Contract> = emptyList(),
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
                val contractsResult = documentService.getContracts(page = 1, limit = 5)

                val totalClients = when (clientsResult) { is ApiResult.Success -> clientsResult.data.total; else -> 0 }
                val totalEmployees = when (employeesResult) { is ApiResult.Success -> employeesResult.data.size; else -> 0 }
                val recentClients = when (clientsResult) { is ApiResult.Success -> clientsResult.data.data; else -> emptyList() }
                val contracts = when (contractsResult) { is ApiResult.Success -> contractsResult.data.data; else -> emptyList() }
                val activeContracts = contracts.count { it.status == "active" || it.status == "signed" }
                val pendingContracts = contracts.count { it.status == "pending" || it.status == "draft" }

                _uiState.value = DashboardUiState(
                    isLoading = false,
                    stats = DashboardStats(
                        totalClients = totalClients,
                        activeContracts = activeContracts,
                        totalEmployees = totalEmployees,
                        pendingContracts = pendingContracts,
                        recentClients = recentClients,
                        recentContracts = contracts
                    ),
                    recentClients = recentClients,
                    recentContracts = contracts
                )
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(isLoading = false, error = "대시보드를 불러올 수 없습니다")
            }
        }
    }

    fun refresh() = loadDashboard()
}
