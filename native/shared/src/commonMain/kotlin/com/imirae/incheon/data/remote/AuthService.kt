package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*
import io.ktor.client.request.*

interface AuthService {
    suspend fun login(email: String, password: String): ApiResult<LoginResponse>
    suspend fun register(name: String, email: String, password: String, phone: String, birthDate: String): ApiResult<RegisterResponse>
    suspend fun forgotPassword(email: String): ApiResult<Unit>
    suspend fun resetPassword(token: String, newPassword: String): ApiResult<Unit>
    suspend fun refreshToken(refreshToken: String): ApiResult<TokenRefreshResponse>
    suspend fun verifyEmail(token: String): ApiResult<VerifyEmailResponse>
    suspend fun getProfile(): ApiResult<UserProfile>
    suspend fun getBranches(): ApiResult<BranchesResponse>
    suspend fun selectBranch(branchId: String): ApiResult<SelectBranchResponse>
}

class AuthServiceImpl(private val client: ApiClient) : AuthService {
    override suspend fun login(email: String, password: String) = client.post<LoginResponse>("/auth/login", retryOnUnauthorized = false) { setBody(LoginRequest(email, password)) }
    override suspend fun register(name: String, email: String, password: String, phone: String, birthDate: String) =
        client.post<RegisterResponse>("/auth/register", retryOnUnauthorized = false) {
            setBody(RegisterRequest(email, password, name, phone, birthDate))
        }
    override suspend fun forgotPassword(email: String) = client.post<Unit>("/auth/forgot-password", retryOnUnauthorized = false) { setBody(ForgotPasswordRequest(email)) }
    override suspend fun resetPassword(token: String, newPassword: String) = client.post<Unit>("/auth/reset-password", retryOnUnauthorized = false) { setBody(ResetPasswordRequest(token, newPassword)) }
    override suspend fun refreshToken(refreshToken: String) = client.post<TokenRefreshResponse>("/auth/refresh-token", retryOnUnauthorized = false) { setBody(TokenRefreshRequest(refreshToken)) }
    override suspend fun verifyEmail(token: String) = client.post<VerifyEmailResponse>("/auth/verify-email", retryOnUnauthorized = false) { setBody(VerifyEmailRequest(token)) }
    override suspend fun getProfile() = client.get<UserProfile>("/auth/me")
    override suspend fun getBranches() = client.get<BranchesResponse>("/auth/branches")
    override suspend fun selectBranch(branchId: String) = client.post<SelectBranchResponse>("/auth/select-branch") { setBody(SelectBranchRequest(branchId)) }
}
