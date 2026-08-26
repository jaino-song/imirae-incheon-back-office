package com.imirae.incheon.auth

import com.imirae.incheon.data.remote.AuthService
import com.imirae.incheon.domain.models.Branch
import com.imirae.incheon.network.ApiResult
import com.imirae.incheon.network.TokenProvider
import com.imirae.incheon.network.platformEngine
import io.ktor.client.HttpClient
import io.ktor.client.plugins.*
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json

sealed class BranchesUiState {
    data object Idle : BranchesUiState()
    data object Loading : BranchesUiState()
    data class Loaded(val branches: List<Branch>) : BranchesUiState()
    data class Error(val message: String) : BranchesUiState()
}

class AuthManager(
    private val authService: AuthService,
    private val secureStorage: SecureStorage,
    private val apiBaseUrl: String,
) : TokenProvider {
    private val sessionPolicy = SessionPolicy(secureStorage)
    private val stepUpAuth = StepUpAuth(secureStorage)
    private val _authState = MutableStateFlow<AuthState>(AuthState.Initial)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()
    private val _branchesState = MutableStateFlow<BranchesUiState>(BranchesUiState.Idle)
    val branchesState: StateFlow<BranchesUiState> = _branchesState.asStateFlow()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val refreshMutex = Mutex()
    private var refreshInFlight: Deferred<String?>? = null
    private val authJson = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }
    private val sessionHttpClient = HttpClient(platformEngine()) {
        install(ContentNegotiation) { json(authJson) }
    }

    override suspend fun getAccessToken(): String? {
        val accessToken = secureStorage.getString(accessTokenKey)
        if (accessToken != null) {
            sessionPolicy.updateActivity()
        }
        return accessToken
    }

    override suspend fun refreshToken(): String? {
        val inFlight = refreshMutex.withLock {
            refreshInFlight?.takeIf { it.isActive } ?: scope.async {
                performRefreshToken()
            }.also {
                refreshInFlight = it
            }
        }

        return try {
            inFlight.await()
        } finally {
            refreshMutex.withLock {
                if (refreshInFlight === inFlight) {
                    refreshInFlight = null
                }
            }
        }
    }

    fun login(email: String, password: String) {
        scope.launch {
            _authState.value = AuthState.Loading
            updateActivity()
            when (val result = authService.login(email, password)) {
                is ApiResult.Success -> {
                    persistTokens(result.data.accessToken, result.data.refreshToken)
                    runCatching {
                        val deviceId = sessionPolicy.getOrCreateDeviceId()
                        registerDeviceWithBackend(result.data.accessToken, deviceId)
                    }

                    if (result.data.requiresBranchSelection) {
                        _authState.value = AuthState.RequiresBranchSelection
                    } else {
                        loadProfile()
                    }
                }

                is ApiResult.Error -> _authState.value = AuthState.Error(result.error.userMessage())
            }
        }
    }

    fun register(name: String, email: String, password: String, phone: String?) {
        scope.launch {
            _authState.value = AuthState.Loading
            updateActivity()
            when (val result = authService.register(name, email, password, phone)) {
                is ApiResult.Success -> _authState.value = AuthState.Unauthenticated
                is ApiResult.Error -> _authState.value = AuthState.Error(result.error.userMessage())
            }
        }
    }

    fun logout() {
        scope.launch {
            forceLogout(revokeRemote = true)
        }
    }

    fun forgotPassword(email: String) {
        scope.launch {
            _authState.value = AuthState.Loading
            updateActivity()
            authService.forgotPassword(email)
            _authState.value = AuthState.Unauthenticated
        }
    }

    fun resetPassword(token: String, password: String) {
        scope.launch {
            _authState.value = AuthState.Loading
            updateActivity()
            when (val result = authService.resetPassword(token, password)) {
                is ApiResult.Success -> _authState.value = AuthState.Unauthenticated
                is ApiResult.Error -> _authState.value = AuthState.Error(result.error.userMessage())
            }
        }
    }

    fun selectBranch(branchId: String) {
        scope.launch {
            _authState.value = AuthState.Loading
            updateActivity()
            when (val result = authService.selectBranch(branchId)) {
                is ApiResult.Success -> {
                    persistTokens(result.data.accessToken, result.data.refreshToken ?: secureStorage.getString(refreshTokenKey).orEmpty())
                    loadProfile()
                }
                is ApiResult.Error -> _authState.value = AuthState.Error(result.error.userMessage())
            }
        }
    }

    fun loadBranches() {
        scope.launch {
            _branchesState.value = BranchesUiState.Loading
            when (val result = authService.getBranches()) {
                is ApiResult.Success -> {
                    _branchesState.value = BranchesUiState.Loaded(result.data.branches)
                }
                is ApiResult.Error -> {
                    _branchesState.value = BranchesUiState.Error(result.error.userMessage())
                }
            }
        }
    }

    fun onAppResume() {
        scope.launch {
            checkSessionOnResume()
        }
    }

    fun updateActivity() {
        sessionPolicy.updateActivity()
    }

    fun requiresStepUp(operation: SensitiveOperation): Boolean = stepUpAuth.requiresStepUp(operation)

    fun confirmStepUp() {
        stepUpAuth.confirmStepUp()
    }

    fun restoreSession() {
        scope.launch {
            val canContinue = checkSessionOnResume()
            if (!canContinue) {
                _authState.value = AuthState.Unauthenticated
                return@launch
            }

            loadProfile()
        }
    }

    private suspend fun loadProfile() {
        updateActivity()
        when (val result = authService.getProfile()) {
            is ApiResult.Success -> {
                _authState.value = AuthState.Authenticated(
                    result.data.id,
                    result.data.role,
                    result.data.branchName
                )
                updateActivity()
            }

            is ApiResult.Error -> {
                clearLocalSession()
                _authState.value = AuthState.Unauthenticated
            }
        }
    }

    private suspend fun performRefreshToken(): String? {
        val refreshToken = secureStorage.getString(refreshTokenKey) ?: return null
        sessionPolicy.ensureRefreshTokenTracked(refreshToken)
        if (!sessionPolicy.canUseRefreshToken(refreshToken)) {
            forceLogout(revokeRemote = false)
            return null
        }

        updateActivity()
        return when (val result = authService.refreshToken(refreshToken)) {
            is ApiResult.Success -> {
                val rotated = sessionPolicy.rotateRefreshToken(refreshToken, result.data.refreshToken)
                if (!rotated) {
                    forceLogout(revokeRemote = true)
                    null
                } else {
                    persistTokens(result.data.accessToken, result.data.refreshToken)
                    updateActivity()
                    result.data.accessToken
                }
            }

            is ApiResult.Error -> {
                forceLogout(revokeRemote = true)
                null
            }
        }
    }

    private suspend fun checkSessionOnResume(): Boolean {
        when (sessionPolicy.checkSession()) {
            SessionAction.Continue -> Unit
            SessionAction.RefreshToken -> {
                if (refreshToken() == null) {
                    return false
                }
            }

            SessionAction.ForceReAuth -> {
                forceLogout(revokeRemote = true)
                return false
            }
        }

        val accessToken = secureStorage.getString(accessTokenKey) ?: return false
        val expired = try {
            isAccessTokenExpired(accessToken)
        } catch (_: Exception) {
            forceLogout(revokeRemote = true)
            return false
        }

        if (!expired) {
            updateActivity()
            return true
        }

        return refreshToken() != null
    }

    private fun isAccessTokenExpired(accessToken: String): Boolean {
        val expClaim = parseTokenExpiryClaim(accessToken) ?: return false
        val nowEpochSeconds = currentTimeMillis() / 1000L
        return expClaim <= nowEpochSeconds
    }

    private fun parseTokenExpiryClaim(token: String): Long? {
        val tokenParts = token.split('.')
        require(tokenParts.size >= 2) { "Invalid JWT format" }
        val payload = decodeBase64Url(tokenParts[1])
        val expMatch = expClaimRegex.find(payload) ?: return null
        return expMatch.groupValues.getOrNull(1)?.toLongOrNull()
    }

    private fun decodeBase64Url(value: String): String {
        if (value.isBlank()) {
            throw IllegalArgumentException("Token payload is empty")
        }

        var buffer = 0
        var bitsInBuffer = 0
        val output = ArrayList<Byte>(value.length)

        for (character in value) {
            if (character == '=') {
                break
            }

            val decoded = base64UrlValue(character)
            buffer = (buffer shl 6) or decoded
            bitsInBuffer += 6

            while (bitsInBuffer >= 8) {
                bitsInBuffer -= 8
                output.add(((buffer shr bitsInBuffer) and 0xFF).toByte())
            }
        }

        if (output.isEmpty()) {
            throw IllegalArgumentException("Token payload is invalid")
        }

        return output.toByteArray().decodeToString()
    }

    private fun base64UrlValue(character: Char): Int = when (character) {
        in 'A'..'Z' -> character.code - 'A'.code
        in 'a'..'z' -> character.code - 'a'.code + 26
        in '0'..'9' -> character.code - '0'.code + 52
        '-' -> 62
        '_' -> 63
        else -> throw IllegalArgumentException("Invalid base64url character")
    }

    private fun persistTokens(accessToken: String, refreshToken: String) {
        secureStorage.putString(accessTokenKey, accessToken)
        secureStorage.putString(refreshTokenKey, refreshToken)
        sessionPolicy.initializeRefreshToken(refreshToken)
        updateActivity()
    }

    private suspend fun registerDeviceWithBackend(accessToken: String, deviceId: String): Boolean {
        val payload = mapOf(
            "deviceId" to deviceId,
            "device_id" to deviceId,
        )

        for (endpoint in deviceRegistrationEndpoints) {
            val isSuccess = runCatching {
                val response = sessionHttpClient.post("$authBaseUrl$endpoint") {
                    header(HttpHeaders.Authorization, "Bearer $accessToken")
                    contentType(ContentType.Application.Json)
                    setBody(payload)
                }
                response.status.isSuccess()
            }.getOrDefault(false)

            if (isSuccess) {
                return true
            }
        }

        return false
    }

    private suspend fun revokeSessionOnBackend(accessToken: String?, refreshToken: String?, deviceId: String?) {
        if (accessToken == null && refreshToken == null) {
            return
        }

        val payload = buildMap {
            if (refreshToken != null) {
                put("refreshToken", refreshToken)
                put("refresh_token", refreshToken)
            }
            if (deviceId != null) {
                put("deviceId", deviceId)
                put("device_id", deviceId)
            }
        }

        for (endpoint in logoutEndpoints) {
            val handled = runCatching {
                val response = sessionHttpClient.post("$authBaseUrl$endpoint") {
                    if (accessToken != null) {
                        header(HttpHeaders.Authorization, "Bearer $accessToken")
                    }
                    contentType(ContentType.Application.Json)
                    setBody(payload)
                }

                response.status.isSuccess() || response.status.value == 401 || response.status.value == 403
            }.getOrDefault(false)

            if (handled) {
                return
            }
        }
    }

    private suspend fun forceLogout(revokeRemote: Boolean = true) {
        val accessToken = secureStorage.getString(accessTokenKey)
        val refreshToken = secureStorage.getString(refreshTokenKey)
        val deviceId = sessionPolicy.getDeviceId()

        if (revokeRemote) {
            revokeSessionOnBackend(accessToken, refreshToken, deviceId)
        }

        clearLocalSession()
        _authState.value = AuthState.Unauthenticated
    }

    private fun clearLocalSession() {
        secureStorage.remove(accessTokenKey)
        secureStorage.remove(refreshTokenKey)
        sessionPolicy.clearSessionPolicyState()
        stepUpAuth.clearStepUp()
    }

    private val authBaseUrl: String get() = apiBaseUrl

    private companion object {
        const val accessTokenKey = "access_token"
        const val refreshTokenKey = "refresh_token"
        val expClaimRegex = "\"exp\"\\s*:\\s*(\\d+)".toRegex()
        val deviceRegistrationEndpoints = listOf(
            "/auth/devices/register",
            "/auth/device/register",
            "/auth/session/register-device",
        )
        val logoutEndpoints = listOf(
            "/auth/logout",
            "/auth/revoke",
            "/auth/revoke-session",
        )
    }
}
