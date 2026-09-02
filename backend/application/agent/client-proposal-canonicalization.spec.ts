import { DeterministicAgentLanguageModel } from "infrastructure/agent/deterministic-agent-language-model";
import { ActionCoordinatorService } from "./action-coordinator.service";
import { AgentRuntimeService } from "./agent-runtime.service";
import { ClientWriteAgentCapabilitiesProvider } from "application/usecases/client/client-write-agent-capabilities.provider";
import { createSchedulerLeaseMock } from "../../test/utils/mocks/scheduler-lease.mock";

const principal = {
    userId: "user-a",
    branchId: "branch-a",
    globalRole: "admin",
    branchRole: "admin",
} as const;

type Scenario = {
    label: string;
    capabilityName: "clients.create" | "clients.update";
    rawInput: Record<string, unknown>;
    expectedPricing: Record<string, unknown>;
    existing?: Record<string, unknown>;
};

const scenarios: Scenario[] = [
    {
        label: "non-voucher create",
        capabilityName: "clients.create",
        rawInput: {
            name: "홍길동",
            phone: "01012345678",
            voucherClient: false,
            type: "private",
            fullPrice: "120000",
            grant: "90000",
            actualPrice: "30000",
        },
        expectedPricing: {
            voucherClient: false,
            type: null,
            fullPrice: "120000",
            grant: "0",
            actualPrice: "120000",
        },
    },
    {
        label: "non-voucher update",
        capabilityName: "clients.update",
        rawInput: {
            id: 1,
            fullPrice: "130000",
            grant: "99999",
            actualPrice: "1",
            type: "stale-type",
        },
        expectedPricing: {
            voucherClient: false,
            type: null,
            fullPrice: "130000",
            grant: "0",
            actualPrice: "130000",
        },
        existing: {
            voucherClient: false,
            type: null,
            fullPrice: "100000",
            grant: "0",
            actualPrice: "100000",
        },
    },
    {
        label: "voucher toggle to non-voucher",
        capabilityName: "clients.update",
        rawInput: {
            id: 1,
            voucherClient: false,
            type: "stale-type",
            fullPrice: "140000",
            grant: "100000",
            actualPrice: "40000",
        },
        expectedPricing: {
            voucherClient: false,
            type: null,
            fullPrice: "140000",
            grant: "0",
            actualPrice: "140000",
        },
        existing: {
            voucherClient: true,
            type: "voucher",
            fullPrice: "140000",
            grant: "100000",
            actualPrice: "40000",
        },
    },
    {
        label: "voucher unchanged",
        capabilityName: "clients.update",
        rawInput: {
            id: 1,
            voucherClient: true,
            type: "voucher",
            fullPrice: "150000",
            grant: "110000",
            actualPrice: "40000",
        },
        expectedPricing: {
            voucherClient: true,
            type: "voucher",
            fullPrice: "150000",
            grant: "110000",
            actualPrice: "40000",
        },
        existing: {
            voucherClient: true,
            type: "voucher",
            fullPrice: "150000",
            grant: "110000",
            actualPrice: "40000",
        },
    },
];

