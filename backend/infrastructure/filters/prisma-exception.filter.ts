import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpStatus,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Response } from "express";
import type { Request } from "express";
import {
    captureServiceRecordError,
    getServiceRecordOperation,
    isServiceRecordSignal,
} from "infrastructure/observability/service-record-sentry";

// Prisma 에러 코드별 HTTP 상태 매핑 (메시지는 프론트엔드에서 처리)
const PRISMA_ERROR_STATUS: Record<string, HttpStatus> = {
    P2002: HttpStatus.CONFLICT,           // Unique constraint violation
    P2003: HttpStatus.BAD_REQUEST,        // Foreign key constraint violation
    P2025: HttpStatus.NOT_FOUND,          // Record not found
    P2011: HttpStatus.BAD_REQUEST,        // Required field missing
    P2006: HttpStatus.BAD_REQUEST,        // Invalid value for field
    P1001: HttpStatus.SERVICE_UNAVAILABLE, // Database unreachable
    P1017: HttpStatus.SERVICE_UNAVAILABLE, // Connection closed by server
    P2024: HttpStatus.SERVICE_UNAVAILABLE, // Prisma pool exhausted
};

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
    catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        const status = PRISMA_ERROR_STATUS[exception.code] || HttpStatus.INTERNAL_SERVER_ERROR;
        const field = this.extractField(exception);

        console.error(`[PrismaException] Code: ${exception.code}, Field: ${field || 'N/A'}`);

        if (status >= 500 && isServiceRecordSignal(request.originalUrl || request.url)) {
            captureServiceRecordError(exception, {
                operation: getServiceRecordOperation(request.originalUrl || request.url),
                handled: true,
                statusCode: status,
            });
        }

        return response.status(status).json({
            statusCode: status,
            code: exception.code,
            error: this.getErrorName(status),
            ...(field && { field }),
        });
    }

    private extractField(exception: Prisma.PrismaClientKnownRequestError): string | null {
        const meta = exception.meta as Record<string, unknown> | undefined;
        if (!meta) return null;

        // P2002: target contains the field names
        if (Array.isArray(meta['target']) && meta['target'].length > 0) {
            return meta['target'][0] as string;
        }

        // P2003, P2006: field_name contains the field
        if (typeof meta['field_name'] === 'string') {
            return meta['field_name'];
        }

        // P2011: constraint contains the field
        if (typeof meta['constraint'] === 'string') {
            return meta['constraint'];
        }

        return null;
    }

    private getErrorName(status: HttpStatus): string {
        switch (status) {
            case HttpStatus.CONFLICT:
                return "Conflict";
            case HttpStatus.BAD_REQUEST:
                return "Bad Request";
            case HttpStatus.NOT_FOUND:
                return "Not Found";
            case HttpStatus.SERVICE_UNAVAILABLE:
                return "Service Unavailable";
            default:
                return "Internal Server Error";
        }
    }
}
