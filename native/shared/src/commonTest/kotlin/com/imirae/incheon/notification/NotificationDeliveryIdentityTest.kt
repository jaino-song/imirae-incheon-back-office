package com.imirae.incheon.notification

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class NotificationDeliveryIdentityTest {
    @Test
    fun payloadNotificationIdWinsAndIsStableForSameRoute() {
        val first = NotificationDeliveryIdentity.key(
            notificationId = "notification-42",
            providerMessageId = "provider-1",
            receiptId = "receipt-1",
        )
        val second = NotificationDeliveryIdentity.key(
            notificationId = "notification-42",
            providerMessageId = "provider-2",
            receiptId = "receipt-2",
        )

        assertEquals("notification:notification-42", first)
        assertEquals(first, second)
    }

    @Test
    fun providerMessageIdIsUsedWhenPayloadIdIsMissing() {
        assertEquals(
            "provider:message-42",
            NotificationDeliveryIdentity.key(
                notificationId = null,
                providerMessageId = " message-42 ",
                receiptId = "receipt-ignored",
            ),
        )
    }

    @Test
    fun generatedReceiptIdentityKeepsDistinctIdlessDeliveriesDistinct() {
        val first = NotificationDeliveryIdentity.key(
            notificationId = null,
            providerMessageId = null,
            receiptId = "receipt-1",
        )
        val second = NotificationDeliveryIdentity.key(
            notificationId = null,
            providerMessageId = null,
            receiptId = "receipt-2",
        )

        assertEquals("receipt:receipt-1", first)
        assertNotEquals(first, second)
    }

    @Test
    fun blankPayloadAndProviderIdsFallBackToReceiptIdentity() {
        assertEquals(
            "receipt:generated-1",
            NotificationDeliveryIdentity.key(
                notificationId = "  ",
                providerMessageId = "\t",
                receiptId = "generated-1",
            ),
        )
    }
}
