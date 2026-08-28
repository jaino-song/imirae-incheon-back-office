package com.imirae.incheon.ui.employees

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.utils.StatusCodes
import com.imirae.incheon.ui.components.*
import com.imirae.incheon.viewmodel.EmployeeListViewModel

@Composable
fun EmployeeListScreen(
    viewModel: EmployeeListViewModel,
    onNavigateToDetail: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) { viewModel.loadEmployees() }

    Column(modifier = modifier.fillMaxSize().padding(DesignTokens.Spacing.lg.dp).testTag("employee-list-screen")) {
        Text("직원 관리", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("employee-list-title"))
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.md.dp))
        AppSearchBar(query = uiState.searchQuery, onQueryChange = { viewModel.search(it) }, placeholder = "직원 검색...")
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))
        FilterChipRow(
            filters = listOf(null to "전체", "available" to "가능", "working" to "근무 중", "unavailable" to "불가"),
            selectedFilter = uiState.statusFilter,
            onFilterSelected = { viewModel.filterByStatus(it) }
        )
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))
        Text("총 ${uiState.totalCount}명", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))

        when {
            uiState.isLoading -> LoadingScreen()
            uiState.error != null -> ErrorScreen(uiState.error!!, onRetry = { viewModel.refresh() })
            uiState.filteredEmployees.isEmpty() -> EmptyScreen("등록된 직원이 없습니다")
            else -> {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp), modifier = Modifier.weight(1f)) {
                    items(uiState.filteredEmployees) { emp ->
                        DataListItem(item = emp, onClick = { onNavigateToDetail(emp.id) }, testTag = "employee-item-${emp.id}") {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(it.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                Text(
                                    listOf(it.grade, it.workArea.joinToString(" · "))
                                        .filter { value -> value.isNotBlank() }
                                        .joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            val status = it.status ?: "unavailable"
                            StatusBadge(status = status, label = StatusCodes.getStatusLabel(status))
                            Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                PaginationControls(uiState.currentPage, uiState.totalPages, onPrevious = { viewModel.previousPage() }, onNext = { viewModel.nextPage() })
            }
        }
    }
}
