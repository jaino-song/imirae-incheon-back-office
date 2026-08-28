#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FCM_SERVICE="$NATIVE_ROOT/androidApp/src/main/kotlin/com/imirae/incheon/notification/FCMService.kt"
NAVIGATION="$NATIVE_ROOT/androidApp/src/main/kotlin/com/imirae/incheon/navigation/NotificationNavigation.kt"
MAIN_ACTIVITY="$NATIVE_ROOT/androidApp/src/main/kotlin/com/imirae/incheon/MainActivity.kt"
AUTH_VIEW_MODEL="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/viewmodel/AuthViewModel.kt"
AUTH_GATE="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/notification/NotificationNavigationGate.kt"
NOTIFICATION_MANAGER="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/notification/NotificationManager.kt"

for source in "$FCM_SERVICE" "$NAVIGATION" "$MAIN_ACTIVITY" "$AUTH_VIEW_MODEL" "$AUTH_GATE" "$NOTIFICATION_MANAGER"; do
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
require_text "$FCM_SERVICE" "showNotification(context, payload, navigationIntent)" \
    "foreground messages are not rendered as system notifications"
require_text "$FCM_SERVICE" "val safeDeepLink = NotificationNavigation.deepLinkFor(navigationIntent)" \
    "notification extras are not derived from the allowlisted intent"
require_text "$FCM_SERVICE" "PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE" \
    "notification PendingIntent flags do not preserve safe extras"
require_text "$FCM_SERVICE" "NotificationNavigation.requestCode(navigationIntent, notificationId)" \
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

# Protected routes must wait for the shared session restoration state machine.
require_text "$AUTH_VIEW_MODEL" "fun restoreSession() = authManager.restoreSession()" \
    "the Android lifecycle cannot initiate shared session restoration"
require_text "$MAIN_ACTIVITY" "authViewModel.restoreSession()" \
    "cold-start activity does not initiate session restoration"
require_text "$MAIN_ACTIVITY" "authViewModel.authState.collectAsState()" \
    "activity does not observe the shared auth state before consuming routes"
require_text "$MAIN_ACTIVITY" "navigationGate.onAuthStateChanged(authState)" \
    "auth-state transitions do not release or refuse pending routes"
require_text "$AUTH_GATE" "AuthState.Initial" \
    "initial/restoring auth state is not deferred"
require_text "$AUTH_GATE" "AuthState.RequiresBranchSelection" \
    "branch-selection-required state is not handled safely"
require_text "$AUTH_GATE" "NotificationNavigationDecision.Login" \
    "unauthenticated routes do not fall back to login"
require_text "$AUTH_GATE" "NotificationNavigationDecision.NavigateProtected(intent)" \
    "authenticated routes do not release through the auth-aware gate"

# Blank links must not be interpreted as the router's empty-path dashboard route.
require_text "$NOTIFICATION_MANAGER" ".firstOrNull { !it.isNullOrEmpty() }" \
    "missing or blank notification links are not rejected safely"

echo "Android push intent source contract passed"
