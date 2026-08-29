package com.imirae.incheon.ui.auth

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.imirae.incheon.auth.AuthState
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.utils.Validation
import com.imirae.incheon.viewmodel.AuthViewModel

@Composable
fun LoginScreen(
    viewModel: AuthViewModel,
    onNavigateToRegister: () -> Unit,
    onNavigateToForgotPassword: () -> Unit,
    onNavigateToVerifyEmail: () -> Unit,
    onNavigateToDashboard: () -> Unit,
    onNavigateToSelectBranch: () -> Unit,
    modifier: Modifier = Modifier,
    shouldNavigateToDashboard: () -> Boolean = { true }
) {
    val authState by viewModel.authState.collectAsState()
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("login_prefs", Context.MODE_PRIVATE) }

    var rememberId by remember { mutableStateOf(prefs.getBoolean("rememberId", false)) }
    var autoLogin by remember { mutableStateOf(prefs.getBoolean("autoLogin", false)) }
    var email by remember { mutableStateOf(if (prefs.getBoolean("rememberId", false)) prefs.getString("savedEmail", "") ?: "" else "") }
    var password by remember { mutableStateOf("") }
    var emailError by remember { mutableStateOf<String?>(null) }
    var passwordError by remember { mutableStateOf<String?>(null) }
    var passwordVisible by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val isLoading = authState is AuthState.Loading

    LaunchedEffect(authState) {
        when (authState) {
            is AuthState.Authenticated -> {
                if (shouldNavigateToDashboard()) {
                    onNavigateToDashboard()
                }
            }
            is AuthState.RequiresBranchSelection -> onNavigateToSelectBranch()
            else -> {}
        }
    }

    fun saveLoginPreferences() {
        prefs.edit()
            .putBoolean("rememberId", rememberId)
            .putBoolean("autoLogin", autoLogin)
            .apply {
                if (rememberId) putString("savedEmail", email) else remove("savedEmail")
            }
            .apply()
    }

    fun validateAndSubmit() {
        val emailResult = Validation.validateEmail(email)
        val passwordResult = Validation.validateRequired(password, "비밀번호")
        emailError = emailResult.errorMessage
        passwordError = passwordResult.errorMessage
        if (emailResult.isValid && passwordResult.isValid) {
            saveLoginPreferences()
            viewModel.login(email, password)
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center
    ) {
        Card(
            modifier = Modifier
                .widthIn(max = 400.dp)
                .padding(DesignTokens.Spacing.lg.dp)
                .testTag("auth-login-card"),
            shape = RoundedCornerShape(DesignTokens.Radius.lg.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(DesignTokens.Spacing.xl.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.lg.dp)
            ) {
                // Title
                Text(
                    text = "로그인",
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.testTag("auth-login-title")
                )
                Text(
                    text = "이미래 인천 서비스에 로그인하세요",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // Error message
                if (authState is AuthState.Error) {
                    Surface(
                        color = MaterialTheme.colorScheme.errorContainer,
                        shape = RoundedCornerShape(DesignTokens.Radius.md.dp),
                        modifier = Modifier.fillMaxWidth().testTag("auth-login-error")
                    ) {
                        Text(
                            text = (authState as AuthState.Error).message,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(DesignTokens.Spacing.md.dp)
                        )
                    }
                }

                // Email field
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it; emailError = null },
                    label = { Text("이메일") },
                    leadingIcon = { Icon(Icons.Default.Email, contentDescription = null) },
                    isError = emailError != null,
                    supportingText = emailError?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                    singleLine = true,
                    enabled = !isLoading,
                    modifier = Modifier.fillMaxWidth().testTag("auth-login-email-field"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                )

                // Password field
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it; passwordError = null },
                    label = { Text("비밀번호") },
                    leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null) },
                    trailingIcon = {
                        IconButton(onClick = { passwordVisible = !passwordVisible }) {
                            Icon(
                                if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = if (passwordVisible) "비밀번호 숨기기" else "비밀번호 보기"
                            )
                        }
                    },
                    visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    isError = passwordError != null,
                    supportingText = passwordError?.let { { Text(it) } },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { focusManager.clearFocus(); validateAndSubmit() }),
                    singleLine = true,
                    enabled = !isLoading,
                    modifier = Modifier.fillMaxWidth().testTag("auth-login-password-field"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.xl.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clickable(enabled = !isLoading) { rememberId = !rememberId }
                            .testTag("auth-login-remember-id")
                    ) {
                        Checkbox(
                            checked = rememberId,
                            onCheckedChange = { rememberId = it },
                            enabled = !isLoading,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = "아이디 저장",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clickable(enabled = !isLoading) { autoLogin = !autoLogin }
                            .testTag("auth-login-auto-login")
                    ) {
                        Checkbox(
                            checked = autoLogin,
                            onCheckedChange = { autoLogin = it },
                            enabled = !isLoading,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = "자동 로그인",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Button(
                    onClick = { validateAndSubmit() },
                    enabled = !isLoading,
                    modifier = Modifier.fillMaxWidth().height(48.dp).testTag("auth-login-submit-button"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp)
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                    } else {
                        Text("로그인", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                }

                // Divider
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    HorizontalDivider(modifier = Modifier.weight(1f))
                    Text("또는", modifier = Modifier.padding(horizontal = DesignTokens.Spacing.sm.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    HorizontalDivider(modifier = Modifier.weight(1f))
                }

                // Kakao login button
                Button(
                    onClick = { /* TODO: Kakao OAuth */ },
                    enabled = !isLoading,
                    modifier = Modifier.fillMaxWidth().height(48.dp).testTag("auth-login-kakao-button"),
                    shape = RoundedCornerShape(DesignTokens.Radius.md.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(DesignTokens.Colors.kakao),
                        contentColor = Color(0xFF3C1E1E)
                    )
                ) {
                    Text("카카오로 로그인", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }

                // Forgot password link
                Text(
                    text = "비밀번호를 잊으셨나요?",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .align(Alignment.End)
                        .clickable(enabled = !isLoading) { onNavigateToForgotPassword() }
                        .testTag("auth-login-forgot-password-link")
                )

                // Register link
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center
                ) {
                    Text("계정이 없으신가요? ", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        text = "회원가입",
                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier
                            .clickable(enabled = !isLoading) { onNavigateToRegister() }
                            .testTag("auth-login-register-link")
                    )
                }
            }
        }
    }
}
