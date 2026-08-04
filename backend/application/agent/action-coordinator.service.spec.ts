import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { AgentFlagsService } from "./agent-flags.service";
import { AgentActionSweepLockService } from "infrastructure/locking/agent-action-sweep-lock.service";
import { CapabilityRegistryService } from "./capability-registry.service";
import { AgentSessionService } from "./agent-session.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ActionCoordinatorService, AgentActionCertainFailureError } from "./action-coordinator.service";
import { AGENT_ACTION_REPOSITORY } from "domain/repositories/agent-action.repository.interface";

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

function sessionPersistence() {
    return {
        assertActive: jest.fn().mockResolvedValue(undefined),
        upsertActionResultMessage: jest.fn().mockResolvedValue(true),
    };
}

function actionPersistence(prisma?: unknown) {
    const source = prisma as { agent_action?: { create?: jest.Mock } } | undefined;
    return {
        createInActiveSession: jest.fn().mockImplementation(async (input: Record<string, unknown>) => {
            const record = source?.agent_action?.create
                ? await source.agent_action.create({ data: input })
                : input;
            return { status: "created", action: record };
        }),
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

    function mutableActionPrisma(initial = actionRecord()) {
        let current = initial;
        return { agent_action: {
            findFirst: jest.fn().mockImplementation(async () => current),
            updateMany: jest.fn().mockImplementation(async ({ data }) => {
                current = actionRecord({
                    ...current,
                    ...data,
                    executionAttemptCount: data.executionAttemptCount ? current.executionAttemptCount + 1 : current.executionAttemptCount,
                });
                return { count: 1 };
            }),
        } };
    }

    it("requires result persistence during Nest dependency construction", async () => {
        const expectedMissingDependency = AgentSessionService.name;
        await expect(Test.createTestingModule({
            providers: [
                ActionCoordinatorService,
                { provide: PrismaService, useValue: {} },
                { provide: CapabilityRegistryService, useValue: {} },
                { provide: AgentFlagsService, useValue: {} },
                { provide: AgentActionSweepLockService, useValue: {} },
                { provide: AGENT_ACTION_REPOSITORY, useValue: {} },
            ],
        }).compile()).rejects.toThrow(new RegExp(expectedMissingDependency));
    });

    it("creates a random action identity with a bounded request dedupe key", async () => {
        const definition = capability();
        const sessions = sessionPersistence();
        const prisma = { agent_action: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(async ({ data }) => ({ ...data, createdAt: new Date(), updatedAt: new Date(), approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, result: null, error: null, executedAt: null, resultPartPersistedAt: null, targetSnapshot: null })) } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessions as never,
            actionPersistence(prisma) as never,
        );
        const action = await service.propose({ sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko" });
        expect(sessions.assertActive).toHaveBeenCalledWith("session-a", { userId: principal.userId, branchId: principal.branchId });
        expect(action.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(action.idempotencyKey).toBe(`agent-action:${action.id}`);
        expect(action.proposalRevision).toHaveLength(64);
        expect(action.requestDedupeKey).toHaveLength(64);
        expect(prisma.agent_action.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: action.id, proposalRevision: action.proposalRevision, requestDedupeKey: action.requestDedupeKey }) }));
        expect(prisma.agent_action.findUnique).toHaveBeenCalledWith({ where: { requestDedupeKey: action.requestDedupeKey } });
    });

    it("does not create an action for an archived or expired session", async () => {
        const definition = capability();
        const sessions = sessionPersistence();
        sessions.assertActive.mockRejectedValueOnce(new NotFoundException("Agent session not found"));
        const prisma = {
            agent_action: {
                findUnique: jest.fn(),
                create: jest.fn(),
            },
        };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessions as never,
            actionPersistence(prisma) as never,
        );

        await expect(service.propose({ sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko" }))
            .rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.agent_action.create).not.toHaveBeenCalled();
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
            const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessionPersistence() as never, actionPersistence(prisma) as never);
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
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessionPersistence() as never, actionPersistence(prisma) as never);

        const first = await service.propose({ sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko" });
        const second = await service.propose({ sessionId: "session-b", principal, capability: "clients.update", input: { id: 3 }, locale: "ko" });

        expect(second.id).not.toBe(first.id);
        expect(prisma.agent_action.create).toHaveBeenCalledTimes(2);
    });

    it.each(["approved", "executing", "uncertain", "succeeded"] as const)("retains an expired dedupe reservation while the action is %s", async (status) => {
        const definition = capability();
        const existing = actionRecord({
            status,
            dedupeExpiresAt: new Date(Date.now() - 60_000),
        });
        const prisma = { agent_action: {
            findUnique: jest.fn().mockResolvedValue(existing),
            updateMany: jest.fn(),
            create: jest.fn(),
        } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessionPersistence() as never,
        actionPersistence() as never,
        );

        const duplicate = await service.propose({
            sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko",
        });

        expect(duplicate.id).toBe(existing.id);
        expect(prisma.agent_action.updateMany).not.toHaveBeenCalled();
        expect(prisma.agent_action.create).not.toHaveBeenCalled();
    });

    it.each(["proposed", "rejected", "expired", "cancelled"] as const)(
        "releases an expired dedupe reservation when the prior action is %s",
        async (status) => {
            const definition = capability();
            const existing = actionRecord({ status, dedupeExpiresAt: new Date(Date.now() - 60_000) });
            const prisma = { agent_action: {
                findUnique: jest.fn().mockResolvedValue(existing),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                create: jest.fn().mockImplementation(async ({ data }) => actionRecord({
                    ...data, createdAt: new Date(), updatedAt: new Date(), resultPartPersistedAt: null,
                })),
            } };
            const service = new ActionCoordinatorService(
                prisma as never,
                { get: jest.fn().mockReturnValue(definition) } as never,
                { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
                { isAvailable: jest.fn().mockReturnValue(false) } as never,
                sessionPersistence() as never,
                actionPersistence(prisma) as never,
            );

            const replacement = await service.propose({
                sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko",
            });

            expect(replacement.id).not.toBe(existing.id);
            expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ id: existing.id, status }),
            }));
            expect(prisma.agent_action.create).toHaveBeenCalledTimes(1);
        },
    );

    it("retains an effect-ambiguous failed action after its dedupe window expires", async () => {
        const definition = capability();
        const existing = actionRecord({
            status: "failed",
            error: { code: "provider_reported_failure", message: "provider rejected after invocation" },
            dedupeExpiresAt: new Date(Date.now() - 60_000),
        });
        const prisma = { agent_action: {
            findUnique: jest.fn().mockResolvedValue(existing),
            updateMany: jest.fn(),
            create: jest.fn(),
        } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessionPersistence() as never,
            actionPersistence() as never,
        );

        const duplicate = await service.propose({
            sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko",
        });

        expect(duplicate.id).toBe(existing.id);
        expect(prisma.agent_action.updateMany).not.toHaveBeenCalled();
        expect(prisma.agent_action.create).not.toHaveBeenCalled();
    });

    it.each([
        ["rejected", null],
        ["failed", { code: "execution_failed", message: "no provider call began" }],
    ] as const)("immediately releases a %s action for reconsideration", async (status, error) => {
        const definition = capability();
        const existing = actionRecord({ status, error, dedupeExpiresAt: new Date(Date.now() + 60_000) });
        const prisma = { agent_action: {
            findUnique: jest.fn().mockResolvedValue(existing),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            create: jest.fn().mockImplementation(async ({ data }) => actionRecord({
                ...data, createdAt: new Date(), updatedAt: new Date(), resultPartPersistedAt: null,
            })),
        } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessionPersistence() as never,
            actionPersistence(prisma) as never,
        );

        const replacement = await service.propose({
            sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko",
        });

        expect(replacement.id).not.toBe(existing.id);
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: existing.id, status, requestDedupeKey: expect.any(String) }),
        }));
        expect(prisma.agent_action.create).toHaveBeenCalledTimes(1);
    });

    it("re-inspects an active proposed action and rotates its key when the complete revision changes", async () => {
        let targetVersion = "target-v1";
        const definition = {
            ...capability(),
            inspect: jest.fn().mockImplementation(async () => ({
                targetVersion,
                targetSnapshot: { id: 3, version: targetVersion },
                title: "Update client",
                summary: `Apply ${targetVersion}`,
            })),
        };
        const records = new Map<string, ReturnType<typeof actionRecord>>();
        const prisma = { agent_action: {
            findUnique: jest.fn().mockImplementation(async ({ where }) => records.get(where.requestDedupeKey) ?? null),
            updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
                const current = records.get(where.requestDedupeKey);
                if (!current || current.status !== where.status) return { count: 0 };
                records.delete(where.requestDedupeKey);
                records.set(data.requestDedupeKey, actionRecord({ ...current, requestDedupeKey: data.requestDedupeKey }));
                return { count: 1 };
            }),
            create: jest.fn().mockImplementation(async ({ data }) => {
                const created = actionRecord({ ...data, createdAt: new Date(), updatedAt: new Date(), resultPartPersistedAt: null });
                records.set(data.requestDedupeKey, created);
                return created;
            }),
        } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessionPersistence() as never,
            actionPersistence(prisma) as never,
        );
        const input = { sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko" };

        const first = await service.propose(input);
        targetVersion = "target-v2";
        const replacement = await service.propose(input);

        expect(replacement.id).not.toBe(first.id);
        expect(replacement.targetVersion).toBe("target-v2");
        expect(definition.inspect).toHaveBeenCalledTimes(2);
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: first.id,
                status: "proposed",
                requestDedupeKey: first.requestDedupeKey,
            }),
        }));
        expect(prisma.agent_action.create).toHaveBeenCalledTimes(2);
    });

    it("reuses an active proposed action only when its complete revision is identical", async () => {
        const definition = {
            ...capability(),
            inspect: jest.fn().mockResolvedValue({
                targetVersion: "target-v1",
                targetSnapshot: { id: 3, version: "target-v1" },
                title: "Update client",
                summary: "Apply target-v1",
            }),
        };
        const records = new Map<string, ReturnType<typeof actionRecord>>();
        const prisma = { agent_action: {
            findUnique: jest.fn().mockImplementation(async ({ where }) => records.get(where.requestDedupeKey) ?? null),
            updateMany: jest.fn(),
            create: jest.fn().mockImplementation(async ({ data }) => {
                const created = actionRecord({ ...data, createdAt: new Date(), updatedAt: new Date(), resultPartPersistedAt: null });
                records.set(data.requestDedupeKey, created);
                return created;
            }),
        } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessionPersistence() as never,
            actionPersistence(prisma) as never,
        );
        const input = { sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko" };

        const first = await service.propose(input);
        const duplicate = await service.propose(input);

        expect(duplicate.id).toBe(first.id);
        expect(definition.inspect).toHaveBeenCalledTimes(2);
        expect(prisma.agent_action.updateMany).not.toHaveBeenCalled();
        expect(prisma.agent_action.create).toHaveBeenCalledTimes(1);
    });

    it("returns the winner when action creation loses a request-dedupe P2002 race", async () => {
        const definition = capability();
        let raced: ReturnType<typeof actionRecord> | null = null;
        let racedId: string | undefined;
        const prisma = { agent_action: {
            findUnique: jest.fn().mockImplementation(async ({ where }) => (
                raced && raced.requestDedupeKey === where.requestDedupeKey ? raced : null
            )),
            create: jest.fn().mockImplementation(async ({ data }) => {
                const created = actionRecord({ ...data, createdAt: new Date(), updatedAt: new Date(), resultPartPersistedAt: null });
                raced = created;
                racedId = created.id;
                throw new Prisma.PrismaClientKnownRequestError("unique constraint", {
                    code: "P2002",
                    clientVersion: "6.19.1",
                });
            }),
        } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessionPersistence() as never,
            actionPersistence(prisma) as never,
        );

        const result = await service.propose({
            sessionId: "session-a", principal, capability: "clients.update", input: { id: 3 }, locale: "ko",
        });

        expect(result.id).toBe(racedId);
        expect(prisma.agent_action.create).toHaveBeenCalledTimes(1);
        expect(prisma.agent_action.findUnique).toHaveBeenCalledTimes(2);
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
            sessionPersistence() as never,
        actionPersistence() as never,
        );

        await expect(service.approve(action.id, principal, action.capabilityVersion)).rejects.toBeInstanceOf(ConflictException);
    });

    it("accepts reconciliation outcomes only from the capability provider", async () => {
        const recover = jest.fn().mockResolvedValue(undefined);
        const definition = {
            ...capability(),
            recover,
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
            sessionPersistence() as never,
        actionPersistence() as never,
        );

        const result = await service.reconcile(uncertain.id, principal);

        expect(definition.reconcile).toHaveBeenCalledWith(expect.objectContaining({ actionId: uncertain.id }), { id: 3 }, { providerRequestId: "provider-1" });
        expect(recover).toHaveBeenCalledWith(expect.objectContaining({ actionId: uncertain.id }), { id: 3 }, { providerRequestId: "provider-1" });
        expect(recover.mock.invocationCallOrder[0]).toBeLessThan(definition.reconcile.mock.invocationCallOrder[0]!);
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: uncertain.id, status: "uncertain" }),
            data: expect.objectContaining({ status: "succeeded", result: { status: "updated" } }),
        }));
        expect(result.status).toBe("succeeded");
    });

    it("replaces a prior uncertain result part in place and resets the persistence CAS", async () => {
        const definition = {
            ...capability(),
            reconcile: jest.fn().mockResolvedValue({ status: "succeeded", result: { status: "updated" } }),
        };
        const uncertain = actionRecord({
            status: "uncertain",
            result: undefined,
            resultPartPersistedAt: new Date("2026-08-04T00:00:00.000Z"),
            error: { code: "provider_uncertain" },
        });
        const succeeded = actionRecord({
            status: "succeeded",
            result: { status: "updated" },
            resultPartPersistedAt: null,
            createdAt: uncertain.createdAt,
        });
        const sessions = { upsertActionResultMessage: jest.fn().mockResolvedValue(true) };
        const prisma = {
            agent_action: {
                findFirst: jest.fn().mockResolvedValueOnce(uncertain).mockResolvedValueOnce(succeeded),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessions as never,
        actionPersistence() as never,
        );

        await expect(service.reconcile(uncertain.id, principal)).resolves.toEqual(expect.objectContaining({ status: "succeeded" }));

        expect(prisma.agent_action.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: expect.objectContaining({ id: uncertain.id, userId: principal.userId, branchId: principal.branchId, status: "uncertain" }),
            data: expect.objectContaining({ status: "succeeded", resultPartPersistedAt: null }),
        }));
        expect(sessions.upsertActionResultMessage).toHaveBeenCalledWith(
            uncertain.sessionId,
            { userId: uncertain.userId, branchId: uncertain.branchId },
            expect.objectContaining({
                id: `agent-action-result:${uncertain.id}`,
                parts: [expect.objectContaining({ data: expect.objectContaining({ status: "succeeded", result: { status: "updated" } }) })],
            }),
        );
        expect(prisma.agent_action.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({ id: uncertain.id, resultPartPersistedAt: null }),
            data: { resultPartPersistedAt: expect.any(Date) },
        }));
    });

    it("leaves reconciliation repairable when the authoritative result upsert fails", async () => {
        const definition = {
            ...capability(),
            reconcile: jest.fn().mockResolvedValue({ status: "failed", result: { status: "provider-rejected" } }),
        };
        const uncertain = actionRecord({ status: "uncertain", resultPartPersistedAt: new Date() });
        const failed = actionRecord({ status: "failed", result: { status: "provider-rejected" }, resultPartPersistedAt: null });
        const sessions = { upsertActionResultMessage: jest.fn().mockRejectedValue(new Error("database unavailable")) };
        const prisma = {
            agent_action: {
                findFirst: jest.fn().mockResolvedValueOnce(uncertain).mockResolvedValueOnce(failed),
                findMany: jest.fn(),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessions as never,
        actionPersistence() as never,
        );

        await expect(service.reconcile(uncertain.id, principal)).rejects.toThrow("database unavailable");
        expect(prisma.agent_action.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ resultPartPersistedAt: null }),
        }));

        sessions.upsertActionResultMessage.mockResolvedValue(true);
        prisma.agent_action.findMany = jest.fn().mockResolvedValue([failed]);
        await expect(service.repairTerminalResultParts()).resolves.toBe(1);
        expect(prisma.agent_action.updateMany).toHaveBeenCalledTimes(2);
        expect(prisma.agent_action.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: failed.id, resultPartPersistedAt: null }),
            data: { resultPartPersistedAt: expect.any(Date) },
        }));
    });

    it("retries the same deterministic result upsert when a concurrent reconciliation loses the CAS", async () => {
        const definition = {
            ...capability(),
            reconcile: jest.fn().mockResolvedValue({ status: "succeeded", result: { status: "updated" } }),
        };
        const uncertain = actionRecord({ status: "uncertain" });
        const succeeded = actionRecord({ status: "succeeded", result: { status: "updated" }, resultPartPersistedAt: null });
        const sessions = { upsertActionResultMessage: jest.fn().mockResolvedValue(true) };
        let compareAndSwapCount = 0;
        const prisma = {
            agent_action: {
                findFirst: jest.fn().mockResolvedValueOnce(uncertain).mockResolvedValueOnce(succeeded).mockResolvedValueOnce(uncertain).mockResolvedValueOnce(succeeded),
                updateMany: jest.fn().mockImplementation(async () => ({ count: compareAndSwapCount++ === 0 ? 1 : 0 })),
            },
        };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessions as never,
        actionPersistence() as never,
        );

        await expect(service.reconcile(uncertain.id, principal)).resolves.toEqual(expect.objectContaining({ status: "succeeded" }));
        await expect(service.reconcile(uncertain.id, principal)).resolves.toEqual(expect.objectContaining({ status: "succeeded" }));

        expect(sessions.upsertActionResultMessage).toHaveBeenCalledTimes(2);
        expect(sessions.upsertActionResultMessage.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ id: `agent-action-result:${uncertain.id}` }));
        expect(sessions.upsertActionResultMessage.mock.calls[1]?.[2]).toEqual(expect.objectContaining({ id: `agent-action-result:${uncertain.id}` }));
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
        const sessions = { upsertActionResultMessage: jest.fn().mockResolvedValue(true) };
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
        actionPersistence() as never,
        );

        await expect(service.reconcile(uncertain.id, principal)).resolves.toEqual(expect.objectContaining({ status: "failed" }));

        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: "failed",
                result: { status: "provider-rejected" },
                error: expect.objectContaining({ message: "Provider rejected the request" }),
            }),
        }));
        expect(sessions.upsertActionResultMessage).toHaveBeenCalledWith(
            uncertain.sessionId,
            { userId: principal.userId, branchId: principal.branchId },
            expect.objectContaining({ parts: [expect.objectContaining({
                data: expect.objectContaining({ status: "failed", result: { status: "provider-rejected" } }),
            })] }),
        );
    });

    it("returns a persisted terminal action without executing it again", async () => {
        const definition = capability();
        const succeeded = actionRecord({ status: "succeeded", result: { status: "updated" }, executedAt: new Date() });
        const service = new ActionCoordinatorService(
            { agent_action: { findFirst: jest.fn().mockResolvedValue(succeeded), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } } as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessionPersistence() as never,
        actionPersistence() as never,
        );

        const result = await service.approve(succeeded.id, principal, succeeded.proposalRevision);

        expect(result.action.status).toBe("succeeded");
        expect(definition.execute).not.toHaveBeenCalled();
    });

    it("does not reconcile an action owned by another user or branch", async () => {
        const definition = {
            ...capability(),
            reconcile: jest.fn(),
        };
        const prisma = { agent_action: { findFirst: jest.fn().mockResolvedValue(null) } };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn() } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessionPersistence() as never,
        actionPersistence() as never,
        );

        await expect(service.reconcile("action-a", { userId: "other-user", branchId: "other-branch", globalRole: "admin", branchRole: "admin" })).rejects.toBeInstanceOf(NotFoundException);
        expect(definition.reconcile).not.toHaveBeenCalled();
    });

    it("marks a schema-invalid post-execution result uncertain", async () => {
        const definition = capability();
        definition.execute.mockResolvedValueOnce({ unexpected: true });
        const proposed = actionRecord();
        const prisma = mutableActionPrisma(proposed);
        const sessions = { upsertActionResultMessage: jest.fn().mockResolvedValue(true) };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessions as never, actionPersistence() as never);

        const result = await service.approve(proposed.id, principal, proposed.proposalRevision);

        expect(result.action.status).toBe("uncertain");
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: "executing" }),
            data: expect.objectContaining({ status: "uncertain", error: expect.objectContaining({ code: "result_validation_failed" }) }),
        }));
    });

    it("treats an unclassified execution exception as uncertain after invocation begins", async () => {
        const definition = capability();
        definition.execute.mockRejectedValueOnce(new Error("connection dropped"));
        const proposed = actionRecord();
        const prisma = mutableActionPrisma(proposed);
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessionPersistence() as never, actionPersistence(prisma) as never);

        const result = await service.approve(proposed.id, principal, proposed.proposalRevision);

        expect(result.action.status).toBe("uncertain");
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "executing" }), data: expect.objectContaining({ status: "uncertain" }) }));
    });

    it("marks only a proven pre-mutation exception as failed", async () => {
        const definition = capability();
        definition.execute.mockRejectedValueOnce(new AgentActionCertainFailureError("duplicate"));
        const proposed = actionRecord();
        const prisma = mutableActionPrisma(proposed);
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessionPersistence() as never, actionPersistence() as never);

        await expect(service.approve(proposed.id, principal, proposed.proposalRevision)).rejects.toBeInstanceOf(ConflictException);

        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "executing" }), data: expect.objectContaining({ status: "failed" }) }));
    });

    it("fails the approval when result-part delivery fails after execution", async () => {
        const definition = capability();
        const proposed = actionRecord();
        const prisma = mutableActionPrisma(proposed);
        const sessions = { upsertActionResultMessage: jest.fn().mockRejectedValue(new Error("session unavailable")) };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessions as never, actionPersistence() as never);

        await expect(service.approve(proposed.id, principal, proposed.proposalRevision)).rejects.toThrow("session unavailable");
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "executing" }), data: expect.objectContaining({ status: "succeeded" }) }));
    });

    it("does not overwrite an uncertain sweep result when provider completion loses the executing CAS", async () => {
        const definition = capability();
        let current = actionRecord();
        const prisma = { agent_action: {
            findFirst: jest.fn().mockImplementation(async () => current),
            updateMany: jest.fn().mockImplementation(async ({ data }) => {
                if (data.status === "succeeded") {
                    current = actionRecord({ ...current, status: "uncertain", error: { code: "execution_interrupted" } });
                    return { count: 0 };
                }
                current = actionRecord({ ...current, ...data });
                return { count: 1 };
            }),
        } };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessionPersistence() as never, actionPersistence() as never);

        const result = await service.approve(current.id, principal, current.proposalRevision);

        expect(result.action.status).toBe("uncertain");
        expect(result.action.error).toEqual({ code: "execution_interrupted" });
    });

    it("persists a schema-valid provider cancellation as cancelled", async () => {
        const definition = { ...capability(), classifyOutcome: jest.fn().mockReturnValue({ status: "cancelled", reason: "provider cancelled" }) };
        const proposed = actionRecord();
        const prisma = mutableActionPrisma(proposed);
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessionPersistence() as never, actionPersistence() as never);

        const result = await service.approve(proposed.id, principal, proposed.proposalRevision);

        expect(result.action.status).toBe("cancelled");
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "executing" }), data: expect.objectContaining({ status: "cancelled" }) }));
    });

    it("persists a schema-valid provider failure instead of reporting success", async () => {
        const definition = { ...capability(), classifyOutcome: jest.fn().mockReturnValue({ status: "failed", reason: "provider rejected" }) };
        const proposed = actionRecord();
        const prisma = mutableActionPrisma(proposed);
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(definition) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessionPersistence() as never, actionPersistence() as never);

        await expect(service.approve(proposed.id, principal, proposed.proposalRevision)).rejects.toBeInstanceOf(ConflictException);

        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: "executing" }),
            data: expect.objectContaining({ status: "failed", error: expect.objectContaining({ code: "provider_reported_failure" }) }),
        }));
    });

    it("persists a partial provider outcome as uncertain with complete delivery counts", async () => {
        const delivery = { status: "partial", subscriptions: 3, delivered: 2, failed: 1 };
        const definition = {
            ...capability(),
            outputSchema: z.object({
                status: z.string(),
                subscriptions: z.number().int().nonnegative(),
                delivered: z.number().int().nonnegative(),
                failed: z.number().int().nonnegative(),
            }),
            execute: jest.fn().mockResolvedValue(delivery),
            classifyOutcome: jest.fn().mockReturnValue({
                status: "uncertain",
                reason: "Web Push was delivered to only some subscriptions",
            }),
        };
        const proposed = actionRecord({ dedupeExpiresAt: new Date(Date.now() - 60_000) });
        const prisma = mutableActionPrisma(proposed);
        const sessions = sessionPersistence();
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessions as never,
            actionPersistence() as never,
        );

        const result = await service.approve(proposed.id, principal, proposed.proposalRevision);

        expect(result.action.status).toBe("uncertain");
        expect(result.action.result).toEqual(delivery);
        expect(result.result).toEqual(delivery);
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: "executing" }),
            data: expect.objectContaining({
                status: "uncertain",
                result: delivery,
                error: expect.objectContaining({ code: "provider_uncertain" }),
            }),
        }));
    });

    it("repairs missing terminal result parts idempotently", async () => {
        const succeeded = actionRecord({ status: "succeeded", result: { status: "updated" }, resultPartPersistedAt: null });
        const sessions = { upsertActionResultMessage: jest.fn().mockResolvedValue(true) };
        const prisma = { agent_action: {
            findMany: jest.fn().mockResolvedValue([succeeded]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        } };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn() } as never, { isCapabilityEnabled: jest.fn() } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessions as never, actionPersistence() as never);

        await expect(service.repairTerminalResultParts()).resolves.toBe(1);

        expect(sessions.upsertActionResultMessage).toHaveBeenCalledWith(
            succeeded.sessionId,
            { userId: succeeded.userId, branchId: succeeded.branchId },
            expect.objectContaining({ id: `agent-action-result:${succeeded.id}` }),
        );
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: succeeded.id, resultPartPersistedAt: null }),
            data: { resultPartPersistedAt: expect.any(Date) },
        }));
    });

    it("fails closed for read capabilities and rejects stale approvals", async () => {
        const read = capability("read");
        const prisma = { agent_action: { findUnique: jest.fn(), create: jest.fn(), findFirst: jest.fn() } };
        const service = new ActionCoordinatorService(prisma as never, { get: jest.fn().mockReturnValue(read) } as never, { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never, { isAvailable: jest.fn().mockReturnValue(false) } as never, sessionPersistence() as never, actionPersistence() as never);
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
            sessionPersistence() as never,
            actionPersistence() as never,
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
            sessionPersistence() as never,
        actionPersistence() as never,
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
            sessionPersistence() as never,
        actionPersistence() as never,
        );
        await expect(service.approve(action.id, principal, action.proposalRevision)).rejects.toBeInstanceOf(ConflictException);
        expect(definition.execute).not.toHaveBeenCalled();
    });

    it("passes the durable approved target into capability execution", async () => {
        const definition = {
            ...capability(),
            revalidate: jest.fn().mockResolvedValue({ valid: true, currentVersion: "target-v1" }),
            executeApprovedTarget: jest.fn().mockResolvedValue({ status: "updated" }),
        };
        const targetSnapshot = { snapshotHash: "snapshot-v1", receiver: "••••5678" };
        const proposed = actionRecord({ targetVersion: "target-v1", targetSnapshot });
        const service = new ActionCoordinatorService(
            mutableActionPrisma(proposed) as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessionPersistence() as never,
        actionPersistence() as never,
        );

        await expect(service.approve(proposed.id, principal, proposed.proposalRevision)).resolves.toEqual(expect.objectContaining({ action: expect.objectContaining({ status: "succeeded" }) }));
        expect(definition.executeApprovedTarget).toHaveBeenCalledWith(
            expect.objectContaining({
                actionId: proposed.id,
                approvedTargetVersion: "target-v1",
                approvedTargetSnapshot: targetSnapshot,
            }),
            proposed.proposal.input,
            "target-v1",
        );
        expect(definition.execute).not.toHaveBeenCalled();
    });

    it("fails closed when a versioned action has no atomic execution hook", async () => {
        const definition = {
            ...capability(),
            revalidate: jest.fn().mockResolvedValue({ valid: true, currentVersion: "target-v1" }),
        };
        const action = actionRecord({ targetVersion: "target-v1", targetSnapshot: { id: 3 } });
        const prisma = {
            agent_action: {
                findFirst: jest.fn().mockResolvedValue(action),
                updateMany: jest.fn(),
            },
        };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessionPersistence() as never,
        actionPersistence() as never,
        );

        await expect(service.approve(action.id, principal, action.proposalRevision)).rejects.toBeInstanceOf(ConflictException);
        expect(definition.revalidate).not.toHaveBeenCalled();
        expect(definition.execute).not.toHaveBeenCalled();
        expect(prisma.agent_action.updateMany).not.toHaveBeenCalled();
    });

    it("does not fall back to ordinary execution after a target changes between preliminary revalidation and atomic execution", async () => {
        let currentTargetVersion = "target-v1";
        const definition = {
            ...capability(),
            revalidate: jest.fn().mockImplementation(async () => {
                const observedVersion = currentTargetVersion;
                // Simulate a competing canonical update after the coordinator's
                // preliminary read but before the provider's CAS boundary.
                currentTargetVersion = "target-v2";
                return { valid: true, currentVersion: observedVersion };
            }),
            executeApprovedTarget: jest.fn().mockImplementation(async (_context, _input, expectedVersion) => {
                if (currentTargetVersion !== expectedVersion) {
                    throw new AgentActionCertainFailureError("Target changed at atomic execution boundary");
                }
                return { status: "updated" };
            }),
        };
        const action = actionRecord({ targetVersion: "target-v1", targetSnapshot: { id: 3 } });
        const prisma = mutableActionPrisma(action);
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(definition) } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessionPersistence() as never,
        actionPersistence() as never,
        );

        await expect(service.approve(action.id, principal, action.proposalRevision)).rejects.toBeInstanceOf(ConflictException);
        expect(definition.revalidate).toHaveBeenCalledTimes(1);
        expect(definition.executeApprovedTarget).toHaveBeenCalledTimes(1);
        expect(definition.execute).not.toHaveBeenCalled();
        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: "executing" }),
            data: expect.objectContaining({ status: "failed" }),
        }));
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
            sessionPersistence() as never,
        actionPersistence() as never,
        );

        await expect(service.approve(action.id, principal, action.proposalRevision)).rejects.toBeInstanceOf(ConflictException);
        expect(service.strongAcknowledgementToken(action as never)).toHaveLength(64);
        expect(definition.execute).not.toHaveBeenCalled();
    });

    it("persists a terminal result part when the owner rejects a proposal", async () => {
        const proposed = actionRecord();
        const rejected = actionRecord({ status: "rejected", rejectedBy: principal.userId, rejectedAt: new Date() });
        const sessions = { upsertActionResultMessage: jest.fn().mockResolvedValue(true) };
        const service = new ActionCoordinatorService(
            { agent_action: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findFirst: jest.fn().mockResolvedValue(rejected),
            } } as never,
            { get: jest.fn() } as never,
            { isCapabilityEnabled: jest.fn() } as never,
            { isAvailable: jest.fn().mockReturnValue(false) } as never,
            sessions as never,
        actionPersistence() as never,
        );

        const result = await service.reject(proposed.id, principal, "operator declined");

        expect(result.status).toBe("rejected");
        expect(sessions.upsertActionResultMessage).toHaveBeenCalledWith(
            proposed.sessionId,
            { userId: principal.userId, branchId: principal.branchId },
            expect.objectContaining({
                role: "assistant",
                parts: [expect.objectContaining({
                    type: "data-action-result",
                    data: expect.objectContaining({ actionId: proposed.id, status: "rejected" }),
                })],
            }),
        );
    });

    it("expires a bounded batch and persists terminal result parts", async () => {
        const proposed = actionRecord({ expiresAt: new Date(Date.now() - 1_000) });
        const expired = actionRecord({ status: "expired", expiresAt: proposed.expiresAt });
        const sessions = { upsertActionResultMessage: jest.fn().mockResolvedValue(true) };
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
        actionPersistence() as never,
        );

        await expect(service.expirePending()).resolves.toBe(1);

        expect(prisma.agent_action.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
        expect(sessions.upsertActionResultMessage).toHaveBeenCalledWith(
            proposed.sessionId,
            { userId: principal.userId, branchId: principal.branchId },
            expect.objectContaining({
                parts: [expect.objectContaining({
                    type: "data-action-result",
                    data: expect.objectContaining({ actionId: proposed.id, status: "expired" }),
                })],
            }),
        );
    });

    it("moves only stale interrupted executions to uncertain instead of using proposal expiry", async () => {
        const updatedAt = new Date(Date.now() - 31 * 60 * 1000);
        const executing = actionRecord({ status: "executing", expiresAt: new Date(Date.now() - 1_000), updatedAt });
        const uncertain = actionRecord({ status: "uncertain", expiresAt: executing.expiresAt, error: { code: "execution_interrupted" } });
        const sessions = { upsertActionResultMessage: jest.fn().mockResolvedValue(true) };
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
        actionPersistence() as never,
        );

        await expect(service.expirePending()).resolves.toBe(1);

        expect(prisma.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: executing.id, status: "executing", updatedAt: expect.any(Object) }),
            data: expect.objectContaining({ status: "uncertain" }),
        }));
        expect(sessions.upsertActionResultMessage).toHaveBeenCalledWith(
            executing.sessionId,
            { userId: principal.userId, branchId: principal.branchId },
            expect.objectContaining({ parts: [expect.objectContaining({ data: expect.objectContaining({ status: "uncertain" }) })] }),
        );
    });

    it("continues the reconciliation sweep when an older action references a missing capability", async () => {
        const missing = actionRecord({ id: "missing-capability", capability: "legacy.removed", status: "uncertain" });
        const uncertain = actionRecord({ id: "known-capability", capability: "clients.update", status: "uncertain" });
        const succeeded = actionRecord({ id: uncertain.id, capability: uncertain.capability, status: "succeeded", result: { status: "updated" } });
        const definition = {
            ...capability(),
            reconcile: jest.fn().mockResolvedValue({ status: "succeeded", result: { status: "updated" } }),
        };
        const registry = {
            get: jest.fn().mockImplementation((name: string) => {
                if (name === missing.capability) throw new Error("Capability is not registered");
                return definition;
            }),
        };
        const sessions = sessionPersistence();
        const prisma = {
            agent_action: {
                findMany: jest.fn().mockResolvedValue([missing, uncertain]),
                findFirst: jest.fn().mockResolvedValueOnce(uncertain).mockResolvedValueOnce(succeeded),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const service = new ActionCoordinatorService(
            prisma as never,
            registry as never,
            { isCapabilityEnabled: jest.fn() } as never,
            {
                isAvailable: jest.fn().mockReturnValue(true),
                runExclusive: jest.fn(async (callback: (lease: { isHeld(): boolean }) => Promise<number>) => callback({ isHeld: () => true })),
            } as never,
            sessions as never,
        actionPersistence() as never,
        );

        await expect(service.reconcileUncertainActions()).resolves.toBe(1);
        expect(registry.get).toHaveBeenCalledWith(missing.capability);
        expect(registry.get).toHaveBeenCalledWith(uncertain.capability);
        expect(definition.reconcile).toHaveBeenCalledTimes(1);
        expect(sessions.upsertActionResultMessage).toHaveBeenCalledWith(
            uncertain.sessionId,
            { userId: uncertain.userId, branchId: uncertain.branchId },
            expect.objectContaining({ id: `agent-action-result:${uncertain.id}` }),
        );
    });

    it("advances every attempted uncertain action so repeated sweeps remain fair beyond the page size", async () => {
        const initialUpdatedAt = new Date("2026-08-03T00:00:00.000Z");
        const records = Array.from({ length: 120 }, (_, index) => actionRecord({
            id: `uncertain-${String(index).padStart(3, "0")}`,
            status: "uncertain",
            updatedAt: initialUpdatedAt,
        }));
        const attempted = new Set<string>();
        const prisma = {
            agent_action: {
                findMany: jest.fn().mockImplementation(async ({ take }: { take: number }) => records
                    .filter((record) => record.status === "uncertain")
                    .sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime() || left.id.localeCompare(right.id))
                    .slice(0, take)),
                updateMany: jest.fn().mockImplementation(async ({ where, data }: { where: { id: string; status: string }; data: { updatedAt: Date } }) => {
                    const record = records.find((candidate) => candidate.id === where.id && candidate.status === where.status);
                    if (!record) return { count: 0 };
                    attempted.add(record.id);
                    record.updatedAt = data.updatedAt;
                    return { count: 1 };
                }),
            },
        };
        const service = new ActionCoordinatorService(
            prisma as never,
            { get: jest.fn().mockReturnValue(capability()) } as never,
            { isCapabilityEnabled: jest.fn() } as never,
            {
                isAvailable: jest.fn().mockReturnValue(true),
                runExclusive: jest.fn(async (callback: (lease: { isHeld(): boolean }) => Promise<number>) => callback({ isHeld: () => true })),
            } as never,
            sessionPersistence() as never,
            actionPersistence() as never,
        );

        await service.reconcileUncertainActions();
        await service.reconcileUncertainActions();
        await service.reconcileUncertainActions();

        expect(attempted).toHaveProperty("size", 120);
        expect(prisma.agent_action.findMany).toHaveBeenCalledTimes(3);
        expect(prisma.agent_action.findMany).toHaveBeenCalledWith(expect.objectContaining({
            orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
            take: 50,
        }));
        expect(prisma.agent_action.updateMany.mock.calls.length).toBeGreaterThanOrEqual(120);
    });
});
