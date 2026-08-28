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
    private val deliveredNavigationKeys = LinkedHashSet<String>()
    private var authState: AuthState = AuthState.Initial
    private var pendingNavigation: NavigationIntent? = null

    /**
     * Queue a parsed, allowlisted route. The route is consumed separately so
     * the caller can wait for a ready navigation host. Duplicate deliveries
     * are ignored before they can replace an already queued route.
     */
    fun enqueue(intent: NavigationIntent, deliveryKey: String): NotificationNavigationDecision {
        if (intent is NavigationIntent.Unknown) {
            return NotificationNavigationDecision.Rejected
        }
        if (!deliveredNavigationKeys.add(deliveryKey)) {
            return NotificationNavigationDecision.Duplicate
        }

        while (deliveredNavigationKeys.size > maxDeliveredKeys) {
            deliveredNavigationKeys.remove(deliveredNavigationKeys.first())
        }

        pendingNavigation = intent
        return NotificationNavigationDecision.Deferred
    }

    /**
     * Update the shared auth state. A queued route is released only after a
     * fully authenticated state; all other terminal states use canonical
     * login/branch-selection fallbacks.
     */
    fun onAuthStateChanged(state: AuthState) {
        authState = state
    }

    /** Consume one queued route only when the caller has a ready navigation host. */
    fun consumePendingNavigation(): NotificationNavigationDecision? {
        val intent = pendingNavigation ?: return null

        return when (authState) {
            AuthState.Initial,
            AuthState.Loading,
            -> NotificationNavigationDecision.Deferred

            is AuthState.Authenticated -> {
                pendingNavigation = null
                NotificationNavigationDecision.NavigateProtected(intent)
            }

            AuthState.RequiresBranchSelection -> {
                pendingNavigation = null
                NotificationNavigationDecision.SelectBranch
            }

            AuthState.Unauthenticated,
            is AuthState.Error,
            -> {
                pendingNavigation = null
                NotificationNavigationDecision.Login
            }
        }
    }

    private companion object {
        const val DEFAULT_MAX_DELIVERED_KEYS = 32
    }
}
