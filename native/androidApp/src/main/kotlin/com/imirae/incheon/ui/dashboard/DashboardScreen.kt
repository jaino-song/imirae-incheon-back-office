package com.imirae.incheon.ui.dashboard

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.ui.components.ErrorScreen
import com.imirae.incheon.ui.components.LoadingScreen
import com.imirae.incheon.viewmodel.DashboardViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel,
    onNavigateToClients: () -> Unit,
    onNavigateToEmployees: () -> Unit,
    onNavigateToContracts: () -> Unit,
    onNavigateToClientDetail: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) { viewModel.loadDashboard() }

    when {
        uiState.isLoading -> LoadingScreen()
        uiState.error != null -> ErrorScreen(uiState.error!!, onRetry = { viewModel.refresh() })
        else -> {
            LazyColumn(
                modifier = modifier.fillMaxSize().padding(DesignTokens.Spacing.lg.dp).testTag("dashboard-screen"),
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.lg.dp)
            ) {
                item {
                    Text("대시보드", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("dashboard-title"))
                }

                // Stats cards
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
                        StatCard("고객", uiState.stats.totalClients.toString(), Icons.Default.People, Color(DesignTokens.Colors.primary), Modifier.weight(1f).clickable { onNavigateToClients() }, "dashboard-stat-clients")
                        StatCard("직원", uiState.stats.totalEmployees.toString(), Icons.Default.Badge, Color(DesignTokens.Colors.secondary), Modifier.weight(1f).clickable { onNavigateToEmployees() }, "dashboard-stat-employees")
                    }
                }
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
                        val contractValue = if (uiState.stats.contractsSupported) uiState.stats.activeContracts.toString() else "—"
                        val pendingContractValue = if (uiState.stats.contractsSupported) uiState.stats.pendingContracts.toString() else "—"
                        StatCard("활성 계약", contractValue, Icons.Default.Description, Color(DesignTokens.Colors.success), Modifier.weight(1f).clickable { onNavigateToContracts() }, "dashboard-stat-active-contracts")
                        StatCard("대기 계약", pendingContractValue, Icons.Default.Pending, Color(DesignTokens.Colors.warning), Modifier.weight(1f).clickable { onNavigateToContracts() }, "dashboard-stat-pending-contracts")
                    }
                }

                // Recent clients
                item {
                    Text("최근 고객", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = DesignTokens.Spacing.sm.dp))
                }
                if (uiState.recentClients.isEmpty()) {
                    item { Text("최근 고객이 없습니다", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                } else {
                    items(uiState.recentClients) { client ->
                        Card(
                            modifier = Modifier.fillMaxWidth().clickable { onNavigateToClientDetail(client.id) }.testTag("dashboard-recent-client-${client.id}"),
                            shape = RoundedCornerShape(DesignTokens.Radius.md),
                            elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
                        ) {
                            Row(modifier = Modifier.padding(DesignTokens.Spacing.md.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(client.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                    client.phone?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                }
                                Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatCard(title: String, value: String, icon: ImageVector, color: Color, modifier: Modifier = Modifier, tag: String = "") {
    Card(
        modifier = modifier.testTag(tag),
        shape = RoundedCornerShape(DesignTokens.Radius.lg),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp)) {
            Icon(icon, null, tint = color, modifier = Modifier.size(28.dp))
            Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
