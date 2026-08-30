package com.imirae.incheon.auth

import com.imirae.incheon.data.remote.AuthService
import com.imirae.incheon.domain.models.BranchesResponse
import com.imirae.incheon.domain.models.LoginResponse
import com.imirae.incheon.domain.models.RegisterResponse
import com.imirae.incheon.domain.models.SelectBranchResponse
import com.imirae.incheon.domain.models.TokenRefreshResponse
import com.imirae.incheon.domain.models.UserProfile
import com.imirae.incheon.domain.models.VerifyEmailResponse
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.async
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class AuthLifecycleTest {
    @Test
    fun logoutClearsCredentialsAndPolicyBeforeCompleting() = runTest {
        val storage = FakeAuthStorage(
            mutableMapOf(
                "access_token" to "access",
                "refresh_token" to "refresh",
                "last_activity" to currentTimeMillis().toString(),
                "active_refresh_token" to "refresh",
                "last_step_up" to currentTimeMillis().toString(),
                "device_id" to "device-1",
            )
        )
        val revoker = RecordingRevoker(result = true)
        val manager = AuthManager(FakeAuthService(), storage, revoker, this, Unit)

        val result = manager.logoutAndAwait()

        assertEquals(LogoutState.Completed(true), result)
        assertEquals(AuthState.Unauthenticated, manager.authState.value)
        assertNull(storage.values["access_token"])
        assertNull(storage.values["refresh_token"])
        assertNull(storage.values["last_activity"])
        assertNull(storage.values["active_refresh_token"])
        assertNull(storage.values["last_step_up"])
        assertEquals("device-1", storage.values["device_id"])
        assertEquals(listOf("access", "refresh", "device-1"), revoker.calls.single())
    }

    @Test
    fun remoteRevokeFailureIsRecordedAfterLocalAuthorityIsRemoved() = runTest {
        val storage = FakeAuthStorage(mutableMapOf("access_token" to "access", "refresh_token" to "refresh"))
        val manager = AuthManager(
            FakeAuthService(),
            storage,
            RecordingRevoker(result = false),
            this,
            Unit,
        )

        val result = manager.logoutAndAwait()

        assertEquals(LogoutState.Completed(false), result)
        assertEquals(LogoutState.Completed(false), manager.logoutState.value)
        assertEquals(AuthState.Unauthenticated, manager.authState.value)
        assertNull(storage.values["access_token"])
        assertNull(storage.values["refresh_token"])
    }

    @Test
    fun itemDeletionFailureEscalatesToSecureStoreClear() = runTest {
        val storage = FakeAuthStorage(
            mutableMapOf("access_token" to "access", "refresh_token" to "refresh"),
            failCredentialRemoval = true,
        )
        val manager = AuthManager(FakeAuthService(), storage, RecordingRevoker(true), this, Unit)

        manager.logoutAndAwait()

        assertEquals(1, storage.clearCalls)
        assertNull(storage.values["access_token"])
        assertNull(storage.values["refresh_token"])
    }

    @Test
    fun concurrentRefreshCallsShareOneRotationAndPersistTheNewPair() = runTest {
        val storage = FakeAuthStorage(
            mutableMapOf(
                "refresh_token" to "refresh-old",
                "access_token" to "access-old",
                "last_activity" to currentTimeMillis().toString(),
                "active_refresh_token" to "refresh-old",
            )
        )
        val service = FakeAuthService(
            refreshResult = ApiResult.Success(TokenRefreshResponse("access-new", "refresh-new"))
        )
        val manager = AuthManager(service, storage, RecordingRevoker(true), this, Unit)

        val first = async { manager.refreshToken() }
        val second = async { manager.refreshToken() }

        assertEquals("access-new", first.await())
        assertEquals("access-new", second.await())
        assertEquals(1, service.refreshCalls)
        assertEquals("access-new", storage.values["access_token"])
        assertEquals("refresh-new", storage.values["refresh_token"])
    }

    @Test
    fun restoreRefreshesAnExpiredAccessTokenBeforeLoadingTheProfile() = runTest {
        val storage = FakeAuthStorage(
            mutableMapOf(
                "access_token" to "eyJhbGciOiJub25lIn0.eyJleHAiOjF9.signature",
                "refresh_token" to "refresh-old",
                "last_activity" to currentTimeMillis().toString(),
                "active_refresh_token" to "refresh-old",
            )
        )
        val service = FakeAuthService(
            refreshResult = ApiResult.Success(TokenRefreshResponse("access-new", "refresh-new"))
        )
        val manager = AuthManager(service, storage, RecordingRevoker(true), this, Unit)

        manager.restoreSession()
        advanceUntilIdle()

        assertEquals(1, service.refreshCalls)
        assertEquals(AuthState.Authenticated("user-1", "admin"), manager.authState.value)
        assertEquals("access-new", storage.values["access_token"])
        assertEquals("refresh-new", storage.values["refresh_token"])
    }

    @Test
    fun logoutInvalidatesAnInFlightRefreshBeforeItCanRestoreCredentials() = runTest {
        val storage = FakeAuthStorage(
            mutableMapOf(
                "access_token" to "access-old",
                "refresh_token" to "refresh-old",
                "last_activity" to currentTimeMillis().toString(),
                "active_refresh_token" to "refresh-old",
            )
        )
        val refreshStarted = CompletableDeferred<Unit>()
        val releaseRefresh = CompletableDeferred<Unit>()
        val service = FakeAuthService(
            refreshResult = ApiResult.Success(TokenRefreshResponse("access-new", "refresh-new")),
            refreshStarted = refreshStarted,
            releaseRefresh = releaseRefresh,
        )
        val manager = AuthManager(service, storage, RecordingRevoker(true), this, Unit)

        val refresh = async { manager.refreshToken() }
        refreshStarted.await()

        val logout = async { manager.logoutAndAwait() }
        advanceUntilIdle()
        assertEquals(LogoutState.Completed(true), logout.await())
        assertNull(storage.values["access_token"])
        assertNull(storage.values["refresh_token"])

        releaseRefresh.complete(Unit)
        assertNull(refresh.await())
        assertNull(storage.values["access_token"])
        assertNull(storage.values["refresh_token"])
    }

    private class FakeAuthStorage(
        val values: MutableMap<String, String>,
        private val failCredentialRemoval: Boolean = false,
    ) : AuthStorage {
        var clearCalls: Int = 0
        override fun getString(key: String): String? = values[key]
        override fun putString(key: String, value: String) { values[key] = value }
        override fun remove(key: String) {
            if (failCredentialRemoval && key in setOf("access_token", "refresh_token")) {
                throw IllegalStateException("item deletion failed")
            }
            values.remove(key)
        }
        override fun clear() {
            clearCalls += 1
            values.clear()
        }
    }

    private class RecordingRevoker(private val result: Boolean) : SessionRevoker {
        val calls = mutableListOf<List<String?>>()

        override suspend fun revoke(accessToken: String?, refreshToken: String?, deviceId: String?): Boolean {
            calls += listOf(accessToken, refreshToken, deviceId)
            return result
        }
    }

    private class FakeAuthService(
        private val refreshResult: ApiResult<TokenRefreshResponse> = ApiResult.Error(
            com.imirae.incheon.network.ApiError.Http(401, "expired")
        ),
        private val refreshStarted: CompletableDeferred<Unit>? = null,
        private val releaseRefresh: CompletableDeferred<Unit>? = null,
    ) : AuthService {
        var refreshCalls: Int = 0

        override suspend fun login(email: String, password: String): ApiResult<LoginResponse> =
            ApiResult.Error(com.imirae.incheon.network.ApiError.Http(401, "not implemented"))

        override suspend fun register(name: String, email: String, password: String, phone: String, birthDate: String): ApiResult<RegisterResponse> =
            ApiResult.Success(RegisterResponse(success = true))

        override suspend fun forgotPassword(email: String): ApiResult<Unit> = ApiResult.Success(Unit)
        override suspend fun resetPassword(token: String, newPassword: String): ApiResult<Unit> = ApiResult.Success(Unit)

        override suspend fun refreshToken(refreshToken: String): ApiResult<TokenRefreshResponse> {
            refreshCalls += 1
            refreshStarted?.complete(Unit)
            releaseRefresh?.await()
            return refreshResult
        }

        override suspend fun verifyEmail(token: String): ApiResult<VerifyEmailResponse> =
            ApiResult.Success(VerifyEmailResponse(success = true))

        override suspend fun getProfile(): ApiResult<UserProfile> = ApiResult.Success(
            UserProfile("user-1", "홍길동", "person@example.com", "admin")
        )

        override suspend fun getBranches(): ApiResult<BranchesResponse> = ApiResult.Success(BranchesResponse())
        override suspend fun selectBranch(branchId: String): ApiResult<SelectBranchResponse> =
            ApiResult.Error(com.imirae.incheon.network.ApiError.Http(400, "not implemented"))
    }
}
