import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger,
    UnauthorizedException,
} from "@nestjs/common";
import { Request } from "express";

import { ServiceRecordHeaderEditTokenService } from "application/services/service-record-header-edit-token.service";
import {
    ServiceRecordTokenContext,
    ServiceRecordTokenService,
} from "application/services/service-record-token.service";

@Injectable()
export class ServiceRecordHeaderEditGuard implements CanActivate {
    private readonly logger = new Logger(ServiceRecordHeaderEditGuard.name);

    constructor(
        private readonly tokenService: ServiceRecordTokenService,
        private readonly headerEditTokenService: ServiceRecordHeaderEditTokenService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<Request & { serviceRecordContext?: ServiceRecordTokenContext }>();
        const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/)?.[1]?.trim();
        if (!token) {
            throw new UnauthorizedException("Missing or invalid Authorization header");
        }

        const serviceRecordContext = await this.tokenService.resolveAccess(token)
            ?? await this.headerEditTokenService.resolve(token);
        if (!serviceRecordContext) {
            this.logger.warn("Service-record header access rejected");
            throw new UnauthorizedException("Invalid or expired token");
        }

        request.serviceRecordContext = serviceRecordContext;
        return true;
    }
}
