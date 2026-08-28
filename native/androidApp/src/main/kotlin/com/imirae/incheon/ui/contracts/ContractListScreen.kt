package com.imirae.incheon.ui.contracts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.models.FileItem
import com.imirae.incheon.ui.components.EmptyScreen
import com.imirae.incheon.ui.components.ErrorScreen
import com.imirae.incheon.ui.components.LoadingScreen
import com.imirae.incheon.viewmodel.ContractListViewModel

@Composable
fun ContractListScreen(
    viewModel: ContractListViewModel,
    onNavigateToDetail: (String) -> Unit,
    onNavigateToCreate: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) { viewModel.loadContracts() }

    Scaffold(
        modifier = modifier.fillMaxSize().testTag("contract-list-screen"),
        topBar = {
            androidx.compose.material3.TopAppBar(
                title = {
                    Text(
                        text = "계약 문서",
                        style = MaterialTheme.typography.headlineMedium,
                        modifier = Modifier.testTag("contract-list-title"),
                    )
                },
                actions = {
                    IconButton(
                        onClick = onNavigateToCreate,
                        modifier = Modifier.testTag("contract-list-add-button"),
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "계약 문서 업로드")
                    }
                    IconButton(
                        onClick = viewModel::refresh,
                        modifier = Modifier.testTag("contract-list-refresh-button"),
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "계약 문서 새로고침")
                    }
                },
            )
        },
    ) { innerPadding ->
        when {
            uiState.isLoading -> LoadingScreen(modifier = Modifier.padding(innerPadding))
            uiState.error != null -> ErrorScreen(
                message = uiState.error ?: "계약 문서를 불러오지 못했습니다",
                onRetry = viewModel::refresh,
                modifier = Modifier.padding(innerPadding),
            )
            uiState.documents.isEmpty() -> EmptyScreen(
                message = "계약 문서가 없습니다",
                modifier = Modifier.padding(innerPadding),
            )
            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .testTag("contract-list-content"),
                contentPadding = PaddingValues(DesignTokens.Spacing.lg.dp),
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp),
            ) {
                items(items = uiState.documents, key = { it.id }) { document ->
                    ContractDocumentCard(
                        document = document,
                        isDeleting = uiState.isDeleting && uiState.deletingId == document.id,
                        onOpen = { onNavigateToDetail(document.id) },
                        onDelete = { viewModel.deleteContract(document.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ContractDocumentCard(
    document: FileItem,
    isDeleting: Boolean,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpen)
            .testTag("contract-document-${document.id}"),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(DesignTokens.Spacing.lg.dp),
            horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp),
        ) {
            Icon(
                imageVector = Icons.Default.Description,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(text = document.name, style = MaterialTheme.typography.bodyLarge)
                document.categoryLabel?.let { label ->
                    Text(text = label, style = MaterialTheme.typography.bodySmall)
                }
                document.description?.takeIf(String::isNotBlank)?.let { description ->
                    Text(text = description, style = MaterialTheme.typography.bodySmall)
                }
            }
            IconButton(
                onClick = onDelete,
                enabled = !isDeleting && document.canManage,
                modifier = Modifier.testTag("contract-document-delete-${document.id}"),
            ) {
                Icon(Icons.Default.Delete, contentDescription = "계약 문서 삭제")
            }
        }
    }
}
