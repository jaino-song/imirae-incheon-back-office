package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*
import io.ktor.client.request.*

interface SettingsService {
    suspend fun getSettings(): ApiResult<UserSettings>
    suspend fun updateSettings(settings: UserSettings): ApiResult<UserSettings>
    suspend fun getVoucherPrices(): ApiResult<List<VoucherPrice>>
}

class SettingsServiceImpl(private val client: ApiClient) : SettingsService {
    override suspend fun getSettings(): ApiResult<UserSettings> = when (
        val result = client.get<NotificationPreferencesResponse>("/settings/notification-preferences")
    ) {
        is ApiResult.Success -> ApiResult.Success(UserSettings(notifications = result.data.emailNotificationsEnabled))
        is ApiResult.Error -> result
    }

    override suspend fun updateSettings(settings: UserSettings): ApiResult<UserSettings> = when (
        val result = client.put<NotificationPreferencesResponse>("/settings/notification-preferences") {
            setBody(UpdateNotificationPreferencesRequest(settings.notifications))
        }
    ) {
        is ApiResult.Success -> ApiResult.Success(UserSettings(notifications = result.data.emailNotificationsEnabled))
        is ApiResult.Error -> result
    }

    override suspend fun getVoucherPrices(): ApiResult<List<VoucherPrice>> = client.get("/voucher-price-infos")
}
