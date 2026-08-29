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
        assertEquals(true, gate.hasPendingNavigation())
        assertNull(gate.consumePendingNavigation())
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))
        assertEquals(
            NotificationNavigationDecision.NavigateProtected(protectedIntent),
            gate.consumePendingNavigation(),
        )
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
        assertEquals(true, gate.hasPendingNavigation())
        gate.onAuthStateChanged(AuthState.Loading)
        assertEquals(NotificationNavigationDecision.Deferred, gate.consumePendingNavigation())
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))
        assertEquals(
            NotificationNavigationDecision.NavigateProtected(protectedIntent),
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
        assertEquals(true, gate.hasPendingNavigation())
        assertNull(gate.consumePendingNavigation())
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin", "본점"))
        assertEquals(
            NotificationNavigationDecision.NavigateProtected(protectedIntent),
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

    @Test
    fun loggedOutColdTapRetainsRouteAcrossLoginErrorAndRetry() {
        val gate = NotificationNavigationGate()
        gate.onAuthStateChanged(AuthState.Unauthenticated)

        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(protectedIntent, "cold-logged-out"),
        )
        assertEquals(NotificationNavigationDecision.Login, gate.consumePendingNavigation())
        gate.onAuthStateChanged(AuthState.Loading)
        assertEquals(NotificationNavigationDecision.Deferred, gate.consumePendingNavigation())
        gate.onAuthStateChanged(AuthState.Error("일시적인 오류"))
        assertNull(gate.consumePendingNavigation())
        assertEquals(true, gate.hasPendingNavigation())

        gate.onAuthStateChanged(AuthState.Loading)
        assertEquals(NotificationNavigationDecision.Deferred, gate.consumePendingNavigation())
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))
        assertEquals(
            NotificationNavigationDecision.NavigateProtected(protectedIntent),
            gate.consumePendingNavigation(),
        )
        assertNull(gate.consumePendingNavigation())
    }

    @Test
    fun loggedOutWarmTapUsesLoginThenContinuesToTargetAfterAuthentication() {
        val gate = NotificationNavigationGate()
        gate.onAuthStateChanged(AuthState.Unauthenticated)

        gate.enqueue(protectedIntent, "warm-logged-out")
        assertEquals(NotificationNavigationDecision.Login, gate.consumePendingNavigation())
        assertNull(gate.consumePendingNavigation())

        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))
        assertEquals(
            NotificationNavigationDecision.NavigateProtected(protectedIntent),
            gate.consumePendingNavigation(),
        )
    }

    @Test
    fun requiresBranchSelectionRetainsRouteUntilSelectionCompletes() {
        val gate = NotificationNavigationGate()
        gate.onAuthStateChanged(AuthState.Loading)
        gate.enqueue(protectedIntent, "requires-branch")

        gate.onAuthStateChanged(AuthState.RequiresBranchSelection)
        assertEquals(NotificationNavigationDecision.SelectBranch, gate.consumePendingNavigation())
        assertNull(gate.consumePendingNavigation())
        assertEquals(true, gate.hasPendingNavigation())

        gate.onAuthStateChanged(AuthState.Loading)
        assertEquals(NotificationNavigationDecision.Deferred, gate.consumePendingNavigation())
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "branch-a"))
        assertEquals(
            NotificationNavigationDecision.NavigateProtected(protectedIntent),
            gate.consumePendingNavigation(),
        )
    }

    @Test
    fun authenticatedToLogoutClearsPendingRouteAndDashboardSuppression() {
        val gate = NotificationNavigationGate()
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))
        gate.enqueue(protectedIntent, "logout-clear")
        assertEquals(true, gate.shouldSuppressDefaultDashboardNavigation())

        gate.onAuthStateChanged(AuthState.Unauthenticated)

        assertEquals(false, gate.hasPendingNavigation())
        assertEquals(false, gate.shouldSuppressDefaultDashboardNavigation())
        assertNull(gate.consumePendingNavigation())
    }

    @Test
    fun authenticatedToErrorClearsPendingRoute() {
        val gate = NotificationNavigationGate()
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))
        gate.enqueue(protectedIntent, "error-clear")

        gate.onAuthStateChanged(AuthState.Error("세션이 만료되었습니다"))

        assertEquals(false, gate.hasPendingNavigation())
        assertNull(gate.consumePendingNavigation())
    }

    @Test
    fun branchSelectionLogoutClearsPendingRouteBeforeAnotherLogin() {
        val gate = NotificationNavigationGate()
        gate.onAuthStateChanged(AuthState.RequiresBranchSelection)
        gate.enqueue(protectedIntent, "branch-logout-clear")

        gate.onAuthStateChanged(AuthState.Unauthenticated)

        assertEquals(false, gate.hasPendingNavigation())
        gate.onAuthStateChanged(AuthState.Authenticated("user-2", "admin"))
        assertNull(gate.consumePendingNavigation())
    }

    @Test
    fun accountReplacementClearsRouteBoundToPreviousPrincipal() {
        val gate = NotificationNavigationGate()
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))
        gate.enqueue(protectedIntent, "account-replacement")
        assertEquals(true, gate.hasPendingNavigation())

        gate.onAuthStateChanged(AuthState.Authenticated("user-2", "admin"))

        assertEquals(false, gate.hasPendingNavigation())
        assertNull(gate.consumePendingNavigation())
    }

    @Test
    fun invalidDeliveryClearsAnyPreviouslyQueuedRoute() {
        val gate = NotificationNavigationGate()
        gate.enqueue(protectedIntent, "valid-before-invalid")

        assertEquals(
            NotificationNavigationDecision.Rejected,
            gate.enqueue(NavigationIntent.Unknown, "invalid-delivery"),
        )
        assertEquals(false, gate.hasPendingNavigation())
        assertNull(gate.consumePendingNavigation())
    }

    @Test
    fun lifecycleClearDropsStaleRouteButKeepsDeliveryLedgerBounded() {
        val gate = NotificationNavigationGate(maxDeliveredKeys = 2)
        gate.enqueue(protectedIntent, "lifecycle-route")
        assertEquals(true, gate.hasPendingNavigation())

        gate.clearPendingNavigation()

        assertEquals(false, gate.hasPendingNavigation())
        assertEquals(
            NotificationNavigationDecision.Duplicate,
            gate.enqueue(NavigationIntent.Settings, "lifecycle-route"),
        )
    }

    @Test
    fun noPendingRouteLeavesOrdinaryDashboardFallbackEnabled() {
        val gate = NotificationNavigationGate()
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))

        assertEquals(false, gate.shouldSuppressDefaultDashboardNavigation())
        assertNull(gate.consumePendingNavigation())
    }

    @Test
    fun duplicateDeliveryIdCanNavigateOnlyOnce() {
        val gate = NotificationNavigationGate()
        gate.onAuthStateChanged(AuthState.Authenticated("user-1", "admin"))

        assertEquals(
            NotificationNavigationDecision.Deferred,
            gate.enqueue(protectedIntent, "single-navigation"),
        )
        assertEquals(
            NotificationNavigationDecision.NavigateProtected(protectedIntent),
            gate.consumePendingNavigation(),
        )
        assertEquals(
            NotificationNavigationDecision.Duplicate,
            gate.enqueue(protectedIntent, "single-navigation"),
        )
        assertNull(gate.consumePendingNavigation())
    }
}
