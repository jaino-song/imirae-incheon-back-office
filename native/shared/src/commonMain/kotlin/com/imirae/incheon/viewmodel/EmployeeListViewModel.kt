package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.EmployeeService
import com.imirae.incheon.domain.models.Employee
import com.imirae.incheon.domain.utils.KoreanSearch
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class EmployeeListUiState(
    val isLoading: Boolean = true,
    val employees: List<Employee> = emptyList(),
    val filteredEmployees: List<Employee> = emptyList(),
    val searchQuery: String = "",
    val statusFilter: String? = null,
    val currentPage: Int = 1,
    val totalPages: Int = 1,
    val totalCount: Int = 0,
    val error: String? = null,
)

class EmployeeListViewModel(private val employeeService: EmployeeService) {
    private val _uiState = MutableStateFlow(EmployeeListUiState())
    val uiState: StateFlow<EmployeeListUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /** The backend exposes an unpaginated branch-scoped employee list. */
    fun loadEmployees(@Suppress("UNUSED_PARAMETER") page: Int = 1) {
        scope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            when (val result = employeeService.getEmployees()) {
                is ApiResult.Success -> {
                    val employees = result.data
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        employees = employees,
                        filteredEmployees = applyFilters(
                            employees,
                            _uiState.value.searchQuery,
                            _uiState.value.statusFilter,
                        ),
                        currentPage = 1,
                        totalPages = 1,
                        totalCount = employees.size,
                    )
                }
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = result.error.userMessage(),
                )
            }
        }
    }

    fun search(query: String) {
        _uiState.value = _uiState.value.copy(
            searchQuery = query,
            filteredEmployees = applyFilters(_uiState.value.employees, query, _uiState.value.statusFilter),
        )
    }

    fun filterByStatus(status: String?) {
        _uiState.value = _uiState.value.copy(
            statusFilter = status,
            filteredEmployees = applyFilters(_uiState.value.employees, _uiState.value.searchQuery, status),
        )
    }

    fun refresh() = loadEmployees()

    private fun applyFilters(employees: List<Employee>, query: String, status: String?): List<Employee> {
        var filtered = employees
        if (query.isNotBlank()) {
            filtered = filtered.filter { employee ->
                KoreanSearch.matchesChosung(query, employee.name) ||
                    employee.phone.contains(query) ||
                    employee.grade.contains(query, ignoreCase = true) ||
                    employee.workArea.any { area -> area.contains(query, ignoreCase = true) }
            }
        }
        if (status != null) {
            filtered = filtered.filter { it.status == status }
        }
        return filtered
    }
}
