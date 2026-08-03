import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested, ArrayMaxSize, ArrayMinSize } from "class-validator";
import { z } from "zod";

import { AgentFormSubmitPartSchema } from "@babyjamjam/shared/agent/message-parts";

const AgentUserTextPartSchema = z.object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(20_000),
}).strict();
const AgentUserFormSubmitPartSchema = z.object({
    type: z.literal("data-form-submit"),
    data: AgentFormSubmitPartSchema,
}).strict();

/**
 * The client supplies one current user turn only. Conversation history is
 * reconstructed from the user-and-branch-owned session on the server.
 */
export const AgentChatMessagesSchema = z.array(z.object({
    id: z.string().min(1).max(200),
    role: z.literal("user"),
    parts: z.union([
        z.tuple([AgentUserTextPartSchema]),
        z.tuple([AgentUserFormSubmitPartSchema]),
    ]),
}).strict()).length(1);

class AgentMessageDto {
    @IsString()
    @MaxLength(200)
    id!: string;

    @IsIn(["user"])
    role!: "user";

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(1)
    @IsObject({ each: true })
    parts!: unknown[];
}

export class AgentChatDto {
    @IsOptional()
    @IsString()
    @MaxLength(200)
    sessionId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(10)
    locale = "ko";

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(1)
    @ValidateNested({ each: true })
    @Type(() => AgentMessageDto)
    messages!: AgentMessageDto[];
}

export class AgentSessionPatchDto {
    @IsOptional()
    @IsString()
    @MaxLength(120)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(10)
    locale?: string;

    @IsOptional()
    @IsBoolean()
    archived?: boolean;
}

export class AgentFlagsPatchDto {
    @IsObject()
    flags!: Record<string, unknown>;
}

export class AgentActionApproveDto {
    @IsString()
    @MaxLength(200)
    expectedRevision!: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    acknowledgementToken?: string;
}

export class AgentActionRejectDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}

export class AgentFeedbackDto {
    @IsString()
    @MaxLength(200)
    sessionId!: string;

    @IsString()
    @MaxLength(200)
    messageId!: string;

    @IsIn(["positive", "negative"])
    type!: "positive" | "negative";

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    comment?: string;
}
