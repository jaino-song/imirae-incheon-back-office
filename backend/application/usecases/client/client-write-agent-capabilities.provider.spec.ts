import { Prisma } from "@prisma/client";
import { ConflictException } from "@nestjs/common";

import { AgentActionCertainFailureError } from "application/agent/action-coordinator.service";
import { ClientWriteAgentCapabilitiesProvider } from "./client-write-agent-capabilities.provider";

describe("ClientWriteAgentCapabilitiesProvider", () => {
    function setup() {
        const createClient = { execute: jest.fn().mockResolvedValue({ id: 1, name: "홍길동" }) };
        const updateClient = {
            execute: jest.fn().mockResolvedValue({ id: 1, name: "홍길동" }),
            executeApprovedTarget: jest.fn().mockResolvedValue({ id: 1, name: "홍길동" }),
        };
        const existingClient = {
            id: 1,
            name: "홍길동",
            startDate: new Date("2024-01-01T00:00:00.000Z"),
            endDate: new Date("2024-06-01T00:00:00.000Z"),
            duration: 10,
            voucherClient: true,
            type: "standard",
            fullPrice: "100000",
            grant: "50000",
            actualPrice: "50000",
            serviceStatus: "active",
            areaId: "global",
        };
        const findClient = { execute: jest.fn().mockResolvedValue(existingClient) };
        const clientRepository = { findByPhone: jest.fn().mockResolvedValue(null) };
        const transaction = { agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        const serviceRecordLifecycle = {
            validatePeriodChange: jest.fn().mockResolvedValue(undefined),
            ensureForClient: jest.fn().mockResolvedValue(undefined),
        };
        const triggerService = {
            syncEmployeeAssignmentRulesForClient: jest.fn().mockResolvedValue(undefined),
        };
        const messageAutomationIntentService = {
            persistScheduleIntent: jest.fn().mockResolvedValue(undefined),
        };
        const voucherServiceSelection = {
            execute: jest.fn().mockResolvedValue({
                type: "A통합1형",
                duration: 35,
                fullPrice: "3500000",
                grant: "2400000",
                actualPrice: "1100000",
            }),
        };
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
            agent_action: transaction.agent_action,
            area: { findFirst: jest.fn().mockResolvedValue({ id: "global" }) },
            employee_schedule: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const provider = new ClientWriteAgentCapabilitiesProvider(
            createClient as never,
            updateClient as never,
            findClient as never,
            clientRepository as never,
            prisma as never,
            serviceRecordLifecycle as never,
            voucherServiceSelection as never,
            triggerService as never,
            messageAutomationIntentService as never,
        );
        return {
            createClient,
            updateClient,
            findClient,
            clientRepository,
            existingClient,
            prisma,
            transaction,
            serviceRecordLifecycle,
            voucherServiceSelection,
            triggerService,
            messageAutomationIntentService,
            capabilities: provider.getCapabilities(),
        };
    }

    it("infers a voucher client and replaces model pricing from the canonical service row before hashing", async () => {
        const { capabilities, voucherServiceSelection } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        } as const;

        await expect(capability.canonicalizeInput!(context, {
            name: "synthetic client",
            phone: "01000000000",
            type: "A 통합 1형 연장형",
            startDate: "2026-04-01",
            fullPrice: "model-price",
            grant: "model-grant",
            actualPrice: "model-actual",
        })).resolves.toEqual(expect.objectContaining({
            voucherClient: true,
            type: "A통합1형",
            duration: 35,
            fullPrice: "3500000",
            grant: "2400000",
            actualPrice: "1100000",
        }));
        expect(voucherServiceSelection.execute).toHaveBeenCalledWith(expect.objectContaining({
            type: "A 통합 1형 연장형",
            startDate: "2026-04-01",
        }));
    });

    it("rejects explicit non-voucher intent that contradicts a voucher label", async () => {
        const { capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        } as const;

        await expect(capability.canonicalizeInput!(context, {
            name: "synthetic client",
            phone: "01000000000",
            voucherClient: false,
            type: "A통합1형 연장형",
            startDate: "2026-04-01",
        })).rejects.toThrow("voucherClient=false");
    });

    it("executes the same canonical voucher pricing that canonicalization returns", async () => {
        const { capabilities, createClient, transaction } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        const canonical = await capability.canonicalizeInput!(context, {
            name: "synthetic client",
            phone: "01000000000",
            type: "A통합1형 연장형",
            startDate: "2026-04-01",
            fullPrice: "model-price",
            grant: "model-grant",
            actualPrice: "model-actual",
        });
        await capability.execute(context, canonical);

        expect(createClient.execute).toHaveBeenCalledWith("branch-a", expect.objectContaining({
            voucherClient: true,
            type: "A통합1형",
            duration: 35,
            fullPrice: "3500000",
            grant: "2400000",
            actualPrice: "1100000",
        }), transaction);
    });

    it("keeps the updated capability description focused on facts, lookups, and one approval proposal", () => {
        const { capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;

        expect(capability.meta.description).toContain("missing facts");
        expect(capability.meta.description).toContain("read-only lookups");
        expect(capability.meta.description).toContain("structured proposal");
        expect(capability.meta.description).toContain("Never ask the user for conversational confirmation");
    });

    it("accepts date-only values emitted by date form controls", async () => {
        const { createClient, capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const input = { name: "홍길동", phone: "01012345678", dueDate: "2026-08-03" };

        expect(capability.inputSchema.safeParse(input).success).toBe(true);
        await capability.execute({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        }, input);

        expect(createClient.execute).toHaveBeenCalledWith("branch-a", expect.objectContaining({
            dueDate: new Date("2026-08-03T00:00:00.000Z"),
        }), expect.objectContaining({ agent_action: expect.any(Object) }));
        expect(capability.inputSchema.safeParse({ ...input, dueDate: "2026-02-31" }).success).toBe(false);
    });

    it.each(["not-a-phone", "123"])("rejects malformed client create phones before lookups or writes (%j)", async (phone) => {
        const { capabilities, createClient, clientRepository, voucherServiceSelection, prisma } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await expect(capability.execute(context, { name: "홍길동", phone })).rejects.toThrow(
            "연락처가 올바른 국내 전화번호 형식이 아닙니다.",
        );
        expect(clientRepository.findByPhone).not.toHaveBeenCalled();
        expect(voucherServiceSelection.execute).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(createClient.execute).not.toHaveBeenCalled();
    });

    it("rejects malformed client update phones before reading the target or starting a transaction", async () => {
        const { capabilities, updateClient, findClient, prisma } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await expect(capability.execute(context, { id: 1, phone: "not-a-phone" })).rejects.toThrow(
            "연락처가 올바른 국내 전화번호 형식이 아닙니다.",
        );
        expect(findClient.execute).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(updateClient.execute).not.toHaveBeenCalled();
    });

    it("rolls client creation and its action receipt through one transaction", async () => {
        const { capabilities, prisma, transaction } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;

        await capability.execute({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        }, { name: "홍길동", phone: "01012345678" });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(transaction.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: "action-a", capability: "clients.create" }),
        }));
    });

    it("does not report a created client when the action receipt cannot be persisted", async () => {
        const { capabilities, transaction, createClient } = setup();
        transaction.agent_action.updateMany.mockResolvedValue({ count: 0 });
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;

        await expect(capability.execute({
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        }, { name: "홍길동", phone: "01012345678" })).rejects.toThrow("receipt could not be persisted");

        expect(createClient.execute).toHaveBeenCalledWith("branch-a", expect.any(Object), transaction);
    });

    it("normalizes non-voucher create pricing and synchronizes its service record in the transaction", async () => {
        const { capabilities, createClient, serviceRecordLifecycle, transaction } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await capability.execute(context, {
            name: "홍길동",
            phone: "01012345678",
            voucherClient: false,
            type: "private",
            fullPrice: "120000",
            grant: "90000",
            actualPrice: "30000",
        });

        expect(createClient.execute).toHaveBeenCalledWith("branch-a", expect.objectContaining({
            voucherClient: false,
            type: null,
            fullPrice: "120000",
            grant: "0",
            actualPrice: "120000",
        }), transaction);
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(1, transaction);
    });

    it("preserves voucher pricing when creating a voucher client", async () => {
        const { capabilities, createClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await capability.execute(context, {
            name: "홍길동",
            phone: "01012345678",
            voucherClient: true,
            type: "voucher",
            fullPrice: "120000",
            grant: "90000",
            actualPrice: "30000",
        });

        expect(createClient.execute).toHaveBeenCalledWith("branch-a", expect.objectContaining({
            voucherClient: true,
            type: "voucher",
            fullPrice: "120000",
            grant: "90000",
            actualPrice: "30000",
        }), expect.anything());
    });

    it("canonicalizes create input before it reaches proposal hashing", async () => {
        const { capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        } as const;

        expect(capability.canonicalizeInput!(context, {
            name: "홍길동",
            phone: "01012345678",
            voucherClient: false,
            type: "private",
            fullPrice: "120000",
            grant: "90000",
            actualPrice: "30000",
        })).toEqual(expect.objectContaining({
            voucherClient: false,
            type: null,
            fullPrice: "120000",
            grant: "0",
            actualPrice: "120000",
        }));
    });

    it("canonicalizes update input from the branch-owned current client", async () => {
        const { capabilities, findClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        } as const;

        await expect(capability.canonicalizeInput!(context, {
            id: 1,
            fullPrice: "130000",
        })).resolves.toEqual(expect.objectContaining({
            id: 1,
            voucherClient: true,
            type: "standard",
            fullPrice: "130000",
            grant: "50000",
            actualPrice: "50000",
        }));
        expect(findClient.execute).toHaveBeenCalledWith("branch-a", 1);
    });

    it("offers every client update field without requiring unrelated values", () => {
        const { capabilities } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const fields = capability.formFields ?? [];

        expect(fields.find((field) => field.name === "id")?.required).toBe(true);
        expect(fields.find((field) => field.name === "phone")).toEqual(expect.objectContaining({ required: false }));
        expect(fields.find((field) => field.name === "name")).toEqual(expect.objectContaining({ required: false }));
        expect(capability.inputSchema.safeParse({ id: 1 }).success).toBe(false);
        expect(capability.inputSchema.safeParse({ id: 1, targetVersion: "v1" }).success).toBe(false);
        expect(capability.inputSchema.safeParse({ id: 1, phone: "01012345678" }).success).toBe(true);
    });

    it("uses the approval-bound client hook instead of the unlocked update path", async () => {
        const { capabilities, updateClient, transaction, serviceRecordLifecycle } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        const result = await capability.executeApprovedTarget!(context, {
            id: 1,
            startDate: "2024-02-29",
            endDate: "2024-03-01",
            dueDate: "2024-02-29",
            birthDate: "1990-02-28T23:30:00-09:00",
        }, "approved-target");

        expect(result).toEqual({ id: 1, name: "홍길동", status: "updated" });
        expect(updateClient.executeApprovedTarget).toHaveBeenCalledWith(
            "branch-a",
            1,
            expect.objectContaining({
                startDate: new Date("2024-02-29T00:00:00.000Z"),
                endDate: new Date("2024-03-01T00:00:00.000Z"),
                dueDate: new Date("2024-02-29T00:00:00.000Z"),
                birthDate: new Date("1990-02-28T00:00:00.000Z"),
            }),
            "approved-target",
            transaction,
        );
        expect(serviceRecordLifecycle.validatePeriodChange).toHaveBeenCalledWith(expect.objectContaining({
            clientId: 1,
            startDate: new Date("2024-02-29T00:00:00.000Z"),
            endDate: new Date("2024-03-01T00:00:00.000Z"),
        }), transaction);
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(1, transaction);
        expect(transaction.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ capability: "clients.update" }),
        }));
        expect(updateClient.execute).not.toHaveBeenCalled();
    });

    it("refreshes assignment jobs after a direct client name update", async () => {
        const { capabilities, updateClient, triggerService, existingClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        } as const;
        updateClient.execute.mockResolvedValue({ ...existingClient, name: "김길동" });

        await capability.execute!(context, { id: existingClient.id, name: "김길동" });

        expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledTimes(1);
        expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledWith("branch-a", existingClient.id);
    });

    it("does not refresh assignment jobs for an unrelated direct client update", async () => {
        const { capabilities, triggerService } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        } as const;

        await capability.execute!(context, { id: 1, address: "새 주소" });

        expect(triggerService.syncEmployeeAssignmentRulesForClient).not.toHaveBeenCalled();
    });

    it("refreshes assignment jobs when a direct supplied name matches the stale snapshot", async () => {
        const { capabilities, updateClient, triggerService, existingClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        } as const;
        updateClient.execute.mockResolvedValue({ ...existingClient, name: "최종 이름" });

        await capability.execute!(context, { id: existingClient.id, name: existingClient.name });

        expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledTimes(1);
        expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledWith("branch-a", existingClient.id);
    });

    it("does not refresh assignment jobs when a direct update omits name", async () => {
        const { capabilities, updateClient, triggerService, existingClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        } as const;
        updateClient.execute.mockResolvedValue({ ...existingClient, name: "동시 변경 이름" });

        await capability.execute!(context, { id: existingClient.id, address: "새 주소" });

        expect(triggerService.syncEmployeeAssignmentRulesForClient).not.toHaveBeenCalled();
    });

    it("refreshes assignment jobs after an approval-bound client name update", async () => {
        const { capabilities, updateClient, triggerService, existingClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;
        updateClient.executeApprovedTarget.mockResolvedValue({ ...existingClient, name: "김길동" });

        await capability.executeApprovedTarget!(context, { id: existingClient.id, name: "김길동" }, "approved-target");

        expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledTimes(1);
        expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledWith("branch-a", existingClient.id);
    });

    it.each([
        ["false", false],
        ["throw", new Error("assignment refresh unavailable")],
    ])("persists deduped active schedule retry intents when the direct agent refresh is %s", async (_label, outcome) => {
        const {
            capabilities,
            updateClient,
            triggerService,
            existingClient,
            prisma,
            transaction,
            messageAutomationIntentService,
        } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        } as const;
        updateClient.execute.mockResolvedValue({ ...existingClient, name: "최종 이름" });
        if (outcome === false) {
            triggerService.syncEmployeeAssignmentRulesForClient.mockResolvedValue(false);
        } else {
            triggerService.syncEmployeeAssignmentRulesForClient.mockRejectedValue(outcome);
        }
        prisma.employee_schedule.findMany.mockResolvedValue([{ id: 12 }, { id: 9 }, { id: 12 }]);

        await capability.execute!(context, { id: existingClient.id, name: existingClient.name });

        expect(prisma.employee_schedule.findMany).toHaveBeenCalledWith({
            where: { branchId: "branch-a", clientId: existingClient.id, replaced: false, terminatedAt: null },
            select: { id: true },
            orderBy: { id: "asc" },
        });
        expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenCalledTimes(2);
        expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenNthCalledWith(
            1,
            transaction,
            expect.objectContaining({
                branchId: "branch-a",
                clientId: existingClient.id,
                scheduleId: 9,
                includePast: true,
                intentAt: expect.any(Date),
                replaceExisting: true,
            }),
        );
        expect(messageAutomationIntentService.persistScheduleIntent).toHaveBeenNthCalledWith(
            2,
            transaction,
            expect.objectContaining({
                branchId: "branch-a",
                clientId: existingClient.id,
                scheduleId: 12,
                includePast: true,
                intentAt: expect.any(Date),
                replaceExisting: true,
            }),
        );
    });

    it("keeps a direct agent client name update successful when retry intent persistence fails", async () => {
        const { capabilities, updateClient, triggerService, existingClient, prisma, messageAutomationIntentService } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko",
        } as const;
        updateClient.execute.mockResolvedValue({ ...existingClient, name: "최종 이름" });
        triggerService.syncEmployeeAssignmentRulesForClient.mockResolvedValue(false);
        prisma.employee_schedule.findMany.mockResolvedValue([{ id: 12 }]);
        messageAutomationIntentService.persistScheduleIntent.mockRejectedValue(new Error("intent store unavailable"));

        await expect(capability.execute!(context, { id: existingClient.id, name: existingClient.name }))
            .resolves.toEqual({ id: existingClient.id, name: "최종 이름", status: "updated" });
    });

    it("refreshes assignment jobs after an approval-bound supplied name even when the snapshot is stale", async () => {
        const { capabilities, updateClient, triggerService, existingClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;
        updateClient.executeApprovedTarget.mockResolvedValue({ ...existingClient, name: "최종 이름" });

        await capability.executeApprovedTarget!(context, { id: existingClient.id, name: existingClient.name }, "approved-target");

        expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledTimes(1);
        expect(triggerService.syncEmployeeAssignmentRulesForClient).toHaveBeenCalledWith("branch-a", existingClient.id);
    });

    it("does not refresh assignment jobs after an approval-bound update omits name", async () => {
        const { capabilities, updateClient, triggerService, existingClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin", },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;
        updateClient.executeApprovedTarget.mockResolvedValue({ ...existingClient, name: "동시 변경 이름" });

        await capability.executeApprovedTarget!(context, { id: existingClient.id, address: "새 주소" }, "approved-target");

        expect(triggerService.syncEmployeeAssignmentRulesForClient).not.toHaveBeenCalled();
    });

    it("does not manufacture a birthDate clear when an update omits birthDate", async () => {
        const { capabilities, updateClient, transaction } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await capability.execute!(context, { id: 1, name: "김길동" });
        await capability.executeApprovedTarget!(context, { id: 1, name: "김길동" }, "approved-target");

        const directUpdates = updateClient.execute.mock.calls[0]?.[2] as Record<string, unknown>;
        const approvedUpdates = updateClient.executeApprovedTarget.mock.calls[0]?.[2] as Record<string, unknown>;
        expect(directUpdates["birthDate"]).toBeUndefined();
        expect(approvedUpdates["birthDate"]).toBeUndefined();
        expect(updateClient.executeApprovedTarget).toHaveBeenCalledWith(
            "branch-a", 1, expect.objectContaining({ birthDate: undefined }), "approved-target", transaction,
        );
    });

    it("normalizes partial pricing updates and synchronizes direct writes", async () => {
        const { capabilities, updateClient, serviceRecordLifecycle } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await capability.execute(context, { id: 1, fullPrice: "130000" });

        expect(updateClient.execute).toHaveBeenCalledWith("branch-a", 1, expect.objectContaining({
            fullPrice: "130000",
            type: "standard",
            grant: "50000",
            actualPrice: "50000",
        }));
        expect(serviceRecordLifecycle.validatePeriodChange).toHaveBeenCalledWith(expect.objectContaining({ clientId: 1 }), undefined);
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(1);
    });

    it("normalizes a voucher toggle to canonical non-voucher pricing", async () => {
        const { capabilities, updateClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await capability.execute(context, {
            id: 1,
            voucherClient: false,
            type: "ignored-type",
            fullPrice: "140000",
            grant: "100000",
            actualPrice: "40000",
        });

        expect(updateClient.execute).toHaveBeenCalledWith("branch-a", 1, expect.objectContaining({
            voucherClient: false,
            type: null,
            fullPrice: "140000",
            grant: "0",
            actualPrice: "140000",
        }));
    });

    it("rejects invalid dates and preserves leap-day calendar dates", async () => {
        const { capabilities, createClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        expect(capability.inputSchema.safeParse({
            name: "홍길동", phone: "01012345678", dueDate: "2024-02-30",
        }).success).toBe(false);

        await capability.execute(context, {
            name: "홍길동",
            phone: "01012345678",
            startDate: "2024-02-29",
            endDate: "2024-03-01",
            dueDate: "2024-02-29",
            birthDate: "1990-02-28T23:30:00-09:00",
        });

        expect(createClient.execute).toHaveBeenCalledWith("branch-a", expect.objectContaining({
            startDate: new Date("2024-02-29T00:00:00.000Z"),
            endDate: new Date("2024-03-01T00:00:00.000Z"),
            dueDate: new Date("2024-02-29T00:00:00.000Z"),
            birthDate: new Date("1990-02-28T00:00:00.000Z"),
        }), expect.anything());
    });

    it.each([
        ["leap day", "240229"],
        ["century leap day", "000229"],
    ])("accepts a calendar-valid YYMMDD birthday for create and update (%s)", async (_label, birthday) => {
        const { capabilities, createClient, updateClient, transaction } = setup();
        const create = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        expect(create.inputSchema.safeParse({ name: "홍길동", phone: "01012345678", birthday }).success).toBe(true);
        expect(update.inputSchema.safeParse({ id: 1, birthday }).success).toBe(true);

        await create.execute(context, { name: "홍길동", phone: "01012345678", birthday });
        await update.execute(context, { id: 1, birthday });
        await update.executeApprovedTarget!(context, { id: 1, birthday }, "approved-target");

        expect(createClient.execute).toHaveBeenCalledWith("branch-a", expect.objectContaining({ birthday }), expect.anything());
        expect(updateClient.execute).toHaveBeenCalledWith("branch-a", 1, expect.objectContaining({ birthday }));
        expect(updateClient.executeApprovedTarget).toHaveBeenCalledWith(
            "branch-a", 1, expect.objectContaining({ birthday }), "approved-target", transaction,
        );
    });

    it.each([
        ["non-leap February 29", "230229"],
        ["invalid day", "900231"],
        ["invalid month", "901300"],
        ["nonnumeric", "90A101"],
        ["too short", "90010"],
        ["too long", "9001011"],
    ])("rejects %s YYMMDD birthday before create or update mutation", async (_label, birthday) => {
        const { capabilities, createClient, updateClient, findClient, prisma } = setup();
        const create = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;
        const createInput = { name: "홍길동", phone: "01012345678", birthday };
        const updateInput = { id: 1, birthday };

        expect(create.inputSchema.safeParse(createInput).success).toBe(false);
        expect(update.inputSchema.safeParse(updateInput).success).toBe(false);
        await expect(create.execute(context, createInput)).rejects.toThrow();
        await expect(update.execute(context, updateInput)).rejects.toThrow();
        await expect(update.executeApprovedTarget!(context, updateInput, "approved-target")).rejects.toThrow();

        expect(createClient.execute).not.toHaveBeenCalled();
        expect(updateClient.execute).not.toHaveBeenCalled();
        expect(updateClient.executeApprovedTarget).not.toHaveBeenCalled();
        expect(findClient.execute).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
        ["null", null],
        ["omitted", undefined],
    ])("accepts a %s nullable/optional birthday value", async (_label, birthday) => {
        const { capabilities, createClient, updateClient } = setup();
        const create = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const update = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;
        const createInput = {
            name: "홍길동",
            phone: "01012345678",
            ...(birthday === undefined ? {} : { birthday }),
        };
        const updateInput = birthday === undefined
            ? { id: 1, name: "김길동" }
            : { id: 1, birthday };

        expect(create.inputSchema.safeParse(createInput).success).toBe(true);
        expect(update.inputSchema.safeParse(updateInput).success).toBe(true);
        await create.execute(context, createInput);
        await update.execute(context, updateInput);
        await update.executeApprovedTarget!(context, updateInput, "approved-target");

        expect(createClient.execute).toHaveBeenCalled();
        expect(updateClient.execute).toHaveBeenCalled();
        expect(updateClient.executeApprovedTarget).toHaveBeenCalled();
    });

    it("restricts serviceStatus to canonical values and does not invoke create on invalid input", async () => {
        const { capabilities, createClient } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        expect(capability.inputSchema.safeParse({
            name: "홍길동", phone: "01012345678", serviceStatus: "not-a-status",
        }).success).toBe(false);
        await expect(capability.execute(context, {
            name: "홍길동", phone: "01012345678", serviceStatus: "not-a-status",
        })).rejects.toThrow();
        expect(createClient.execute).not.toHaveBeenCalled();
    });

    it("accepts branch-local and global areas while rejecting foreign areas without enumeration", async () => {
        const { capabilities, createClient, prisma } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        prisma.area.findFirst
            .mockResolvedValueOnce({ id: "local" })
            .mockResolvedValueOnce({ id: "global" })
            .mockResolvedValueOnce(null);
        await capability.execute(context, { name: "홍길동", phone: "01011112222", areaId: "local" });
        await capability.execute(context, { name: "김영희", phone: "01033334444", areaId: "global" });
        await expect(capability.execute(context, {
            name: "박철수", phone: "01055556666", areaId: "foreign",
        })).rejects.toThrow("선택한 관할 지역을 사용할 수 없습니다.");

        expect(prisma.area.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: { id: "local", OR: [{ branchId: "branch-a" }, { branchId: null }] },
        }));
        expect(createClient.execute).toHaveBeenCalledTimes(2);
    });

    it("normalizes formatted phones and allows the current target to retain its own phone", async () => {
        const { capabilities, clientRepository, existingClient, updateClient, createClient } = setup();
        const createCapability = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const updateCapability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        clientRepository.findByPhone.mockResolvedValueOnce(existingClient);
        await expect(createCapability.execute(context, {
            name: "신규", phone: "010-1234-5678",
        })).rejects.toThrow("이미 같은 전화번호의 고객이 있습니다.");
        expect(clientRepository.findByPhone).toHaveBeenLastCalledWith("branch-a", "01012345678");
        expect(createClient.execute).not.toHaveBeenCalled();

        clientRepository.findByPhone.mockResolvedValueOnce(existingClient);
        await updateCapability.execute(context, { id: 1, phone: "010-1234-5678" });
        expect(updateClient.execute).toHaveBeenCalledWith("branch-a", 1, expect.objectContaining({ phone: "010-1234-5678" }));

        clientRepository.findByPhone.mockResolvedValueOnce({ ...existingClient, id: 2 });
        await expect(updateCapability.execute(context, { id: 1, phone: "010 1234 5678" })).rejects.toThrow("이미 같은 전화번호의 고객이 있습니다.");
        expect(updateClient.execute).toHaveBeenCalledTimes(1);
    });

    it("merges partial dates before direct and approved updates, allowing equal or null dates", async () => {
        const { capabilities, updateClient, transaction } = setup();
        const capability = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await expect(capability.execute(context, { id: 1, endDate: "2023-12-31" })).rejects.toThrow("서비스 시작일은 종료일보다 늦을 수 없습니다.");
        expect(updateClient.execute).not.toHaveBeenCalled();

        await capability.execute(context, { id: 1, endDate: "2024-01-01" });
        await capability.execute(context, { id: 1, startDate: null });
        expect(updateClient.execute).toHaveBeenCalledTimes(2);
        expect(updateClient.execute).toHaveBeenLastCalledWith("branch-a", 1, expect.objectContaining({ startDate: null }));

        await expect(capability.execute(context, { id: 1, endDate: null, duration: 5 }))
            .rejects.toThrow("서비스 기간을 지정하려면 시작일과 종료일이 모두 있어야 합니다.");
        expect(updateClient.execute).toHaveBeenCalledTimes(2);

        await expect(capability.executeApprovedTarget!(context, { id: 1, startDate: "2025-01-01", endDate: "2024-01-01" }, "approved-target"))
            .rejects.toThrow("서비스 시작일은 종료일보다 늦을 수 없습니다.");
        expect(updateClient.executeApprovedTarget).not.toHaveBeenCalled();

        await capability.executeApprovedTarget!(context, { id: 1, startDate: null }, "approved-target");
        expect(updateClient.executeApprovedTarget).toHaveBeenCalledWith(
            "branch-a", 1, expect.objectContaining({ startDate: null }), "approved-target", transaction,
        );
    });

    it.each([
        ["constraint name", "client_branch_phone_normalized_key"],
        ["branchId target fields", ["branchId", "phone"]],
        ["branch_id target fields", ["branch_id", "phone"]],
    ])("converts client phone conflicts from %s into a certain failure without recording an effect", async (_label, target) => {
        const { createClient, transaction, capabilities } = setup();
        const conflict = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
            meta: { target },
        });
        createClient.execute.mockRejectedValue(conflict);
        const create = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        const error = await create.execute(context, {
            name: "홍길동", phone: "01012345678",
        }).catch((caught) => caught);

        expect(error).toBeInstanceOf(AgentActionCertainFailureError);
        expect(transaction.agent_action.updateMany).not.toHaveBeenCalled();
    });

    it.each([
        ["unrelated unique constraint", new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["email"] },
        })],
        ["different composite unique constraint", new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["branchId", "phone", "name"] },
        })],
        ["unrelated database error", new Error("database unavailable")],
    ])("passes through %s unchanged", async (_label, error) => {
        const { createClient, capabilities } = setup();
        createClient.execute.mockRejectedValue(error);
        const create = capabilities.find((entry) => entry.meta.name === "clients.create")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await expect(create.execute(context, {
            name: "홍길동", phone: "01012345678",
        })).rejects.toBe(error);
    });

    it.each([
        ["direct update", "execute", "client_branch_phone_normalized_key"],
        ["direct update", "execute", ["branchId", "phone"]],
        ["direct update", "execute", ["branch_id", "phone"]],
        ["approval-bound update", "executeApprovedTarget", "client_branch_phone_normalized_key"],
        ["approval-bound update", "executeApprovedTarget", ["branchId", "phone"]],
        ["approval-bound update", "executeApprovedTarget", ["branch_id", "phone"]],
    ])("converts %s client phone conflicts from %s into a certain failure without recording an effect", async (_label, updateMethod, target) => {
        const { updateClient, transaction, capabilities } = setup();
        const conflict = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
            meta: { target },
        });
        updateClient[updateMethod as "execute" | "executeApprovedTarget"].mockRejectedValue(conflict);
        const update = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        const result = updateMethod === "execute"
            ? update.execute(context, { id: 1, phone: "01098765432" })
            : update.executeApprovedTarget!(context, { id: 1, phone: "01098765432" }, "approved-target");

        await expect(result).rejects.toBeInstanceOf(AgentActionCertainFailureError);
        expect(transaction.agent_action.updateMany).not.toHaveBeenCalled();
    });

    it.each([
        ["direct update", "execute", new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["email"] },
        })],
        ["direct update", "execute", new Error("database unavailable")],
        ["approval-bound update", "executeApprovedTarget", new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["branchId", "phone", "name"] },
        })],
        ["approval-bound update", "executeApprovedTarget", new Error("database unavailable")],
    ])("passes through %s unrelated write errors unchanged", async (_label, updateMethod, error) => {
        const { updateClient, capabilities } = setup();
        updateClient[updateMethod as "execute" | "executeApprovedTarget"].mockRejectedValue(error);
        const update = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        const result = updateMethod === "execute"
            ? update.execute(context, { id: 1, phone: "01098765432" })
            : update.executeApprovedTarget!(context, { id: 1, phone: "01098765432" }, "approved-target");

        await expect(result).rejects.toBe(error);
    });

    it("normalizes approval-bound pricing inside the CAS transaction", async () => {
        const { capabilities, updateClient, transaction } = setup();
        const update = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await update.executeApprovedTarget!(context, {
            id: 1,
            voucherClient: false,
            type: "ignored-type",
            fullPrice: "150000",
            grant: "120000",
            actualPrice: "30000",
        }, "approved-target");

        expect(updateClient.executeApprovedTarget).toHaveBeenCalledWith(
            "branch-a",
            1,
            expect.objectContaining({
                voucherClient: false,
                type: null,
                fullPrice: "150000",
                grant: "0",
                actualPrice: "150000",
            }),
            "approved-target",
            transaction,
        );
    });

    it.each(["SERVICE_RECORD_START_DATE_LOCKED", "SERVICE_RECORD_FINALIZED"])(
        "denies lifecycle-protected %s updates before mutation",
        async (code) => {
            const { capabilities, updateClient, transaction, serviceRecordLifecycle } = setup();
            serviceRecordLifecycle.validatePeriodChange.mockRejectedValue(new ConflictException({ code }));
            const update = capabilities.find((entry) => entry.meta.name === "clients.update")!;
            const context = {
                principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
                sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
            } as const;

            await expect(update.inspect!(context, { id: 1, startDate: "2024-02-01" })).rejects.toThrow(code);
            await expect(update.execute(context, { id: 1, startDate: "2024-02-01" })).rejects.toThrow(code);
            await expect(update.executeApprovedTarget!(context, { id: 1, startDate: "2024-02-01" }, "approved-target"))
                .rejects.toThrow(code);

            expect(updateClient.execute).not.toHaveBeenCalled();
            expect(updateClient.executeApprovedTarget).not.toHaveBeenCalled();
            expect(transaction.agent_action.updateMany).not.toHaveBeenCalled();
        },
    );

    it("rolls approval-bound lifecycle synchronization back before recording an effect", async () => {
        const { capabilities, updateClient, transaction, serviceRecordLifecycle } = setup();
        serviceRecordLifecycle.ensureForClient.mockRejectedValue(new Error("service record sync failed"));
        const update = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        await expect(update.executeApprovedTarget!(context, { id: 1, name: "새 이름" }, "approved-target"))
            .rejects.toThrow("service record sync failed");

        expect(updateClient.executeApprovedTarget).toHaveBeenCalledWith(
            "branch-a", 1, expect.objectContaining({ name: "새 이름" }), "approved-target", transaction,
        );
        expect(transaction.agent_action.updateMany).not.toHaveBeenCalled();
    });

    it("reconciles voucher pricing from the merged canonical fields", async () => {
        const { capabilities, existingClient } = setup();
        const reconcile = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        const result = await reconcile.reconcile!(context, { id: 1, voucherClient: true }, null);

        expect(result).toEqual({
            status: "succeeded",
            result: { id: 1, name: "홍길동", status: "updated" },
        });
        expect(existingClient.voucherClient).toBe(true);
    });

    it("reconciles non-voucher pricing against canonical grant and actual price", async () => {
        const { capabilities, existingClient } = setup();
        Object.assign(existingClient, {
            voucherClient: false,
            type: null,
            fullPrice: "160000",
            grant: "0",
            actualPrice: "160000",
        });
        const reconcile = capabilities.find((entry) => entry.meta.name === "clients.update")!;
        const context = {
            principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
            sessionId: "session-a", traceId: "trace-a", locale: "ko", actionId: "action-a",
        } as const;

        const result = await reconcile.reconcile!(context, {
            id: 1,
            voucherClient: false,
            type: "stale-input",
            fullPrice: "160000",
            grant: "99999",
            actualPrice: "1",
        }, null);

        expect(result).toEqual({
            status: "succeeded",
            result: { id: 1, name: "홍길동", status: "updated" },
        });
    });
});
