import { GeminiCallExtractionAdapter } from "infrastructure/api/gemini-call-extraction.adapter";

describe("GeminiCallExtractionAdapter", () => {
    const configService = {
        get: jest.fn((key: string) => (key === "GEMINI_API_KEY" ? "test-key" : undefined)),
    };
    const input = {
        transcript: [{ speaker: "고객", text: "7월 15일이 예정일이에요" }],
        summary: null,
        fileName: "rec.m4a",
    };
    const geminiResult = {
        category: "NEW_CONSULTATION",
        callerName: "김서연",
        callerPhoneCandidates: ["010-4821-7763"],
        requestSummary: "산후도우미 신규 문의",
        proposals: [
            { field: "dueDate", value: "2026-07-15", evidence: "7월 15일이 예정일이에요", confidence: "high" },
        ],
        summary: {
            inquiry_type: "신규상담",
            customer_info: "김서연",
            key_content: "산후도우미 신규 문의",
            result_action: "견적 안내",
        },
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("calls Gemini generateContent and parses the structured JSON", async () => {
        const fetchMock = jest.spyOn(global, "fetch" as never).mockResolvedValue({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: JSON.stringify(geminiResult) }] } }],
            }),
        } as never);

        const adapter = new GeminiCallExtractionAdapter(configService as never);
        const result = await adapter.extract(input);

        expect(result).toEqual(geminiResult);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain("gemini-2.5-flash:generateContent");
        expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
        const body = JSON.parse(init.body as string);
        expect(body.generationConfig.responseMimeType).toBe("application/json");
    });

    it("throws a descriptive error on non-OK responses", async () => {
        jest.spyOn(global, "fetch" as never).mockResolvedValue({
            ok: false, status: 429, text: async () => "rate limited",
        } as never);

        const adapter = new GeminiCallExtractionAdapter(configService as never);
        await expect(adapter.extract(input)).rejects.toThrow(/Gemini extraction failed \(429\)/);
    });

    it("throws when GEMINI_API_KEY is missing", async () => {
        const emptyConfig = { get: jest.fn(() => undefined) };
        const adapter = new GeminiCallExtractionAdapter(emptyConfig as never);
        await expect(adapter.extract(input)).rejects.toThrow(/GEMINI_API_KEY/);
    });

    it("uses GEMINI_EXTRACTION_MODEL to override the request URL's model when configured", async () => {
        const overrideConfig = {
            get: jest.fn((key: string) => {
                if (key === "GEMINI_API_KEY") return "test-key";
                if (key === "GEMINI_EXTRACTION_MODEL") return "gemini-x-test";
                return undefined;
            }),
        };
        const fetchMock = jest.spyOn(global, "fetch" as never).mockResolvedValue({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: JSON.stringify(geminiResult) }] } }],
            }),
        } as never);

        const adapter = new GeminiCallExtractionAdapter(overrideConfig as never);
        await adapter.extract(input);

        const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain("gemini-x-test:generateContent");
    });

    it("throws a descriptive error on unparseable model output", async () => {
        jest.spyOn(global, "fetch" as never).mockResolvedValue({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: "not-json{" }] } }],
            }),
        } as never);

        const adapter = new GeminiCallExtractionAdapter(configService as never);
        await expect(adapter.extract(input)).rejects.toThrow(/unparseable JSON/);
    });
});
