package com.imirae.incheon.ui.files

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.models.FileItem
import com.imirae.incheon.ui.components.EmptyScreen
import com.imirae.incheon.ui.components.ErrorScreen
import com.imirae.incheon.ui.components.LoadingScreen
import com.imirae.incheon.viewmodel.FileListViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileListScreen(
    viewModel: FileListViewModel,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val uriHandler = LocalUriHandler.current

    LaunchedEffect(Unit) { viewModel.loadFiles() }

    Scaffold(
        modifier = modifier.fillMaxSize().testTag("file-list-screen"),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "파일 관리",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.testTag("file-list-title")
                    )
                },
                actions = {
                    IconButton(
                        onClick = { viewModel.refresh() },
                        modifier = Modifier.testTag("file-list-refresh-button")
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "파일 목록 새로고침")
                    }
                }
            )
        }
    ) { innerPadding ->
        when {
            uiState.isLoading -> LoadingScreen(modifier = Modifier.padding(innerPadding))
            uiState.error != null -> {
                ErrorScreen(
                    message = uiState.error ?: "파일을 불러오지 못했습니다",
                    onRetry = { viewModel.refresh() },
                    modifier = Modifier.padding(innerPadding)
                )
            }

            uiState.files.isEmpty() -> {
                EmptyScreen(
                    message = "파일이 없습니다",
                    modifier = Modifier.padding(innerPadding)
                )
            }

            else -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .testTag("file-list-content"),
                    contentPadding = PaddingValues(DesignTokens.Spacing.lg.dp),
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
                ) {
                    items(items = uiState.files, key = { it.id }) { file ->
                        FileItemCard(
                            file = file,
                            onOpenFile = { file.storageUrl?.let { runCatching { uriHandler.openUri(it) } } }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun FileItemCard(
    file: FileItem,
    onOpenFile: () -> Unit
) {
    val icon = when {
        file.mimeType.contains("pdf", ignoreCase = true) -> Icons.Default.PictureAsPdf
        file.mimeType.contains("image", ignoreCase = true) -> Icons.Default.Image
        else -> Icons.Default.InsertDriveFile
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onOpenFile)
            .testTag("file-item-${file.id}"),
        shape = RoundedCornerShape(DesignTokens.Radius.md),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(DesignTokens.Spacing.lg.dp),
            horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            FileMimeIcon(icon = icon)

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = file.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold
                )
                if (file.mimeType.isNotBlank()) {
                    Text(
                        text = file.mimeType,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Icon(
                imageVector = Icons.Default.Download,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun FileMimeIcon(icon: ImageVector) {
    Icon(
        imageVector = icon,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.primary
    )
}
