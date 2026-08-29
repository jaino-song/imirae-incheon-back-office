package com.imirae.incheon.ui.employees

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.models.Employee
import com.imirae.incheon.domain.models.UpdateEmployeeRequest
import com.imirae.incheon.domain.utils.StatusCodes
import com.imirae.incheon.ui.components.*
import com.imirae.incheon.viewmodel.EmployeeDetailViewModel

@Composable
fun EmployeeDetailScreen(
    viewModel: EmployeeDetailViewModel,
    employeeId: Int,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val uiState by viewModel.uiState.collectAsState()
    var editName by remember(employeeId) { mutableStateOf("") }
    var editPhone by remember(employeeId) { mutableStateOf("") }
    var editGrade by remember(employeeId) { mutableStateOf("") }
    var editWorkArea by remember(employeeId) { mutableStateOf("") }
    var editBirthday by remember(employeeId) { mutableStateOf("") }
    var editOpenToNextWork by remember(employeeId) { mutableStateOf(false) }

    LaunchedEffect(employeeId) { viewModel.loadEmployee(employeeId) }
    LaunchedEffect(uiState.deleteSuccess) {
        if (uiState.deleteSuccess) onNavigateBack()
    }

    when {
        uiState.isLoading && uiState.employee == null -> LoadingScreen()
        uiState.error != null && uiState.employee == null -> ErrorScreen(uiState.error!!, onRetry = { viewModel.loadEmployee(employeeId) })
        uiState.employee == null -> EmptyScreen("직원을 찾을 수 없습니다")
        else -> {
            val employee = uiState.employee!!
            LaunchedEffect(employee.id) {
                editName = employee.name
                editPhone = employee.phone
                editGrade = employee.grade
                editWorkArea = employee.workArea.joinToString(", ")
                editBirthday = employee.birthday.orEmpty()
                editOpenToNextWork = employee.openToNextWork
            }

            Column(
                modifier = modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(DesignTokens.Spacing.lg.dp)
                    .testTag("employee-detail-screen"),
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.lg.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onNavigateBack, modifier = Modifier.testTag("employee-detail-back")) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "뒤로")
                    }
                    Text(
                        employee.name,
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f).testTag("employee-detail-name"),
                    )
                    val status = employee.status ?: if (employee.openToNextWork) "available" else "unavailable"
                    StatusBadge(status = status, label = StatusCodes.getStatusLabel(status))
                }

                if (uiState.isEditing) {
                    Card(
                        shape = RoundedCornerShape(DesignTokens.Radius.lg),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                    ) {
                        Column(
                            modifier = Modifier.padding(DesignTokens.Spacing.lg.dp),
                            verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp),
                        ) {
                            AppTextField(
                                value = editName,
                                onValueChange = { editName = it },
                                label = "이름 *",
                                testTag = "employee-detail-edit-name",
                            )
                            AppTextField(
                                value = editPhone,
                                onValueChange = { editPhone = it },
                                label = "전화번호",
                                testTag = "employee-detail-edit-phone",
                            )
                            AppTextField(
                                value = editGrade,
                                onValueChange = { editGrade = it },
                                label = "직급",
                                testTag = "employee-detail-edit-grade",
                            )
                            AppTextField(
                                value = editWorkArea,
                                onValueChange = { editWorkArea = it },
                                label = "근무 지역 (쉼표로 구분)",
                                testTag = "employee-detail-edit-work-area",
                            )
                            AppTextField(
                                value = editBirthday,
                                onValueChange = { editBirthday = it },
                                label = "생년월일",
                                testTag = "employee-detail-edit-birthday",
                            )
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text("다음 업무 가능", style = MaterialTheme.typography.bodyMedium)
                                Switch(
                                    checked = editOpenToNextWork,
                                    onCheckedChange = { editOpenToNextWork = it },
                                    modifier = Modifier.testTag("employee-detail-edit-open-status"),
                                )
                            }
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                OutlinedButton(onClick = { viewModel.cancelEditing() }, modifier = Modifier.weight(1f)) {
                                    Text("취소")
                                }
                                Button(
                                    onClick = {
                                        viewModel.updateEmployee(
                                            employeeId,
                                            UpdateEmployeeRequest(
                                                name = editName.trim().takeIf { it.isNotEmpty() },
                                                workArea = editWorkArea.split(",").map { it.trim() }.filter { it.isNotEmpty() },
                                                phone = editPhone.trim().takeIf { it.isNotEmpty() },
                                                grade = editGrade.trim().takeIf { it.isNotEmpty() },
                                                openToNextWork = editOpenToNextWork,
                                                birthday = editBirthday.trim().takeIf { it.isNotEmpty() },
                                            ),
                                        )
                                    },
                                    enabled = !uiState.isSaving && editName.isNotBlank() && editPhone.isNotBlank(),
                                    modifier = Modifier.weight(1f).testTag("employee-detail-save-button"),
                                ) {
                                    if (uiState.isSaving) {
                                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                                    } else {
                                        Text("저장")
                                    }
                                }
                            }
                        }
                    }
                } else {
                    Card(
                        shape = RoundedCornerShape(DesignTokens.Radius.lg),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                    ) {
                        Column(
                            modifier = Modifier.padding(DesignTokens.Spacing.lg.dp),
                            verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp),
                        ) {
                            Text("직원 정보", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            InfoRow("전화번호", employee.phone)
                            InfoRow("직급", employee.grade)
                            InfoRow("근무 지역", employee.workArea.joinToString(" · ").ifBlank { "-" })
                            InfoRow("생년월일", employee.birthday ?: "-")
                            InfoRow("등록일", employee.registeredDate ?: "-")
                            InfoRow("다음 업무 가능", if (employee.openToNextWork) "예" else "아니오")
                        }
                    }
                }

                uiState.error?.let { message ->
                    Text(message, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("employee-detail-error"))
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp),
                ) {
                    OutlinedButton(
                        onClick = { viewModel.startEditing() },
                        enabled = !uiState.isSaving && !uiState.isDeleting,
                        modifier = Modifier.weight(1f).testTag("employee-detail-edit-button"),
                    ) {
                        Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("수정")
                    }
                    OutlinedButton(
                        onClick = { viewModel.deleteEmployee(employeeId) },
                        enabled = !uiState.isSaving && !uiState.isDeleting,
                        modifier = Modifier.weight(1f).testTag("employee-detail-delete-button"),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) {
                        if (uiState.isDeleting) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                        }
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(if (uiState.isDeleting) "삭제 중..." else "삭제")
                    }
                }
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}
