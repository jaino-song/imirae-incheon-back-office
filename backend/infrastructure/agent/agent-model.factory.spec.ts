import { ConfigService } from "@nestjs/config";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import { AgentModelFactory, DEFAULT_AGENT_MODEL } from "./agent-model.factory";
import { DeterministicAgentLanguageModel } from "./deterministic-agent-language-model";

describe("AgentModelFactory", () => {
    it("uses the new runtime model without changing the legacy gateway default", () => {
        const factory = new AgentModelFactory(new ConfigService({ GEMINI_API_KEY: "test" }));
        expect(factory.modelId).toBe(DEFAULT_AGENT_MODEL);
    });

    it("drives a real streamText tool loop deterministically", async () => {
        const execute = jest.fn(async ({ query }: { query: string }) => ({ id: "client-1", query }));
        const model = new DeterministicAgentLanguageModel([
            { type: "tool-call", toolName: "clients_search", input: { query: "홍길동" } },
            { type: "text", text: "홍길동 산모를 찾았습니다." },
        ]);

        const result = streamText({
            model,
            prompt: "홍길동 산모 찾아줘",
            stopWhen: stepCountIs(2),
            tools: {
                clients_search: tool({
                    inputSchema: z.object({ query: z.string() }),
                    execute,
                }),
            },
        });

        await expect(result.text).resolves.toBe("홍길동 산모를 찾았습니다.");
        expect(execute).toHaveBeenCalledWith(
            { query: "홍길동" },
            expect.objectContaining({ toolCallId: "deterministic-tool-1" }),
        );
    });
});
