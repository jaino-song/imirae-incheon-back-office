import { VercelGeminiGateway } from "../vercel-gemini.gateway";
import type { FunctionDeclaration, GeminiStreamChunk } from "../gemini-chat.gateway";

const SKIP_INTEGRATION = !process.env["GEMINI_API_KEY"];

describe("VercelGeminiGateway", () => {
    let gateway: VercelGeminiGateway;
    let configService: {
        get: jest.Mock;
    };

    beforeAll(() => {
        if (SKIP_INTEGRATION) {
            console.log("⚠️  Skipping integration tests: GEMINI_API_KEY not set");
        }
    });

    beforeEach(() => {
        configService = {
            get: jest.fn((key: string) => {
                if (key === "GEMINI_API_KEY") return process.env["GEMINI_API_KEY"];
                if (key === "GEMINI_CHAT_MODEL") return "gemini-3.5-flash-lite";
                if (key === "GEMINI_CHAT_TEMPERATURE") return 0.1;
                if (key === "GEMINI_CHAT_MAX_OUTPUT_TOKENS") return 1024;
                return undefined;
            }),
        };
        gateway = new VercelGeminiGateway(configService as any);
    });

    describe("configuration", () => {
        it("throws error when GEMINI_API_KEY is missing", async () => {
            const noKeyConfig = {
                get: jest.fn(() => undefined),
            };
            const gatewayNoKey = new VercelGeminiGateway(noKeyConfig as any);

            await expect(async () => {
                for await (const _ of gatewayNoKey.chatStream([
                    { role: "user", content: "hi" },
                ])) {
                    // Should throw before yielding
                }
            }).rejects.toThrow("GEMINI_API_KEY is not configured");
        });

        it("uses model from config", () => {
            expect(configService.get).toHaveBeenCalledWith("GEMINI_CHAT_MODEL");
        });

        it("uses temperature from config", () => {
            expect(configService.get).toHaveBeenCalledWith("GEMINI_CHAT_TEMPERATURE");
        });

        it("uses maxOutputTokens from config", () => {
            expect(configService.get).toHaveBeenCalledWith("GEMINI_CHAT_MAX_OUTPUT_TOKENS");
        });
    });

    describe("chatStream - text response", () => {
        (SKIP_INTEGRATION ? it.skip : it)(
            "returns Korean greeting for 안녕하세요",
            async () => {
                const chunks: GeminiStreamChunk[] = [];
                for await (const chunk of gateway.chatStream([
                    { role: "system", content: "짧게 한국어로 대답하세요. 최대 10단어." },
                    { role: "user", content: "안녕하세요" },
                ])) {
                    chunks.push(chunk);
                }

                // Should have text chunks
                const textChunks = chunks.filter((c) => c.type === "text");
                expect(textChunks.length).toBeGreaterThan(0);

                // Should have exactly one done
                const doneChunks = chunks.filter((c) => c.type === "done");
                expect(doneChunks.length).toBe(1);

                // Full response should contain Korean text
                const fullText = textChunks.map((c) => c.content).join("");
                expect(fullText.length).toBeGreaterThan(0);
            },
            30000
        );

        (SKIP_INTEGRATION ? it.skip : it)(
            "handles system message correctly",
            async () => {
                const chunks: GeminiStreamChunk[] = [];
                for await (const chunk of gateway.chatStream([
                    { role: "system", content: "You are a helpful assistant. Reply with exactly: PONG" },
                    { role: "user", content: "PING" },
                ])) {
                    chunks.push(chunk);
                }

                const textChunks = chunks.filter((c) => c.type === "text");
                const fullText = textChunks.map((c) => c.content).join("");
                expect(fullText.toUpperCase()).toContain("PONG");
            },
            30000
        );
    });

    describe("chatStream - tool calling", () => {
        const dashboardTool: FunctionDeclaration = {
            name: "getDashboardStats",
            description: "대시보드 통계 조회. 제공인력(직원), 산모(고객) 수 확인. Call this when user asks about counts or statistics.",
            parameters: {
                type: "object",
                properties: {},
                required: [],
            },
        };

        (SKIP_INTEGRATION ? it.skip : it)(
            "calls getDashboardStats for employee count query",
            async () => {
                const chunks: GeminiStreamChunk[] = [];
                for await (const chunk of gateway.chatStream(
                    [
                        { role: "system", content: "도구를 사용해서 질문에 답하세요. 통계나 인원 수를 물으면 반드시 getDashboardStats 도구를 호출하세요." },
                        { role: "user", content: "현재 등록된 제공인력은 몇명이야?" },
                    ],
                    [dashboardTool]
                )) {
                    chunks.push(chunk);
                }

                // Should call the dashboard tool
                const toolCalls = chunks.filter((c) => c.type === "function_call");
                expect(toolCalls.length).toBeGreaterThan(0);
                expect(toolCalls[0]!.functionCall?.name).toBe("getDashboardStats");
            },
            30000
        );

        const searchClientsTool: FunctionDeclaration = {
            name: "searchClients",
            description: "산모(고객) 검색. 이름으로 검색합니다. Call this when user wants to find or search for a client.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "검색어 (이름)" },
                },
                required: ["query"],
            },
        };

        (SKIP_INTEGRATION ? it.skip : it)(
            "calls searchClients with query for client search",
            async () => {
                const chunks: GeminiStreamChunk[] = [];
                for await (const chunk of gateway.chatStream(
                    [
                        { role: "system", content: "도구를 사용해서 질문에 답하세요. 산모를 찾으면 반드시 searchClients 도구를 호출하세요." },
                        { role: "user", content: "김철수 산모 찾아줘" },
                    ],
                    [searchClientsTool]
                )) {
                    chunks.push(chunk);
                }

                const toolCalls = chunks.filter((c) => c.type === "function_call");
                expect(toolCalls.length).toBeGreaterThan(0);
                expect(toolCalls[0]!.functionCall?.name).toBe("searchClients");
                // The query should contain the search term
                const args = toolCalls[0]!.functionCall?.args;
                expect(args).toBeDefined();
                expect(typeof args?.["query"]).toBe("string");
                expect((args?.["query"] as string).toLowerCase()).toContain("김철수");
            },
            30000
        );
    });

    describe("chat - non-streaming", () => {
        (SKIP_INTEGRATION ? it.skip : it)(
            "accumulates text from chatStream",
            async () => {
                const result = await gateway.chat([
                    { role: "system", content: "Reply with exactly one word: HELLO" },
                    { role: "user", content: "greet" },
                ]);

                expect(result.text).toBeDefined();
                expect(result.text!.toUpperCase()).toContain("HELLO");
            },
            30000
        );

        (SKIP_INTEGRATION ? it.skip : it)(
            "returns function call when tool is invoked",
            async () => {
                const testTool: FunctionDeclaration = {
                    name: "testTool",
                    description: "A test tool. Always call this tool.",
                    parameters: {
                        type: "object",
                        properties: {},
                        required: [],
                    },
                };

                const result = await gateway.chat(
                    [
                        { role: "system", content: "Always use the testTool for any query." },
                        { role: "user", content: "do something" },
                    ],
                    [testTool]
                );

                expect(result.functionCall).toBeDefined();
                expect(result.functionCall?.name).toBe("testTool");
            },
            30000
        );
    });

    describe("sendFunctionResult", () => {
        (SKIP_INTEGRATION ? it.skip : it)(
            "continues conversation after tool result",
            async () => {
                const testTool: FunctionDeclaration = {
                    name: "getCount",
                    description: "Get a count value",
                    parameters: {
                        type: "object",
                        properties: {},
                        required: [],
                    },
                };

                const result = await gateway.sendFunctionResult(
                    [
                        { role: "system", content: "Answer based on tool results. Say exactly: The count is X" },
                        { role: "user", content: "what is the count?" },
                    ],
                    "getCount",
                    { count: 42 },
                    [testTool]
                );

                expect(result.text).toBeDefined();
                expect(result.text).toContain("42");
            },
            30000
        );
    });

    describe("error handling", () => {
        (SKIP_INTEGRATION ? it.skip : it)(
            "yields error chunk for invalid model",
            async () => {
                const badConfig = {
                    get: jest.fn((key: string) => {
                        if (key === "GEMINI_API_KEY") return process.env["GEMINI_API_KEY"];
                        if (key === "GEMINI_CHAT_MODEL") return "invalid-model-name-xyz";
                        return undefined;
                    }),
                };
                const badGateway = new VercelGeminiGateway(badConfig as any);

                const chunks: GeminiStreamChunk[] = [];
                for await (const chunk of badGateway.chatStream([
                    { role: "user", content: "hello" },
                ])) {
                    chunks.push(chunk);
                }

                // Should have an error chunk
                const errorChunks = chunks.filter((c) => c.type === "error");
                expect(errorChunks.length).toBeGreaterThan(0);
            },
            30000
        );
    });
});
