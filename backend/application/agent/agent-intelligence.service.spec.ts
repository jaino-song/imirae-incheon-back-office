import { AgentIntelligenceService, AgentSessionSummarySchema } from "./agent-intelligence.service";

describe("AgentIntelligenceService", () => {
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
        expect(result.checksum).toHaveLength(64);
        expect(sessions.update).toHaveBeenCalledWith("session-a", { userId: "user-a", branchId: "branch-a" }, { summary: result.summary });
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
