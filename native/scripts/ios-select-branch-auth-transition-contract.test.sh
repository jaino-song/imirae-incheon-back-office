#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SELECT_BRANCH_VIEW="$NATIVE_ROOT/iosApp/iosApp/Views/Auth/SelectBranchView.swift"

if [[ ! -f "$SELECT_BRANCH_VIEW" ]]; then
    echo "iOS SelectBranch auth transition contract failure: missing source file" >&2
    exit 2
fi

require_text() {
    local expected="$1"
    local description="$2"

    if ! grep -Fq -- "$expected" "$SELECT_BRANCH_VIEW"; then
        echo "iOS SelectBranch auth transition contract failure: $description" >&2
        exit 1
    fi
}

require_text "@State private var isLoggingOut = false" \
    "logout transition is not tracked independently from the shared loading state"
require_text "if !isLoggingOut, newState is AuthState.Authenticated" \
    "an in-flight logout can still route to the dashboard"
require_text "if isLoggingOut, newState is AuthState.Unauthenticated" \
    "login navigation is not gated on completed unauthenticated state"
require_text "guard !isLoggingOut else {" \
    "duplicate logout interactions are not rejected"
require_text ".disabled(viewModel.isLoading || isLoggingOut)" \
    "auth actions are not disabled during logout"

logout_start="$(grep -n -m1 "private func logout()" "$SELECT_BRANCH_VIEW" | cut -d: -f1)"
logout_guard="$(grep -n -m1 "guard !isLoggingOut else" "$SELECT_BRANCH_VIEW" | cut -d: -f1)"
logout_mark="$(grep -n -m1 "isLoggingOut = true" "$SELECT_BRANCH_VIEW" | cut -d: -f1)"
logout_call="$(grep -n -m1 "viewModel.logout()" "$SELECT_BRANCH_VIEW" | cut -d: -f1)"
unauthenticated_state="$(grep -n -m1 "if isLoggingOut, newState is AuthState.Unauthenticated" "$SELECT_BRANCH_VIEW" | cut -d: -f1)"
login_navigation="$(grep -n -m1 "onNavigateToLogin()" "$SELECT_BRANCH_VIEW" | cut -d: -f1)"

if [[ -z "$logout_start" || -z "$logout_guard" || -z "$logout_mark" || -z "$logout_call" ]]; then
    echo "iOS SelectBranch auth transition contract failure: logout ordering markers are missing" >&2
    exit 1
fi

if (( logout_guard <= logout_start || logout_mark <= logout_guard || logout_call <= logout_mark )); then
    echo "iOS SelectBranch auth transition contract failure: logout must guard, mark, then start the shared logout" >&2
    exit 1
fi

logout_body="$(awk '/private func logout\(\)/,/^    }/' "$SELECT_BRANCH_VIEW")"
if grep -Fq -- "onNavigateToLogin()" <<< "$logout_body"; then
    echo "iOS SelectBranch auth transition contract failure: logout navigates before completion" >&2
    exit 1
fi

if [[ -z "$unauthenticated_state" || -z "$login_navigation" ]] || (( login_navigation <= unauthenticated_state )); then
    echo "iOS SelectBranch auth transition contract failure: login navigation must follow unauthenticated state" >&2
    exit 1
fi

disabled_count="$(grep -Fc -- ".disabled(viewModel.isLoading || isLoggingOut)" "$SELECT_BRANCH_VIEW")"
if (( disabled_count < 3 )); then
    echo "iOS SelectBranch auth transition contract failure: branch, retry, and logout actions must be disabled during logout" >&2
    exit 1
fi

echo "iOS SelectBranch auth transition source contract passed"
