package com.imirae.incheon.navigation

import android.content.Intent
import com.imirae.incheon.deeplink.DeepLinkRouter
import com.imirae.incheon.deeplink.NavigationIntent

/**
 * The single Android entry point for notification and app-link navigation.
 *
 * FCM payloads are untrusted input.  A raw link is therefore parsed before it
 * is placed in a PendingIntent, and the activity parses it again when the
 * PendingIntent is delivered.  The second parse protects the activity from
 * callers that construct an Intent without going through the FCM service.
 */
object NotificationNavigation {
    const val EXTRA_DEEP_LINK = "com.imirae.incheon.notification.deep_link"
    const val EXTRA_NOTIFICATION_ID = "com.imirae.incheon.notification.id"
    const val DATA_NOTIFICATION_ID = "notificationId"

    private const val LEGACY_EXTRA_DEEP_LINK = "deepLink"
    private const val LEGACY_EXTRA_LINK = "link"
    private const val FCM_LINK_EXTRA = "gcm.n.link"
    private const val LEGACY_DATA_NOTIFICATION_ID = "notification_id"

    data class ParsedNavigation(
        val intent: NavigationIntent,
        val deliveryKey: String,
    )

    /**
     * Parse the link carried by an activity intent.
     *
     * Invalid, missing, or non-allowlisted links return null.  The caller can
     * then leave the activity at its normal start destination.
     */
    fun parse(intent: Intent, router: DeepLinkRouter): ParsedNavigation? {
        return try {
            val rawDeepLink = firstNonBlank(
                intent.getStringExtra(EXTRA_DEEP_LINK),
                intent.getStringExtra(LEGACY_EXTRA_DEEP_LINK),
                intent.getStringExtra(LEGACY_EXTRA_LINK),
                intent.getStringExtra(FCM_LINK_EXTRA),
                intent.data?.toString(),
            ) ?: return null

            val navigationIntent = router.route(rawDeepLink)
            if (navigationIntent is NavigationIntent.Unknown) {
                return null
            }

            ParsedNavigation(
                intent = navigationIntent,
                deliveryKey = deliveryKey(
                    navigationIntent,
                    firstNonBlank(
                        intent.getStringExtra(EXTRA_NOTIFICATION_ID),
                        intent.getStringExtra(DATA_NOTIFICATION_ID),
                        intent.getStringExtra(LEGACY_DATA_NOTIFICATION_ID),
                    ),
                ),
            )
        } catch (_: Exception) {
            // Malformed/malicious extras must never prevent the app from opening.
            null
        }
    }

    /**
     * Convert a validated shared navigation intent to its canonical deep-link
     * path.  This path is what is carried in a PendingIntent and parsed again
     * by [parse] when the activity receives the tap.
     */
    fun deepLinkFor(intent: NavigationIntent): String? = when (intent) {
        NavigationIntent.Dashboard -> "/dashboard"
        is NavigationIntent.ClientDetail -> "/clients/${intent.clientId}"
        is NavigationIntent.EmployeeDetail -> "/employees/${intent.employeeId}"
        is NavigationIntent.ContractDetail -> "/contracts/${intent.contractId}"
        is NavigationIntent.MessageTemplateDetail -> "/messages/templates/${intent.templateId}"
        NavigationIntent.Chat -> "/chat"
        NavigationIntent.ClientList -> "/clients"
        NavigationIntent.EmployeeList -> "/employees"
        NavigationIntent.ContractList -> "/contracts"
        NavigationIntent.Messages -> "/messages"
        NavigationIntent.Settings -> "/settings"
        NavigationIntent.Unknown -> null
    }

    /**
     * Convert a validated shared navigation intent to a route in the Android
     * navigation graph.  Employee and contract detail screens do not exist in
     * the current native graph, so those allowlisted links safely land on the
     * corresponding list until the detail screens are implemented.
     */
    fun routeFor(intent: NavigationIntent): String? = when (intent) {
        NavigationIntent.Dashboard -> Routes.DASHBOARD
        is NavigationIntent.ClientDetail -> Routes.clientDetail(intent.clientId)
        is NavigationIntent.EmployeeDetail -> Routes.EMPLOYEE_LIST
        is NavigationIntent.ContractDetail -> Routes.CONTRACT_LIST
        is NavigationIntent.MessageTemplateDetail -> Routes.messageEdit(intent.templateId)
        NavigationIntent.Chat -> Routes.CHAT
        NavigationIntent.ClientList -> Routes.CLIENT_LIST
        NavigationIntent.EmployeeList -> Routes.EMPLOYEE_LIST
        NavigationIntent.ContractList -> Routes.CONTRACT_LIST
        NavigationIntent.Messages -> Routes.MESSAGES
        NavigationIntent.Settings -> Routes.SETTINGS
        NavigationIntent.Unknown -> null
    }

    /** Extract the optional provider notification identifier without trusting it as a link. */
    fun notificationId(data: Map<String, String>): String? = firstNonBlank(
        data[DATA_NOTIFICATION_ID],
        data[LEGACY_DATA_NOTIFICATION_ID],
    )

    /** Stable request code and duplicate-delivery key for a validated intent. */
    fun deliveryKey(intent: NavigationIntent, notificationId: String?): String {
        val identity = notificationId?.let { "notification:$it" } ?: "navigation:${identityFor(intent)}"
        return identity
    }

    fun requestCode(intent: NavigationIntent, notificationId: String?): Int =
        deliveryKey(intent, notificationId).hashCode() and Int.MAX_VALUE

    private fun identityFor(intent: NavigationIntent): String = when (intent) {
        NavigationIntent.Dashboard -> "dashboard"
        is NavigationIntent.ClientDetail -> "client:${intent.clientId}"
        is NavigationIntent.EmployeeDetail -> "employee:${intent.employeeId}"
        is NavigationIntent.ContractDetail -> "contract:${intent.contractId}"
        is NavigationIntent.MessageTemplateDetail -> "message-template:${intent.templateId}"
        NavigationIntent.Chat -> "chat"
        NavigationIntent.ClientList -> "clients"
        NavigationIntent.EmployeeList -> "employees"
        NavigationIntent.ContractList -> "contracts"
        NavigationIntent.Messages -> "messages"
        NavigationIntent.Settings -> "settings"
        NavigationIntent.Unknown -> "unknown"
    }

    private fun firstNonBlank(vararg values: String?): String? = values
        .asSequence()
        .map { it?.trim() }
        .firstOrNull { !it.isNullOrEmpty() }
}
