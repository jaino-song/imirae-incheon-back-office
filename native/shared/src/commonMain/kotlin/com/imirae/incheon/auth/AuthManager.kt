package com.imirae.incheon.auth

import com.imirae.incheon.data.remote.AuthService
import com.imirae.incheon.domain.models.Branch
import com.imirae.incheon.network.ApiResult
import com.imirae.incheon.network.TokenProvider
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

sealed class BranchesUiState {
    data object Idle : BranchesUiState()
    data object Loading : BranchesUiState()
    data class Loaded(val branches: List<Branch>) : BranchesUiState()
    data class Error(val message: String) : BranchesUiState()
}

/** Result of the local logout transaction.  Local authority is always removed;
 * [remoteRevocationSucceeded] records whether the backend acknowledged the
 * revoke so callers can surface a recoverable warning without retaining a
 * usable local session. */
sealed class LogoutState {
    data object Idle : LogoutState()
    data object InProgress : LogoutState()
    data class Completed(val remoteRevocationSucceeded: Boolean) : LogoutState()
}

internal interface SessionRevoker {
    suspend fun revoke(accessToken: String?, refreshToken: String?, deviceId: String?): Boolean
}

class AuthManager private constructor(
    private val authService: AuthService,
    private val secureStorage: AuthStorage,
    private val sessionRevoker: SessionRevoker,
    private val scope: CoroutineScope,
) : TokenProvider {
    /** Public KMP boundary retained for Android/iOS dependency injection. */
    constructor(
        authService: AuthService,
        secureStorage: SecureStorage,
        apiBaseUrl: String,
    ) : this(
        authService = authService,
        secureStorage = SecureStorageAdapter(secureStorage),
        sessionRevoker = HttpSessionRevoker(apiBaseUrl),
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    )

    /** Deterministic constructor for shared lifecycle contract tests. */
    internal constructor(
        authService: AuthService,
        secureStorage: AuthStorage,
        sessionRevoker: SessionRevoker,
        scope: CoroutineScope,
        @Suppress("UNUSED_PARAMETER") testOnly: Unit = Unit,
    ) : this(authService, secureStorage, sessionRevoker, scope)

    private val sessionPolicy = SessionPolicy(secureStorage)
    private val stepUpAuth = StepUpAuth(secureStorage)
    private val _authState = MutableStateFlow<AuthState>(AuthState.Initial)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()
    private val _branchesState = MutableStateFlow<BranchesUiState>(BranchesUiState.Idle)
    val branchesState: StateFlow<BranchesUiState> = _branchesState.asStateFlow()
    private val _logoutState = MutableStateFlow<LogoutState>(LogoutState.Idle)
    val logoutState: StateFlow<LogoutState> = _logoutState.asStateFlow()
    private val refreshMutex = Mutex()
    private val lifecycleMutex = Mutex()
    private val logoutMutex = Mutex()
    private val sessionOperationMutex = Mutex()
    private var sessionEpoch = 0L
    private var refreshInFlight: Deferred<String?>? = null

    override suspend fun getAccessToken(): String? {
        return sessionOperationMutex.withLock {
            val accessToken = secureStorage.getString(accessTokenKey)
            if (accessToken != null) {
                sessionPolicy.updateActivity()
            }
            accessToken
        }
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
            val operationEpoch = currentSessionEpoch()
            _authState.value = AuthState.Loading
            updateActivity()
            when (val result = authService.login(email, password)) {
                is ApiResult.Success -> {
                    if (!persistTokensIfCurrent(operationEpoch, result.data.accessToken, result.data.refreshToken)) {
                        return@launch
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

    fun register(name: String, email: String, password: String, phone: String, birthDate: String) {
        scope.launch {
            _authState.value = AuthState.Loading
            updateActivity()
            when (val result = authService.register(name, email, password, phone, birthDate)) {
                is ApiResult.Success -> _authState.value = AuthState.Unauthenticated
                is ApiResult.Error -> _authState.value = AuthState.Error(result.error.userMessage())
            }
        }
    }

    fun logout() {
        scope.launch {
            logoutMutex.withLock {
                _logoutState.value = LogoutState.InProgress
                val remoteRevocationSucceeded = runCatching {
                    withContext(NonCancellable) {
                        forceLogout(revokeRemote = true)
                    }
                }.getOrDefault(false)
                _logoutState.value = LogoutState.Completed(remoteRevocationSucceeded)
            }
        }
    }

    /** Suspended variant used by deterministic lifecycle tests and hosts that
     * already own a coroutine. Navigation should still be driven by the
     * published unauthenticated state after this transaction completes. */
    suspend fun logoutAndAwait(): LogoutState = logoutMutex.withLock {
        _logoutState.value = LogoutState.InProgress
        val remoteRevocationSucceeded = runCatching {
            withContext(NonCancellable) {
                forceLogout(revokeRemote = true)
            }
        }.getOrDefault(false)
        LogoutState.Completed(remoteRevocationSucceeded).also { _logoutState.value = it }
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
            val operationEpoch = currentSessionEpoch()
            _authState.value = AuthState.Loading
            updateActivity()
            when (val result = authService.selectBranch(branchId)) {
                is ApiResult.Success -> {
                    val refreshToken = result.data.refreshToken ?: secureStorage.getString(refreshTokenKey).orEmpty()
                    if (!persistTokensIfCurrent(operationEpoch, result.data.accessToken, refreshToken)) {
                        return@launch
                    }
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
            lifecycleMutex.withLock {
                val canContinue = checkSessionOnResume()
                if (!canContinue) {
                    _authState.value = AuthState.Unauthenticated
                    return@withLock
                }

                if (_authState.value is AuthState.Initial ||
                    _authState.value is AuthState.Loading ||
                    _authState.value is AuthState.Unauthenticated
                ) {
                    loadProfile()
                }
            }
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
            lifecycleMutex.withLock {
                val canContinue = checkSessionOnResume()
                if (!canContinue) {
                    _authState.value = AuthState.Unauthenticated
                    return@withLock
                }

                loadProfile()
            }
        }
    }

    private suspend fun loadProfile() {
        val operationEpoch = currentSessionEpoch()
        updateActivity()
        when (val result = authService.getProfile()) {
            is ApiResult.Success -> {
                sessionOperationMutex.withLock {
                    if (sessionEpoch != operationEpoch) {
                        return@withLock
                    }
                    _authState.value = AuthState.Authenticated(
                        result.data.id,
                        result.data.role,
                        result.data.branchName
                    )
                    updateActivity()
                }
            }

            is ApiResult.Error -> {
                clearSessionIfCurrent(operationEpoch)
            }
        }
    }

    private suspend fun performRefreshToken(): String? {
        val operationEpoch = currentSessionEpoch()
        val refreshToken = secureStorage.getString(refreshTokenKey) ?: run {
            forceLogout(revokeRemote = false)
            return null
        }
        val refreshTokenUsable = sessionOperationMutex.withLock {
            if (sessionEpoch != operationEpoch) {
                false
            } else {
                sessionPolicy.ensureRefreshTokenTracked(refreshToken)
                sessionPolicy.canUseRefreshToken(refreshToken)
            }
        }
        if (!refreshTokenUsable) {
            forceLogout(revokeRemote = false)
            return null
        }

        updateActivity()
        return when (val result = authService.refreshToken(refreshToken)) {
            is ApiResult.Success -> {
                when (commitRefreshIfCurrent(operationEpoch, refreshToken, result.data.accessToken, result.data.refreshToken)) {
                    RefreshCommit.Success -> result.data.accessToken
                    RefreshCommit.Stale -> null
                    RefreshCommit.Rejected -> {
                        forceLogout(revokeRemote = true)
                        null
                    }
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

        val accessToken = secureStorage.getString(accessTokenKey) ?: run {
            forceLogout(revokeRemote = false)
            return false
        }
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

    private suspend fun currentSessionEpoch(): Long = sessionOperationMutex.withLock { sessionEpoch }

    private suspend fun persistTokensIfCurrent(
        operationEpoch: Long,
        accessToken: String,
        refreshToken: String,
    ): Boolean = sessionOperationMutex.withLock {
        if (sessionEpoch != operationEpoch) {
            return@withLock false
        }
        persistTokens(accessToken, refreshToken)
        true
    }

    private suspend fun commitRefreshIfCurrent(
        operationEpoch: Long,
        usedRefreshToken: String,
        accessToken: String,
        refreshToken: String,
    ): RefreshCommit = sessionOperationMutex.withLock {
        if (sessionEpoch != operationEpoch) {
            return@withLock RefreshCommit.Stale
        }
        if (!sessionPolicy.rotateRefreshToken(usedRefreshToken, refreshToken)) {
            return@withLock RefreshCommit.Rejected
        }
        persistTokens(accessToken, refreshToken)
        RefreshCommit.Success
    }

    private suspend fun clearSessionIfCurrent(operationEpoch: Long): Boolean = sessionOperationMutex.withLock {
        if (sessionEpoch != operationEpoch) {
            return@withLock false
        }
        sessionEpoch += 1
        clearLocalSession()
        _authState.value = AuthState.Unauthenticated
        true
    }

    /**
     * Remote revoke is best effort, but the local transaction is fail-closed:
     * credentials and policy state are cleared even when storage or transport
     * operations fail.  The Boolean is deliberately returned to the caller so
     * logout can record a warning without retaining local authority.
     */
    private suspend fun forceLogout(revokeRemote: Boolean = true): Boolean = sessionOperationMutex.withLock {
        // Invalidate all in-flight login/profile/refresh commits before the
        // remote request. They may finish, but cannot restore local authority
        // after this logout transaction has begun.
        sessionEpoch += 1
        val accessToken = runCatching { secureStorage.getString(accessTokenKey) }.getOrNull()
        val refreshToken = runCatching { secureStorage.getString(refreshTokenKey) }.getOrNull()
        val deviceId = runCatching { sessionPolicy.getDeviceId() }.getOrNull()

        val remoteRevocationSucceeded = if (revokeRemote) {
            runCatching { sessionRevoker.revoke(accessToken, refreshToken, deviceId) }.getOrDefault(false)
        } else {
            true
        }

        clearLocalSession()
        _authState.value = AuthState.Unauthenticated
        return@withLock remoteRevocationSucceeded
    }

    private fun clearLocalSession() {
        // Each deletion is isolated so a platform Keychain/Keystore error for
        // one key cannot leave another usable credential behind.
        var credentialDeletionFailed = false
        listOf(accessTokenKey, refreshTokenKey).forEach { key ->
            runCatching { secureStorage.remove(key) }
                .onFailure { credentialDeletionFailed = true }
        }
        if (credentialDeletionFailed) {
            // A platform store may fail one item-level deletion (for example,
            // a transient Keychain status).  Escalate to the store's atomic
            // clear operation rather than leaving a bearer token behind.
            runCatching { secureStorage.clear() }
        }
        runCatching { sessionPolicy.clearSessionPolicyState() }
        runCatching { stepUpAuth.clearStepUp() }
    }

    private companion object {
        const val accessTokenKey = "access_token"
        const val refreshTokenKey = "refresh_token"
        val expClaimRegex = "\"exp\"\\s*:\\s*(\\d+)".toRegex()
    }

    private enum class RefreshCommit {
        Success,
        Stale,
        Rejected,
    }
}