function buildClientProvider(existingOverrides: Record<string, unknown> = {}) {
    const existing = {
        id: 1,
        name: "홍길동",
        startDate: new Date("2024-01-01T00:00:00.000Z"),
        endDate: new Date("2024-06-01T00:00:00.000Z"),
        duration: 10,
        voucherClient: false,
        type: null,
        fullPrice: "100000",
        grant: "0",
        actualPrice: "100000",
        serviceStatus: "active",
        areaId: "global",
        ...existingOverrides,
    };
    const createClient = { execute: jest.fn().mockResolvedValue({ id: 1, name: existing.name }) };
    const updateClient = {
        execute: jest.fn().mockResolvedValue({ id: 1, name: existing.name }),
        executeApprovedTarget: jest.fn().mockResolvedValue({ id: 1, name: existing.name }),
    };
    const findClient = { execute: jest.fn().mockResolvedValue(existing) };
    const clientRepository = { findByPhone: jest.fn().mockResolvedValue(null) };
    const transaction = { agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const prisma = {
        $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
        agent_action: {
            ...transaction.agent_action,
            findFirst: jest.fn().mockResolvedValue(null),
        },
        area: { findFirst: jest.fn().mockResolvedValue({ id: "global" }) },
    };
    const serviceRecordLifecycle = {
        validatePeriodChange: jest.fn().mockResolvedValue(undefined),
        ensureForClient: jest.fn().mockResolvedValue(undefined),
    };
    const provider = new ClientWriteAgentCapabilitiesProvider(
        createClient as never,
        updateClient as never,
        findClient as never,
        clientRepository as never,
        prisma as never,
        serviceRecordLifecycle as never,
    );
    return { provider, existing, createClient, updateClient, findClient, prisma, transaction };
}

function buildCoordinator(capability: ReturnType<ClientWriteAgentCapabilitiesProvider["getCapabilities"]>[number]) {
    let persisted: Record<string, unknown> | null = null;
    const records = new Map<string, Record<string, unknown>>();
    const prisma = {
        agent_action: {
            findUnique: jest.fn().mockImplementation(async ({ where }: { where: { requestDedupeKey: string } }) =>
                records.get(where.requestDedupeKey) ?? null),
        },
    };
    const sessions = {
        assertActive: jest.fn().mockResolvedValue(undefined),
        upsertActionResultMessage: jest.fn().mockResolvedValue(true),
    };
    const actionRepository = {
        createInActiveSession: jest.fn().mockImplementation(async (input: Record<string, unknown>) => {
            const now = new Date();
            persisted = {
                ...input,
                targetSnapshot: input["targetSnapshot"] ?? null,
                targetVersion: input["targetVersion"] ?? null,
                approvedBy: null,
                approvedAt: null,
                rejectedBy: null,
                rejectedAt: null,
                result: null,
                error: null,
                createdAt: now,
                updatedAt: now,
                executedAt: null,
                executionAttemptCount: 0,
                resultPartPersistedAt: null,
            };
            records.set(String(input["requestDedupeKey"]), persisted);
            return { status: "created", action: persisted };
        }),
    };
    const service = new ActionCoordinatorService(
        prisma as never,
        { get: jest.fn().mockReturnValue(capability) } as never,
        { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
        { isAvailable: jest.fn().mockReturnValue(false) } as never,
        sessions as never,
        actionRepository as never,
        createSchedulerLeaseMock(),
    );
    return { service, getPersisted: () => persisted };
}

async function drain(stream: ReadableStream): Promise<unknown[]> {
    const chunks: unknown[] = [];
    const reader = stream.getReader();
    while (true) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
    }
    return chunks;
}

describe("client proposal pricing canonicalization", () => {
    it.each(scenarios)("keeps coordinator, execution, and reconciliation canonical for %s", async (scenario) => {
        const setup = buildClientProvider(scenario.existing);
        const capability = setup.provider.getCapabilities().find((entry) => entry.meta.name === scenario.capabilityName)!;
        const coordinator = buildCoordinator(capability);
        const action = await coordinator.service.propose({
            sessionId: "session-a",
            principal,
            capability: scenario.capabilityName,
            input: scenario.rawInput,
            locale: "ko",
        });
        const canonical = action.proposal["input"] as Record<string, unknown>;

        expect(canonical).toEqual(expect.objectContaining(scenario.expectedPricing));
        expect(coordinator.getPersisted()?.["proposal"]).toEqual(expect.objectContaining({ input: canonical }));

        const context = {
            principal,
            sessionId: "session-a",
            traceId: "trace-a",
            locale: "ko",
            actionId: action.id,
        } as const;
        if (scenario.capabilityName === "clients.create") {
            await capability.execute(context, canonical);
            expect(setup.createClient.execute).toHaveBeenCalledWith(
                "branch-a",
                expect.objectContaining(scenario.expectedPricing),
                setup.transaction,
            );
            setup.prisma.agent_action.findFirst.mockResolvedValue({
                effectReceipt: {
                    actionId: action.id,
                    capability: "clients.create",
                    resourceType: "client",
                    resourceId: 1,
                    result: { id: 1, name: "홍길동", status: "created" },
                    recordedAt: new Date().toISOString(),
                },
            });
            await expect(capability.reconcile!(context, canonical, null)).resolves.toEqual(expect.objectContaining({ status: "succeeded" }));
        } else {
            await capability.executeApprovedTarget!(context, canonical, action.targetVersion!);
            expect(setup.updateClient.executeApprovedTarget).toHaveBeenCalledWith(
                "branch-a",
                1,
                expect.objectContaining(scenario.expectedPricing),
                action.targetVersion,
                setup.transaction,
            );
            Object.assign(setup.existing, scenario.expectedPricing);
            await expect(capability.reconcile!(context, canonical, null)).resolves.toEqual(expect.objectContaining({ status: "succeeded" }));
        }
    });

    it("streams the same canonical proposal input that the coordinator persists", async () => {
        const setup = buildClientProvider({
            voucherClient: true,
            type: "voucher",
            fullPrice: "150000",
            grant: "110000",
            actualPrice: "40000",
        });
        const capability = setup.provider.getCapabilities().find((entry) => entry.meta.name === "clients.update")!;
        const coordinator = buildCoordinator(capability);
        const sessions = {
            create: jest.fn().mockResolvedValue({ id: "session-runtime", selectedEntities: {}, messages: [] }),
            appendMessages: jest.fn().mockResolvedValue(undefined),
            assertActive: jest.fn().mockResolvedValue(undefined),
            upsertActionResultMessage: jest.fn().mockResolvedValue(true),
        };
        const traces = {
            start: jest.fn().mockResolvedValue({ id: "trace-runtime", startedAt: Date.now() }),
            finish: jest.fn().mockResolvedValue(undefined),
        };
        const runtime = new AgentRuntimeService(
            { list: () => [capability] } as never,
            { isCapabilityEnabled: jest.fn().mockResolvedValue(true) } as never,
            sessions as never,
            {
                modelId: "deterministic-agent-v1",
                create: () => new DeterministicAgentLanguageModel([{
                    type: "tool-call",
                    toolName: "clients_update",
                    input: {
                        id: 1,
                        voucherClient: false,
                        type: "stale-type",
                        fullPrice: "140000",
                        grant: "100000",
                        actualPrice: "40000",
                    },
                }]),
            } as never,
            { route: jest.fn().mockResolvedValue({ domains: ["clients"], capabilities: [capability] }) } as never,
            traces as never,
            coordinator.service as never,
        );

        const result = await runtime.stream({
            principal,
            locale: "ko",
            messages: [{ id: "message-runtime", role: "user", parts: [{ type: "text", text: "고객 요금을 변경해줘" }] }] as never,
        });
        const chunks = await drain(result.stream);
        const canonical = coordinator.getPersisted()?.["proposal"] as { input: Record<string, unknown> };
        const proposalChunk = chunks.find((chunk) => (chunk as { type?: string }).type === "data-action-proposal") as { data: { changes: Record<string, unknown> } };

        expect(canonical.input).toEqual({
            id: 1,
            voucherClient: false,
            type: null,
            fullPrice: "140000",
            grant: "0",
            actualPrice: "140000",
        });
        expect(proposalChunk.data.changes).toEqual(canonical.input);
    });
});
