import { Logger } from "@nestjs/common";
import { tenantContextStore } from "./tenant-context.store";

const logger = new Logger("TenantSystemScope");

/**
 * Enters system scope: `{ origin: "system", systemScope: true }` on the
 * ambient tenant store, bypassing per-branch tenant isolation for the
 * duration of `fn`. This is deliberately kept in its own module (rather than
 * as a method on `TenantContextStore`) so `eslint.config.mjs` can restrict
 * *this specific capability* via `no-restricted-imports` on the module path,
 * independent of the store itself (which must stay freely importable for the
 * Prisma extension task and for `TenantAlsMiddleware`/`TenantGuard`).
 *
 * Every invocation is audited: a structured `tenant_system_scope_used` log
 * event records the call site, so any bypass of tenant isolation is
 * traceable after the fact.
 */
export function runSystemScope<T>(fn: () => T): T {
    // `new Error().stack` frames, after dropping the "Error" header line:
    //   [0] this frame (inside runSystemScope, where the Error was built)
    //   [1] the frame that called runSystemScope — the actual call site
    const stack = new Error().stack ?? "";
    const frames = stack.split("\n").slice(1);
    const callSite = frames[1]?.trim() ?? "unknown";

    logger.log(
        JSON.stringify({
            event: "tenant_system_scope_used",
            callSite,
        }),
    );

    return tenantContextStore.run({ origin: "system", systemScope: true }, fn);
}
