package com.imirae.incheon.ui.contracts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.data.remote.UpdateDocumentRequest
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.ui.components.ErrorScreen
import com.imirae.incheon.ui.components.LoadingScreen
import com.imirae.incheon.ui.components.AppTextField
import com.imirae.incheon.viewmodel.ContractListViewModel

@Composable
fun ContractDetailScreen(
    viewModel: ContractListViewModel,
    documentId: String,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val uiState by viewModel.uiState.collectAsState()
    val uriHandler = LocalUriHandler.current
    var isEditing by remember(documentId) { mutableStateOf(false) }
    var editName by remember(documentId) { mutableStateOf("") }
    var editDescription by remember(documentId) { mutableStateOf("") }

    LaunchedEffect(documentId) { viewModel.loadContract(documentId) }
    LaunchedEffect(uiState.selectedDocument?.id) {
        uiState.selectedDocument?.let { document ->
            editName = document.name
            editDescription = document.description.orEmpty()
        }
    }
    LaunchedEffect(uiState.deleteSuccess) {
        if (uiState.deleteSuccess) onNavigateBack()
    }

    when {
        uiState.isDetailLoading || (uiState.selectedDocument == null && uiState.detailError == null) -> LoadingScreen()
        uiState.detailError != null -> ErrorScreen(
            message = uiState.detailError ?: "계약 문서를 불러오지 못했습니다",
            onRetry = { viewModel.loadContract(documentId) },
        )
        uiState.selectedDocument != null -> {
            val document = uiState.selectedDocument!!
            Column(
                modifier = modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(DesignTokens.Spacing.lg.dp)
                    .testTag("contract-detail-screen"),
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.lg.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onNavigateBack, modifier = Modifier.testTag("contract-detail-back")) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "뒤로")
                    }
                    Text(
                        text = "계약 문서",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f).testTag("contract-detail-title"),
                    )
                }

                Card(
                    modifier = Modifier.fillMaxWidth(),
                    elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                ) {
                    Column(
                        modifier = Modifier.padding(DesignTokens.Spacing.lg.dp),
                        verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp),
                    ) {
                        if (isEditing) {
                            AppTextField(
                                value = editName,
                                onValueChange = { editName = it },
                                label = "이름 *",
                                testTag = "contract-detail-edit-name",
                            )
                            AppTextField(
                                value = editDescription,
                                onValueChange = { editDescription = it },
                                label = "설명",
                                testTag = "contract-detail-edit-description",
                            )
                        } else {
                            Text(document.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                            document.description?.takeIf(String::isNotBlank)?.let { description ->
                                InfoRow("설명", description)
                            }
                        }
                        InfoRow("분류", document.categoryLabel ?: document.categoryId)
                        InfoRow("형식", document.mimeType)
                        InfoRow("파일 크기", "${document.fileSize} bytes")
                        InfoRow("공개 범위", document.visibilityScope)
                        document.createdAt?.let { InfoRow("등록일", it) }

                        document.storageUrl?.let { url ->
                            OutlinedButton(
                                onClick = { runCatching { uriHandler.openUri(url) } },
                                modifier = Modifier.fillMaxWidth().testTag("contract-detail-open"),
                            ) {
                                Icon(Icons.Default.OpenInNew, contentDescription = null)
                                Text("문서 열기")
                            }
                        }
                    }
                }

                if (document.canManage) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp),
                    ) {
                        if (isEditing) {
                            OutlinedButton(
                                onClick = { isEditing = false },
                                modifier = Modifier.weight(1f),
                            ) { Text("취소") }
                            Button(
                                onClick = {
                                    viewModel.updateContract(
                                        document.id,
                                        UpdateDocumentRequest(
                                            name = editName.trim().takeIf(String::isNotEmpty),
                                            description = editDescription.trim().takeIf(String::isNotEmpty),
                                        ),
                                    )
                                    isEditing = false
                                },
                                enabled = !uiState.isUpdating && editName.isNotBlank(),
                                modifier = Modifier.weight(1f),
                            ) { Text(if (uiState.isUpdating) "저장 중..." else "저장") }
                        } else {
                            OutlinedButton(
                                onClick = { isEditing = true },
                                modifier = Modifier.weight(1f).testTag("contract-detail-edit-button"),
                            ) {
                                Icon(Icons.Default.Edit, contentDescription = null)
                                Text("수정")
                            }
                            OutlinedButton(
                                onClick = { viewModel.deleteContract(document.id) },
                                enabled = !uiState.isDeleting,
                                modifier = Modifier.weight(1f).testTag("contract-detail-delete-button"),
                            ) {
                                Icon(Icons.Default.Delete, contentDescription = null)
                                Text(if (uiState.isDeleting) "삭제 중..." else "삭제")
                            }
                        }
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
