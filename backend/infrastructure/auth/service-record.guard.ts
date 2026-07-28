import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
    Logger,
} from "@nestjs/common";
import { Request } from "express";
import {
    ServiceRecordTokenService,
    ServiceRecordTokenContext,
} from "application/services/service-record-token.service";

/**
 * DB-backed bearer guard for the no-login service-record data endpoints (BJJ-247).
 * Expects the minted ACCESS token (post-DOB) as `Authorization: Bearer <token>`;
 * attaches the resolved assignment context to request.serviceRecordContext.
 * The DOB-challenge endpoint itself is NOT guarded by this — it takes the link token in the body.
 */
@Injectable()
export class ServiceRecordGuard implements CanActivate {
    private readonly logger = new Logger(ServiceRecordGuard.name);

    constructor(private readonly tokenService: ServiceRecordTokenService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<Request & { serviceRecordContext?: ServiceRecordTokenContext }>();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            throw new UnauthorizedException("Missing Authorization header");
        }

        const authMatch = authHeader.match(/^Bearer\s+(.+)$/);
        const token = authMatch?.[1]?.trim();
        if (!token) {
            throw new UnauthorizedException("Invalid Authorization format");
        }

        const ctx = await this.tokenService.resolveAccess(token);
        if (!ctx) {
            this.logger.warn("Service record access rejected: unknown, unverified, revoked, or expired token");
            throw new UnauthorizedException("Invalid or expired token");
        }

        request.serviceRecordContext = ctx;
        return true;
    }
}
