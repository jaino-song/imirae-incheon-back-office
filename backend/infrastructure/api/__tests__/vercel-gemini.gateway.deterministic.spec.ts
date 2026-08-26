import type { ConfigService } from "@nestjs/config";
import type { GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { streamText } from "ai";

import type { GeminiStreamChunk } from "../gemini-chat.gateway";
import { VercelGeminiGateway } from "../vercel-gemini.gateway";

jest.mock("ai", () => ({
    streamText: jest.fn(),
}));

jest.mock("@ai-sdk/google", () => ({
    createGoogleGenerativeAI: jest.fn(),
}));

const streamTextMock = jest.mocked(streamText);

async function collect(stream: AsyncGenerator<GeminiStreamChunk>): Promise<GeminiStreamChunk[]> {
    const chunks: GeminiStreamChunk[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return chunks;
}

function createConfigService(): ConfigService {
    const values: Record<string, string | number> = {
        GEMINI_CHAT_MODEL: "gemini-2.5-flash-lite",
        GEMINI_CHAT_TIMEOUT_MS: 1_000,
    };

    return {
        get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
}

class DeterministicVercelGeminiGateway extends VercelGeminiGateway {
    protected override createGoogleProvider(): GoogleGenerativeAIProvider {
        return ((model: string) => ({ modelId: model })) as unknown as GoogleGenerativeAIProvider;
    }
}

describe("VercelGeminiGateway deterministic provider contract", () => {
    beforeEach(() => {
        streamTextMock.mockReset();
    });

    it("exercises a successful response through a fake provider without a live API key", async () => {
        streamTextMock.mockReturnValue({
            fullStream: (async function* () {
                yield { type: "text-delta", text: "deterministic response" };
                yield { type: "finish" };
            })(),
        } as never);

        const configService = createConfigService();
        const gateway = new DeterministicVercelGeminiGateway(configService);

        const chunks = await collect(gateway.chatStream([
            { role: "system", content: "Reply deterministically." },
            { role: "user", content: "ping" },
        ]));

        expect(chunks).toEqual([
            { type: "text", content: "deterministic response" },
            { type: "done" },
        ]);
        expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
            model: { modelId: "gemini-2.5-flash-lite" },
            system: "Reply deterministically.",
            messages: [{ role: "user", content: "ping" }],
        }));
        expect(configService.get).not.toHaveBeenCalledWith("GEMINI_API_KEY");
    });

    it("keeps the missing-key guard before provider or SDK work", async () => {
        const configService = {
            get: jest.fn(() => undefined),
        } as unknown as ConfigService;
        const gateway = new VercelGeminiGateway(configService);

        await expect(collect(gateway.chatStream([
            { role: "user", content: "ping" },
        ]))).rejects.toThrow("GEMINI_API_KEY is not configured");
        expect(streamTextMock).not.toHaveBeenCalled();
    });
});
