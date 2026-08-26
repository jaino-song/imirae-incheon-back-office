import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { streamText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToVercelTools } from "./vercel-tool-adapter";
import type {
    ChatMessage,
    FunctionDeclaration,
    FunctionCall,
    GeminiStreamChunk,
} from "./gemini-chat.gateway";
import {
    createGeminiStreamDeadline,
    getGeminiStreamTermination,
    getGeminiStreamTimeouts,
    getSafeGeminiStreamError,
    waitForGeminiStreamOperation,
} from "./gemini-stream-timeout";

function getNumberConfig(configService: ConfigService, key: string, fallback: number, min: number): number {
    const rawValue = configService.get<string | number>(key);
    if (rawValue === undefined || rawValue === null || rawValue === "") {
        return fallback;
    }

    const parsedValue = Number(rawValue);
    return Number.isFinite(parsedValue) && parsedValue >= min ? parsedValue : fallback;
}

/**
 * Vercel AI SDK-based gateway for Gemini API.
 *
 * This gateway uses the Vercel AI SDK streamText() function for improved
 * streaming, better error handling, and standardized tool calling patterns.
 * It maintains the same interface as GeminiChatGateway for backwards compatibility.
 */
@Injectable()
export class VercelGeminiGateway {
    private readonly logger = new Logger(VercelGeminiGateway.name);
    private readonly model: string;
    private readonly temperature: number;
    private readonly maxOutputTokens: number;
    private readonly streamTimeouts: ReturnType<typeof getGeminiStreamTimeouts>;

    constructor(private readonly configService: ConfigService) {
        this.model = this.configService.get<string>("GEMINI_CHAT_MODEL") || "gemini-2.5-flash-lite";
        this.temperature = getNumberConfig(this.configService, "GEMINI_CHAT_TEMPERATURE", 0.1, 0);
        this.maxOutputTokens = getNumberConfig(this.configService, "GEMINI_CHAT_MAX_OUTPUT_TOKENS", 4096, 1);
        this.streamTimeouts = getGeminiStreamTimeouts(this.configService);
    }

    private getApiKey(): string {
        const apiKey = this.configService.get<string>("GEMINI_API_KEY");
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is not configured");
        }
        return apiKey;
    }

    private createGoogleProvider() {
        return createGoogleGenerativeAI({
            apiKey: this.getApiKey(),
        });
    }

    private formatMessagesForVercel(messages: ChatMessage[]): Array<{
        role: "user" | "assistant" | "system";
        content: string;
    }> {
        return messages.map(m => ({
            role: m.role === "model" ? "assistant" as const : m.role as "user" | "assistant" | "system",
            content: m.content,
        }));
    }

    /**
     * Non-streaming chat method for simple requests.
     */
    async chat(
        messages: ChatMessage[],
        tools?: FunctionDeclaration[],
    ): Promise<{ text?: string; functionCall?: FunctionCall }> {
        // For non-streaming, we still use streamText but consume the full response
        let fullText = "";
        let functionCall: FunctionCall | undefined;

        for await (const chunk of this.chatStream(messages, tools)) {
            if (chunk.type === "text" && chunk.content) {
                fullText += chunk.content;
            }
            if (chunk.type === "function_call" && chunk.functionCall) {
                functionCall = chunk.functionCall;
            }
        }

        if (functionCall) {
            return { functionCall };
        }
        return { text: fullText };
    }

    /**
     * Streaming chat with tool support.
     * Uses Vercel AI SDK's streamText() for improved streaming experience.
     */
    async *chatStream(
        messages: ChatMessage[],
        tools?: FunctionDeclaration[],
        callerSignal?: AbortSignal,
    ): AsyncGenerator<GeminiStreamChunk> {
        const google = this.createGoogleProvider();
        const formattedMessages = this.formatMessagesForVercel(messages);

        // Extract system message if present
        const systemMessage = formattedMessages.find(m => m.role === "system");
        const conversationMessages = formattedMessages.filter(m => m.role !== "system");

        // Convert tools to Vercel AI SDK format
        const vercelTools = tools ? convertToVercelTools(tools) : undefined;

        const deadline = createGeminiStreamDeadline(this.streamTimeouts, callerSignal);
        let iterator: AsyncIterator<unknown> | undefined;
        let iteratorCompleted = false;
        let terminated = false;

        try {
            const result = streamText({
                model: google(this.model),
                system: systemMessage?.content,
                messages: conversationMessages.map(m => ({
                    role: m.role as "user" | "assistant",
                    content: m.content,
                })),
                tools: vercelTools,
                temperature: this.temperature,
                maxOutputTokens: this.maxOutputTokens,
                abortSignal: deadline.signal,
                onError: ({ error }) => {
                    this.logger.error("Gemini streaming provider error", error instanceof Error ? error.stack : undefined);
                },
            });

            iterator = result.fullStream[Symbol.asyncIterator]();
            while (true) {
                const next = await waitForGeminiStreamOperation(iterator.next(), deadline);
                if (next.done) {
                    iteratorCompleted = true;
                    break;
                }

                deadline.markChunkReceived();
                const part = next.value as {
                    type: string;
                    text?: string;
                    toolName?: string;
                    input?: unknown;
                    error?: unknown;
                };
                switch (part.type) {
                    case "text-delta":
                        if (part.text) {
                            yield { type: "text", content: part.text };
                        }
                        break;

                    case "tool-call":
                        if (!part.toolName) {
                            yield { type: "error", error: "Gemini streaming provider error" };
                            terminated = true;
                            break;
                        }
                        yield {
                            type: "function_call",
                            functionCall: {
                                name: part.toolName,
                                args: part.input as Record<string, unknown>,
                            },
                        };
                        break;

                    case "finish":
                        yield { type: "done" };
                        terminated = true;
                        break;

                    case "error":
                        yield {
                            type: "error",
                            error: part.error instanceof Error
                                ? "Gemini streaming provider error"
                                : "Gemini streaming provider error",
                        };
                        terminated = true;
                        break;
                }

                if (terminated) {
                    break;
                }
            }

            if (!terminated) {
                yield { type: "done" };
            }
        } catch (error) {
            terminated = true;
            const termination = getGeminiStreamTermination(error, deadline);
            if (!termination) {
                this.logger.error(
                    "Gemini streaming request failed",
                    error instanceof Error ? error.stack : undefined,
                );
            }
            yield { type: "error", error: getSafeGeminiStreamError(error, deadline) };
        } finally {
            if (iterator && !iteratorCompleted) {
                try {
                    void Promise.resolve(iterator.return?.()).catch(() => undefined);
                } catch {
                    // The SDK stream is already closing; deadline cleanup still runs.
                }
            }
            deadline.cleanup();
        }
    }

    /**
     * Sends a function result back to the model for continued generation.
     * This is used after tool execution to get the model's response.
     */
    async sendFunctionResult(
        messages: ChatMessage[],
        functionName: string,
        result: unknown,
        tools?: FunctionDeclaration[],
    ): Promise<{ text?: string; functionCall?: FunctionCall }> {
        const messagesWithResult: ChatMessage[] = [
            ...messages,
            {
                role: "model",
                content: JSON.stringify({ functionCall: { name: functionName } }),
            },
            {
                role: "user",
                content: JSON.stringify({ functionResponse: { name: functionName, response: result } }),
            },
        ];

        return this.chat(messagesWithResult, tools);
    }
}
