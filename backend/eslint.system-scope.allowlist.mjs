// Files allowed to import `infrastructure/tenant/run-system-scope`, which
// grants a caller a system-scope tenant bypass (isolation is disabled for
// the duration of the callback).
//
// This list only grows through explicit review: every entry is a place
// where tenant isolation is deliberately and knowingly bypassed. Do NOT add
// an entry to silence the lint error without confirming the bypass is
// actually required and audited (runSystemScope logs a
// `tenant_system_scope_used` event on every call).
export const systemScopeImportAllowlist = [
    "**/*.spec.ts",
    // TenantGuard wraps its own membership-lookup query (which runs before
    // `assignPrincipal` sets the ALS store's branchId) in `runSystemScope`
    // so it doesn't self-trip the tenant-isolation extension's
    // `http_no_tenant` violation. See tenant.guard.ts canActivate().
    "infrastructure/tenant/tenant.guard.ts",
    // AuthService enumerates the authenticated user's OWN user_branch
    // memberships (login result, getUserBranches, pending onboarding) and
    // verifies membership during branch selection/switch — all before or
    // while the tenant store's branchId is being established, always pinned
    // to `where: { userId }` (+ target branchId).
    "application/services/auth.service.ts",
    // AuthSessionService re-validates the session's selected-branch
    // membership during token refresh, before any tenant store branchId
    // exists for the request.
    "application/services/auth-session.service.ts",
    // CallIngestGuard resolves the call-transcript webhook's bearer token to
    // its branch. The lookup is on `call_ingest_token` (a tenant model)
    // BEFORE any branchId exists on the request store — resolving it is the
    // point of the query — so it self-trips `http_no_tenant` unwrapped, which
    // under enforce 500s every n8n delivery. The bypass covers the
    // token→branch lookup (pinned to the presented token's hash) and the
    // un-awaited `lastUsedAt` touch that lookup fires, which is keyed on the
    // row's primary key and never touches branchId; the guard then calls
    // setBranchId so everything downstream is branch-scoped.
    "infrastructure/auth/call-ingest.guard.ts",
    // SbReceiptLinkTokenRepository's token-keyed lookups (findByLinkTokenHash,
    // update, incrementFailedAttempts) back the public, unauthenticated
    // receipt-link status/verify endpoints: the presented link token IS the
    // credential, and the branch is resolved BY the lookup, not known before
    // it — the same shape as TenantGuard's own bypass above. See the class
    // comment on SbReceiptLinkTokenRepository.
    "infrastructure/database/repositories/sb.receipt-link-token.repository.ts",
];
