import { AgentActionCertainFailureError } from "application/agent/action-coordinator.service";
import { clientAgentTargetVersion } from "application/usecases/client/client-agent-target";
import { ContractExternalAgentCapabilitiesProvider } from "./contract-external-agent-capabilities.provider";

describe("ContractExternalAgentCapabilitiesProvider approval-bound dispatch", () => {
    const context = {
        principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
        sessionId: "session-a",
        traceId: "trace-a",
        locale: "ko",
        actionId: "action-a",
    } as const;

    const client = (overrides: Record<string, unknown> = {}) => ({
        id: 7,
        name: "김고객",
        address: "인천",
        phone: "010-1111-2222",
        birthday: "900101",
        startDate: new Date("2026-08-03T00:00:00.000Z"),
        endDate: new Date("2026-08-17T00:00:00.000Z"),
        fullPrice: "100000",
        grant: "50000",
        actualPrice: "50000",
        duration: 15,
        ...overrides,
    });

    function setup(currentClient = client()) {
        const createAndSend = { execute: jest.fn().mockResolvedValue({ success: true, documentId: "remote-1" }) };
        const transaction = { agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
        };
        const provider = new ContractExternalAgentCapabilitiesProvider(
            createAndSend as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn().mockResolvedValue(currentClient) } as never,
            { findByIdForUpdate: jest.fn().mockResolvedValue(currentClient) } as never,
            prisma as never,
        );
        return { provider, createAndSend, transaction, prisma };
    }

    async function inspectDispatch(provider: ContractExternalAgentCapabilitiesProvider) {
        const capability = provider.getCapabilities().find((entry) => entry.meta.name === "contracts.dispatch")!;
        const inspection = await capability.inspect!(context, {
            clientId: 7,
            templateId: "template-1",
            templateName: "표준계약서",
        });
        return { capability, inspection };
    }

    it("exposes only dispatch and keeps a complete masked approval snapshot", async () => {
        const { provider } = setup();
        const capabilities = provider.getCapabilities();
        expect(capabilities.map((entry) => entry.meta.name)).toEqual(["contracts.dispatch"]);

        const { inspection } = await inspectDispatch(provider);
        expect(inspection.targetSnapshot).toEqual(expect.objectContaining({
            clientId: 7,
            phoneLast4: "••••2222",
            templateId: "template-1",
            templateName: "표준계약서",
            startDate: "2026-08-03",
            endDate: "2026-08-17",
            duration: 15,
            fullPrice: "100000",
            grant: "50000",
            actualPrice: "50000",
            effectiveDate: expect.stringMatching(/^2026-/),
            includesSensitiveFields: true,
        }));

        const serializedInspection = JSON.stringify(inspection);
        expect(serializedInspection).not.toContain("010-1111-2222");
        expect(serializedInspection).not.toContain("인천");
        expect(serializedInspection).not.toContain("900101");
    });

    it("refuses dispatch when the locked target changed after preliminary revalidation", async () => {
        const original = client();
        const changed = client({ name: "다른 고객" });
        const { provider, createAndSend } = setup(changed);
        const { inspection } = await inspectDispatch(provider);

        await expect(provider.getCapabilities()[0]!.executeApprovedTarget!({
            ...context,
            approvedTargetSnapshot: inspection.targetSnapshot,
        }, {
            clientId: original.id,
            templateId: "template-1",
        }, clientAgentTargetVersion(original as never))).rejects.toBeInstanceOf(AgentActionCertainFailureError);

        expect(createAndSend.execute).not.toHaveBeenCalled();
    });

    it("stages the exact client projection before sending and never re-reads it in the usecase", async () => {
        const current = client();
        const { provider, createAndSend, transaction } = setup(current);
        const { capability, inspection } = await inspectDispatch(provider);

        await expect(capability.executeApprovedTarget!({
            ...context,
            approvedTargetSnapshot: inspection.targetSnapshot,
        }, {
            clientId: current.id,
            templateId: "template-1",
            templateName: "표준계약서",
        }, clientAgentTargetVersion(current as never))).resolves.toEqual({
            success: true,
            documentId: "remote-1",
            status: "sent",
        });

        expect(transaction.agent_action.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: "action-a", capability: "contracts.dispatch", status: "executing" }),
            data: expect.objectContaining({ effectReceipt: expect.objectContaining({ result: expect.objectContaining({
                clientSnapshot: expect.objectContaining({ name: "김고객", startDate: "2026-08-03T00:00:00.000Z" }),
            }) }) }),
        }));
        expect(createAndSend.execute).toHaveBeenCalledWith("branch-a", expect.objectContaining({
            clientSnapshot: expect.objectContaining({
                name: "김고객",
                phone: "010-1111-2222",
                startDate: "2026-08-03T00:00:00.000Z",
                fallbackDate: (inspection.targetSnapshot as Record<string, unknown>)["effectiveDate"],
            }),
            idempotencyKey: "action-a",
        }));
    });

    it("rejects execution when the approved snapshot is missing or unsafe", async () => {
        const { provider, createAndSend } = setup();
        const capability = provider.getCapabilities()[0]!;

        await expect(capability.executeApprovedTarget!(context, {
            clientId: 7,
            templateId: "template-1",
        }, clientAgentTargetVersion(client() as never))).rejects.toBeInstanceOf(AgentActionCertainFailureError);

        const { inspection } = await inspectDispatch(provider);
        await expect(capability.executeApprovedTarget!({
            ...context,
            approvedTargetSnapshot: {
                ...inspection.targetSnapshot,
                phoneLast4: "010-1111-2222",
            },
        }, {
            clientId: 7,
            templateId: "template-1",
        }, clientAgentTargetVersion(client() as never))).rejects.toBeInstanceOf(AgentActionCertainFailureError);

        expect(createAndSend.execute).not.toHaveBeenCalled();
    });
});
