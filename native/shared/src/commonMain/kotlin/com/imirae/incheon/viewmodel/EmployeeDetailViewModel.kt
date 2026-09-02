package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.EmployeeService
import com.imirae.incheon.domain.models.Employee
import com.imirae.incheon.domain.models.UpdateEmployeeRequest
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class EmployeeDetailUiState(
    val isLoading: Boolean = true,
    val employee: Employee? = null,
    val error: String? = null,
    val isEditing: Boolean = false,
    val isSaving: Boolean = false,
    val saveSuccess: Boolean = false,
    val isDeleting: Boolean = false,
    val deleteSuccess: Boolean = false,
)

private const val INVALID_EMPLOYEE_ID_MESSAGE = "직원 식별자가 올바르지 않습니다."

class EmployeeDetailViewModel(private val employeeService: EmployeeService) {
    private val _uiState = MutableStateFlow(EmployeeDetailUiState())
    val uiState: StateFlow<EmployeeDetailUiState> = _uiState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun loadEmployee(employeeId: Int) {
        if (employeeId <= 0) {
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                employee = null,
                error = INVALID_EMPLOYEE_ID_MESSAGE,
            )
            return
        }

        scope.launch {
            _uiState.value = _uiState.value.copy(
                isLoading = true,
                error = null,
                deleteSuccess = false,
            )
            when (val result = employeeService.getEmployee(employeeId)) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    employee = result.data,
                )
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = result.error.userMessage(),
                )
            }
        }
    }

    fun startEditing() {
        _uiState.value = _uiState.value.copy(isEditing = true, saveSuccess = false, error = null)
    }

    fun cancelEditing() {
        _uiState.value = _uiState.value.copy(isEditing = false)
    }

    fun updateEmployee(employeeId: Int, request: UpdateEmployeeRequest) {
        if (employeeId <= 0) {
            _uiState.value = _uiState.value.copy(error = INVALID_EMPLOYEE_ID_MESSAGE)
            return
        }

        scope.launch {
            _uiState.value = _uiState.value.copy(
                isSaving = true,
                saveSuccess = false,
                error = null,
            )
            when (val result = employeeService.updateEmployee(employeeId, request)) {
                is ApiResult.Success -> _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    saveSuccess = true,
                    isEditing = false,
                    employee = result.data,
                )
                is ApiResult.Error -> _uiState.value = _uiState.value.copy(
                    isSaving = false,
                    error = result.error.userMessage(),
                )
            }
        }
    }

    fun deleteEmployee(employeeId: Int) {
        if (employeeId <= 0) {
            _uiState.value = _uiState.value.copy(error = INVALID_EMPLOYEE_ID_MESSAGE)
            return
        }

        scope.launch {
            _uiState.value = _uiState.value.copy(
                isDeleting = true,
                deleteSuccess = false,
                error = null,
            )
            when (val result = employeeService.deleteEmployee(employeeId)) {
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
        _uiState.value.employee?.let { loadEmployee(it.id) }
    }
}
