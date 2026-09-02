import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
    Logger,
} from "@nestjs/common";
import { Request } from "express";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";

/**
 * DB-backed bearer guard for the call-transcript webhook.
 * The token IS the branch allocation: payloads never carry branch identity.
 * Attaches the resolved branchId to request.callIngestBranchId AND to the
 * ambient tenant store, so everything downstream of this guard runs
 * branch-scoped (see canActivate for why both steps are required under
 * TENANT_ISOLATION_MODE=enforce).
 */
@Injectable()
export class CallIngestGuard implements CanActivate {
    private readonly logger = new Logger(CallIngestGuard.name);

    constructor(private readonly tokenService: CallIngestTokenService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request & { callIngestBranchId?: string }>();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            this.logger.warn("Call ingest rejected: Missing Authorization header");
            throw new UnauthorizedException("Missing Authorization header");
        }

        const authMatch = authHeader.match(/^Bearer\s+(.+)$/);
        const token = authMatch?.[1]?.trim();
        if (!token) {
            this.logger.warn("Call ingest rejected: Invalid Authorization format");
            throw new UnauthorizedException("Invalid Authorization format");
        }

        // The token lookup itself must run in system scope, for the same
        // reason TenantGuard wraps its membership lookup: `call_ingest_token`
        // is a tenant model, and at this point the request has an ALS store
        // of `{ origin: "http" }` with NO branchId — resolving the branch is
        // precisely what this query does. Without the wrapper the
        // tenant-isolation extension raises `http_no_tenant`, which under
        // TENANT_ISOLATION_MODE=enforce throws and 500s every n8n webhook
        // delivery. The query is pinned to the presented token's hash.
        //
        // Two operations run inside this scope, not one: resolveBranchId also
        // fires an un-awaited `lastUsedAt` touch, and a Prisma promise executes
        // even when only `.catch()` is attached, so that write lands here too.
        // It is keyed on the primary key the lookup just returned and never
        // touches branchId, so it cannot cross a tenant boundary — but the one
        // `tenant_system_scope_used` audit entry does cover a write as well as
        // a read.
        const branchId = await runSystemScope(() => this.tokenService.resolveBranchId(token));
        if (!branchId) {
            this.logger.warn("Call ingest rejected: Unknown or revoked token");
            throw new UnauthorizedException("Invalid token");
        }

        request.callIngestBranchId = branchId;
        // Establish the tenant identity the token just proved, so the ingestion
        // writes downstream (call_record, client_draft — both tenant models)
        // are branch-SCOPED rather than bypassed. Mirrors
        // TenantGuard.assignPrincipal's store write.
        //
        // Note what this arms: with a branchId on the store, the isolation
        // extension stops short-circuiting at http_no_tenant and starts
        // checking write args, so every tenant-model write reachable from this
        // request must pin branchId in its `where`. CallProcessingService's
        // claim/refine/finalize/fail writes are pinned for exactly that reason.
        tenantContextStore.setBranchId(branchId);
        return true;
    }
}
