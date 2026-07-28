import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
} from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import type { Request } from "express";

import {
    captureServiceRecordError,
    getServiceRecordOperation,
    isServiceRecordSignal,
} from "./service-record-sentry";

@Catch()
export class ServiceRecordSentryExceptionFilter
    extends BaseExceptionFilter
    implements ExceptionFilter
{
    constructor(httpAdapterHost: HttpAdapterHost) {
        super(httpAdapterHost.httpAdapter);
    }

    catch(exception: unknown, host: ArgumentsHost): void {
        if (host.getType() === "http") {
            const request = host.switchToHttp().getRequest<Request>();
            const path = request.originalUrl || request.url;
            const statusCode = exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;

            if (statusCode >= 500 && isServiceRecordSignal(path)) {
                captureServiceRecordError(exception, {
                    operation: getServiceRecordOperation(path),
                    handled: false,
                    statusCode,
                });
            }
        }

        super.catch(exception, host);
    }
}
