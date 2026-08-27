package com.imirae.incheon.notification

import com.imirae.incheon.data.remote.NotificationService
import com.imirae.incheon.deeplink.DeepLinkRouter
import com.imirae.incheon.deeplink.NavigationIntent
import com.imirae.incheon.domain.models.Notification
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
    fun routesAllowedDeepLinkWithoutServiceCall() = runTest {
        val service = RecordingNotificationService()
        val managerScope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val manager = NotificationManager(
            deepLinkRouter = DeepLinkRouter(),
            notificationService = service,
            scope = managerScope,
        )

        assertEquals(
            NavigationIntent.ClientDetail("client-1"),
            manager.routeNotification(
                NotificationPayload(
                    title = "새 알림",
                    body = "확인해 주세요",
                    deepLink = "https://app.imirae-incheon.com/clients/client-1",
                ),
            ),
        )
        assertEquals(emptyList(), service.operations)
        managerScope.cancel()
    }

    @Test
    fun blankDeepLinkFallsBackToUnknownWithoutRouting() = runTest {
        val managerScope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val manager = NotificationManager(
            deepLinkRouter = DeepLinkRouter(),
            notificationService = RecordingNotificationService(),
            scope = managerScope,
        )

        assertEquals(
            NavigationIntent.Unknown,
            manager.routeNotification(
                NotificationPayload(
                    title = "새 알림",
                    body = "확인해 주세요",
                    deepLink = "   ",
                ),
            ),
        )
        managerScope.cancel()
    }

    @Test
    fun refreshUnreadCountUpdatesState() = runTest {
        val service = RecordingNotificationService()
        val managerScope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val manager = NotificationManager(
            deepLinkRouter = DeepLinkRouter(),
            notificationService = service,
            scope = managerScope,
        )

        service.unreadResponses.add(ApiResult.Success(3))
        manager.refreshUnreadCount()
        advanceUntilIdle()

        assertEquals(3, manager.state.value.unreadCount)
        assertEquals(1, service.unreadCountCalls)
        assertEquals(listOf("getUnreadCount"), service.operations)
        managerScope.cancel()
    }

    @Test
    fun markingAsReadRefreshesUnreadCount() = runTest {
        val service = RecordingNotificationService()
        val managerScope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val manager = NotificationManager(
            deepLinkRouter = DeepLinkRouter(),
            notificationService = service,
            scope = managerScope,
        )

        service.unreadResponses.add(ApiResult.Success(2))
        manager.markAsRead("notification-42")
        advanceUntilIdle()

        assertEquals(listOf("notification-42"), service.markedIds)
        assertEquals(2, manager.state.value.unreadCount)
        assertEquals(listOf("markAsRead", "getUnreadCount"), service.operations)
        managerScope.cancel()
    }

    @Test
    fun decrementUnreadDoesNotGoBelowZero() = runTest {
        val managerScope = CoroutineScope(StandardTestDispatcher(testScheduler))
        val manager = NotificationManager(
            deepLinkRouter = DeepLinkRouter(),
            notificationService = RecordingNotificationService(),
            scope = managerScope,
        )

        manager.decrementUnread()
        assertEquals(0, manager.state.value.unreadCount)
        manager.updatePermissionStatus(granted = true)
        assertEquals(true, manager.state.value.isPermissionGranted)
        managerScope.cancel()
    }

    private class RecordingNotificationService : NotificationService {
        val unreadResponses = ArrayDeque<ApiResult<Int>>()
        val markedIds = mutableListOf<String>()
        val operations = mutableListOf<String>()
        var unreadCountCalls = 0

        override suspend fun getNotifications(): ApiResult<List<Notification>> = ApiResult.Success(emptyList())

        override suspend fun markAsRead(id: String): ApiResult<Unit> {
            operations += "markAsRead"
            markedIds += id
            return ApiResult.Success(Unit)
        }

        override suspend fun getUnreadCount(): ApiResult<Int> {
            operations += "getUnreadCount"
            unreadCountCalls += 1
            return unreadResponses.removeFirstOrNull() ?: ApiResult.Success(0)
        }
    }
}
