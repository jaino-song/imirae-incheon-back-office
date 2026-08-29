#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FCM_SERVICE="$NATIVE_ROOT/androidApp/src/main/kotlin/com/imirae/incheon/notification/FCMService.kt"
NAVIGATION="$NATIVE_ROOT/androidApp/src/main/kotlin/com/imirae/incheon/navigation/NotificationNavigation.kt"
MAIN_ACTIVITY="$NATIVE_ROOT/androidApp/src/main/kotlin/com/imirae/incheon/MainActivity.kt"
NAV_GRAPH="$NATIVE_ROOT/androidApp/src/main/kotlin/com/imirae/incheon/navigation/NavGraph.kt"
LOGIN_SCREEN="$NATIVE_ROOT/androidApp/src/main/kotlin/com/imirae/incheon/ui/auth/LoginScreen.kt"
SELECT_BRANCH_SCREEN="$NATIVE_ROOT/androidApp/src/main/kotlin/com/imirae/incheon/ui/auth/SelectBranchScreen.kt"
AUTH_VIEW_MODEL="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/viewmodel/AuthViewModel.kt"
AUTH_GATE="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/notification/NotificationNavigationGate.kt"
DELIVERY_IDENTITY="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/notification/NotificationDeliveryIdentity.kt"
NOTIFICATION_MANAGER="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/notification/NotificationManager.kt"

for source in "$FCM_SERVICE" "$NAVIGATION" "$MAIN_ACTIVITY" "$NAV_GRAPH" "$LOGIN_SCREEN" "$SELECT_BRANCH_SCREEN" "$AUTH_VIEW_MODEL" "$AUTH_GATE" "$DELIVERY_IDENTITY" "$NOTIFICATION_MANAGER"; do
    if [[ ! -f "$source" ]]; then
        echo "Android push intent contract failure: missing source file $source" >&2
        exit 2
    fi
done

require_text() {
    local source="$1"
    local expected="$2"
    local description="$3"

    if ! grep -Fq -- "$expected" "$source"; then
        echo "Android push intent contract failure: $description" >&2
        exit 1
    fi
}

forbidden_text() {
    local source="$1"
    local forbidden="$2"
    local description="$3"

    if grep -Fq -- "$forbidden" "$source"; then
        echo "Android push intent contract failure: $description" >&2
        exit 1
    fi
}

# Foreground delivery must remain visible and carry only a parsed navigation intent.
require_text "$FCM_SERVICE" "val navigationIntent = notificationManager.routeNotification(payload)" \
    "foreground messages do not parse their navigation intent"
require_text "$FCM_SERVICE" "showNotification(context, payload, navigationIntent, providerMessageId)" \
    "foreground messages are not rendered as system notifications"
require_text "$FCM_SERVICE" "val safeDeepLink = NotificationNavigation.deepLinkFor(navigationIntent)" \
    "notification extras are not derived from the allowlisted intent"
require_text "$FCM_SERVICE" "providerMessageId = remoteMessage.messageId" \
    "FCM provider delivery identity is not carried into notification construction"
require_text "$FCM_SERVICE" "val deliveryKey = NotificationNavigation.deliveryKey(" \
    "notification delivery identity is not selected before PendingIntent creation"
require_text "$FCM_SERVICE" "putExtra(NotificationNavigation.EXTRA_DELIVERY_KEY, deliveryKey)" \
    "the chosen delivery identity is not embedded in the notification PendingIntent"
require_text "$FCM_SERVICE" "PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE" \
    "notification PendingIntent flags do not preserve safe extras"
require_text "$FCM_SERVICE" "NotificationNavigation.requestCode(deliveryKey)" \
    "notification PendingIntents can reuse another notification's extras"
forbidden_text "$FCM_SERVICE" "onNewToken" \
    "FCM token registration was reintroduced"
forbidden_text "$FCM_SERVICE" "registerDeviceToken" \
    "FCM token registration was reintroduced"

