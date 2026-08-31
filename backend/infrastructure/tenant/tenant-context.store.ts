import { AsyncLocalStorage } from "node:async_hooks";
import { Logger } from "@nestjs/common";

/**
 * Ambient, request-spanning tenant state carried alongside (not instead of)
 * the existing REQUEST-scoped `TenantContext`. A later Prisma extension task
 * consults this to enforce branch isolation at the query layer, so it must be
 * importable as a plain singleton without going through Nest DI.
 */
export interface TenantStoreState {
    origin: "http" | "system";
    branchId?: string;
    systemScope?: boolean;
}

export interface TenantStoreRunOptions {
    /**
     * Overrides the call site recorded on the `tenant_system_scope_used`
     * audit log (see `run()`). `runSystemScope` passes its OWN caller's call
     * site here so the log points at the real bypass site rather than at
     * `runSystemScope` itself (which is otherwise what `run()`'s own stack
     * capture would report, since `runSystemScope` is the direct caller of
     * `run()` in that path).
     */
    callSite?: string;
}

/**
 * Plain (non-injectable) singleton wrapping `AsyncLocalStorage`. Every HTTP
 * request enters a store via `TenantAlsMiddleware`; `TenantGuard` then
 * write-throughs the resolved branchId onto the active store via
 * `setBranchId`. System-scope entry (bypassing tenant isolation) is a
 * separate, audited concern: `run-system-scope.ts` is the sanctioned,
 * lint-gated front door for it, but ANY caller can enter system scope by
 * calling `run({ systemScope: true, ... }, fn)` directly on this store (it
 * must stay freely importable for the Prisma extension task,
 * `TenantAlsMiddleware`, and `TenantGuard`). So the audit log lives HERE,
 * not in the wrapper, ensuring every system-scope entry is logged
 * regardless of which path was used to reach it.
 */
export class TenantContextStore {
    private readonly logger = new Logger(TenantContextStore.name);
    private readonly als = new AsyncLocalStorage<TenantStoreState>();

    /**
     * Runs `fn` with `state` as the active store for the lifetime of `fn`
     * (including everything awaited within it). Nested/concurrent calls each
     * get their own isolated state.
     *
     * When `state.systemScope` is true, emits a structured
     * `tenant_system_scope_used` audit log recording the call site (either
     * `options.callSite`, or derived from this call's own stack when
     * omitted) — so a bypass entered via the raw capability is audited
     * exactly like one entered through `runSystemScope`.
     */
    run<T>(state: TenantStoreState, fn: () => T, options?: TenantStoreRunOptions): T {
        if (state.systemScope) {
            // `new Error().stack` frames, after dropping the "Error" header line:
            //   [0] this frame (inside run(), where the Error was built)
            //   [1] the frame that called run() — the actual call site
            const stack = new Error().stack ?? "";
            const frames = stack.split("\n").slice(1);
            const callSite = options?.callSite ?? frames[1]?.trim() ?? "unknown";

            this.logger.log(
                JSON.stringify({
                    event: "tenant_system_scope_used",
                    callSite,
                }),
            );
        }

        return this.als.run(state, fn);
    }

    /** Returns the state active for the current async execution context, if any. */
    get(): TenantStoreState | undefined {
        return this.als.getStore();
    }

    /**
     * Mutates the branchId on the CURRENTLY active store. No-ops (with a
     * debug log) when called outside any `run` — e.g. during app bootstrap,
     * background jobs, or tests that construct `TenantGuard` directly.
     */
    setBranchId(branchId: string): void {
        const state = this.als.getStore();
        if (!state) {
            this.logger.debug(
                "setBranchId called with no active TenantContextStore run(); no-op",
            );
            return;
        }
        state.branchId = branchId;
    }
}

/**
 * Module-level singleton. Import this directly (not via Nest DI) from
 * non-request-scoped code, such as the Prisma extension task.
 */
export const tenantContextStore = new TenantContextStore();
