import { AgentActionCertainFailureError } from "application/agent/action-coordinator.service";
import { clientAgentTargetVersion } from "application/usecases/client/client-agent-target";
import { ContractExternalAgentCapabilitiesProvider } from "./contract-external-agent-capabilities.provider";

describe("ContractExternalAgentCapabilitiesProvider approval-bound dispatch", () => {
    const TEMPLATE_UNAVAILABLE_ERROR = "Contract template is unavailable";

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

    const template = (overrides: Record<string, unknown> = {}) => ({
        id: "area-template-1",
        areaId: "area-1",
        templateId: "template-1",
        templateName: "표준계약서",
        ...overrides,
    });

    function setup(currentClient = client(), currentTemplates = [template()]) {
        const createAndSend = { execute: jest.fn().mockResolvedValue({ success: true, documentId: "remote-1" }) };
        const transaction = { agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        const prisma = {
            $transaction: jest.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) => operation(transaction)),
        };
        const areaTemplateService = { findAll: jest.fn().mockResolvedValue(currentTemplates) };
        const provider = new ContractExternalAgentCapabilitiesProvider(
            createAndSend as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn().mockResolvedValue(currentClient) } as never,
            areaTemplateService as never,
            { findByIdForUpdate: jest.fn().mockResolvedValue(currentClient) } as never,
            prisma as never,
        );
        return { provider, createAndSend, transaction, prisma, areaTemplateService };
    }

    async function inspectDispatch(
        provider: ContractExternalAgentCapabilitiesProvider,
        templateName = "표준계약서",
    ) {
        const capability = provider.getCapabilities().find((entry) => entry.meta.name === "contracts.dispatch")!;
        const inspection = await capability.inspect!(context, {
            clientId: 7,
            templateId: "template-1",
            templateName,
        });
        return { capability, inspection };
    }

    it("rejects inspection for missing and foreign branch templates without enumeration", async () => {
        for (const currentTemplates of [[], [template({ templateId: "template-foreign", templateName: "다른 지점 계약서" })]]) {
            const { provider, createAndSend, areaTemplateService } = setup(client(), currentTemplates);
            const capability = provider.getCapabilities()[0]!;

            await expect(capability.inspect!(context, {
                clientId: 7,
                templateId: "template-1",
                templateName: "caller-controlled name",
            })).rejects.toThrow(TEMPLATE_UNAVAILABLE_ERROR);

            expect(areaTemplateService.findAll).toHaveBeenCalledWith("branch-a");
            expect(createAndSend.execute).not.toHaveBeenCalled();
        }
    });

    it("binds the canonical branch template metadata instead of caller-supplied names", async () => {
        const { provider } = setup(client(), [template({ templateName: "지점 표준 계약서" })]);
        const { inspection } = await inspectDispatch(provider, "caller-controlled name");

        expect(inspection.targetSnapshot).toEqual(expect.objectContaining({
            areaId: "area-1",
            templateId: "template-1",
            templateName: "지점 표준 계약서",
        }));
        expect(inspection.summary).toContain("지점 표준 계약서");
        expect(inspection.summary).not.toContain("caller-controlled name");
    });

    it("resolves canonical templates for direct execution before calling the provider", async () => {
        const { provider, createAndSend, areaTemplateService } = setup(client(), [template({ templateName: "지점 표준 계약서" })]);
        const capability = provider.getCapabilities()[0]!;

        await expect(capability.execute(context, {
            clientId: 7,
            templateId: "template-1",
            templateName: "caller-controlled name",
        })).resolves.toEqual({ success: true, documentId: "remote-1", status: "sent" });

        expect(areaTemplateService.findAll).toHaveBeenCalledWith("branch-a");
        expect(createAndSend.execute).toHaveBeenCalledWith("branch-a", expect.objectContaining({
            templateId: "template-1",
            templateName: "지점 표준 계약서",
            idempotencyKey: "action-a",
        }));
    });

    it("rejects direct execution for a removed template before any provider call", async () => {
        const { provider, createAndSend } = setup(client(), []);
        const capability = provider.getCapabilities()[0]!;

        await expect(capability.execute(context, {
            clientId: 7,
            templateId: "template-1",
            templateName: "caller-controlled name",
        })).rejects.toThrow(TEMPLATE_UNAVAILABLE_ERROR);

        expect(createAndSend.execute).not.toHaveBeenCalled();
    });

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
        const { provider, createAndSend } = setup(changed, [template()]);
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
        const { provider, createAndSend, transaction } = setup(current, [template({ templateName: "지점 표준 계약서" })]);
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
            templateId: "template-1",
            templateName: "지점 표준 계약서",
            idempotencyKey: "action-a",
        }));
    });

    it("rejects approved execution when a template is removed or changed after inspection", async () => {
        for (const currentTemplates of [[], [template({ templateName: "변경된 계약서" })]]) {
            const { provider, createAndSend, areaTemplateService } = setup(client(), [template({ templateName: "지점 표준 계약서" })]);
            const { inspection } = await inspectDispatch(provider, "caller-controlled name");
            areaTemplateService.findAll.mockResolvedValue(currentTemplates);
            const capability = provider.getCapabilities()[0]!;
            const input = {
                clientId: 7,
                templateId: "template-1",
                templateName: "caller-controlled name",
            };

            await expect(capability.revalidate!({
                ...context,
                approvedTargetSnapshot: inspection.targetSnapshot,
            }, input, clientAgentTargetVersion(client() as never))).resolves.toEqual(expect.objectContaining({
                valid: false,
                reason: TEMPLATE_UNAVAILABLE_ERROR,
            }));

            await expect(capability.executeApprovedTarget!({
                ...context,
                approvedTargetSnapshot: inspection.targetSnapshot,
            }, input, clientAgentTargetVersion(client() as never))).rejects.toThrow(TEMPLATE_UNAVAILABLE_ERROR);

            expect(createAndSend.execute).not.toHaveBeenCalled();
        }
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
