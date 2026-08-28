import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsIn,
    IsInt,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Min,
    Validate,
    ValidateIf,
    ValidateNested,
    ValidatorConstraint,
    ValidatorConstraintInterface,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { PROPOSAL_FIELDS } from "application/services/call-extraction.prompt";
import { SERVICE_STATUS_VALUES } from "domain/value-objects/service-status.vo";
import { KOREAN_WON_INPUT_PATTERN } from "domain/value-objects/money.vo";
import { IsCanonicalPhone, trimNullablePhone } from "./canonical-phone.validator";

const KOREAN_WON_VALIDATION_MESSAGE = "금액은 정수 원 단위(예: 1,000원)만 입력할 수 있습니다.";
const trimKoreanWonInput = ({ value }: { value: unknown }): unknown =>
    typeof value === "string" ? value.trim() : value;

@ValidatorConstraint({ name: "calendarBirthday", async: false })
class CalendarBirthdayConstraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean {
        if (typeof value !== "string" || !/^\d{6}$/.test(value)) return false;

        const year = Number(value.slice(0, 2));
        const month = Number(value.slice(2, 4));
        const day = Number(value.slice(4, 6));
        if (month < 1 || month > 12 || day < 1) return false;

        const daysInMonth = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        return day <= (daysInMonth[month - 1] ?? 0);
    }

    defaultMessage(): string {
        return "생년월일은 유효한 YYMMDD 6자리여야 합니다.";
    }
}

export class CreateCallIngestTokenDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    label!: string;
}

export class TranscriptTurnDto {
    @IsString()
    @MaxLength(50)
    speaker!: string;

    @IsString()
    @MaxLength(2_000)
    text!: string;
}

export class CallSummaryDto {
    @IsOptional() @IsString() @MaxLength(2_000)
    inquiry_type?: string;

    @IsOptional() @IsString() @MaxLength(2_000)
    customer_info?: string;

    @IsOptional() @IsString() @MaxLength(5_000)
    key_content?: string;

    @IsOptional() @IsString() @MaxLength(2_000)
    result_action?: string;
}

export class ProposalDto {
    @IsIn([...PROPOSAL_FIELDS])
    field!: string;

    @ValidateIf((object, value) => object.field === "phone" && value !== null && value !== undefined)
    @IsString()
    @IsCanonicalPhone()
    @ValidateIf((_, value) => value !== null)
    value!: string | number | boolean | null;

    @IsString()
    @MaxLength(2_000)
    evidence!: string;

    @IsIn(["high", "low"])
    confidence!: "high" | "low";
}

export class PatchClientDraftDto {
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProposalDto)
    proposals?: ProposalDto[];

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsInt()
    clientId?: number | null;
}

/**
 * Staff-final values accepted by the NEW_CLIENT confirmation path.
 *
 * Keep this contract aligned with the fields that the confirmation service
 * actually forwards to ClientService.create. This is deliberately separate
 * from the permissive extraction/proposal shapes: a reviewer confirmation is
 * a write boundary and must not coerce malformed values.
 */
export class ConfirmNewClientFieldsDto {
    @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name!: string;

    @IsOptional() @IsString() @MaxLength(300)
    address?: string | null;

    @IsOptional() @IsString() @MaxLength(40)
    @Transform(trimNullablePhone)
    @IsCanonicalPhone()
    phone?: string | null;

    @IsOptional() @IsString() @MaxLength(40)
    type?: string | null;

    @IsOptional() @IsInt() @Min(0)
    duration?: number | null;

    @IsOptional() @IsString() @MaxLength(40)
    @Transform(trimKoreanWonInput)
    @Matches(KOREAN_WON_INPUT_PATTERN, { message: KOREAN_WON_VALIDATION_MESSAGE })
    fullPrice?: string | null;

    @IsOptional() @IsString() @MaxLength(80)
    @Transform(trimKoreanWonInput)
    @Matches(KOREAN_WON_INPUT_PATTERN, { message: KOREAN_WON_VALIDATION_MESSAGE })
    grant?: string | null;

    @IsOptional() @IsString() @MaxLength(40)
    @Transform(trimKoreanWonInput)
    @Matches(KOREAN_WON_INPUT_PATTERN, { message: KOREAN_WON_VALIDATION_MESSAGE })
    actualPrice?: string | null;

    @IsOptional() @IsDateString()
    startDate?: string | null;

    @IsOptional() @IsDateString()
    endDate?: string | null;

    @IsOptional() @IsBoolean()
    careCenter?: boolean | null;

    @ValidateIf((_, value) => value !== undefined)
    @IsBoolean()
    voucherClient?: boolean;

    @IsOptional() @IsString()
    @Validate(CalendarBirthdayConstraint)
    birthday?: string | null;

    @IsOptional() @IsDateString()
    dueDate?: string | null;

    @IsOptional() @IsDateString()
    birthDate?: string | null;

    @IsOptional() @IsIn(SERVICE_STATUS_VALUES)
    serviceStatus?: string | null;

    @ValidateIf((_, value) => value !== undefined)
    @IsBoolean()
    breastPump?: boolean;

    @IsOptional() @IsString() @MaxLength(100)
    areaId?: string | null;

    // These are optional in the client create contract and are forwarded
    // unchanged when staff supplies an assignment during confirmation.
    @IsOptional() @IsInt()
    primaryEmployeeId?: number | null;

    @IsOptional() @IsInt()
    secondaryEmployeeId?: number | null;
}

export class ConfirmNewClientDraftDto {
    @IsObject()
    @ValidateNested()
    @Type(() => ConfirmNewClientFieldsDto)
    fields!: ConfirmNewClientFieldsDto;

    @IsOptional()
    @IsBoolean()
    suppressGreetingSms?: boolean;
}

export class ConfirmClientUpdateDraftDto {
    /** included changes only; keys validated against PROPOSAL_FIELDS in the service */
    @IsObject()
    changes!: Record<string, unknown>;
}

/** Permissive union DTO used by the controller — the service discriminates by draft type */
export class ConfirmDraftDto {
    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => ConfirmNewClientFieldsDto)
    fields?: ConfirmNewClientFieldsDto | Record<string, unknown>;

    @IsOptional()
    @IsBoolean()
    suppressGreetingSms?: boolean;

    @IsOptional()
    @IsObject()
    changes?: Record<string, unknown>;
}

export class DiscardClientDraftDto {
    @IsOptional()
    @IsString()
    @MaxLength(1_000)
    reason?: string;
}

export class CallTranscriptWebhookDto {
    @IsString()
    @MaxLength(200)
    fileId!: string;

    @IsString()
    @MaxLength(500)
    fileName!: string;

    @IsOptional()
    @IsDateString({ strict: true })
    recordedAt?: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => TranscriptTurnDto)
    transcript!: TranscriptTurnDto[];

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => CallSummaryDto)
    summary?: CallSummaryDto;
}
