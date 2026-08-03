import {
    AgentActionRiskSchema,
    AgentActionStatusSchema,
    AgentCapabilityMetaSchema,
    AgentMessageMetadataSchema,
    AgentRendererNameSchema,
    AgentNavigationPartSchema,
    AgentActionResultPartSchema,
    type BjjUIMessage,
} from "./index";

describe("agent contracts", () => {
    it("should validate Release A message metadata", () => {
        const metadata = AgentMessageMetadataSchema.parse({
            sessionId: "session-1",
            traceId: "trace-1",
            createdAt: "2026-08-03T00:00:00.000Z",
            model: "gemini-3.5-flash-lite",
            agentVersion: "release-a",
        });

        expect(metadata.sessionId).toBe("session-1");
    });

    it("should expose the complete renderer contract", () => {
        expect(AgentRendererNameSchema.options).toEqual([
            "text",
            "activity",
            "entity-choice",
            "action-proposal",
            "action-result",
            "navigation",
            "error",
            "attachment",
            "form",
            "feedback",
        ]);
    });

    it("should reject a write capability without an approval policy", () => {
        const result = AgentCapabilityMetaSchema.safeParse({
            name: "clients.update",
            domain: "clients",
            version: "1.0.0",
            description: "Update a client",
            risk: "reversible-write",
            requiredRoles: ["branch_admin"],
            renderer: "action-proposal",
            flagKey: "agent.capability.clients.update.enabled",
            sideEffect: true,
        });

        expect(result.success).toBe(false);
    });

    it("should expose stable action risk and status values", () => {
        expect(AgentActionRiskSchema.options).toContain("read");
        expect(AgentActionStatusSchema.options).toContain("proposed");
        expect(AgentActionStatusSchema.options).toContain("uncertain");
    });

    it("should keep capability risk and renderer validation aligned with the shared contracts", () => {
        for (const risk of AgentActionRiskSchema.options) {
            const isRead = risk === "read";
            const result = AgentCapabilityMetaSchema.safeParse({
                name: "clients.example",
                domain: "clients",
                version: "1.0.0",
                description: "Validate the capability contract",
                risk,
                requiredRoles: ["branch_admin"],
                renderer: "text",
                flagKey: "agent.capability.clients.example",
                sideEffect: !isRead,
                approvalPolicy: isRead ? undefined : "structured",
                idempotencyPolicy: isRead ? undefined : "action-id",
            });

            expect(result.success).toBe(true);
        }

        for (const renderer of AgentRendererNameSchema.options) {
            const result = AgentCapabilityMetaSchema.safeParse({
                name: "clients.example",
                domain: "clients",
                version: "1.0.0",
                description: "Validate the renderer contract",
                risk: "read",
                requiredRoles: ["branch_admin"],
                renderer,
                flagKey: "agent.capability.clients.example",
                sideEffect: false,
            });

            expect(result.success).toBe(true);
        }
    });

    it("should remain compatible with the AI SDK UIMessage shape", () => {
        const message = {
            id: "message-1",
            role: "assistant",
            metadata: {
                sessionId: "session-1",
                traceId: "trace-1",
                createdAt: "2026-08-03T00:00:00.000Z",
                model: "gemini-3.5-flash-lite",
                agentVersion: "release-a",
            },
            parts: [{ type: "text", text: "안녕하세요" }],
        } satisfies BjjUIMessage;

        expect(message.parts[0]?.type).toBe("text");
    });

    it("should keep navigation and action links internal", () => {
        expect(AgentNavigationPartSchema.safeParse({ href: "//evil.example", label: "open" }).success).toBe(false);
        expect(AgentActionResultPartSchema.safeParse({ actionId: "a-1", status: "succeeded", summary: "done", href: "javascript:alert(1)" }).success).toBe(false);
    });
});
