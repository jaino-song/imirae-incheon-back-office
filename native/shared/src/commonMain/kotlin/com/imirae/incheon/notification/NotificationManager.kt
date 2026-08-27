package com.imirae.incheon.notification

import com.imirae.incheon.deeplink.DeepLinkRouter
import com.imirae.incheon.deeplink.NavigationIntent
import com.imirae.incheon.data.remote.NotificationService
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Cross-platform notification manager.
 * Handles payload parsing, routing via DeepLinkRouter, and unread state.
 */

data class NotificationPayload(
    val title: String,
    val body: String,
    val deepLink: String? = null,
    val data: Map<String, String> = emptyMap()
)

data class NotificationState(
    val unreadCount: Int = 0,
    val isPermissionGranted: Boolean = false,
    val deviceToken: String? = null
)

class NotificationManager(
    private val deepLinkRouter: DeepLinkRouter,
    private val notificationService: NotificationService,
    private val tokenStore: NotificationTokenStore = InMemoryNotificationTokenStore(),
    /**
     * The default reader fails closed. Injected app bindings provide the real
     * access-token reader so a Firebase callback cannot issue an
     * unauthenticated request.
     */
    private val getAccessToken: suspend () -> String? = { null },
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main),
) {
    private val _state = MutableStateFlow(NotificationState(deviceToken = tokenStore.read()?.token))
    val state: StateFlow<NotificationState> = _state.asStateFlow()
    private val registrationMutex = Mutex()
    private var registeredToken: StoredNotificationToken? = null

    /**
     * Parse notification payload and return navigation intent.
     */
    fun routeNotification(payload: NotificationPayload): NavigationIntent {
        val deepLink = payload.deepLink ?: payload.data["deepLink"] ?: payload.data["link"]
        return if (deepLink != null) {
            deepLinkRouter.route(deepLink)
        } else {
            NavigationIntent.Unknown
        }
    }

    /**
     * Retain and register a device token. Firebase can invoke this callback
     * before login, so registration is gated on an access token and retried by
     * AuthManager after the authenticated profile has been loaded.
     */
    fun registerToken(token: String, platform: String) {
        val normalizedToken = token.trim()
        if (normalizedToken.isEmpty()) {
            return
        }

        val normalizedPlatform = platform.trim().ifEmpty { DEFAULT_PLATFORM }
        tokenStore.write(normalizedToken, normalizedPlatform)
        _state.value = _state.value.copy(deviceToken = normalizedToken)
        enqueueTokenRegistration()
    }

    /**
     * Retry a token that arrived before authentication, or a previous attempt
     * that failed. The token remains in secure storage until explicitly
     * unregistered, so a process restart does not lose the pending callback.
     */
    fun retryPendingToken() {
        val storedToken = tokenStore.read()
        if (storedToken != null && _state.value.deviceToken != storedToken.token) {
            _state.value = _state.value.copy(deviceToken = storedToken.token)
        }
        enqueueTokenRegistration()
    }

    private fun enqueueTokenRegistration() {
        scope.launch {
            registrationMutex.withLock {
                val pendingToken = tokenStore.read()
                    ?: _state.value.deviceToken?.let {
                        StoredNotificationToken(it, DEFAULT_PLATFORM)
                    }
                    ?: return@withLock

                if (registeredToken == pendingToken) {
                    return@withLock
                }

                val accessToken = try {
                    getAccessToken.invoke()
                } catch (cancellation: CancellationException) {
                    throw cancellation
                } catch (_: Exception) {
                    null
                }
                if (accessToken.isNullOrBlank()) {
                    return@withLock
                }

                val result = try {
                    notificationService.registerDeviceToken(
                        pendingToken.token,
                        pendingToken.platform,
                    )
                } catch (cancellation: CancellationException) {
                    throw cancellation
                } catch (_: Exception) {
                    null
                }

                if (result is ApiResult.Success) {
                    registeredToken = pendingToken
                }
            }
        }
    }

    /**
     * Unregister device token (logout / unsubscribe).
     */
    fun unregisterToken() {
        val token = _state.value.deviceToken ?: return
        scope.launch {
            notificationService.unregisterDeviceToken(token)
            tokenStore.clear()
            registeredToken = null
            _state.value = _state.value.copy(deviceToken = null)
        }
    }

    /**
     * Update unread count from backend.
     */
    fun refreshUnreadCount() {
        scope.launch {
            when (val result = notificationService.getUnreadCount()) {
                is ApiResult.Success -> _state.value = _state.value.copy(unreadCount = result.data)
                is ApiResult.Error -> {} // silently ignore
            }
        }
    }

    /**
     * Mark notification as read.
     */
    fun markAsRead(notificationId: String) {
        scope.launch {
            notificationService.markAsRead(notificationId)
            refreshUnreadCount()
        }
    }

    fun updatePermissionStatus(granted: Boolean) {
        _state.value = _state.value.copy(isPermissionGranted = granted)
    }

    fun decrementUnread() {
        val current = _state.value.unreadCount
        if (current > 0) {
            _state.value = _state.value.copy(unreadCount = current - 1)
        }
    }

    private companion object {
        const val DEFAULT_PLATFORM = "android"
    }
}
