package com.imirae.incheon.notification

import com.imirae.incheon.auth.AuthState
import com.imirae.incheon.deeplink.NavigationIntent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class NotificationNavigationGateTest {
    private val protectedIntent = NavigationIntent.ClientDetail("client-42")

    @Test
    fun coldStartDefersRouteUntilSessionRestorationAuthenticates() {
        val gate = NotificationNavigationGate()

        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(protectedIntent, "cold-start-1"),
        )
        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.consumePendingNavigation(),
        )
        gate.onAuthStateChanged(AuthState.Loading)
        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.consumePendingNavigation(),
        )
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin", "본점"))
        assertEquals(
            NotificationNavigationDecision.NavigateProtected(protectedIntent),
            gate.consumePendingNavigation(),
        )
    }

    @Test
    fun warmIntentNavigatesImmediatelyWhenAlreadyAuthenticated() {
        val gate = NotificationNavigationGate()
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin", "본점"))

        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(protectedIntent, "warm-1"),
        )
        assertEquals(
            NotificationNavigationDecision.NavigateProtected(protectedIntent),
            gate.consumePendingNavigation(),
        )
    }

    @Test
    fun initialStateNeverExposesProtectedRouteBeforeRestoration() {
        val gate = NotificationNavigationGate()

        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(NavigationIntent.Dashboard, "initial-1"),
        )
        gate.onAuthStateChanged(AuthState.Initial)
        assertEquals(NotificationNavigationDecision.Deferred, gate.consumePendingNavigation())
    }

    @Test
    fun unknownIntentIsRejectedBeforeItCanBeQueued() {
        val gate = NotificationNavigationGate()

        assertEquals(
            NotificationNavigationDecision.Rejected,
            gate.enqueue(NavigationIntent.Unknown, "unknown-1"),
        )
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))
        assertNull(gate.consumePendingNavigation())
    }

    @Test
    fun unauthenticatedStateUsesCanonicalLoginFallback() {
        val gate = NotificationNavigationGate()
        gate.enqueue(protectedIntent, "logged-out-1")

        gate.onAuthStateChanged(AuthState.Unauthenticated)
        assertEquals(
            NotificationNavigationDecision.Login,
            gate.consumePendingNavigation(),
        )
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))
        assertNull(gate.consumePendingNavigation())
    }

    @Test
    fun authErrorUsesCanonicalLoginFallback() {
        val gate = NotificationNavigationGate()
        gate.enqueue(protectedIntent, "error-1")

        gate.onAuthStateChanged(AuthState.Error("복구할 수 없습니다"))
        assertEquals(
            NotificationNavigationDecision.Login,
            gate.consumePendingNavigation(),
        )
    }

    @Test
    fun branchSelectionStateNeverReleasesProtectedRoute() {
        val gate = NotificationNavigationGate()
        gate.enqueue(protectedIntent, "branch-1")

        gate.onAuthStateChanged(AuthState.RequiresBranchSelection)
        assertEquals(
            NotificationNavigationDecision.SelectBranch,
            gate.consumePendingNavigation(),
        )
    }

    @Test
    fun duplicateDeliveryIsIgnoredAndCannotReplacePendingRoute() {
        val gate = NotificationNavigationGate()

        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(protectedIntent, "same-delivery"),
        )
        assertEquals(
            NotificationNavigationDecision.Duplicate,
            gate.enqueue(NavigationIntent.Settings, "same-delivery"),
        )
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))
        assertEquals(
            NotificationNavigationDecision.NavigateProtected(protectedIntent),
            gate.consumePendingNavigation(),
        )
    }

    @Test
    fun distinctExplicitIdsForTheSameRouteAreAccepted() {
        val gate = NotificationNavigationGate()

        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(
                protectedIntent,
                NotificationDeliveryIdentity.key("notification-1", null, "receipt-1"),
            ),
        )
        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(
                protectedIntent,
                NotificationDeliveryIdentity.key("notification-2", null, "receipt-2"),
            ),
        )
    }

    @Test
    fun sameProviderDeliveryIdIsIgnoredAsDuplicate() {
        val gate = NotificationNavigationGate()
        val deliveryKey = NotificationDeliveryIdentity.key(
            notificationId = null,
            providerMessageId = "provider-42",
            receiptId = "receipt-1",
        )

        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(protectedIntent, deliveryKey),
        )
        assertEquals(
            NotificationNavigationDecision.Duplicate,
            gate.enqueue(NavigationIntent.Settings, deliveryKey),
        )
    }

    @Test
    fun idlessDirectDeliveriesUseDistinctReceiptKeysButReprocessingOneKeyIsDuplicate() {
        val gate = NotificationNavigationGate()
        val firstReceiptKey = NotificationDeliveryIdentity.key(null, null, "receipt-1")
        val secondReceiptKey = NotificationDeliveryIdentity.key(null, null, "receipt-2")

        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(NavigationIntent.Settings, firstReceiptKey),
        )
        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(NavigationIntent.Settings, secondReceiptKey),
        )
        assertEquals(
            NotificationNavigationDecision.Duplicate,
            gate.enqueue(NavigationIntent.Settings, firstReceiptKey),
        )
    }

    @Test
    fun deliveredKeyLedgerIsBoundedAndAllowsLaterReusedKey() {
        val gate = NotificationNavigationGate(maxDeliveredKeys = 2)
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))
        gate.enqueue(NavigationIntent.Dashboard, "first")
        gate.enqueue(NavigationIntent.Settings, "second")
        gate.enqueue(NavigationIntent.Chat, "third")

        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(NavigationIntent.Dashboard, "first"),
        )
        assertEquals(
            NotificationNavigationDecision.NavigateProtected(NavigationIntent.Dashboard),
            gate.consumePendingNavigation(),
        )
    }
}
