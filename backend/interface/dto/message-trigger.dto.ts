import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsInt, Min } from "class-validator";
import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";

export class CreateMessageTriggerRuleDto {
    @IsString()
    @IsNotEmpty()
    name!: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsEnum(MessageTriggerEventType)
    eventType!: MessageTriggerEventType;

    @IsEnum(MessageTriggerOffsetType)
    offsetType!: MessageTriggerOffsetType;

    @IsOptional()
    @IsInt()
    @Min(0)
    offsetDays?: number;

    @IsEnum(MessageTriggerRecipientType)
    recipientType!: MessageTriggerRecipientType;

    @IsEnum(MessageTriggerTemplateKey)
    templateKey!: MessageTriggerTemplateKey;
}

export class UpdateMessageTriggerRuleDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    name?: string;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @IsOptional()
    @IsEnum(MessageTriggerEventType)
    eventType?: MessageTriggerEventType;

    @IsOptional()
    @IsEnum(MessageTriggerOffsetType)
    offsetType?: MessageTriggerOffsetType;

    @IsOptional()
    @IsInt()
    @Min(0)
    offsetDays?: number;

    @IsOptional()
    @IsEnum(MessageTriggerRecipientType)
    recipientType?: MessageTriggerRecipientType;

    @IsOptional()
    @IsEnum(MessageTriggerTemplateKey)
    templateKey?: MessageTriggerTemplateKey;
}

export class UpdateMessageTriggerRuleBranchActivationDto {
    @IsBoolean()
    isActive!: boolean;
}
