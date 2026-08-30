package com.imirae.incheon.notification

import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager as SystemNotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import androidx.core.app.NotificationCompat
import com.imirae.incheon.MainActivity
import com.imirae.incheon.deeplink.NavigationIntent
import com.imirae.incheon.navigation.NotificationNavigation
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.koin.android.ext.android.inject

/**
 * Firebase Cloud Messaging service for Android.
 * Handles foreground/background/terminated message handling and notification
 * channel management. Native token registration remains unsupported until the
 * CR-PUSH mobile-token backend contract is implemented.
 */
class FCMService : FirebaseMessagingService() {
    private val appNotificationManager: NotificationManager by inject()

    companion object {
        private const val CHANNEL_ID = "imirae_default"
        private const val CHANNEL_NAME = "이미래 알림"
        private const val CHANNEL_DESCRIPTION = "이미래 인천 서비스 알림"

        fun createNotificationChannels(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    SystemNotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = CHANNEL_DESCRIPTION
                    enableVibration(true)
                }
                val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as SystemNotificationManager
                notificationManager.createNotificationChannel(channel)
            }
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        val notification = remoteMessage.notification
        onMessageReceived(
            context = applicationContext,
            title = notification?.title ?: data["title"],
            body = notification?.body ?: data["body"],
            data = data,
            isAppInForeground = isAppInForeground(),
            notificationManager = appNotificationManager,
            providerMessageId = remoteMessage.messageId,
        )
    }

    /**
     * Handle received message.
     *
     * FCM does not automatically present notification payloads while the app
     * is foregrounded.  Always rendering our own system notification keeps the
     * title/body visible in every lifecycle state; the parsed navigation intent
     * is attached only when it is allowlisted by the shared router.
     */
    fun onMessageReceived(
        context: Context,
        title: String?,
        body: String?,
        data: Map<String, String>,
        isAppInForeground: Boolean,
        notificationManager: com.imirae.incheon.notification.NotificationManager,
        providerMessageId: String? = null,
    ) {
        val payload = NotificationPayload(
            title = title ?: "이미래 인천",
            body = body ?: "",
            deepLink = data["deepLink"] ?: data["link"],
            data = data
        )

        val navigationIntent = notificationManager.routeNotification(payload)
        if (navigationIntent is NavigationIntent.Unknown) {
            // Keep invalid/missing links visible while opening the normal app entry point.
            showNotification(context, payload, providerMessageId = providerMessageId)
        } else {
            showNotification(context, payload, navigationIntent, providerMessageId)
        }

        if (isAppInForeground) {
            notificationManager.refreshUnreadCount()
        }
    }

    private fun showNotification(
        context: Context,
        payload: NotificationPayload,
        providerMessageId: String? = null,
    ) {
        showNotification(context, payload, NavigationIntent.Unknown, providerMessageId)
    }

    private fun showNotification(
        context: Context,
        payload: NotificationPayload,
        navigationIntent: NavigationIntent,
        providerMessageId: String? = null,
    ) {
        val safeDeepLink = NotificationNavigation.deepLinkFor(navigationIntent)
        val notificationId = NotificationNavigation.notificationId(payload.data)
        val deliveryKey = NotificationNavigation.deliveryKey(
            navigationIntent,
            notificationId = notificationId,
            providerMessageId = providerMessageId,
        )
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            safeDeepLink?.let { putExtra(NotificationNavigation.EXTRA_DEEP_LINK, it) }
            notificationId?.let { putExtra(NotificationNavigation.EXTRA_NOTIFICATION_ID, it) }
            putExtra(NotificationNavigation.EXTRA_DELIVERY_KEY, deliveryKey)
        }
        // Use the delivery identity as the request code so two notifications
        // do not reuse each other's deep-link extras.
        val pendingIntent = PendingIntent.getActivity(
            context,
            NotificationNavigation.requestCode(deliveryKey),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info) // TODO: Replace with app icon
            .setContentTitle(payload.title)
            .setContentText(payload.body)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as SystemNotificationManager
        notificationManager.notify(System.currentTimeMillis().toInt(), notification)
    }

    private fun isAppInForeground(): Boolean {
        val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val processInfo = activityManager.runningAppProcesses
            ?.firstOrNull { it.pid == Process.myPid() }
        return processInfo?.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }
}
