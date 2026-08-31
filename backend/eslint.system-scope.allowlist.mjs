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
];
