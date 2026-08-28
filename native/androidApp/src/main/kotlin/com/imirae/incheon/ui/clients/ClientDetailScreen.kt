package com.imirae.incheon.ui.clients

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
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
import com.imirae.incheon.viewmodel.ClientDetailViewModel

@Composable
fun ClientDetailScreen(
    viewModel: ClientDetailViewModel,
    clientId: Int,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(clientId) { viewModel.loadClient(clientId) }
    LaunchedEffect(uiState.deleteSuccess) { if (uiState.deleteSuccess) onNavigateBack() }

    when {
        uiState.isLoading -> LoadingScreen()
        uiState.error != null -> ErrorScreen(uiState.error!!, onRetry = { viewModel.refresh() })
        uiState.client != null -> {
            val client = uiState.client!!
            Column(
                modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(DesignTokens.Spacing.lg.dp).testTag("client-detail-screen"),
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.lg.dp)
            ) {
                // Header
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onNavigateBack, modifier = Modifier.testTag("client-detail-back")) { Icon(Icons.Default.ArrowBack, "뒤로") }
                    Text(client.name, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).testTag("client-detail-name"))
                    StatusBadge(status = client.status, label = StatusCodes.getStatusLabel(client.status))
                }

                // Info card
                Card(shape = RoundedCornerShape(DesignTokens.Radius.lg), elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)) {
                    Column(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp), verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
                        Text("기본 정보", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        InfoRow("전화번호", client.phone ?: "-")
                        InfoRow("이메일", client.email ?: "-")
                        InfoRow("주소", client.address ?: "-")
                        InfoRow("아기 이름", client.babyName ?: "-")
                        InfoRow("출산 예정일", client.dueDate ?: "-")
                    }
                }

                // Contracts section
                if (uiState.contracts.isNotEmpty()) {
                    Text("계약 내역", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    uiState.contracts.forEach { contract ->
                        Card(shape = RoundedCornerShape(DesignTokens.Radius.md), elevation = CardDefaults.cardElevation(defaultElevation = 1.dp), modifier = Modifier.fillMaxWidth().testTag("client-detail-contract-${contract.id}")) {
                            Row(modifier = Modifier.padding(DesignTokens.Spacing.md.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(contract.serviceType ?: "계약", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                    Text("${contract.startDate ?: ""} ~ ${contract.endDate ?: ""}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                StatusBadge(status = contract.status, label = StatusCodes.getStatusLabel(contract.status))
                            }
                        }
                    }
                }

                // Memo
                if (!client.memo.isNullOrBlank()) {
                    Card(shape = RoundedCornerShape(DesignTokens.Radius.lg), elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)) {
                        Column(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp)) {
                            Text("메모", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))
                            Text(client.memo!!, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }

                // Actions
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
                    OutlinedButton(onClick = { viewModel.startEditing() }, modifier = Modifier.weight(1f).testTag("client-detail-edit-button")) {
                        Icon(Icons.Default.Edit, null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("수정")
                    }
                    OutlinedButton(
                        onClick = { viewModel.deleteClient(clientId) },
                        modifier = Modifier.weight(1f).testTag("client-detail-delete-button"),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                    ) {
                        Icon(Icons.Default.Delete, null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("삭제")
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
