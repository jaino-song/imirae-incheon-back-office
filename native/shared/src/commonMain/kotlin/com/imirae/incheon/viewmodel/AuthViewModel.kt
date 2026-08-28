package com.imirae.incheon.viewmodel

import com.imirae.incheon.auth.AuthManager
import com.imirae.incheon.auth.AuthState
import com.imirae.incheon.auth.BranchesUiState
import com.imirae.incheon.domain.utils.Validation
import kotlinx.coroutines.flow.StateFlow

class AuthViewModel(private val authManager: AuthManager) {
    val authState: StateFlow<AuthState> = authManager.authState
    val branchesState: StateFlow<BranchesUiState> = authManager.branchesState

    fun login(email: String, password: String) {
        val e = Validation.validateEmail(email); if (!e.isValid) { return }
        val p = Validation.validateRequired(password, "비밀번호"); if (!p.isValid) { return }
        authManager.login(email, password)
    }
    fun register(name: String, email: String, password: String, phone: String?) {
        if (!Validation.validateName(name).isValid) return
        if (!Validation.validateEmail(email).isValid) return
        if (!Validation.validatePasswordStrength(password).isValid) return
        if (phone != null && !Validation.validateKoreanPhoneNumber(phone).isValid) return
        authManager.register(name, email, password, phone)
    }
    fun logout() = authManager.logout()
    fun restoreSession() = authManager.restoreSession()
    fun forgotPassword(email: String) { if (Validation.validateEmail(email).isValid) authManager.forgotPassword(email) }
    fun resetPassword(token: String, password: String) { if (Validation.validatePasswordStrength(password).isValid) authManager.resetPassword(token, password) }
    fun selectBranch(branchId: String) { if (branchId.isNotBlank()) authManager.selectBranch(branchId) }
    fun loadBranches() = authManager.loadBranches()
}
