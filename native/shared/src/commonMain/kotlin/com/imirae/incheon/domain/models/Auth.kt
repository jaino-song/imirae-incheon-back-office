package com.imirae.incheon.domain.models
import kotlinx.serialization.Serializable
@Serializable data class LoginRequest(val email: String, val password: String)
@Serializable data class LoginResponse(val accessToken: String, val refreshToken: String, val requiresBranchSelection: Boolean = false)
/**
 * Payload for the backend's RegisterDto.  Phone and birthDate are required by
 * the server; keeping them non-null here prevents either native client from
 * silently sending a contract-invalid registration request.
 */
@Serializable data class RegisterRequest(
    val email: String,
    val password: String,
    val name: String,
    val phone: String,
    val birthDate: String,
)
@Serializable data class RegisterResponse(val success: Boolean, val message: String? = null, val code: String? = null)
@Serializable data class ForgotPasswordRequest(val email: String)
@Serializable data class ResetPasswordRequest(val token: String, val newPassword: String)
@Serializable data class TokenRefreshRequest(val refreshToken: String)
@Serializable data class VerifyEmailRequest(val token: String)
@Serializable data class TokenRefreshResponse(val accessToken: String, val refreshToken: String)
@Serializable data class VerifyEmailResponse(val success: Boolean, val message: String? = null)
@Serializable data class UserProfile(val id: String, val name: String, val email: String, val role: String, val phone: String? = null, val profileImage: String? = null, val branchName: String? = null)
@Serializable data class Branch(val id: String, val name: String, val slug: String? = null, val description: String? = null, val role: String? = null)
@Serializable data class BranchesResponse(val branches: List<Branch> = emptyList())
@Serializable data class SelectBranchRequest(val branchId: String)
@Serializable data class SelectBranchResponse(val accessToken: String, val refreshToken: String? = null)
