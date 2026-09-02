import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { CallIngestGuard } from "infrastructure/auth/call-ingest.guard";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";

function contextWithAuth(header?: string): ExecutionContext {
    const request: Record<string, unknown> = { headers: header ? { authorization: header } : {} };
    return {
        switchToHttp: () => ({ getRequest: () => request }),
        __request: request,
    } as unknown as ExecutionContext & { __request: Record<string, unknown> };
}

describe("CallIngestGuard", () => {
    let tokenService: jest.Mocked<Pick<CallIngestTokenService, "resolveBranchId">>;
    let guard: CallIngestGuard;

    beforeEach(() => {
        tokenService = { resolveBranchId: jest.fn() };
        guard = new CallIngestGuard(tokenService as unknown as CallIngestTokenService);
    });

    it("attaches branchId from a valid token", async () => {
        tokenService.resolveBranchId.mockResolvedValue("branch-1");
        const context = contextWithAuth("Bearer cit_valid");

        await expect(guard.canActivate(context)).resolves.toBe(true);
        const request = (context as unknown as { __request: { callIngestBranchId?: string } }).__request;
        expect(request.callIngestBranchId).toBe("branch-1");
    });

    // Regression: `call_ingest_token` is a tenant model and this guard runs
    // BEFORE any branchId exists on the request store, so an unwrapped lookup
    // self-trips the isolation extension's `http_no_tenant` check — which
    // throws under TENANT_ISOLATION_MODE=enforce and 500s every n8n webhook
    // delivery. Both halves are pinned here: the lookup runs in system scope,
    // and the resolved branch is then written to the store so downstream
    // ingestion writes are scoped rather than bypassed.
    it("resolves the token inside system scope, then pins the resolved branch on the tenant store", async () => {
        const observedScopes: Array<{ origin?: string; systemScope?: boolean; branchId?: string }> = [];
        tokenService.resolveBranchId.mockImplementation(async () => {
            observedScopes.push({ ...(tenantContextStore.get() ?? {}) });
            return "branch-1";
        });

        await tenantContextStore.run({ origin: "http" }, async () => {
            await guard.canActivate(contextWithAuth("Bearer cit_valid"));

            // Established for everything downstream of the guard.
            expect(tenantContextStore.get()?.branchId).toBe("branch-1");
            // …and the request is NOT left in system scope.
            expect(tenantContextStore.get()?.systemScope).not.toBe(true);
        });

        expect(observedScopes).toHaveLength(1);
        expect(observedScopes[0]).toMatchObject({ origin: "system", systemScope: true });
    });

    it("rejects missing header, malformed header, and unknown token", async () => {
        await expect(guard.canActivate(contextWithAuth())).rejects.toThrow(UnauthorizedException);
        await expect(guard.canActivate(contextWithAuth("Token abc"))).rejects.toThrow(UnauthorizedException);

        tokenService.resolveBranchId.mockResolvedValue(null);
        await expect(guard.canActivate(contextWithAuth("Bearer cit_bad"))).rejects.toThrow(UnauthorizedException);
    });
});