# Activity delivery must cover cold start, warm start, invalid fallback, and dedupe.
require_text "$NAVIGATION" "val navigationIntent = router.route(rawDeepLink)" \
    "PendingIntent links are not parsed at the activity boundary"
require_text "$NAVIGATION" "if (navigationIntent is NavigationIntent.Unknown)" \
    "unknown links are not rejected before navigation"
require_text "$NAVIGATION" "const val EXTRA_DEEP_LINK" \
    "the canonical deep-link extra is not defined"
require_text "$NAVIGATION" "const val EXTRA_DELIVERY_KEY" \
    "the canonical delivery identity extra is not defined"
require_text "$NAVIGATION" "intent.getStringExtra(EXTRA_DELIVERY_KEY)" \
    "activity intents do not preserve the FCM delivery identity"
require_text "$NAVIGATION" "intent.putExtra(EXTRA_DELIVERY_KEY, parsedDeliveryKey)" \
    "id-less direct app links do not receive a per-Intent receipt identity"
forbidden_text "$NAVIGATION" 'navigation:${identityFor(intent)}' \
    "route-only navigation identity can permanently suppress same-route deliveries"
require_text "$NAVIGATION" "NotificationDeliveryIdentity.key(" \
    "notification delivery identity does not prefer payload/provider ids before receipt fallback"
require_text "$NAVIGATION" "UUID.randomUUID().toString()" \
    "id-less deliveries do not receive a generated per-receipt identity"
require_text "$DELIVERY_IDENTITY" "firstNonBlank(notificationId)?.let { return NOTIFICATION_PREFIX + it }" \
    "payload notification ids do not take precedence in delivery identity selection"
require_text "$DELIVERY_IDENTITY" "firstNonBlank(providerMessageId)?.let { return PROVIDER_PREFIX + it }" \
    "provider message ids do not take precedence over receipt fallback when payload id is absent"
require_text "$NAVIGATION" "fun deepLinkFor(intent: NavigationIntent): String?" \
    "validated intents are not converted to canonical deep-link paths"
require_text "$NAVIGATION" "fun routeFor(intent: NavigationIntent): String?" \
    "validated intents are not mapped to a single navigation route"
require_text "$MAIN_ACTIVITY" "enqueueNotificationIntent(intent)" \
    "cold-start notification intents are not queued"
require_text "$MAIN_ACTIVITY" "override fun onNewIntent(intent: Intent)" \
    "warm-start notification intents are not handled"
require_text "$MAIN_ACTIVITY" "setIntent(intent)" \
    "the latest warm-start intent is not retained by the activity"
require_text "$MAIN_ACTIVITY" "NotificationNavigation.parse(intent, deepLinkRouter)" \
    "activity intents bypass the safe parser"
require_text "$MAIN_ACTIVITY" "navigationGate.enqueue(parsedNavigation.intent, parsedNavigation.deliveryKey)" \
    "notification deliveries do not pass through the auth-aware gate"
require_text "$MAIN_ACTIVITY" "launchSingleTop = true" \
    "navigation does not guard against duplicate back-stack entries"

