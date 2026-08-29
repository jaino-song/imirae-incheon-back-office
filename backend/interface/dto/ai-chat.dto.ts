import { IsString, IsOptional, IsNotEmpty, IsIn, IsInt, Min } from "class-validator";

export class ChatStreamDto {
    @IsOptional()
    @IsString()
    sessionId?: string;

    @IsNotEmpty()
    @IsString()
    message!: string;
}

export class SessionIdParamDto {
    @IsNotEmpty()
    @IsString()
    id!: string;
}

export interface ChatMessageResponse {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
}

export interface SessionResponse {
    id: string;
    userId: string;
    messages: ChatMessageResponse[];
    createdAt: string;
    expiresAt: string;
}

export class ChatFeedbackDto {
    @IsNotEmpty()
    @IsString()
    sessionId!: string;

    @IsOptional()
    @IsString()
    messageId?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    messageIndex?: number;

    @IsNotEmpty()
    @IsIn(['positive', 'negative'])
    type!: 'positive' | 'negative';

    @IsOptional()
    @IsString()
    comment?: string;
}

export class ChatPersistDto {
    @IsOptional()
    @IsString()
    sessionId?: string;

    @IsNotEmpty()
    @IsString()
    userMessage!: string;

    @IsNotEmpty()
    @IsString()
    assistantContent!: string;
}

export class ChatConfirmDto {
    @IsNotEmpty()
    @IsString()
    intentId!: string;

    @IsNotEmpty()
    @IsString()
    nonce!: string;

    @IsOptional()
    @IsString()
    sessionId?: string;
}
