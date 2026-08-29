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
import com.imirae.incheon.domain.models.UpdateClientRequest
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
    var editName by remember(clientId) { mutableStateOf("") }
    var editPhone by remember(clientId) { mutableStateOf("") }
    var editAddress by remember(clientId) { mutableStateOf("") }

    LaunchedEffect(clientId) { viewModel.loadClient(clientId) }
    LaunchedEffect(uiState.deleteSuccess) { if (uiState.deleteSuccess) onNavigateBack() }

    when {
        uiState.isLoading -> LoadingScreen()
        uiState.error != null -> ErrorScreen(uiState.error!!, onRetry = { viewModel.loadClient(clientId) })
        uiState.client != null -> {
            val client = uiState.client!!
            LaunchedEffect(client.id) {
                editName = client.name
                editPhone = client.phone.orEmpty()
                editAddress = client.address.orEmpty()
            }
            Column(
                modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(DesignTokens.Spacing.lg.dp).testTag("client-detail-screen"),
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.lg.dp)
            ) {
                // Header
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onNavigateBack, modifier = Modifier.testTag("client-detail-back")) { Icon(Icons.Default.ArrowBack, "뒤로") }
                    Text(client.name, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).testTag("client-detail-name"))
                    val status = client.serviceStatus ?: "pre_booking"
                    StatusBadge(status = status, label = StatusCodes.getStatusLabel(status))
                }

                // Info card
                Card(shape = RoundedCornerShape(DesignTokens.Radius.lg), elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)) {
                    Column(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp), verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
                        Text("기본 정보", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        InfoRow("전화번호", client.phone ?: "-")
                        InfoRow("주소", client.address ?: "-")
                        InfoRow("출산 예정일", client.dueDate ?: "-")
                        InfoRow("생년월일", client.birthday ?: client.birthDate ?: "-")
                        InfoRow("바우처 고객", if (client.voucherClient) "예" else "아니오")
                        InfoRow("유축기", if (client.breastPump) "예" else "아니오")
                        client.primaryEmployee?.let { InfoRow("담당 직원", it.name) }
                    }
                }

                if (uiState.isEditing) {
                    Card(shape = RoundedCornerShape(DesignTokens.Radius.lg), elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)) {
                        Column(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp), verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)) {
                            AppTextField(value = editName, onValueChange = { editName = it }, label = "이름 *", testTag = "client-detail-edit-name")
                            AppTextField(value = editPhone, onValueChange = { editPhone = it }, label = "전화번호", testTag = "client-detail-edit-phone")
                            AppTextField(value = editAddress, onValueChange = { editAddress = it }, label = "주소", testTag = "client-detail-edit-address")
                            Row(horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp), modifier = Modifier.fillMaxWidth()) {
                                OutlinedButton(onClick = { viewModel.cancelEditing() }, modifier = Modifier.weight(1f)) { Text("취소") }
                                Button(
                                    onClick = {
                                        viewModel.updateClient(
                                            clientId,
                                            UpdateClientRequest(
                                                name = editName.trim().takeIf { it.isNotEmpty() },
                                                phone = editPhone.ifBlank { null },
                                                address = editAddress.ifBlank { null },
                                            ),
                                        )
                                    },
                                    enabled = !uiState.isSaving && editName.isNotBlank(),
                                    modifier = Modifier.weight(1f),
                                ) {
                                    if (uiState.isSaving) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                                    else Text("저장")
                                }
                            }
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
