package com.imirae.incheon.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.models.UserSettings
import com.imirae.incheon.ui.components.ErrorScreen
import com.imirae.incheon.ui.components.LoadingScreen
import com.imirae.incheon.viewmodel.SettingsViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    onNavigateToVoucherPrices: () -> Unit,
    onLogout: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    var notificationsEnabled by rememberSaveable { mutableStateOf(true) }
    var language by rememberSaveable { mutableStateOf("ko") }
    var theme by rememberSaveable { mutableStateOf("system") }

    LaunchedEffect(Unit) {
        viewModel.loadSettings()
    }

    LaunchedEffect(uiState.settings) {
        val currentSettings = uiState.settings ?: return@LaunchedEffect
        notificationsEnabled = currentSettings.notifications
        language = currentSettings.language
        theme = currentSettings.theme
    }

    Scaffold(
        modifier = modifier.fillMaxSize().testTag("settings-screen"),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "설정",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.testTag("settings-title")
                    )
                },
                actions = {
                    IconButton(
                        onClick = { viewModel.refresh() },
                        modifier = Modifier.testTag("settings-refresh-button")
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "설정 새로고침")
                    }
                }
            )
        }
    ) { innerPadding ->
        when {
            uiState.isLoading && uiState.settings == null -> {
                LoadingScreen(modifier = Modifier.padding(innerPadding))
            }

            uiState.error != null && uiState.settings == null -> {
                ErrorScreen(
                    message = uiState.error ?: "설정을 불러오지 못했습니다",
                    onRetry = { viewModel.refresh() },
                    modifier = Modifier.padding(innerPadding)
                )
            }

            else -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .verticalScroll(rememberScrollState())
                        .padding(DesignTokens.Spacing.lg.dp)
                        .testTag("settings-content"),
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)
                ) {
                    SettingsToggleCard(
                        iconTag = "settings-notifications-icon",
                        title = "알림",
                        subtitle = "푸시 알림 수신을 설정합니다",
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Notifications,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary
                            )
                        },
                        trailingControl = {
                            Switch(
                                checked = notificationsEnabled,
                                onCheckedChange = { notificationsEnabled = it },
                                modifier = Modifier.testTag("settings-notifications-switch")
                            )
                        }
                    )

                    SettingsSelectionCard(
                        title = "언어",
                        subtitle = "현재 백엔드 미지원 · 이 기기에서만 적용됩니다",
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Language,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.testTag("settings-language-icon")
                            )
                        },
                        options = listOf("ko" to "한국어", "en" to "English"),
                        selectedValue = language,
                        onSelect = { language = it },
                        optionTagPrefix = "settings-language-option",
                        enabled = false,
                    )

                    SettingsSelectionCard(
                        title = "테마",
                        subtitle = "현재 백엔드 미지원 · 이 기기에서만 적용됩니다",
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Palette,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.testTag("settings-theme-icon")
                            )
                        },
                        options = listOf("light" to "라이트", "dark" to "다크", "system" to "시스템"),
                        selectedValue = theme,
                        onSelect = { theme = it },
                        optionTagPrefix = "settings-theme-option",
                        enabled = false,
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
                    ) {
                        Button(
                            onClick = {
                                viewModel.updateSettings(
                                    UserSettings(
                                        notifications = notificationsEnabled,
                                        language = language,
                                        theme = theme
                                    )
                                )
                            },
                            enabled = !uiState.isSaving,
                            modifier = Modifier
                                .weight(1f)
                                .height(DesignTokens.Spacing.xxxl.dp)
                                .testTag("settings-save-button"),
                            shape = RoundedCornerShape(DesignTokens.Radius.md)
                        ) {
                            Icon(Icons.Default.Save, contentDescription = null)
                            Text(
                                text = "저장",
                                modifier = Modifier.padding(start = DesignTokens.Spacing.xs.dp)
                            )
                        }

                        Button(
                            onClick = onNavigateToVoucherPrices,
                            modifier = Modifier
                                .weight(1f)
                                .height(DesignTokens.Spacing.xxxl.dp)
                                .testTag("settings-voucher-prices-button"),
                            shape = RoundedCornerShape(DesignTokens.Radius.md)
                        ) {
                            Icon(Icons.Default.AttachMoney, contentDescription = null)
                            Text(
                                text = "바우처",
                                modifier = Modifier.padding(start = DesignTokens.Spacing.xs.dp)
                            )
                        }
                    }

                    OutlinedButton(
                        onClick = onLogout,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(DesignTokens.Spacing.xxxl.dp)
                            .testTag("settings-logout-button"),
                        shape = RoundedCornerShape(DesignTokens.Radius.md)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Logout,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error
                        )
                        Text(
                            text = "로그아웃",
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(start = DesignTokens.Spacing.xs.dp)
                        )
                    }

                    if (uiState.saveSuccess) {
                        Text(
                            text = "설정이 저장되었습니다",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.testTag("settings-save-success")
                        )
                    }

                    if (uiState.error != null) {
                        Text(
                            text = uiState.error ?: "오류가 발생했습니다",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.testTag("settings-inline-error")
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsToggleCard(
    iconTag: String,
    title: String,
    subtitle: String,
    leadingIcon: @Composable () -> Unit,
    trailingControl: @Composable () -> Unit
) {
    Card(
        shape = RoundedCornerShape(DesignTokens.Radius.md),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(DesignTokens.Spacing.lg.dp),
            horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(modifier = Modifier.testTag(iconTag)) {
                leadingIcon()
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            trailingControl()
        }
    }
}

@Composable
private fun SettingsSelectionCard(
    title: String,
    subtitle: String,
    leadingIcon: @Composable () -> Unit,
    options: List<Pair<String, String>>,
    selectedValue: String,
    onSelect: (String) -> Unit,
    optionTagPrefix: String,
    enabled: Boolean = true,
) {
    Card(
        shape = RoundedCornerShape(DesignTokens.Radius.md),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(DesignTokens.Spacing.lg.dp),
            verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                leadingIcon()
                Column {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm.dp)
            ) {
                options.forEach { (value, label) ->
                    FilterChip(
                        selected = value == selectedValue,
                        onClick = { onSelect(value) },
                        enabled = enabled,
                        label = { Text(label) },
                        modifier = Modifier.testTag("$optionTagPrefix-$value")
                    )
                }
            }
        }
    }
}
