package com.imirae.incheon.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.imirae.incheon.auth.AuthState
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.utils.Validation
import com.imirae.incheon.viewmodel.AuthViewModel

@Composable
fun RegisterScreen(
    viewModel: AuthViewModel,
    onNavigateToLogin: () -> Unit,
    onRegistrationSuccess: () -> Unit,
    modifier: Modifier = Modifier
) {
    val authState by viewModel.authState.collectAsState()
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var birthDate by remember { mutableStateOf("") }
    var nameError by remember { mutableStateOf<String?>(null) }
    var emailError by remember { mutableStateOf<String?>(null) }
    var passwordError by remember { mutableStateOf<String?>(null) }
    var confirmPasswordError by remember { mutableStateOf<String?>(null) }
    var phoneError by remember { mutableStateOf<String?>(null) }
    var birthDateError by remember { mutableStateOf<String?>(null) }
    var passwordVisible by remember { mutableStateOf(false) }
    var isSuccess by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val isLoading = authState is AuthState.Loading

    // Password strength indicators
    val hasMinLength = password.length >= 8
    val hasUpperCase = password.any { it.isUpperCase() }
    val hasLowerCase = password.any { it.isLowerCase() }
    val hasDigit = password.any { it.isDigit() }
    val hasSpecial = password.any { !it.isLetterOrDigit() }

    LaunchedEffect(authState) {
        if (authState is AuthState.Unauthenticated && isSuccess) {
            // Registration succeeded, stay on success screen
        }
    }

    fun validateAndSubmit() {
        val nameResult = Validation.validateName(name)
        val emailResult = Validation.validateEmail(email)
        val passwordResult = Validation.validatePasswordStrength(password)
        val phoneResult = Validation.validateKoreanPhoneNumber(phone)
        val birthDateResult = Validation.validateBirthDate(birthDate)
        nameError = nameResult.errorMessage
        emailError = emailResult.errorMessage
        passwordError = passwordResult.errorMessage
        phoneError = phoneResult.errorMessage
        birthDateError = birthDateResult.errorMessage
        confirmPasswordError = if (password != confirmPassword) "비밀번호가 일치하지 않습니다" else null
        if (nameResult.isValid && emailResult.isValid && passwordResult.isValid && phoneResult.isValid && birthDateResult.isValid && confirmPasswordError == null) {
            viewModel.register(name, email, password, phone, birthDate)
            isSuccess = true
        }
    }

    // Success state
    if (isSuccess && authState is AuthState.Unauthenticated) {
        Box(
            modifier = modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
            contentAlignment = Alignment.Center
        ) {
            Card(
                modifier = Modifier.widthIn(max = 400.dp).padding(DesignTokens.Spacing.lg.dp),
                shape = RoundedCornerShape(DesignTokens.Radius.lg.dp)
            ) {
                Column(
                    modifier = Modifier.padding(DesignTokens.Spacing.xl.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.lg.dp)
                ) {
                    Icon(
                        Icons.Default.CheckCircle,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(64.dp)
                    )
                    Text("회원가입 완료!", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "인증 이메일이 발송되었습니다.\n이메일을 확인하여 계정을 활성화해 주세요.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )
                    Button(
                        onClick = onNavigateToLogin,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                    ) {
                        Text("로그인 페이지로 이동", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        return
    }

    Box(
        modifier = modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier.widthIn(max = 400.dp).padding(DesignTokens.Spacing.lg.dp).testTag("auth-register-card"),
            shape = RoundedCornerShape(DesignTokens.Radius.lg.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()).padding(DesignTokens.Spacing.xl.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)
            ) {
                Text("회원가입", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.testTag("auth-register-title"))

                if (authState is AuthState.Error) {
                    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(DesignTokens.Radius.md.dp), modifier = Modifier.fillMaxWidth()) {
                        Text((authState as AuthState.Error).message, color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(DesignTokens.Spacing.md.dp))
                    }
                }

                // Name
                OutlinedTextField(
                    value = name, onValueChange = { name = it; nameError = null },
                    label = { Text("이름") }, leadingIcon = { Icon(Icons.Default.Person, null) },
                    isError = nameError != null, supportingText = nameError?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                    singleLine = true, enabled = !isLoading,
                    modifier = Modifier.fillMaxWidth().testTag("auth-register-name-field"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                )

                // Email
                OutlinedTextField(
                    value = email, onValueChange = { email = it; emailError = null },
                    label = { Text("이메일") }, leadingIcon = { Icon(Icons.Default.Email, null) },
                    isError = emailError != null, supportingText = emailError?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                    singleLine = true, enabled = !isLoading,
                    modifier = Modifier.fillMaxWidth().testTag("auth-register-email-field"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                )

                // Password
                OutlinedTextField(
                    value = password, onValueChange = { password = it; passwordError = null },
                    label = { Text("비밀번호") }, leadingIcon = { Icon(Icons.Default.Lock, null) },
                    trailingIcon = {
                        IconButton(onClick = { passwordVisible = !passwordVisible }) {
                            Icon(if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility, null)
                        }
                    },
                    visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    isError = passwordError != null, supportingText = passwordError?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                    singleLine = true, enabled = !isLoading,
                    modifier = Modifier.fillMaxWidth().testTag("auth-register-password-field"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                )

                // Password requirements
                if (password.isNotEmpty()) {
                    Column(modifier = Modifier.fillMaxWidth().padding(start = DesignTokens.Spacing.sm.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        PasswordRequirementRow("8자 이상", hasMinLength)
                        PasswordRequirementRow("대문자 포함", hasUpperCase)
                        PasswordRequirementRow("소문자 포함", hasLowerCase)
                        PasswordRequirementRow("숫자 포함", hasDigit)
                        PasswordRequirementRow("특수문자 포함", hasSpecial)
                    }
                }

                // Confirm password
                OutlinedTextField(
                    value = confirmPassword, onValueChange = { confirmPassword = it; confirmPasswordError = null },
                    label = { Text("비밀번호 확인") }, leadingIcon = { Icon(Icons.Default.Lock, null) },
                    visualTransformation = PasswordVisualTransformation(),
                    isError = confirmPasswordError != null, supportingText = confirmPasswordError?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                    singleLine = true, enabled = !isLoading,
                    modifier = Modifier.fillMaxWidth().testTag("auth-register-confirm-password-field"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                )

                // Phone (required by the backend RegisterDto)
                OutlinedTextField(
                    value = phone, onValueChange = { phone = it; phoneError = null },
                    label = { Text("전화번호") }, leadingIcon = { Icon(Icons.Default.Phone, null) },
                    isError = phoneError != null, supportingText = phoneError?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus(); validateAndSubmit() }),
                    singleLine = true, enabled = !isLoading, placeholder = { Text("010-XXXX-XXXX") },
                    modifier = Modifier.fillMaxWidth().testTag("auth-register-phone-field"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                )

                // Birth date (required by the backend RegisterDto)
                OutlinedTextField(
                    value = birthDate, onValueChange = { birthDate = it; birthDateError = null },
                    label = { Text("생년월일") }, leadingIcon = { Icon(Icons.Default.CalendarToday, null) },
                    isError = birthDateError != null, supportingText = birthDateError?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus(); validateAndSubmit() }),
                    singleLine = true, enabled = !isLoading, placeholder = { Text("YYYY-MM-DD") },
                    modifier = Modifier.fillMaxWidth().testTag("auth-register-birth-date-field"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                )

                Spacer(modifier = Modifier.height(DesignTokens.Spacing.sm.dp))

                Button(
                    onClick = { validateAndSubmit() }, enabled = !isLoading,
                    modifier = Modifier.fillMaxWidth().height(48.dp).testTag("auth-register-submit-button"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                ) {
                    if (isLoading) CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                    else Text("회원가입", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    Text("이미 계정이 있으신가요? ", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("로그인", style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.clickable(enabled = !isLoading) { onNavigateToLogin() }.testTag("auth-register-login-link"))
                }
            }
        }
    }
}

@Composable
private fun PasswordRequirementRow(text: String, met: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.xs.dp)) {
        Icon(
            if (met) Icons.Default.CheckCircle else Icons.Default.Cancel,
            contentDescription = null,
            tint = if (met) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp)
        )
        Text(text, style = MaterialTheme.typography.bodySmall, color = if (met) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
