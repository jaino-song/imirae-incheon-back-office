import {
    AgentIntelligenceService,
    AgentSessionSummarySchema,
    MAX_CONVERSATION_DIGEST_CHARS,
    MAX_SUMMARY_CHARS,
} from "./agent-intelligence.service";

describe("AgentIntelligenceService", () => {
    it("redacts landlines and hyphenated identifiers from summaries and selected entity memory", async () => {
        const sessions = {
            get: jest.fn().mockResolvedValue({
                selectedEntities: {
                    clients: {
                        id: "client_cuid_2m4x6z8q0v",
                        identifier: "900101-1234567",
                        phone: "02-1234-5678",
                        businessNumber: "123-45-67890",
                        asOf: "2026-08-03",
                        version: "v1.2.3",
                    },
                },
                messages: [
                    { id: "m1", role: "user", parts: [{ type: "text", text: "031-123-4567 900101-1234567" }] },
                ],
            }),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const service = new AgentIntelligenceService(sessions as never, { list: jest.fn().mockResolvedValue([]) } as never);

        const result = await service.compact("session-a", { userId: "user-a", branchId: "branch-a" });
        const parsed = AgentSessionSummarySchema.parse(JSON.parse(result.summary));
        const selected = JSON.stringify(parsed.selectedEntities);

        expect(selected).toContain("client_cuid_2m4x6z8q0v");
        expect(selected).toContain("2026-08-03");
        expect(selected).toContain("v1.2.3");
        expect(selected).not.toMatch(/02-1234-5678|031-123-4567|900101-1234567|123-45-67890/);
        expect(parsed.goals[0]).not.toMatch(/031-123-4567|900101-1234567/);
    });

    it("compacts server-owned context while preserving unresolved work and minimizing PII", async () => {
        const sessions = {
            get: jest.fn().mockResolvedValue({
                selectedEntities: { clients: { id: 7, name: "홍길동" } },
                messages: [
                    { id: "m1", role: "user", parts: [{ type: "text", text: "010-1234-5678 연락처로 확인 token=secret" }] },
                    { id: "m2", role: "assistant", parts: [{ type: "text", text: "확인 중" }] },
                ],
            }),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const actions = { list: jest.fn().mockResolvedValue([{
            id: "action-a", sessionId: "session-a", capability: "messages.sendSms", status: "uncertain", expiresAt: new Date("2026-08-03T01:00:00.000Z"),
        }]) };
        const service = new AgentIntelligenceService(sessions as never, actions as never);

        const result = await service.compact("session-a", { userId: "user-a", branchId: "branch-a" });
        const parsed = AgentSessionSummarySchema.parse(JSON.parse(result.summary));

        expect(parsed.unresolvedActions).toEqual([expect.objectContaining({ id: "action-a", status: "uncertain" })]);
        expect(parsed.goals[0]).not.toContain("010-1234-5678");
        expect(parsed.goals[0]).not.toContain("secret");
        expect(parsed.conversationDigest).toEqual([
            { id: "m1", role: "user", text: "[redacted] 연락처로 확인 [redacted]" },
            { id: "m2", role: "assistant", text: "확인 중" },
        ]);
        expect(result.checksum).toHaveLength(64);
        expect(sessions.update).toHaveBeenCalledWith("session-a", { userId: "user-a", branchId: "branch-a" }, { summary: result.summary });
    });

    it("keeps a bounded redacted user and assistant digest while excluding non-conversation parts", async () => {
        const messages = Array.from({ length: 32 }, (_, index) => ({
            id: `message-${index}`,
            role: index % 2 === 0 ? "user" : "assistant",
            parts: [
                { type: "text", text: `${index % 2 === 0 ? "사용자" : "assistant"} ${"긴 대화 ".repeat(200)} 010-1234-5678` },
                { type: "data-action-result", data: { providerToken: "tool-secret", documentContent: "private" } },
                { type: "data-document", data: { body: "private-document-body" } },
            ],
        }));
        const sessions = {
            get: jest.fn().mockResolvedValue({ selectedEntities: {}, messages }),
            update: jest.fn().mockResolvedValue(undefined),
        };
        const service = new AgentIntelligenceService(sessions as never, { list: jest.fn().mockResolvedValue([]) } as never);

        const result = await service.compact("session-a", { userId: "user-a", branchId: "branch-a" });
        const parsed = AgentSessionSummarySchema.parse(JSON.parse(result.summary));
        const digestJson = JSON.stringify(parsed.conversationDigest);

        expect(parsed.conversationDigest.length).toBeGreaterThan(0);
        expect(parsed.conversationDigest.some((message) => message.role === "user")).toBe(true);
        expect(parsed.conversationDigest.some((message) => message.role === "assistant")).toBe(true);
        expect(digestJson.length).toBeLessThanOrEqual(MAX_CONVERSATION_DIGEST_CHARS);
        expect(result.summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
        expect(digestJson).not.toContain("tool-secret");
        expect(digestJson).not.toContain("private-document-body");
        expect(digestJson).not.toContain("010-1234-5678");
    });

    it("returns versioned policy provenance and checksums for explanatory answers", () => {
        const service = new AgentIntelligenceService({} as never, {} as never);
        const result = service.retrievePolicy("외부 제공자 불확실 재시도", "ko");

        expect(result.matches[0]).toEqual(expect.objectContaining({
            id: "external-uncertainty",
            version: "2.0.0",
            source: expect.any(String),
            checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
        }));
    });
});
