import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { z } from "zod";

import { ActionCoordinatorService, AgentActionCertainFailureError } from "./action-coordinator.service";

const principal = { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" };

function capability(risk: "read" | "reversible-write" = "reversible-write") {
    return {
        meta: {
            name: risk === "read" ? "clients.get" : "clients.update",
            domain: "clients",
            version: "1.0.0",
            description: "test capability",
            risk,
            requiredRoles: ["admin"],
            renderer: risk === "read" ? "text" : "action-proposal",
            flagKey: `agent.capability.${risk}`,
            sideEffect: risk !== "read",
            ...(risk === "read" ? {} : { approvalPolicy: "structured", idempotencyPolicy: "action-id" }),
        },
        inputSchema: z.object({ id: z.number().int().positive() }),
        outputSchema: z.object({ status: z.string() }),
        execute: jest.fn().mockResolvedValue({ status: "updated" }),
    };
}

describe("ActionCoordinatorService", () => {
    function actionRecord(overrides: Record<string, unknown> = {}) {
        const now = new Date();
        return {
            id: "action-a", sessionId: "session-a", userId: principal.userId, branchId: principal.branchId,
            capability: "clients.update", capabilityVersion: "1.0.0", risk: "reversible-write", status: "proposed",
            proposal: { input: { id: 3 }, locale: "ko" }, proposalRevision: "proposal-revision", inputHash: "input-hash",
            targetSnapshot: null, targetVersion: null, authorizationContext: {}, approvedBy: null, approvedAt: null,
            rejectedBy: null, rejectedAt: null, expiresAt: new Date(now.getTime() + 60_000),
            idempotencyKey: "provider-key", requestDedupeKey: "request-key", dedupeExpiresAt: new Date(now.getTime() + 60_000),
            result: null, error: null, createdAt: now, updatedAt: now, executedAt: null, executionAttemptCount: 0,
            ...overrides,
        };
    }

    it("creates a random action identity with a bounded request dedupe key", async () => {
        const definition = capability();
        const prisma = { agent_action: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(async ({ data }) => ({ ...data, createdAt: new Date(), updatedAt: new Date(), approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, result: null, error: null, executedAt: null, resultPartPersistedAt: null, targetSnapshot: null })) } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
        );
        const action = await service.propose({ sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko" });
        expect(action.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(action.idempotencyKey).toBe(`agent-action:${action.id}`);
        expect(action.proposalRevision).toHaveLength(64);
        expect(action.requestDedupeKey).toHaveLength(64);
        expect(prisma.agent_action.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: action.id, proposalRevision: action.proposalRevision, requestDedupeKey: action.requestDedupeKey }) }));
        expect(prisma.agent_action.findUnique).toHaveBeenCalledWith({ where: { requestDedupeKey: action.requestDedupeKey } });
    });

    it("deduplicates matching proposals across a time-bucket boundary", async () => {
        jest.useFakeTimers().setSystemTime(new Date(899_999));
        try {
            const definition = capability();
            let created: ReturnType<typeof actionRecord> | null = null;
            const prisma = { agent_action: {
                findUnique: jest.fn().mockImplementation(async () => created),
                create: jest.fn().mockImplementation(async ({ data }) => {
                    created = actionRecord({ ...data, createdAt: new Date(), updatedAt: new Date(), resultPartPersistedAt: null });
                    return created;
                }),
            } };
            const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never);
            const input = { sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko" };

            const first = await service.propose(input);
            jest.setSystemTime(new Date(900_001));
            const duplicate = await service.propose(input);

            expect(duplicate.id).toBe(first.id);
            expect(prisma.agent_action.create).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it("does not reuse a proposal from another session", async () => {
        const definition = capability();
        const records = new Map<string, ReturnType<typeof actionRecord>>();
        const prisma = { agent_action: {
            findUnique: jest.fn().mockImplementation(async ({ where }) => records.get(where.requestDedupeKey) ?? null),
            create: jest.fn().mockImplementation(async ({ data }) => {
                const created = actionRecord({ ...data, createdAt: new Date(), updatedAt: new Date(), resultPartPersistedAt: null });
                records.set(data.requestDedupeKey, created);
                return created;
            }),
        } };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never);

        const first = await service.propose({ sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko" });
        const second = await service.propose({ sessionId: "session-b", principal, capability: "clients.update", input: { id: 3 }, locale: "ko" });

        expect(second.id).not.toBe(first.id);
        expect(prisma.agent_action.create).toHaveBeenCalledTimes(2);
    });

    it("does not accept a capability version as approval proof", async () => {
        const definition = capability();
        const action = actionRecord();
        const prisma = { agent_action: { findFirst: jest.fn().mockResolvedValue(action) } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
        );

        await expect(service.approve(action.id, principal, action.capabilityVersion)).rejects.toBeInstanceOf(ConflictException);
    });

    it("accepts reconciliation outcomes only from the capability provider", async () => {
        const definition = {
            ...capability(),
            reconcile: jest.fn().mockResolvedValue({ status: "succeeded", result: { status: "updated" } }),
        };
        const uncertain = actionRecord({ status: "uncertain", error: { details: { providerRequestId: "provider-1" } } });
        const succeeded = actionRecord({ status: "succeeded", result: { status: "updated" } });
        const prisma = { agent_action: {
            findFirst: jest.fn().mockResolvedValueOnce(uncertain).mockResolvedValueOnce(succeeded),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
        );

        const result = await service.reconcile(uncertain.id, principal);

        expect(definition.reconcile).toHaveBeenCalledWith(expect.objectContaining({ actionId: uncertain.id }), { id: 3 }, { providerRequestId: "provider-1" });
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: uncertain.id, status: "uncertain" }),
            data: expect.objectContaining({ status: "succeeded", result: { status: "updated" } }),
        }));
        expect(result.status).toBe("succeeded");
    });

    it("preserves a schema-valid provider failure result in storage and the terminal UI part", async () => {
        const definition = {
            ...capability(),
            reconcile: jest.fn().mockResolvedValue({
                status: "failed",
                reason: "Provider rejected the request",
                result: { status: "provider-rejected" },
            }),
        };
        const uncertain = actionRecord({ status: "uncertain" });
        const failed = actionRecord({ status: "failed", result: { status: "provider-rejected" } });
        const sessions = { appendMessages: jest.fn().mockResolvedValue(undefined) };
        const prisma = { agent_action: {
            findFirst: jest.fn().mockResolvedValueOnce(uncertain).mockResolvedValueOnce(failed),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessions as never,
        );

        await expect(service.reconcile(uncertain.id, principal)).resolves.toEqual(expect.objectContaining({ status: "failed" }));

        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: "failed",
                result: { status: "provider-rejected" },
                error: expect.objectContaining({ message: "Provider rejected the request" }),
            }),
        }));
        expect(sessions.appendMessages).toHaveBeenCalledWith(
            uncertain.sessionId,
            { userId: principal.userId, branchId: principal.branchId },
            [expect.objectContaining({ parts: [expect.objectContaining({
                data: expect.objectContaining({ status: "failed", result: { status: "provider-rejected" } }),
            })] })],
        );
    });

    it("returns a persisted terminal action without executing it again", async () => {
        const definition = capability();
        const succeeded = actionRecord({ status: "succeeded", result: { status: "updated" }, executedAt: new Date() });
        const service = new ActionCoordinatorService(
            { agent_action: { findFirst: jest.fn().mockResolvedValue(succeeded) } } as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
        );

        const result = await service.approve(succeeded.id, principal, succeeded.proposalRevision);

        expect(result.action.status).toBe("succeeded");
        expect(definition.execute).not.toHaveBeenCalled();
    });

    it("marks a schema-invalid post-execution result uncertain", async () => {
        const definition = capability();
        definition.execute.mockResolvedValueOnce({ unexpected: true });
        const proposed = actionRecord();
        const prisma = { agent_action: {
            findFirst: jest.fn().mockResolvedValue(proposed),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockImplementation(async ({ data }) => actionRecord({ ...data })),
        } };
        const sessions = { appendMessages: jest.fn().mockResolvedValue(undefined) };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessions as never);

        const result = await service.approve(proposed.id, principal, proposed.proposalRevision);

        expect(result.action.status).toBe("uncertain");
        expect(prisma.agent_action.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: "uncertain", error: expect.objectContaining({ code: "result_validation_failed" }) }),
        }));
    });

    it("treats an unclassified execution exception as uncertain after invocation begins", async () => {
        const definition = capability();
        definition.execute.mockRejectedValueOnce(new Error("connection dropped"));
        const proposed = actionRecord();
        const prisma = { agent_action: {
            findFirst: jest.fn().mockResolvedValue(proposed),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockImplementation(async ({ data }) => actionRecord({ ...data })),
        } };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never);

        const result = await service.approve(proposed.id, principal, proposed.proposalRevision);

        expect(result.action.status).toBe("uncertain");
        expect(prisma.agent_action.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "uncertain" }) }));
    });

    it("marks only a proven pre-mutation exception as failed", async () => {
        const definition = capability();
        definition.execute.mockRejectedValueOnce(new AgentActionCertainFailureError("duplicate"));
        const proposed = actionRecord();
        const prisma = { agent_action: {
            findFirst: jest.fn().mockResolvedValue(proposed),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockImplementation(async ({ data }) => actionRecord({ ...data })),
        } };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never);

        await expect(service.approve(proposed.id, principal, proposed.proposalRevision)).rejects.toBeInstanceOf(ConflictException);

        expect(prisma.agent_action.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
    });

    it("does not rewrite a succeeded action when result-part delivery fails", async () => {
        const definition = capability();
        const proposed = actionRecord();
        const prisma = { agent_action: {
            findFirst: jest.fn().mockResolvedValue(proposed),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockImplementation(async ({ data }) => actionRecord({ ...data })),
        } };
        const sessions = { appendMessages: jest.fn().mockRejectedValue(new Error("session unavailable")) };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessions as never);

        const result = await service.approve(proposed.id, principal, proposed.proposalRevision);

        expect(result.action.status).toBe("succeeded");
        expect(prisma.agent_action.update).toHaveBeenCalledTimes(1);
        expect(prisma.agent_action.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "succeeded" }) }));
    });

    it("persists a schema-valid provider cancellation as cancelled", async () => {
        const definition = { ...capability(), classifyOutcome: jest.fn().mockReturnValue({ status: "cancelled", reason: "provider cancelled" }) };
        const proposed = actionRecord();
        const prisma = { agent_action: {
            findFirst: jest.fn().mockResolvedValue(proposed),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockImplementation(async ({ data }) => actionRecord({ ...data })),
        } };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never);

        const result = await service.approve(proposed.id, principal, proposed.proposalRevision);

        expect(result.action.status).toBe("cancelled");
        expect(prisma.agent_action.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
    });

    it("persists a schema-valid provider failure instead of reporting success", async () => {
        const definition = { ...capability(), classifyOutcome: jest.fn().mockReturnValue({ status: "failed", reason: "provider rejected" }) };
        const proposed = actionRecord();
        const prisma = { agent_action: {
            findFirst: jest.fn().mockResolvedValue(proposed),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockImplementation(async ({ data }) => actionRecord({ ...data })),
        } };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never);

        await expect(service.approve(proposed.id, principal, proposed.proposalRevision)).rejects.toBeInstanceOf(ConflictException);

        expect(prisma.agent_action.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: "failed", error: expect.objectContaining({ code: "provider_reported_failure" }) }),
        }));
    });

    it("repairs missing terminal result parts idempotently", async () => {
        const succeeded = actionRecord({ status: "succeeded", result: { status: "updated" }, resultPartPersistedAt: null });
        const sessions = { appendMessages: jest.fn().mockResolvedValue(undefined) };
        const prisma = { agent_action: {
            findMany: jest.fn().mockResolvedValue([succeeded]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        } };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn() } as never, { isCapabilityEnabled: jest.fn() } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessions as never);

        await expect(service.repairTerminalResultParts()).resolves.toBe(1);

        expect(sessions.appendMessages).toHaveBeenCalledWith(
            succeeded.sessionId,
            { userId: succeeded.userId, branchId: succeeded.branchId },
            [expect.objectContaining({ id: `agent-action-result:${succeeded.id}` })],
        );
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: succeeded.id, resultPartPersistedAt: null }),
            data: { resultPartPersistedAt: expect.any(Date) },
        }));
    });

    it("fails closed for read capabilities and rejects stale approvals", async () => {
        const read = capability("read");
        const prisma = { agent_action: { findUnique: jest.fn(), create: jest.fn(), findFirst: jest.fn() } };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(read) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never);
        await expect(service.propose({ sessionId: "session-a", principal, capability: "clients.get", input: { id: 3 }, locale: "ko" })).rejects.toBeInstanceOf(BadRequestException);
        await expect(service.approve("missing", principal, "stale")).rejects.toBeInstanceOf(Error);
    });

    it("rejects an approval when the registered capability version changed", async () => {
        const definition = capability();
        definition.meta.version = "2.0.0";
        const action = actionRecord();
        const service = new ActionCoordinatorService(
            { agent_action: { findFirst: jest.fn().mockResolvedValue(action) } } as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
        );
        await expect(service.approve(action.id, principal, action.proposalRevision)).rejects.toBeInstanceOf(ConflictException);
        expect(definition.execute).not.toHaveBeenCalled();
    });

    it("rechecks effective flags and role authorization at approval time", async () => {
        const definition = capability();
        const action = actionRecord();
        const service = new ActionCoordinatorService(
            { agent_action: { findFirst: jest.fn().mockResolvedValue(action) } } as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(false) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
        );
        await expect(service.approve(action.id, principal, action.proposalRevision)).rejects.toBeInstanceOf(ForbiddenException);
        expect(definition.execute).not.toHaveBeenCalled();
    });

    it("rejects a proposal whose canonical target changed before approval", async () => {
        const definition = {
            ...capability(),
            revalidate: jest.fn().mockResolvedValue({ valid: false, currentVersion: "new-version", reason: "Target changed" }),
        };
        const action = actionRecord({ targetVersion: "old-version", targetSnapshot: { id: 3 } });
        const service = new ActionCoordinatorService(
            { agent_action: { findFirst: jest.fn().mockResolvedValue(action), updateMany: jest.fn() } } as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
        );
        await expect(service.approve(action.id, principal, action.proposalRevision)).rejects.toBeInstanceOf(ConflictException);
        expect(definition.execute).not.toHaveBeenCalled();
    });

    it("requires an acknowledgement bound to strong action identity and revision", async () => {
        const definition = capability();
        definition.meta.approvalPolicy = "strong";
        const action = actionRecord();
        const service = new ActionCoordinatorService(
            { agent_action: { findFirst: jest.fn().mockResolvedValue(action), updateMany: jest.fn() } } as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
        );

        await expect(service.approve(action.id, principal, action.proposalRevision)).rejects.toBeInstanceOf(ConflictException);
        expect(service.strongAcknowledgementToken(action as never)).toHaveLength(64);
        expect(definition.execute).not.toHaveBeenCalled();
    });

    it("persists a terminal result part when the owner rejects a proposal", async () => {
        const proposed = actionRecord();
        const rejected = actionRecord({ status: "rejected", rejectedBy: principal.userId, rejectedAt: new Date() });
        const sessions = { appendMessages: jest.fn().mockResolvedValue(undefined) };
        const service = new ActionCoordinatorService(
            { agent_action: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findFirst: jest.fn().mockResolvedValue(rejected),
            } } as never,
            { get: jest.fn() } as never,
            { isCapabilityEnabled: jest.fn() } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessions as never,
        );

        const result = await service.reject(proposed.id, principal, "operator declined");

        expect(result.status).toBe("rejected");
        expect(sessions.appendMessages).toHaveBeenCalledWith(
            proposed.sessionId,
            { userId: principal.userId, branchId: principal.branchId },
            [expect.objectContaining({
                role: "assistant",
                parts: [expect.objectContaining({
                    type: "data-action-result",
                    data: expect.objectContaining({ actionId: proposed.id, status: "rejected" }),
                })],
            })],
        );
    });

    it("expires a bounded batch and persists terminal result parts", async () => {
        const proposed = actionRecord({ expiresAt: new Date(Date.now() - 1_000) });
        const expired = actionRecord({ status: "expired", expiresAt: proposed.expiresAt });
        const sessions = { appendMessages: jest.fn().mockResolvedValue(undefined) };
        const prisma = { agent_action: {
            findMany: jest.fn().mockResolvedValueOnce([proposed]).mockResolvedValueOnce([]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findFirst: jest.fn().mockResolvedValue(expired),
        } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn() } as never,
            { isCapabilityEnabled: jest.fn() } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessions as never,
        );

        await expect(service.expirePending()).resolves.toBe(1);

        expect(prisma.agent_action.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
        expect(sessions.appendMessages).toHaveBeenCalledWith(
            proposed.sessionId,
            { userId: principal.userId, branchId: principal.branchId },
            [expect.objectContaining({
                parts: [expect.objectContaining({
                    type: "data-action-result",
                    data: expect.objectContaining({ actionId: proposed.id, status: "expired" }),
                })],
            })],
        );
    });

    it("moves interrupted executions to uncertain instead of expiring or replaying them", async () => {
        const executing = actionRecord({ status: "executing", expiresAt: new Date(Date.now() - 1_000) });
        const uncertain = actionRecord({ status: "uncertain", expiresAt: executing.expiresAt, error: { code: "execution_interrupted" } });
        const sessions = { appendMessages: jest.fn().mockResolvedValue(undefined) };
        const prisma = { agent_action: {
            findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([executing]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findFirst: jest.fn().mockResolvedValue(uncertain),
        } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn() } as never,
            { isCapabilityEnabled: jest.fn() } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessions as never,
        );

        await expect(service.expirePending()).resolves.toBe(1);

        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: executing.id, status: "executing" }),
            data: expect.objectContaining({ status: "uncertain" }),
        }));
        expect(sessions.appendMessages).toHaveBeenCalledWith(
            executing.sessionId,
            { userId: principal.userId, branchId: principal.branchId },
            [expect.objectContaining({ parts: [expect.objectContaining({ data: expect.objectContaining({ status: "uncertain" }) })] })],
        );
    });
});
