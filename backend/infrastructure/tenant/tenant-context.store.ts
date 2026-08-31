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

/**
 * Plain (non-injectable) singleton wrapping `AsyncLocalStorage`. Every HTTP
 * request enters a store via `TenantAlsMiddleware`; `TenantGuard` then
 * write-throughs the resolved branchId onto the active store via
 * `setBranchId`. System-scope entry (bypassing tenant isolation) is a
 * separate, audited concern — see `run-system-scope.ts`.
 */
export class TenantContextStore {
    private readonly logger = new Logger(TenantContextStore.name);
    private readonly als = new AsyncLocalStorage<TenantStoreState>();

    /**
     * Runs `fn` with `state` as the active store for the lifetime of `fn`
     * (including everything awaited within it). Nested/concurrent calls each
     * get their own isolated state.
     */
    run<T>(state: TenantStoreState, fn: () => T): T {
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
