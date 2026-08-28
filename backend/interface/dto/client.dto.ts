import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, ValidateIf } from "class-validator";
import { Transform } from "class-transformer";
import { SERVICE_STATUS_VALUES } from "domain/value-objects/service-status.vo";
import { KOREAN_WON_INPUT_PATTERN } from "domain/value-objects/money.vo";
import { IsCanonicalPhone, trimNullablePhone } from "./canonical-phone.validator";

const KOREAN_WON_VALIDATION_MESSAGE = "금액은 정수 원 단위(예: 1,000원)만 입력할 수 있습니다.";

function trimKoreanWonInput({ value }: { value: unknown }): unknown {
    return typeof value === "string" ? value.trim() : value;
}

export class CreateClientDto {
    @IsString()
    name!: string;

    @IsOptional()
    @IsInt()
    primaryEmployeeId?: number | null;

    @IsOptional()
    @IsInt()
    secondaryEmployeeId?: number | null;

    @IsOptional()
    @IsString()
    address?: string | null;

    @IsOptional()
    @IsString()
    @Transform(trimNullablePhone)
    @IsCanonicalPhone()
    phone?: string | null;

    @IsOptional()
    @IsString()
    type?: string | null;

    @IsOptional()
    @IsInt()
    duration?: number | null;

    @IsOptional()
    @IsString()
    @Transform(trimKoreanWonInput)
    @Matches(KOREAN_WON_INPUT_PATTERN, { message: KOREAN_WON_VALIDATION_MESSAGE })
    fullPrice?: string | null;

    @IsOptional()
    @IsString()
    @Transform(trimKoreanWonInput)
    @Matches(KOREAN_WON_INPUT_PATTERN, { message: KOREAN_WON_VALIDATION_MESSAGE })
    grant?: string | null;

    @IsOptional()
    @IsString()
    @Transform(trimKoreanWonInput)
    @Matches(KOREAN_WON_INPUT_PATTERN, { message: KOREAN_WON_VALIDATION_MESSAGE })
    actualPrice?: string | null;

    @IsOptional()
    @IsDateString()
    startDate?: string | null;

    @IsOptional()
    @IsDateString()
    endDate?: string | null;

    @IsOptional()
    @IsBoolean()
    careCenter?: boolean | null;

    @IsBoolean()
    voucherClient!: boolean;

    @IsOptional()
    @IsString()
    @Matches(/^\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/, { message: "생년월일은 YYMMDD 6자리여야 합니다." })
    birthday?: string | null;

    @IsOptional()
    @IsDateString()
    dueDate?: string | null;

    @IsOptional()
    @IsDateString()
    birthDate?: string | null;

    @IsOptional()
    @IsIn(SERVICE_STATUS_VALUES)
    serviceStatus?: string | null;

    @IsBoolean()
    breastPump!: boolean;

    @IsOptional()
    @IsString()
    eDocId?: string | null;

    @IsOptional()
    @IsString()
    areaId?: string | null;

    @IsOptional()
    @IsBoolean()
    suppressGreetingSms?: boolean;

    @IsOptional()
    @IsBoolean()
    applyMessageAutomation?: boolean;

    @IsOptional()
    @IsBoolean()
    reuseExistingClient?: boolean;

    @IsOptional()
    @IsIn(["contract_auto_registration"])
    source?: string;
}

export class UpdateClientDto {
    @ValidateIf((_, value) => value !== undefined)
    @IsString()
    name?: string;

    @IsOptional()
    @IsInt()
    primaryEmployeeId?: number;

    @IsOptional()
    @IsInt()
    secondaryEmployeeId?: number | null;

    @IsOptional()
    @IsString()
    address?: string | null;

    @IsOptional()
    @IsString()
    @Transform(trimNullablePhone)
    @IsCanonicalPhone()
    phone?: string | null;

    @IsOptional()
    @IsString()
    type?: string | null;

    @IsOptional()
    @IsInt()
    duration?: number | null;

    @IsOptional()
    @IsString()
    @Transform(trimKoreanWonInput)
    @Matches(KOREAN_WON_INPUT_PATTERN, { message: KOREAN_WON_VALIDATION_MESSAGE })
    fullPrice?: string | null;

    @IsOptional()
    @IsString()
    @Transform(trimKoreanWonInput)
    @Matches(KOREAN_WON_INPUT_PATTERN, { message: KOREAN_WON_VALIDATION_MESSAGE })
    grant?: string | null;

    @IsOptional()
    @IsString()
    @Transform(trimKoreanWonInput)
    @Matches(KOREAN_WON_INPUT_PATTERN, { message: KOREAN_WON_VALIDATION_MESSAGE })
    actualPrice?: string | null;

    @IsOptional()
    @IsDateString()
    startDate?: string | null;

    @IsOptional()
    @IsDateString()
    endDate?: string | null;

    @IsOptional()
    @IsBoolean()
    careCenter?: boolean | null;

    @ValidateIf((_, value) => value !== undefined)
    @IsBoolean()
    voucherClient?: boolean;

    @IsOptional()
    @IsString()
    @Matches(/^\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/, { message: "생년월일은 YYMMDD 6자리여야 합니다." })
    birthday?: string | null;

    @IsOptional()
    @IsDateString()
    dueDate?: string | null;

    @IsOptional()
    @IsDateString()
    birthDate?: string | null;

    @IsOptional()
    @IsIn(SERVICE_STATUS_VALUES)
    serviceStatus?: string | null;

    @ValidateIf((_, value) => value !== undefined)
    @IsBoolean()
    breastPump?: boolean;

    @IsOptional()
    @IsString()
    eDocId?: string | null;

    @IsOptional()
    @IsString()
    areaId?: string | null;
}

/**
 * DTO for terminating a client's service
 */
export class TerminateServiceDto {
    @IsOptional()
    @IsString()
    reason?: string;
}

/**
 * DTO for requesting a provider replacement
 */
export class RequestReplacementDto {
    @IsInt()
    newPrimaryEmployeeId!: number;

    @IsOptional()
    @IsInt()
    newSecondaryEmployeeId?: number | null;
}
