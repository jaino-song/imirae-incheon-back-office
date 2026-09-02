package com.imirae.incheon.ui.contracts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.viewmodel.ContractListViewModel

@Composable
fun ContractCreationScreen(
    viewModel: ContractListViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(DesignTokens.Spacing.lg.dp)
            .testTag("contract-creation-screen"),
        verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp),
    ) {
        IconButton(onClick = onNavigateBack, modifier = Modifier.testTag("contract-creation-back")) {
            Icon(Icons.Default.ArrowBack, contentDescription = "뒤로")
        }
        Text(
            text = "계약 생성",
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.testTag("contract-creation-title"),
        )
        Text(
            text = "계약 문서 업로드는 아직 지원되지 않습니다. 문서 목록과 수정·삭제는 사용할 수 있습니다.",
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}
