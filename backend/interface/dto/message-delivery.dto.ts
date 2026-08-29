import {
    IsBoolean,
    IsInt,
    IsIn,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    ValidateIf,
} from "class-validator";

export const MESSAGE_DELIVERY_TRIGGER_TYPES = ["immediate", "scheduled"] as const;
export type MessageDeliveryTriggerType = (typeof MESSAGE_DELIVERY_TRIGGER_TYPES)[number];

export class SendSmsMessageDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^[0-9,\-\s]+$/, { message: "수신자 연락처 형식이 올바르지 않습니다." })
    receiver!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(2000)
    message!: string;

    @IsOptional()
    @IsString()
    @MaxLength(44)
    title?: string;

    @IsOptional()
    @IsString()
    recipientName?: string;

    @IsOptional()
    @IsInt()
    /** Optional client association; the backend resolves and verifies the branch-owned recipient. */
    clientId?: number | null;

    @IsOptional()
    @IsInt()
    /** Optional employee association; the employee must be active in the selected branch. */
    employeeId?: number | null;

    @IsOptional()
    @IsIn(["AUTO", "SMS", "LMS"])
    msgType?: "AUTO" | "SMS" | "LMS";

    @IsOptional()
    @IsIn([...MESSAGE_DELIVERY_TRIGGER_TYPES])
    triggerType?: MessageDeliveryTriggerType;

    @ValidateIf((dto: SendSmsMessageDto) => dto.triggerType === "scheduled")
    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "예약일 형식이 올바르지 않습니다." })
    scheduledDate?: string;

    @ValidateIf((dto: SendSmsMessageDto) => dto.triggerType === "scheduled")
    @IsString()
    @Matches(/^\d{2}:\d{2}$/, { message: "예약시간 형식이 올바르지 않습니다." })
    scheduledTime?: string;

    @IsOptional()
    @IsBoolean()
    testMode?: boolean;

    /** Client-supplied retry key; never forwarded to Aligo. */
    @IsOptional()
    @IsString()
    @MaxLength(200)
    @Matches(/^[A-Za-z0-9._:-]+$/, { message: "문자 요청 식별자 형식이 올바르지 않습니다." })
    idempotencyKey?: string;
}
