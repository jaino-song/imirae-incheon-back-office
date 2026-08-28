#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AUTH_MANAGER="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/auth/AuthManager.kt"
AUTH_SERVICE="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/data/remote/AuthService.kt"
API_CLIENT="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/network/ApiClient.kt"
AUTH_VIEW_MODEL="$NATIVE_ROOT/shared/src/commonMain/kotlin/com/imirae/incheon/viewmodel/AuthViewModel.kt"
IOS_APP="$NATIVE_ROOT/iosApp/iosApp/imirae_incheonApp.swift"
IOS_NAV="$NATIVE_ROOT/iosApp/iosApp/Navigation/AppNavigation.swift"
IOS_WRAPPER="$NATIVE_ROOT/iosApp/iosApp/Helpers/AuthViewModelWrapper.swift"
IOS_SETTINGS="$NATIVE_ROOT/iosApp/iosApp/Navigation/AppNavigation.swift"
IOS_REGISTER="$NATIVE_ROOT/iosApp/iosApp/Views/Auth/RegisterView.swift"
ANDROID_NAV="$NATIVE_ROOT/androidApp/src/main/kotlin/com/imirae/incheon/navigation/NavGraph.kt"

for source in "$AUTH_MANAGER" "$AUTH_SERVICE" "$API_CLIENT" "$AUTH_VIEW_MODEL" "$IOS_APP" "$IOS_NAV" "$IOS_WRAPPER" "$IOS_REGISTER" "$ANDROID_NAV"; do
    if [[ ! -f "$source" ]]; then
        echo "Native auth lifecycle contract failure: missing $source" >&2
        exit 2
    fi
done

require_text() {
    local source="$1"
    local expected="$2"
    local description="$3"
    if ! grep -Fq -- "$expected" "$source"; then
        echo "Native auth lifecycle contract failure: $description" >&2
        exit 1
    fi
}

forbid_text() {
    local source="$1"
    local forbidden="$2"
    local description="$3"
    if grep -Fq -- "$forbidden" "$source"; then
        echo "Native auth lifecycle contract failure: $description" >&2
        exit 1
    fi
}

# Shared auth policy and backend route/body contracts.
require_text "$AUTH_MANAGER" "suspend fun logoutAndAwait(): LogoutState" "logout cannot be awaited by a lifecycle host"
require_text "$AUTH_MANAGER" "forceLogout(revokeRemote = true)" "logout does not record the remote revoke outcome"
require_text "$AUTH_MANAGER" "clearLocalSession()" "logout does not clear local authority"
require_text "$AUTH_MANAGER" "runCatching { secureStorage.remove(key) }" "credential cleanup is not isolated per secure-storage key"
require_text "$AUTH_SERVICE" "RegisterRequest(email, password, name, phone, birthDate)" "registration body does not carry required canonical fields"
require_text "$AUTH_SERVICE" "\"/auth/verify-email\"" "verification route is not canonical"
require_text "$AUTH_SERVICE" "VerifyEmailRequest(token)" "verification token is not sent in the request body"
require_text "$AUTH_SERVICE" "\"/auth/refresh-token\"" "refresh route does not match the backend"
forbid_text "$AUTH_SERVICE" "\"/auth/refresh\"" "legacy refresh route remains"
forbid_text "$AUTH_SERVICE" "verify-email?token=" "verification token remains in the query string"
require_text "$API_CLIENT" "statusCode == HttpStatusCode.Unauthorized.value" "401 responses do not enter the refresh path"
require_text "$API_CLIENT" "!unauthorizedRetried" "401 retry is not bounded to one attempt"
require_text "$AUTH_VIEW_MODEL" "fun onAppResume() = authManager.onAppResume()" "shared resume hook is missing"

# iOS launch/resume and one-shot deep-link replay.
require_text "$IOS_APP" "static let shared = DeepLinkHandler()" "cold-start links have no retained handler"
require_text "$IOS_APP" "router.routePath(uri: url.absoluteString)" "iOS bypasses the shared route parser"
require_text "$IOS_APP" "pendingRoute" "iOS has no single pending destination"
require_text "$IOS_APP" "func consumePendingRoute(_ route: String)" "iOS deep links are not consumed explicitly"
require_text "$IOS_NAV" "authWrapper.restoreSession()" "iOS launch does not restore the shared session"
require_text "$IOS_NAV" "UIApplication.didBecomeActiveNotification" "iOS resume does not revalidate the session"
require_text "$IOS_NAV" "case is AuthState.RequiresBranchSelection" "branch selection replay is not gated"
require_text "$IOS_NAV" "case is AuthState.Unauthenticated, is AuthState.Error" "unauthenticated links do not remain behind login"
require_text "$IOS_NAV" "deepLinkHandler.clearPendingRoute()" "principal/logout transitions do not discard stale links"
require_text "$IOS_WRAPPER" "func onAppResume()" "iOS wrapper does not expose the shared resume hook"
require_text "$IOS_WRAPPER" "func restoreSession()" "iOS wrapper does not expose the shared restore hook"
require_text "$IOS_APP" "DeepLinkHandler.shared.handle(url: url)" "APNs taps do not enter the shared deep-link handler"
require_text "$IOS_REGISTER" "birthDate" "iOS registration does not collect birthDate"
require_text "$IOS_REGISTER" "phone: phone, birthDate: birthDate" "iOS registration body omits required fields"

# Android settings must invoke shared logout and wait for the published state.
require_text "$ANDROID_NAV" "authViewModel.logout()" "Android settings bypasses shared logout"
require_text "$ANDROID_NAV" "logoutRequested && authState is AuthState.Unauthenticated" "Android navigates before local cleanup"

echo "Native auth lifecycle source contract passed"