protected_navigation_block() {
    awk '
        /is NotificationNavigationDecision.NavigateProtected -> \{/ { in_block = 1 }
        in_block { print }
        in_block && /NotificationNavigationDecision.Login ->/ { exit }
    ' "$MAIN_ACTIVITY"
}

if ! protected_navigation_block | grep -Fq -- "popUpTo(0) { inclusive = true }"; then
    echo "Android push intent contract failure: protected notification continuation leaves auth screens on the back stack" >&2
    exit 1
fi

# Protected routes must wait for the shared session restoration state machine.
require_text "$AUTH_VIEW_MODEL" "fun restoreSession() = authManager.restoreSession()" \
    "the Android lifecycle cannot initiate shared session restoration"
require_text "$AUTH_VIEW_MODEL" "fun onAppResume() = authManager.onAppResume()" \
    "the Android lifecycle cannot revalidate sessions on foreground"
require_text "$MAIN_ACTIVITY" "authViewModel.restoreSession()" \
    "cold-start activity does not initiate session restoration"
require_text "$MAIN_ACTIVITY" "override fun onResume()" \
    "warm-start activity does not revalidate the shared session"
require_text "$MAIN_ACTIVITY" "authViewModel.onAppResume()" \
    "warm-start activity does not invoke the shared resume hook"
require_text "$MAIN_ACTIVITY" "authViewModel.authState.collectAsState()" \
    "activity does not observe the shared auth state before consuming routes"
require_text "$MAIN_ACTIVITY" "navigationGate.onAuthStateChanged(authState)" \
    "auth-state transitions do not release or refuse pending routes"
require_text "$MAIN_ACTIVITY" "navigationGate.clearPendingNavigation()" \
    "invalid deliveries and activity teardown do not clear stale pending routes"
require_text "$MAIN_ACTIVITY" "if (intent == null) {" \
    "a missing activity intent does not fail closed"
require_text "$MAIN_ACTIVITY" "shouldSuppressDefaultDashboardNavigation()" \
    "auth screens are not coordinated with protected-route continuation"
require_text "$NAV_GRAPH" "shouldNavigateToDashboard: () -> Boolean" \
    "the navigation graph does not expose dashboard fallback coordination"
require_text "$NAV_GRAPH" "onClearPendingNavigation: () -> Unit" \
    "branch-selection logout cannot explicitly clear a pending route"
require_text "$NAV_GRAPH" "onClearPendingNavigation()" \
    "branch-selection logout does not clear its pending route before sign-out"
require_text "$LOGIN_SCREEN" "shouldNavigateToDashboard: () -> Boolean" \
    "login does not accept the protected-route dashboard suppression decision"
require_text "$LOGIN_SCREEN" "if (shouldNavigateToDashboard())" \
    "login can race notification continuation with dashboard navigation"
require_text "$SELECT_BRANCH_SCREEN" "shouldNavigateToDashboard: () -> Boolean" \
    "branch selection does not accept the protected-route dashboard suppression decision"
require_text "$SELECT_BRANCH_SCREEN" "authState is AuthState.Authenticated && shouldNavigateToDashboard()" \
    "branch selection can race notification continuation with dashboard navigation"
require_text "$AUTH_GATE" "AuthState.Initial" \
    "initial/restoring auth state is not deferred"
require_text "$AUTH_GATE" "AuthState.RequiresBranchSelection" \
    "branch-selection-required state is not handled safely"
require_text "$AUTH_GATE" "NotificationNavigationDecision.Login" \
    "unauthenticated routes do not fall back to login"
require_text "$AUTH_GATE" "NotificationNavigationDecision.NavigateProtected(intent)" \
    "authenticated routes do not release through the auth-aware gate"
require_text "$AUTH_GATE" "pendingFallback == FallbackDestination.Login" \
    "login fallback consumes the protected route instead of retaining it"
require_text "$AUTH_GATE" "pendingFallback == FallbackDestination.SelectBranch" \
    "branch-selection fallback consumes the protected route instead of retaining it"
require_text "$AUTH_GATE" "pendingPrincipalId" \
    "pending routes are not tied to the authenticated principal"
require_text "$AUTH_GATE" "replacedAuthenticatedPrincipal" \
    "account replacement does not clear stale pending routes"
require_text "$AUTH_GATE" "abandonedBranchSelection" \
    "branch-selection logout does not clear stale pending routes"
require_text "$AUTH_GATE" "shouldSuppressDefaultDashboardNavigation" \
    "the gate does not coordinate ordinary dashboard fallback"
require_text "$AUTH_GATE" "fun clearPendingNavigation()" \
    "lifecycle and invalid-delivery cleanup is not available"

# Blank links must not be interpreted as the router's empty-path dashboard route.
require_text "$NOTIFICATION_MANAGER" ".firstOrNull { !it.isNullOrEmpty() }" \
    "missing or blank notification links are not rejected safely"

echo "Android push intent source contract passed"
