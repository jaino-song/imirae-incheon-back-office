package com.imirae.incheon.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.imirae.incheon.auth.AuthState
import com.imirae.incheon.auth.BranchesUiState
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.viewmodel.AuthViewModel

@Composable
fun SelectBranchScreen(
    viewModel: AuthViewModel,
    onNavigateToDashboard: () -> Unit,
    onNavigateToLogin: () -> Unit,
    modifier: Modifier = Modifier,
    shouldNavigateToDashboard: () -> Boolean = { true }
) {
    val authState by viewModel.authState.collectAsState()
    val branchesState by viewModel.branchesState.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.loadBranches()
    }

    LaunchedEffect(authState) {
        if (authState is AuthState.Authenticated && shouldNavigateToDashboard()) {
            onNavigateToDashboard()
        }
    }

    Box(
        modifier = modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier.widthIn(max = 400.dp).padding(DesignTokens.Spacing.lg.dp).testTag("auth-select-branch-card"),
            shape = RoundedCornerShape(DesignTokens.Radius.lg.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(
                modifier = Modifier.padding(DesignTokens.Spacing.xl.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.lg.dp)
            ) {
                Icon(
                    Icons.Default.Business,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(48.dp)
                )

                Text(
                    "지점 선택",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.testTag("auth-select-branch-title")
                )

                Text(
                    "사용할 지점을 선택해 주세요.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )

                when (val state = branchesState) {
                    is BranchesUiState.Idle,
                    is BranchesUiState.Loading -> {
                        CircularProgressIndicator(modifier = Modifier.size(32.dp))
                        Text(
                            "지점 목록을 불러오는 중...",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    is BranchesUiState.Error -> {
                        Text(
                            state.message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error,
                            textAlign = TextAlign.Center
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { viewModel.loadBranches() }) {
                                Text("다시 시도")
                            }
                            OutlinedButton(onClick = onNavigateToLogin) {
                                Text("로그아웃")
                            }
                        }
                    }

                    is BranchesUiState.Loaded -> {
                        if (state.branches.isEmpty()) {
                            Text(
                                "접근 가능한 지점이 없습니다.\n관리자에게 지점 접근 권한을 요청해주세요.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = TextAlign.Center
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { viewModel.loadBranches() }) {
                                    Text("새로고침")
                                }
                                OutlinedButton(onClick = onNavigateToLogin) {
                                    Text("로그아웃")
                                }
                            }
                        } else {
                            val isSelecting = authState is AuthState.Loading

                            LazyColumn(
                                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                items(state.branches) { org ->
                                    Card(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable(enabled = !isSelecting) { viewModel.selectBranch(org.id) }
                                            .testTag("auth-select-branch-item-${org.id}"),
                                        shape = RoundedCornerShape(DesignTokens.Radius.md.dp),
                                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(DesignTokens.Spacing.lg.dp).fillMaxWidth(),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.SpaceBetween
                                        ) {
                                            Column(modifier = Modifier.weight(1f)) {
                                                Text(org.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                                                val roleLabel = when (org.role) {
                                                    "owner" -> "소유자"
                                                    "admin" -> "관리자"
                                                    else -> "사용자"
                                                }
                                                Text(roleLabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            }
                                            if (isSelecting) {
                                                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                                            } else {
                                                Icon(Icons.Default.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (authState is AuthState.Error) {
                    Text(
                        (authState as AuthState.Error).message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center
                    )
                }
            }
        }
    }
}
