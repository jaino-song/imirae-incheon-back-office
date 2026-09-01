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
        const branchId = await runSystemScope(() => this.tokenService.resolveBranchId(token));
        if (!branchId) {
            this.logger.warn("Call ingest rejected: Unknown or revoked token");
            throw new UnauthorizedException("Invalid token");
        }

        request.callIngestBranchId = branchId;
        // Establish the tenant identity the token just proved, so the
        // ingestion writes downstream (call_record, client_draft — both
        // tenant models) are branch-SCOPED rather than bypassed. Mirrors
        // TenantGuard.assignPrincipal's store write.
        tenantContextStore.setBranchId(branchId);
        return true;
    }
}
