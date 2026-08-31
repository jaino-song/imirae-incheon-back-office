import { tenantContextStore } from "./tenant-context.store";

/**
 * Enters system scope: `{ origin: "system", systemScope: true }` on the
 * ambient tenant store, bypassing per-branch tenant isolation for the
 * duration of `fn`. This is deliberately kept in its own module (rather than
 * as a method on `TenantContextStore`) so `eslint.config.mjs` can restrict
 * *this specific capability* via `no-restricted-imports` on the module path,
 * independent of the store itself (which must stay freely importable for the
 * Prisma extension task and for `TenantAlsMiddleware`/`TenantGuard`).
 *
 * Every invocation is audited: `TenantContextStore.run` emits a structured
 * `tenant_system_scope_used` log event whenever the entered store has
 * `systemScope: true` — that's true for ANY caller of `store.run(...)`
 * directly, not just calls that go through this wrapper. This function's
 * only remaining job is to compute ITS OWN caller's call site (rather than
 * reporting itself as the call site, which is what the store's own stack
 * capture would otherwise see, since this function is the direct caller of
 * `store.run`) and pass it through so the audit log stays precise.
 */
export function runSystemScope<T>(fn: () => T): T {
    // `new Error().stack` frames, after dropping the "Error" header line:
    //   [0] this frame (inside runSystemScope, where the Error was built)
    //   [1] the frame that called runSystemScope — the actual call site
    const stack = new Error().stack ?? "";
    const frames = stack.split("\n").slice(1);
    const callSite = frames[1]?.trim() ?? "unknown";

    return tenantContextStore.run({ origin: "system", systemScope: true }, fn, { callSite });
}
