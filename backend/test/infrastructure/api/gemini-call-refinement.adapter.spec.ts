import { GeminiCallRefinementAdapter } from "infrastructure/api/gemini-call-refinement.adapter";
import { REFINED_SPEAKERS } from "domain/ports/call-refinement.port";

describe("GeminiCallRefinementAdapter", () => {
    const configService = {
        get: jest.fn((key: string) => (key === "GEMINI_API_KEY" ? "test-key" : undefined)),
    };
    const input = {
        segments: [
            { speaker: "1", text: "산우도우미 문의요" },
            { speaker: "2", text: "네 안녕하세요" },
        ],
        diarized: true,
        fileName: "rec.m4a",
    };

    const mockGeminiResponse = (transcript: unknown) =>
        jest.spyOn(global, "fetch" as never).mockResolvedValue({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: JSON.stringify({ transcript }) }] } }],
            }),
        } as never);

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("accepts every literal of the closed speaker vocabulary", async () => {
        // One turn per legal literal — the input must have the same turn count.
        const transcript = REFINED_SPEAKERS.map((speaker, index) => ({ speaker, text: `t${index}` }));
        const segments = REFINED_SPEAKERS.map((_, index) => ({ speaker: "1", text: `raw${index}` }));
        mockGeminiResponse(transcript);

        const adapter = new GeminiCallRefinementAdapter(configService as never);
        const result = await adapter.refine({ ...input, segments });

        expect(result).toEqual({ transcript });
    });

    it("rejects an out-of-vocabulary speaker near-miss (상담사)", async () => {
        mockGeminiResponse([
            { speaker: "상담사", text: "안녕하세요" },
            { speaker: "고객", text: "문의요" },
        ]);

        const adapter = new GeminiCallRefinementAdapter(configService as never);
        await expect(adapter.refine(input)).rejects.toThrow(/unrecognized speaker: "상담사"/);
    });

    it("rejects an empty transcript", async () => {
        mockGeminiResponse([]);

        const adapter = new GeminiCallRefinementAdapter(configService as never);
        await expect(adapter.refine(input)).rejects.toThrow(/empty or non-array transcript/);
    });

    it("rejects a response that changed the turn count (summarisation guard)", async () => {
        mockGeminiResponse([{ speaker: "고객", text: "요약된 한 턴" }]);

        const adapter = new GeminiCallRefinementAdapter(configService as never);
        await expect(adapter.refine(input)).rejects.toThrow(/changed the turn count \(in=2, out=1\)/);
    });

    it("rejects a turn without string text", async () => {
        mockGeminiResponse([
            { speaker: "아이미래로", text: "안녕하세요" },
            { speaker: "고객" },
        ]);

        const adapter = new GeminiCallRefinementAdapter(configService as never);
        await expect(adapter.refine(input)).rejects.toThrow(/turn without string text/);
    });

    it("uses GEMINI_EXTRACTION_MODEL to override the request URL's model for the refine call too", async () => {
        const overrideConfig = {
            get: jest.fn((key: string) => {
                if (key === "GEMINI_API_KEY") return "test-key";
                if (key === "GEMINI_EXTRACTION_MODEL") return "gemini-x-test";
                return undefined;
            }),
        };
        const fetchMock = mockGeminiResponse([
            { speaker: "아이미래로", text: "안녕하세요" },
            { speaker: "고객", text: "문의요" },
        ]);

        const adapter = new GeminiCallRefinementAdapter(overrideConfig as never);
        await adapter.refine(input);

        const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain("gemini-x-test:generateContent");
    });

    it("defaults the model to gemini-2.5-flash and sends the structured-output schema", async () => {
        const fetchMock = mockGeminiResponse([
            { speaker: "아이미래로", text: "안녕하세요" },
            { speaker: "고객", text: "문의요" },
        ]);

        const adapter = new GeminiCallRefinementAdapter(configService as never);
        await adapter.refine(input);

        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain("gemini-2.5-flash:generateContent");
        expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
        const body = JSON.parse(init.body as string);
        expect(body.generationConfig.responseMimeType).toBe("application/json");
        expect(body.generationConfig.responseSchema.properties.transcript.items.properties.speaker.enum)
            .toEqual([...REFINED_SPEAKERS]);
    });

    it("throws a descriptive error on non-OK responses", async () => {
        jest.spyOn(global, "fetch" as never).mockResolvedValue({
            ok: false, status: 503, text: async () => "unavailable",
        } as never);

        const adapter = new GeminiCallRefinementAdapter(configService as never);
        await expect(adapter.refine(input)).rejects.toThrow(/Gemini refinement failed \(503\)/);
    });

    it("throws when GEMINI_API_KEY is missing", async () => {
        const emptyConfig = { get: jest.fn(() => undefined) };
        const adapter = new GeminiCallRefinementAdapter(emptyConfig as never);
        await expect(adapter.refine(input)).rejects.toThrow(/GEMINI_API_KEY/);
    });

    it("throws a descriptive error on unparseable model output", async () => {
        jest.spyOn(global, "fetch" as never).mockResolvedValue({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: "not-json{" }] } }],
            }),
        } as never);

        const adapter = new GeminiCallRefinementAdapter(configService as never);
        await expect(adapter.refine(input)).rejects.toThrow(/unparseable JSON/);
    });
});
