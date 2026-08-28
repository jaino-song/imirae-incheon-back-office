package com.imirae.incheon.ui.clients

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.models.CreateClientRequest
import com.imirae.incheon.ui.components.AppTextField
import com.imirae.incheon.viewmodel.ClientListViewModel

@Composable
fun ClientNewScreen(
    viewModel: ClientListViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var dueDate by remember { mutableStateOf("") }
    var voucherClient by remember { mutableStateOf(false) }
    var breastPump by remember { mutableStateOf(false) }
    var nameError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(uiState.createSuccess) { if (uiState.createSuccess) onNavigateBack() }

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(DesignTokens.Spacing.lg.dp).testTag("client-new-screen"),
        verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onNavigateBack, modifier = Modifier.testTag("client-new-back")) { Icon(Icons.Default.ArrowBack, "뒤로") }
            Text("고객 추가", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("client-new-title"))
        }

        Card(shape = RoundedCornerShape(DesignTokens.Radius.lg), elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)) {
            Column(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp), verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
                AppTextField(value = name, onValueChange = { name = it; nameError = null }, label = "이름 *", error = nameError, testTag = "client-new-name")
                AppTextField(value = phone, onValueChange = { phone = it }, label = "전화번호", keyboardType = KeyboardType.Phone, testTag = "client-new-phone")
                AppTextField(value = address, onValueChange = { address = it }, label = "주소", testTag = "client-new-address")
                AppTextField(value = dueDate, onValueChange = { dueDate = it }, label = "출산 예정일 (YYYY-MM-DD)", testTag = "client-new-due-date")
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text("바우처 고객", style = MaterialTheme.typography.bodyMedium)
                    Switch(checked = voucherClient, onCheckedChange = { voucherClient = it }, modifier = Modifier.testTag("client-new-voucher-client"))
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text("유축기", style = MaterialTheme.typography.bodyMedium)
                    Switch(checked = breastPump, onCheckedChange = { breastPump = it }, modifier = Modifier.testTag("client-new-breast-pump"))
                }
            }
        }

        Button(
            onClick = {
                if (name.isBlank()) { nameError = "이름을 입력해 주세요"; return@Button }
                viewModel.createClient(
                    CreateClientRequest(
                        name = name.trim(),
                        voucherClient = voucherClient,
                        breastPump = breastPump,
                        phone = phone.ifBlank { null },
                        address = address.ifBlank { null },
                        dueDate = dueDate.ifBlank { null },
                    ),
                )
            },
            enabled = !uiState.isCreating,
            modifier = Modifier.fillMaxWidth().height(48.dp).testTag("client-new-submit"),
            shape = RoundedCornerShape(DesignTokens.Radius.md)
        ) {
            if (uiState.isCreating) CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
            else Text("저장", fontWeight = FontWeight.SemiBold)
        }
    }
}
