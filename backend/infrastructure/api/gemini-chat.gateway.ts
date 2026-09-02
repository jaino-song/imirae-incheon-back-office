import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    createGeminiStreamDeadline,
    DEFAULT_GEMINI_STREAM_TOTAL_TIMEOUT_MS,
    getGeminiStreamTermination,
    getGeminiStreamTimeouts,
    getSafeGeminiStreamError,
    waitForGeminiStreamOperation,
} from "./gemini-stream-timeout";

export interface ChatMessage {
    role: 'user' | 'model' | 'system';
    content: string;
}

export interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
        }>;
        required?: string[];
    };
}

export interface FunctionCall {
    name: string;
    args: Record<string, unknown>;
}

export interface GeminiStreamChunk {
    type: 'text' | 'function_call' | 'done' | 'error';
    content?: string;
    functionCall?: FunctionCall;
    error?: string;
}

function getNumberConfig(configService: ConfigService, key: string, fallback: number, min: number): number {
    const rawValue = configService.get<string | number>(key);
    if (rawValue === undefined || rawValue === null || rawValue === "") {
        return fallback;
    }

    const parsedValue = Number(rawValue);
    return Number.isFinite(parsedValue) && parsedValue >= min ? parsedValue : fallback;
}

@Injectable()
export class GeminiChatGateway {
    private readonly logger = new Logger(GeminiChatGateway.name);
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta";
    private readonly model: string;
    private readonly temperature: number;
    private readonly maxOutputTokens: number;
    private readonly requestTimeoutMs: number;

    constructor(private readonly configService: ConfigService) {
        this.model = this.configService.get<string>("GEMINI_CHAT_MODEL") || "gemini-2.5-flash-lite";
        this.temperature = getNumberConfig(this.configService, "GEMINI_CHAT_TEMPERATURE", 0.1, 0);
        this.maxOutputTokens = getNumberConfig(this.configService, "GEMINI_CHAT_MAX_OUTPUT_TOKENS", 4096, 1);
        this.requestTimeoutMs = getNumberConfig(
            this.configService,
            "GEMINI_CHAT_TIMEOUT_MS",
            DEFAULT_GEMINI_STREAM_TOTAL_TIMEOUT_MS,
            1,
        );
    }

