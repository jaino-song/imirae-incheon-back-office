package com.imirae.incheon.ui.clients

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
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
import com.imirae.incheon.viewmodel.ClientListViewModel

@Composable
fun ClientListScreen(
    viewModel: ClientListViewModel,
    onNavigateToDetail: (Int) -> Unit,
    onNavigateToNew: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) { viewModel.loadClients() }

    Column(modifier = modifier.fillMaxSize().padding(DesignTokens.Spacing.lg.dp).testTag("client-list-screen")) {
        // Header
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("고객 관리", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("client-list-title"))
            FloatingActionButton(onClick = onNavigateToNew, modifier = Modifier.testTag("client-list-add-button")) {
                Icon(Icons.Default.Add, contentDescription = "고객 추가")
            }
        }

        Spacer(modifier = Modifier.height(DesignTokens.Spacing.md.dp))

        // Search
        AppSearchBar(query = uiState.searchQuery, onQueryChange = { viewModel.search(it) }, placeholder = "고객 검색...")

        Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))

        // Filters
        FilterChipRow(
            filters = listOf(null to "전체", "pre_booking" to "예약 전", "waiting" to "대기", "active" to "진행 중", "completed" to "완료"),
            selectedFilter = uiState.statusFilter,
            onFilterSelected = { viewModel.filterByStatus(it) }
        )

        Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))

        // Count
        Text("총 ${uiState.totalCount}명", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

        Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))

        when {
            uiState.isLoading -> LoadingScreen()
            uiState.error != null -> ErrorScreen(uiState.error!!, onRetry = { viewModel.refresh() })
            uiState.filteredClients.isEmpty() -> EmptyScreen("등록된 고객이 없습니다")
            else -> {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp), modifier = Modifier.weight(1f)) {
                    items(uiState.filteredClients) { client ->
                        DataListItem(item = client, onClick = { onNavigateToDetail(client.id) }, testTag = "client-item-${client.id}") {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(it.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                it.phone?.let { p -> Text(p, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                            val status = it.serviceStatus ?: "pre_booking"
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
