package com.imirae.incheon.notification

import com.imirae.incheon.auth.AuthState
import com.imirae.incheon.deeplink.NavigationIntent

/**
 * Holds validated notification routes until the shared auth state is settled.
 *
 * The Android activity owns navigation, while this class owns only the
 * security-sensitive decision about whether a route may be consumed. This
 * keeps auth policy in one place and makes cold/warm lifecycle behavior
 * deterministic in common tests.
 */
sealed class NotificationNavigationDecision {
    data object Deferred : NotificationNavigationDecision()
    data object Duplicate : NotificationNavigationDecision()
    data object Rejected : NotificationNavigationDecision()
    data class NavigateProtected(val intent: NavigationIntent) : NotificationNavigationDecision()
    data object Login : NotificationNavigationDecision()
    data object SelectBranch : NotificationNavigationDecision()
}

class NotificationNavigationGate(
    private val maxDeliveredKeys: Int = DEFAULT_MAX_DELIVERED_KEYS,
) {
    init {
        require(maxDeliveredKeys > 0) { "maxDeliveredKeys must be positive" }
    }

    private enum class FallbackDestination {
        Login,
        SelectBranch,
    }

    private val deliveredNavigationKeys = LinkedHashSet<String>()
    private var authState: AuthState = AuthState.Initial
    private var pendingNavigation: NavigationIntent? = null
    private var pendingPrincipalId: String? = null
    private var pendingFallback: FallbackDestination? = null
    private var continuationConsumedForPrincipal = false

    /**
     * Queue a parsed, allowlisted route. The route is consumed separately so
     * the caller can wait for a ready navigation host. Duplicate deliveries
     * are ignored before they can replace an already queued route.
     */
    fun enqueue(intent: NavigationIntent, deliveryKey: String): NotificationNavigationDecision {
        if (intent is NavigationIntent.Unknown || deliveryKey.isBlank()) {
            clearPendingNavigation()
            return NotificationNavigationDecision.Rejected
        }
        if (!deliveredNavigationKeys.add(deliveryKey)) {
            return NotificationNavigationDecision.Duplicate
        }

        while (deliveredNavigationKeys.size > maxDeliveredKeys) {
            deliveredNavigationKeys.remove(deliveredNavigationKeys.first())
        }

        pendingNavigation = intent
        pendingPrincipalId = (authState as? AuthState.Authenticated)?.userId
        pendingFallback = null
        continuationConsumedForPrincipal = false
        return NotificationNavigationDecision.Deferred
    }

    /**
     * Update the shared auth state. A queued route is released only after a
     * fully authenticated state; all other terminal states use canonical
     * login/branch-selection fallbacks while retaining the route for the
     * eventual authenticated continuation.
     */
    fun onAuthStateChanged(state: AuthState) {
        val previousState = authState
        val previousPrincipalId = (previousState as? AuthState.Authenticated)?.userId
        val nextPrincipalId = (state as? AuthState.Authenticated)?.userId
        val leftAuthenticatedSession = previousState is AuthState.Authenticated && state !is AuthState.Authenticated
        val abandonedBranchSelection = previousState is AuthState.RequiresBranchSelection &&
            state is AuthState.Unauthenticated
        val replacedAuthenticatedPrincipal = previousPrincipalId != null &&
            nextPrincipalId != null &&
            previousPrincipalId != nextPrincipalId
        val pendingBelongsToAnotherPrincipal = pendingPrincipalId != null &&
            nextPrincipalId != null &&
            pendingPrincipalId != nextPrincipalId

        if (leftAuthenticatedSession || abandonedBranchSelection || replacedAuthenticatedPrincipal || pendingBelongsToAnotherPrincipal) {
            clearPendingNavigation()
        }

        authState = state
        if (state is AuthState.Authenticated && pendingNavigation != null && pendingPrincipalId == null) {
            pendingPrincipalId = state.userId
        }
    }

    /** Whether a notification route is still waiting for an authenticated host. */
    fun hasPendingNavigation(): Boolean = pendingNavigation != null

    /**
     * Auth screens use this to avoid racing the one-shot notification continuation
     * with their ordinary dashboard fallback.
     */
    fun shouldSuppressDefaultDashboardNavigation(): Boolean =
        pendingNavigation != null || continuationConsumedForPrincipal

    /**
     * Drop a route when the activity/session lifecycle can no longer prove that
     * the original principal still owns it. The delivery ledger remains bounded
     * and intact so duplicate receipts are still suppressed.
     */
    fun clearPendingNavigation() {
        pendingNavigation = null
        pendingPrincipalId = null
        pendingFallback = null
        continuationConsumedForPrincipal = false
    }

    /** Consume one queued route only when the caller has a ready navigation host. */
    fun consumePendingNavigation(): NotificationNavigationDecision? {
        val intent = pendingNavigation ?: return null

        return when (authState) {
            AuthState.Initial,
            AuthState.Loading,
            -> NotificationNavigationDecision.Deferred

            is AuthState.Authenticated -> {
                val authenticatedState = authState as AuthState.Authenticated
                if (pendingPrincipalId != null && pendingPrincipalId != authenticatedState.userId) {
                    clearPendingNavigation()
                    return NotificationNavigationDecision.Rejected
                }
                pendingNavigation = null
                pendingPrincipalId = null
                pendingFallback = null
                continuationConsumedForPrincipal = true
                NotificationNavigationDecision.NavigateProtected(intent)
            }

            AuthState.RequiresBranchSelection -> {
                if (pendingFallback == FallbackDestination.SelectBranch) {
                    null
                } else {
                    pendingFallback = FallbackDestination.SelectBranch
                    NotificationNavigationDecision.SelectBranch
                }
            }

            AuthState.Unauthenticated,
            is AuthState.Error,
            -> {
                if (pendingFallback == FallbackDestination.Login) {
                    null
                } else {
                    pendingFallback = FallbackDestination.Login
                    NotificationNavigationDecision.Login
                }
            }
        }
    }

    private companion object {
        const val DEFAULT_MAX_DELIVERED_KEYS = 32
    }
}
