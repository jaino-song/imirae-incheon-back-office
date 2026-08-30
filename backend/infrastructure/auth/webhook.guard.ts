import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    UnauthorizedException,
    Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import * as crypto from "crypto";

import { resolveEformsignWebhookAllowedCompanyIds } from "infrastructure/auth/eformsign-webhook-config";

/**
 * Guard for validating eformsign webhook requests using Bearer token authentication.
 *
 * Eformsign sends the token in the Authorization header:
 * Authorization: Bearer <token>
 *
 * The expected token is stored in EFORMSIGN_WEBHOOK_SECRET environment variable.
 */
@Injectable()
export class WebhookGuard implements CanActivate {
    private readonly logger = new Logger(WebhookGuard.name);

    constructor(private readonly configService: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            this.logger.warn("Webhook request rejected: Missing Authorization header");
            throw new UnauthorizedException("Missing Authorization header");
        }

        const authMatch = authHeader.match(/^Bearer\s+(.+)$/);
        const token = authMatch?.[1]?.trim();
        if (!token) {
            this.logger.warn("Webhook request rejected: Invalid Authorization format");
            throw new UnauthorizedException("Invalid Authorization format");
        }

        const expectedToken = this.configService.get<string>("EFORMSIGN_WEBHOOK_SECRET")?.trim() ?? "";
        if (!expectedToken) {
            this.logger.error("EFORMSIGN_WEBHOOK_SECRET not configured");
            throw new UnauthorizedException("Webhook authentication not configured");
        }

        if (!this.secureCompare(token, expectedToken)) {
            this.logger.warn("Webhook request rejected: Invalid token");
            throw new UnauthorizedException("Invalid token");
        }

        this.assertAllowedCompanyId(request);
        this.logger.debug("Webhook request authenticated successfully");
        return true;
    }

    private assertAllowedCompanyId(request: Request): void {
        const companyId = typeof request.body?.company_id === "string"
            ? request.body.company_id.trim()
            : "";
        if (!companyId) {
            this.logger.warn("Webhook request rejected: Missing company_id");
            throw new ForbiddenException("Unknown company id");
        }

        const allowedCompanyIds = resolveEformsignWebhookAllowedCompanyIds(this.configService);

        if (allowedCompanyIds.length === 0) {
            this.logger.error("EFORMSIGN_WEBHOOK_ALLOWED_COMPANY_IDS or EFORMSIGN_COMPANY_ID not configured");
            throw new ForbiddenException("Webhook tenant validation not configured");
        }

        const isAllowed = allowedCompanyIds.some((allowedCompanyId) => (
            this.secureCompare(companyId, allowedCompanyId)
        ));
        if (!isAllowed) {
            this.logger.warn(
                `Webhook request rejected: Unknown company_id ${this.maskIdentifier(companyId)}`,
            );
            throw new ForbiddenException("Unknown company id");
        }
    }

    private secureCompare(a: string, b: string): boolean {
        const left = Buffer.from(a, "utf8");
        const right = Buffer.from(b, "utf8");
        if (left.length === 0 || right.length === 0 || left.length !== right.length) {
            return false;
        }

        try {
            return crypto.timingSafeEqual(left, right);
        } catch {
            return false;
        }
    }

    private maskIdentifier(value: string): string {
        if (value.length <= 8) {
            return `${value.slice(0, 2)}***`;
        }

        return `${value.slice(0, 4)}***${value.slice(-4)}`;
    }
}