    private getApiKey(): string {
        const apiKey = this.configService.get<string>("GEMINI_API_KEY");
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is not configured");
        }
        return apiKey;
    }

    private formatMessagesForGemini(messages: ChatMessage[]): { role: string; parts: { text: string }[] }[] {
        return messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }],
            }));
    }

    private getSystemInstruction(messages: ChatMessage[]): string | undefined {
        const systemMessage = messages.find(m => m.role === 'system');
        return systemMessage?.content;
    }

    private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        try {
            return await fetch(url, {
                ...init,
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeout);
        }
    }

    async chat(
        messages: ChatMessage[],
        tools?: FunctionDeclaration[],
    ): Promise<{ text?: string; functionCall?: FunctionCall }> {
        const apiKey = this.getApiKey();
        const systemInstruction = this.getSystemInstruction(messages);
        const formattedMessages = this.formatMessagesForGemini(messages);

        const requestBody: Record<string, unknown> = {
            contents: formattedMessages,
            generationConfig: {
                temperature: this.temperature,
                maxOutputTokens: this.maxOutputTokens,
            },
        };

        if (systemInstruction) {
            requestBody['systemInstruction'] = { parts: [{ text: systemInstruction }] };
        }

        if (tools && tools.length > 0) {
            requestBody['tools'] = [{
                functionDeclarations: tools,
            }];
            requestBody['toolConfig'] = {
                functionCallingConfig: {
                    mode: "AUTO",
                },
            };
        }

        const response = await this.fetchWithTimeout(
            `${this.baseUrl}/models/${this.model}:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`Gemini API error: ${response.status} - ${errorText}`);
            throw new Error(`Gemini API request failed: ${response.status}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const content = candidate?.content;

        if (!content) {
            throw new Error("Empty response from Gemini API");
        }

        const textPart = content.parts?.find((p: { text?: string }) => p.text);
        const functionCallPart = content.parts?.find((p: { functionCall?: unknown }) => p.functionCall);

        if (functionCallPart?.functionCall) {
            return {
                functionCall: {
                    name: functionCallPart.functionCall.name,
                    args: functionCallPart.functionCall.args || {},
                },
            };
        }

        return { text: textPart?.text || "" };
    }

    async *chatStream(
        messages: ChatMessage[],
        tools?: FunctionDeclaration[],
        callerSignal?: AbortSignal,
    ): AsyncGenerator<GeminiStreamChunk> {
        const apiKey = this.getApiKey();
        const systemInstruction = this.getSystemInstruction(messages);
        const formattedMessages = this.formatMessagesForGemini(messages);

        const requestBody: Record<string, unknown> = {
            contents: formattedMessages,
            generationConfig: {
                temperature: this.temperature,
                maxOutputTokens: this.maxOutputTokens,
            },
        };

        if (systemInstruction) {
            requestBody['systemInstruction'] = { parts: [{ text: systemInstruction }] };
        }

        if (tools && tools.length > 0) {
            requestBody['tools'] = [{
                functionDeclarations: tools,
            }];
            requestBody['toolConfig'] = {
                functionCallingConfig: {
                    mode: "AUTO",
                },
            };
        }

        const deadline = createGeminiStreamDeadline(
            getGeminiStreamTimeouts(this.configService),
            callerSignal,
        );
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let readerCompleted = false;
        let doneEmitted = false;
        let terminated = false;

        try {
            const response = await waitForGeminiStreamOperation(
                fetch(
                    `${this.baseUrl}/models/${this.model}:streamGenerateContent?alt=sse&key=${apiKey}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(requestBody),
                        signal: deadline.signal,
                    },
                ),
                deadline,
            );

            if (!response.ok) {
                this.logger.error(`Gemini streaming error: ${response.status}`);
                yield { type: "error", error: `Gemini API error: ${response.status}` };
                terminated = true;
                return;
            }

            deadline.markHeadersReceived();
            reader = response.body?.getReader();
            if (!reader) {
                yield { type: "error", error: "Gemini streaming response had no body" };
                terminated = true;
                return;
            }

            const decoder = new TextDecoder();
            let buffer = "";
            let shouldStop = false;

            while (!shouldStop) {
                const { done, value } = await waitForGeminiStreamOperation(
                    reader.read(),
                    deadline,
                );
                if (done) {
                    readerCompleted = true;
                    break;
                }

                deadline.markChunkReceived();
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.startsWith("data: ")) {
                        continue;
                    }
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr || jsonStr === "[DONE]") {
                        continue;
                    }

                    try {
                        const data = JSON.parse(jsonStr);
                        const candidate = data.candidates?.[0];
                        const content = candidate?.content;

                        if (content?.parts) {
                            for (const part of content.parts) {
                                if (part.text) {
                                    yield { type: "text", content: part.text };
                                }
                                if (part.functionCall) {
                                    yield {
                                        type: "function_call",
                                        functionCall: {
                                            name: part.functionCall.name,
                                            args: part.functionCall.args || {},
                                        },
                                    };
                                }
                            }
                        }

                        if (candidate?.finishReason === "STOP") {
                            if (!doneEmitted) {
                                doneEmitted = true;
                                yield { type: "done" };
                            }
                            shouldStop = true;
                            break;
                        }
                    } catch {
                        this.logger.warn("Failed to parse Gemini streaming response chunk");
                    }
                }
            }

            if (!doneEmitted && !terminated) {
                doneEmitted = true;
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
            if (reader) {
                if (!readerCompleted) {
                    try {
                        void Promise.resolve(reader.cancel()).catch(() => undefined);
                    } catch {
                        // The stream is already closing; releasing the lock is sufficient.
                    }
                }
                try {
                    reader.releaseLock();
                } catch {
                    // The underlying response may have released the lock during cancellation.
                }
            }
            deadline.cleanup();
        }
    }

    async sendFunctionResult(
        messages: ChatMessage[],
        functionName: string,
        result: unknown,
        tools?: FunctionDeclaration[],
    ): Promise<{ text?: string; functionCall?: FunctionCall }> {
        const messagesWithResult: ChatMessage[] = [
            ...messages,
            {
                role: 'model',
                content: JSON.stringify({ functionCall: { name: functionName } }),
            },
            {
                role: 'user',
                content: JSON.stringify({ functionResponse: { name: functionName, response: result } }),
            },
        ];

        return this.chat(messagesWithResult, tools);
    }
}
