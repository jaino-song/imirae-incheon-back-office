package com.imirae.incheon.data.remote

import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*

/**
 * Native push subscription is intentionally not part of this service until
 * the CR-PUSH mobile-token backend contract is implemented. The native client
 * continues to consume in-app notification data and receipt events only.
 */
interface NotificationService {
    suspend fun getNotifications(): ApiResult<List<Notification>>
    suspend fun markAsRead(id: String): ApiResult<Unit>
    suspend fun getUnreadCount(): ApiResult<Int>
}

class NotificationServiceImpl(private val client: ApiClient) : NotificationService {
    override suspend fun getNotifications() = client.get<List<Notification>>("/notifications")
    override suspend fun markAsRead(id: String) = client.put<Unit>("/notifications/$id/read")
    override suspend fun getUnreadCount() = client.get<Int>("/notifications/unread-count")
}
