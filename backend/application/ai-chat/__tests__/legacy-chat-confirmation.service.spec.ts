import { ConflictException, NotFoundException } from "@nestjs/common";
import { createHash } from "crypto";
import {
    LEGACY_CHAT_CONFIRMATION_TTL_MS,
    LegacyChatConfirmationService,
    hashLegacyChatPayload,
} from "../legacy-chat-confirmation.service";

describe("LegacyChatConfirmationService", () => {
    const context = { userId: "user-1", branchId: "branch-1", sessionId: "session-1" };
    const payload = { clientId: 7, phone: "010-0000-0000" };

    function createPrisma() {
        return {
            legacy_chat_confirmation_intent: {
                create: jest.fn(),
                findFirst: jest.fn(),
                updateMany: jest.fn(),
            },
        };
    }

    function storedIntent(overrides: Record<string, unknown> = {}) {
        return {
            id: "intent-1",
            userId: context.userId,
            branchId: context.branchId,
            sessionId: context.sessionId,
            toolName: "updateClient",
            payload,
            payloadHash: hashLegacyChatPayload(payload),
            nonceHash: "11".repeat(32),
            expiresAt: new Date(Date.now() + LEGACY_CHAT_CONFIRMATION_TTL_MS),
            consumedAt: null,
            ...overrides,
        };
    }

    it("binds actor, branch, session, action and payload while returning a nonce only once", async () => {
        const prisma = createPrisma();
        prisma.legacy_chat_confirmation_intent.create.mockResolvedValue({
            id: "intent-1",
            expiresAt: new Date(Date.now() + LEGACY_CHAT_CONFIRMATION_TTL_MS),
        });
        const service = new LegacyChatConfirmationService(prisma as never);

        const result = await service.createIntent(context, "updateClient", { confirmed: true, ...payload });

        expect(result.intentId).toBe("intent-1");
        expect(result.nonce).toHaveLength(43);
        expect(prisma.legacy_chat_confirmation_intent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                userId: context.userId,
                branchId: context.branchId,
                sessionId: context.sessionId,
                toolName: "updateClient",
                payload,
                nonceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
            }),
        }));
        expect(JSON.stringify(prisma.legacy_chat_confirmation_intent.create.mock.calls[0]?.[0])).not.toContain("confirmed");
    });

    it("rejects a cross-tenant intent without probing the mutation path", async () => {
        const prisma = createPrisma();
        prisma.legacy_chat_confirmation_intent.findFirst.mockResolvedValue(null);
        const service = new LegacyChatConfirmationService(prisma as never);

        await expect(service.consumeIntent(
            { userId: "other-user", branchId: context.branchId, sessionId: context.sessionId },
            { intentId: "intent-1", nonce: "nonce" },
        )).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.legacy_chat_confirmation_intent.updateMany).not.toHaveBeenCalled();
    });

    it.each([
        ["replay", { consumedAt: new Date() }, "already been used"],
        ["expiry", { expiresAt: new Date(Date.now() - 1) }, "expired"],
    ])("rejects %s intents", async (_label, overrides, message) => {
        const prisma = createPrisma();
        prisma.legacy_chat_confirmation_intent.findFirst.mockResolvedValue(storedIntent(overrides));
        const service = new LegacyChatConfirmationService(prisma as never);

        await expect(service.consumeIntent(context, { intentId: "intent-1", nonce: "bad" })).rejects.toThrow(message);
        expect(prisma.legacy_chat_confirmation_intent.updateMany).not.toHaveBeenCalled();
    });

    it("rejects nonce, action, payload and session mismatches", async () => {
        const nonce = "c".repeat(43);
        const nonceHash = createHash("sha256").update(nonce).digest("hex");
        const cases: Array<{ intent: Record<string, unknown>; expectedTool?: string; expectedPayload?: Record<string, unknown>; expectedSessionId?: string }> = [
            { intent: storedIntent({ nonceHash }), expectedTool: "deleteClient" },
            { intent: storedIntent({ nonceHash }), expectedPayload: { clientId: 99 } },
            { intent: storedIntent({ nonceHash, sessionId: "other-session" }), expectedSessionId: context.sessionId },
        ];

        for (const testCase of cases) {
            const prisma = createPrisma();
            prisma.legacy_chat_confirmation_intent.findFirst.mockResolvedValue(testCase.intent);
            const service = new LegacyChatConfirmationService(prisma as never);
            const suppliedContext = { ...context, ...(testCase.expectedSessionId ? { sessionId: testCase.expectedSessionId } : {}) };

            await expect(service.consumeIntent(
                suppliedContext,
                { intentId: "intent-1", nonce },
                testCase.expectedTool,
                testCase.expectedPayload,
            )).rejects.toBeInstanceOf(ConflictException);
            expect(prisma.legacy_chat_confirmation_intent.updateMany).not.toHaveBeenCalled();
        }
    });

    it("claims a valid intent exactly once under concurrent consumption", async () => {
        const prisma = createPrisma();
        const nonce = "a".repeat(43);
        const intent = storedIntent({
            nonceHash: createHash("sha256").update(nonce).digest("hex"),
        });
        prisma.legacy_chat_confirmation_intent.findFirst.mockResolvedValue(intent);
        prisma.legacy_chat_confirmation_intent.updateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 });
        const service = new LegacyChatConfirmationService(prisma as never);

        const results = await Promise.allSettled([
            service.consumeIntent(context, { intentId: "intent-1", nonce }),
            service.consumeIntent(context, { intentId: "intent-1", nonce }),
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        expect(prisma.legacy_chat_confirmation_intent.updateMany).toHaveBeenCalledTimes(2);
    });

    it("consumes before running the external/mutation callback", async () => {
        const prisma = createPrisma();
        const nonce = "b".repeat(43);
        prisma.legacy_chat_confirmation_intent.findFirst.mockResolvedValue(storedIntent({
            nonceHash: createHash("sha256").update(nonce).digest("hex"),
        }));
        prisma.legacy_chat_confirmation_intent.updateMany.mockResolvedValue({ count: 1 });
        const service = new LegacyChatConfirmationService(prisma as never);
        const order: string[] = [];

        await service.consumeAndExecute(context, { intentId: "intent-1", nonce }, async () => {
            expect(prisma.legacy_chat_confirmation_intent.updateMany).toHaveBeenCalledTimes(1);
            order.push("callback");
            return "done";
        });

        expect(order).toEqual(["callback"]);
    });
});
