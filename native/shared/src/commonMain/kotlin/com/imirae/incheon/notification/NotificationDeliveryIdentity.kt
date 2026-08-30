package com.imirae.incheon.notification

/**
 * Selects the identity used to deduplicate one notification delivery.
 *
 * A route is deliberately not part of the fallback. Two deliveries can point
 * at the same route while still representing different events, so callers must
 * supply a receipt identity when neither the application nor the provider has
 * a stable identifier.
 */
object NotificationDeliveryIdentity {
    private const val NOTIFICATION_PREFIX = "notification:"
    private const val PROVIDER_PREFIX = "provider:"
    private const val RECEIPT_PREFIX = "receipt:"

    /**
     * Prefer the application notification id, then the provider message id,
     * and finally the identity generated for this receipt.
     */
    fun key(
        notificationId: String?,
        providerMessageId: String?,
        receiptId: String,
    ): String {
        firstNonBlank(notificationId)?.let { return NOTIFICATION_PREFIX + it }
        firstNonBlank(providerMessageId)?.let { return PROVIDER_PREFIX + it }

        val normalizedReceiptId = firstNonBlank(receiptId)
            ?: error("A generated receipt identity must not be blank")
        return RECEIPT_PREFIX + normalizedReceiptId
    }

    private fun firstNonBlank(value: String?): String? = value
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
}
