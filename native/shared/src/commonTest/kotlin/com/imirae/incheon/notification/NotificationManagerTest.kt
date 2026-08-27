package com.imirae.incheon.notification

import com.imirae.incheon.data.remote.NotificationService
import com.imirae.incheon.deeplink.DeepLinkRouter
import com.imirae.incheon.domain.models.Notification
import com.imirae.incheon.network.ApiError
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class NotificationManagerTest {
    @Test
    fun preLoginTokenIsRetainedAndRegisteredAfterAuthentication() = runTest {
        var accessToken: String? = null
        val store = InMemoryNotificationTokenStore()
        val service = RecordingNotificationService()
        val managerScope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val manager = NotificationManager(
            deepLinkRouter = DeepLinkRouter(),
            notificationService = service,
            tokenStore = store,
            getAccessToken = { accessToken },
            scope = managerScope,
        )

        manager.registerToken(" fcm-token ", "android")
        advanceUntilIdle()

        assertEquals(emptyList(), service.registrations)
        assertEquals(
            StoredNotificationToken("fcm-token", "android"),
            store.read(),
        )
        assertEquals("fcm-token", manager.state.value.deviceToken)

        accessToken = "access-token"
        manager.retryPendingToken()
        advanceUntilIdle()

        assertEquals(listOf("fcm-token" to "android"), service.registrations)
        managerScope.cancel()
    }

    @Test
    fun successfulRegistrationIsDeduplicatedAcrossRetries() = runTest {
        val service = RecordingNotificationService()
        val managerScope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val manager = NotificationManager(
            deepLinkRouter = DeepLinkRouter(),
            notificationService = service,
            tokenStore = InMemoryNotificationTokenStore(),
            getAccessToken = { "access-token" },
            scope = managerScope,
        )

        manager.registerToken("fcm-token", "android")
        manager.retryPendingToken()
        advanceUntilIdle()

        assertEquals(listOf("fcm-token" to "android"), service.registrations)
        managerScope.cancel()
    }

    @Test
    fun failedRegistrationKeepsTokenForAnExplicitRetry() = runTest {
        val service = RecordingNotificationService(
            responses = ArrayDeque(
                listOf(
                    ApiResult.Error(ApiError.Network("offline")),
                    ApiResult.Success(Unit),
                )
            )
        )
        val store = InMemoryNotificationTokenStore()
        val managerScope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val manager = NotificationManager(
            deepLinkRouter = DeepLinkRouter(),
            notificationService = service,
            tokenStore = store,
            getAccessToken = { "access-token" },
            scope = managerScope,
        )

        manager.registerToken("fcm-token", "android")
        advanceUntilIdle()
        manager.retryPendingToken()
        advanceUntilIdle()

        assertEquals(
            listOf("fcm-token" to "android", "fcm-token" to "android"),
            service.registrations,
        )
        assertEquals(StoredNotificationToken("fcm-token", "android"), store.read())
        managerScope.cancel()
    }

    @Test
    fun persistedTokenIsRestoredIntoNotificationState() = runTest {
        val store = InMemoryNotificationTokenStore(
            StoredNotificationToken("persisted-token", "android"),
        )
        val managerScope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val manager = NotificationManager(
            deepLinkRouter = DeepLinkRouter(),
            notificationService = RecordingNotificationService(),
            tokenStore = store,
            getAccessToken = { null },
            scope = managerScope,
        )

        assertEquals("persisted-token", manager.state.value.deviceToken)
        managerScope.cancel()
    }

    private class RecordingNotificationService(
        private val responses: ArrayDeque<ApiResult<Unit>> = ArrayDeque(),
    ) : NotificationService {
        val registrations = mutableListOf<Pair<String, String>>()

        override suspend fun getNotifications(): ApiResult<List<Notification>> = ApiResult.Success(emptyList())

        override suspend fun markAsRead(id: String): ApiResult<Unit> = ApiResult.Success(Unit)

        override suspend fun registerDeviceToken(token: String, platform: String): ApiResult<Unit> {
            registrations += token to platform
            return responses.removeFirstOrNull() ?: ApiResult.Success(Unit)
        }

        override suspend fun unregisterDeviceToken(token: String): ApiResult<Unit> = ApiResult.Success(Unit)

        override suspend fun getUnreadCount(): ApiResult<Int> = ApiResult.Success(0)
    }
}
