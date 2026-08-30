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
    suspend fun markAsRead(id: Int): ApiResult<Notification>
    suspend fun getUnreadCount(): ApiResult<Int>
}

class NotificationServiceImpl(private val client: ApiClient) : NotificationService {
    override suspend fun getNotifications() = client.get<List<Notification>>("/notifications")
    override suspend fun markAsRead(id: Int) = client.patch<Notification>("/notifications/$id/read")
    override suspend fun getUnreadCount(): ApiResult<Int> = when (val result = client.get<UnreadCountResponse>("/notifications/unread/count")) {
        is ApiResult.Success -> ApiResult.Success(result.data.count)
        is ApiResult.Error -> result
    }
}
