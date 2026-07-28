import {
    IsBoolean,
    IsDateString,
    MaxLength,
    IsObject,
    IsOptional,
    IsString,
    ValidateBy,
    ValidationOptions,
} from "class-validator";

import { SERVICE_RECORD_TEXT_LIMITS } from "domain/constants/service-record-text-limits";

const PNG_DATA_URI_PREFIX = "data:image/png;base64,";
const MAX_SIGNATURE_BYTES = 192 * 1024;
const STRICT_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function IsValidMomSignature(validationOptions?: ValidationOptions): PropertyDecorator {
    return ValidateBy({
        name: "isValidMomSignature",
        validator: {
            validate(value: unknown): boolean {
                if (typeof value !== "string" || !value.startsWith(PNG_DATA_URI_PREFIX)) {
                    return false;
                }
                const body = value.slice(PNG_DATA_URI_PREFIX.length);
                if (!body || !STRICT_BASE64_PATTERN.test(body)) {
                    return false;
                }
                return Buffer.from(body, "base64").length <= MAX_SIGNATURE_BYTES;
            },
            defaultMessage(): string {
                return "clientSignature must be a PNG data URI no larger than 192KB";
            },
        },
    }, validationOptions);
}

/** Phone challenge — public endpoint, takes the link token + provider phone. */
export class VerifyServiceRecordPhoneDto {
    @IsString()
    linkToken!: string;

    @IsString()
    phone!: string;
}

/** One-time service header (top of the 제공기록지). */
export class SaveServiceHeaderDto {
    @IsOptional() @IsString() momName?: string;
    @IsOptional() @IsString() momBirth?: string;
    @IsOptional() @IsString() babyName?: string;
    @IsOptional() @IsString() babyBirth?: string;
    @IsOptional() @IsString() deliveryType?: string;
    @IsOptional() @IsString() babyWeight?: string;
}

/** A single service session's record (used for both draft save and final submit). */
export class UpsertSessionDto {
    @IsDateString()
    serviceDate!: string;

    /** ①–⑪ structured answers, free-form per the form layout. */
    @IsOptional() @IsObject() answers?: Record<string, unknown>;

    @IsOptional() @IsString() @MaxLength(SERVICE_RECORD_TEXT_LIMITS.etcService)
    etcService?: string;

    @IsOptional() @IsString() @MaxLength(SERVICE_RECORD_TEXT_LIMITS.notes)
    notes?: string;
    @IsOptional() @IsBoolean() paymentConfirmed?: boolean;
    /** 산모 확인 (data URL / storage ref). */
    @IsOptional() @IsString() momApproval?: string;

    @IsOptional() @IsString() @IsValidMomSignature()
    clientSignature?: string;
}
