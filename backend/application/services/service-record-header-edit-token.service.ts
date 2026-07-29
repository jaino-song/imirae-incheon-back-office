import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "crypto";

import { ServiceRecordTokenContext } from "./service-record-token.service";

const ADMIN_HEADER_EDIT_TOKEN_PREFIX = "sreh_";
const ADMIN_HEADER_EDIT_TOKEN_TYPE = "service_record_header_edit";
const ADMIN_HEADER_EDIT_TOKEN_ISSUER = "babyjamjam-admin";
const ADMIN_HEADER_EDIT_TOKEN_AUDIENCE = "service-record-header-edit";
const ADMIN_HEADER_EDIT_TOKEN_TTL_SECONDS = 5 * 60;

interface IssueAdminHeaderEditTokenParams {
    branchId: string;
    scheduleId: number;
    employeeId: number;
    serviceRecordCaseId?: string | null;
    linkToken: string;
    issuedBy: string;
}

interface AdminHeaderEditTokenPayload {
    type: typeof ADMIN_HEADER_EDIT_TOKEN_TYPE;
    branchId: string;
    scheduleId: number;
    employeeId: number;
    serviceRecordCaseId?: string;
    linkToken: string;
    issuedBy: string;
    jti?: string;
}

export interface IssuedAdminHeaderEditToken {
    token: string;
    expiresAt: Date;
}

@Injectable()
export class ServiceRecordHeaderEditTokenService {
    private readonly logger = new Logger(ServiceRecordHeaderEditTokenService.name);

    constructor(private readonly jwtService: JwtService) {}

    async issue(params: IssueAdminHeaderEditTokenParams): Promise<IssuedAdminHeaderEditToken> {
        const issuedAt = new Date();
        const jwtId = randomUUID();
        const payload: AdminHeaderEditTokenPayload = {
            type: ADMIN_HEADER_EDIT_TOKEN_TYPE,
            branchId: params.branchId,
            scheduleId: params.scheduleId,
            employeeId: params.employeeId,
            ...(params.serviceRecordCaseId
                ? { serviceRecordCaseId: params.serviceRecordCaseId }
                : {}),
            linkToken: params.linkToken,
            issuedBy: params.issuedBy,
        };
        const signedToken = await this.jwtService.signAsync(payload, {
            audience: ADMIN_HEADER_EDIT_TOKEN_AUDIENCE,
            expiresIn: ADMIN_HEADER_EDIT_TOKEN_TTL_SECONDS,
            issuer: ADMIN_HEADER_EDIT_TOKEN_ISSUER,
            jwtid: jwtId,
            subject: `service-record-schedule:${params.scheduleId}`,
        });

        return {
            token: `${ADMIN_HEADER_EDIT_TOKEN_PREFIX}${signedToken}`,
            expiresAt: new Date(issuedAt.getTime() + ADMIN_HEADER_EDIT_TOKEN_TTL_SECONDS * 1000),
        };
    }

    async resolve(token: string): Promise<ServiceRecordTokenContext | null> {
        if (!token.startsWith(ADMIN_HEADER_EDIT_TOKEN_PREFIX)) return null;

        try {
            const payload = await this.jwtService.verifyAsync<AdminHeaderEditTokenPayload>(
                token.slice(ADMIN_HEADER_EDIT_TOKEN_PREFIX.length),
                {
                    audience: ADMIN_HEADER_EDIT_TOKEN_AUDIENCE,
                    issuer: ADMIN_HEADER_EDIT_TOKEN_ISSUER,
                },
            );
            if (
                payload.type !== ADMIN_HEADER_EDIT_TOKEN_TYPE
                || !payload.branchId
                || !Number.isInteger(payload.scheduleId)
                || !Number.isInteger(payload.employeeId)
                || !payload.linkToken
                || !payload.jti
            ) {
                return null;
            }

            return {
                tokenId: `admin-header-edit:${payload.jti}`,
                branchId: payload.branchId,
                scheduleId: payload.scheduleId,
                employeeId: payload.employeeId,
                ...(payload.serviceRecordCaseId
                    ? { serviceRecordCaseId: payload.serviceRecordCaseId }
                    : {}),
                accessMode: "admin_header_edit",
                linkToken: payload.linkToken,
            };
        } catch {
            this.logger.warn("Rejected invalid or expired service-record header-edit capability");
            return null;
        }
    }
}
