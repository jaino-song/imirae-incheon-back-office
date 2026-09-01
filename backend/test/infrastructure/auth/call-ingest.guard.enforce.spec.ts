import { ExecutionContext } from "@nestjs/common";
import { CallIngestGuard } from "infrastructure/auth/call-ingest.guard";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import { handleModelOperation } from "infrastructure/database/tenant-isolation.extension";
import { TenantIsolationViolationError } from "infrastructure/tenant/tenant-isolation.reporter";

jest.mock("@sentry/nestjs", () => ({
    withScope: (fn: (scope: unknown) => void) =>
        fn({ setLevel: jest.fn(), setTag: jest.fn(), setContext: jest.fn() }),
    captureMessage: jest.fn(),
}));

/**
 * Regression harness for the enforce-mode call-ingest blocker.
 *
 * `call_ingest_token` IS a tenant model, and CallIngestGuard runs on a
 * request whose ALS store is `{ origin: "http" }` with NO branchId —
 * resolving the branch is the whole point of the query. Unwrapped, that
 * self-trips the isolation extension's `http_no_tenant` check, which under
 * TENANT_ISOLATION_MODE=enforce THROWS: every n8n webhook delivery 500s the
 * moment the operator flips the mode.
 *
 * Why this lives here and not in the e2e suite: `test/e2e/call-inbox*` builds
 * its Nest testing module from CallInboxModule directly, not AppModule, so
 * TenantAlsMiddleware is never installed and no ALS store exists. With no
 * store the extension bypasses unconditionally (policy-matrix case 1), so the
 * e2e passes under enforce whether or not this bug is present — it cannot see
 * this class of defect at all. This harness supplies the missing store and
 * routes the token lookup through the REAL extension entry point.
 */

const BRANCH_ID = "20000000-0000-4000-8000-000000000001";

function contextWithAuth(header: string): ExecutionContext {
    const request: Record<string, unknown> = { headers: { authorization: header } };
    return {
        switchToHttp: () => ({ getRequest: () => request }),
        __request: request,
    } as unknown as ExecutionContext & { __request: Record<string, unknown> };
}

describe("CallIngestGuard under TENANT_ISOLATION_MODE=enforce", () => {
    let previousMode: string | undefined;
    let tokenService: CallIngestTokenService;
    let guard: CallIngestGuard;

    beforeEach(() => {
        previousMode = process.env["TENANT_ISOLATION_MODE"];
        process.env["TENANT_ISOLATION_MODE"] = "enforce";

        const tokenRow = {
            id: "token-1",
            branchId: BRANCH_ID,
            active: true,
            tokenHash: "unused-in-this-harness",
        };

        // Every call routes through the real extension entry point, so the
        // policy matrix — not a mock of it — decides the outcome.
        const prisma = {
            call_ingest_token: {
                findUnique: (args: unknown) =>
                    handleModelOperation({
                        model: "call_ingest_token",
                        operation: "findUnique",
                        args,
                        query: async () => tokenRow,
                    }),
                update: (args: unknown) =>
                    handleModelOperation({
                        model: "call_ingest_token",
                        operation: "update",
                        args,
                        query: async () => tokenRow,
                    }),
            },
        } as unknown as PrismaService;

        tokenService = new CallIngestTokenService(prisma);
        guard = new CallIngestGuard(tokenService);
    });

    afterEach(() => {
        if (previousMode === undefined) {
            delete process.env["TENANT_ISOLATION_MODE"];
        } else {
            process.env["TENANT_ISOLATION_MODE"] = previousMode;
        }
    });

    // The control. Without it, the test below could pass because enforce was
    // never actually active in this harness — exactly the trap that made a
    // full green e2e run under enforce meaningless for this defect.
    it("CONTROL: the same lookup outside system scope is rejected, proving enforce is live here", async () => {
        await tenantContextStore.run({ origin: "http" }, async () => {
            await expect(tokenService.resolveBranchId("cit_valid")).rejects.toThrow(
                TenantIsolationViolationError,
            );
        });
    });

    it("resolves the webhook's token and pins its branch, instead of 500ing", async () => {
        await tenantContextStore.run({ origin: "http" }, async () => {
            const context = contextWithAuth("Bearer cit_valid");

            await expect(guard.canActivate(context)).resolves.toBe(true);

            const request = (context as unknown as { __request: { callIngestBranchId?: string } }).__request;
            expect(request.callIngestBranchId).toBe(BRANCH_ID);
            // Downstream ingestion writes (call_record, client_draft) are now
            // branch-SCOPED rather than bypassed.
            expect(tenantContextStore.get()?.branchId).toBe(BRANCH_ID);
            expect(tenantContextStore.get()?.systemScope).not.toBe(true);
        });
    });
});
