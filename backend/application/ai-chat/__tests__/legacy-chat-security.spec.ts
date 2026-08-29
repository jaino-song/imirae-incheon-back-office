import { Logger } from "@nestjs/common";
import { ToolExecutorService } from "../tool-executor.service";
import { hashLegacyChatPayload, redactSensitiveLegacyChatContent } from "../legacy-chat-confirmation.service";
import { allTools, CUD_TOOLS } from "../tools";

describe("legacy chat tool security boundary", () => {
    const context = {
        userId: "user-1",
        branchId: "branch-1",
        sessionId: "session-1",
        globalRole: "user",
        branchRole: "admin",
    };

    function createExecutor() {
        const clientService = {
            findAllPaginated: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, totalPages: 0 }),
            findById: jest.fn(), create: jest.fn().mockResolvedValue({ id: 7, name: "김산모" }), update: jest.fn(),
            findAll: jest.fn().mockResolvedValue([]), findByFilter: jest.fn().mockResolvedValue([]),
            terminateService: jest.fn(), requestReplacement: jest.fn(),
        };
        const employeeService = {
            findAll: jest.fn().mockResolvedValue([]), findById: jest.fn(), create: jest.fn(), update: jest.fn(),
            delete: jest.fn(), findAllOpenToNextWork: jest.fn().mockResolvedValue([]), findByWorkArea: jest.fn().mockResolvedValue([]),
            findByGrade: jest.fn().mockResolvedValue([]), changeOpenStatus: jest.fn(),
        };
        const messageService = { findAll: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
        const areaTemplateService = { findAll: jest.fn().mockResolvedValue([]), findByArea: jest.fn() };
        const eformsignDocService = { createAndSendContract: jest.fn(), findByDocumentId: jest.fn(), findByClientId: jest.fn(), findAll: jest.fn().mockResolvedValue([]) };
        const voucherPriceInfoService = { list: jest.fn().mockResolvedValue([]), findByType: jest.fn().mockResolvedValue([]) };
        const bankAccountInfoService = {
            findAll: jest.fn().mockResolvedValue([{ area: "인천", bankName: "은행", accNum: "110-123-456789" }]),
            findByArea: jest.fn().mockResolvedValue({ area: "인천", bankName: "은행", accNum: "110-123-456789" }),
        };
        const employeeScheduleService = { findAll: jest.fn().mockResolvedValue([]), findByPrimaryEmployeeId: jest.fn().mockResolvedValue([]), findBySecondaryEmployeeId: jest.fn().mockResolvedValue([]) };
        const confirmationService = { createIntent: jest.fn().mockResolvedValue({ intentId: "intent-1", nonce: "nonce-1", toolName: "createClient", confirmationExpiresAt: new Date(Date.now() + 1000).toISOString() }) };
        const executor = new ToolExecutorService(
            clientService as never,
            employeeService as never,
            messageService as never,
            areaTemplateService as never,
            eformsignDocService as never,
            voucherPriceInfoService as never,
            bankAccountInfoService as never,
            employeeScheduleService as never,
            confirmationService as never,
        );
        return { executor, clientService, bankAccountInfoService, confirmationService };
    }

    it("does not treat model-supplied confirmed:true as authority", async () => {
        const { executor, clientService, confirmationService } = createExecutor();
        const payload = {
            confirmed: true,
            name: "김산모",
            primaryEmployeeId: 1,
            careCenter: false,
            voucherClient: true,
        };

        const result = await executor.execute(context, "createClient", payload);

        expect(result).toMatchObject({ success: true, requiresConfirmation: true, confirmationIntentId: "intent-1" });
        expect(clientService.create).not.toHaveBeenCalled();
        expect(confirmationService.createIntent).toHaveBeenCalledWith(
            context,
            "createClient",
            expect.not.objectContaining({ confirmed: true }),
        );
    });

    it("masks bank accounts, scopes the branch, and never logs the raw account", async () => {
        const { executor, bankAccountInfoService } = createExecutor();
        const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);

        const result = await executor.execute(context, "listBankAccounts", {});

        expect(result).toEqual({ success: true, data: [{ area: "인천", bankName: "은행", accountLast4: "6789" }] });
        expect(JSON.stringify(result)).not.toContain("110-123-456789");
        expect(bankAccountInfoService.findAll).toHaveBeenCalledWith("branch-1");
        expect(logSpy.mock.calls.flat().join(" ")).not.toContain("110-123-456789");
        logSpy.mockRestore();
    });

    it("denies bank account reads to a non-admin branch role", async () => {
        const { executor, bankAccountInfoService } = createExecutor();

        const result = await executor.execute({ ...context, branchRole: "user" }, "getBankAccountByArea", { area: "인천" });

        expect(result).toEqual({ success: false, error: expect.stringContaining("관리자") });
        expect(bankAccountInfoService.findByArea).not.toHaveBeenCalled();
    });

    it("requires a consumed, payload-bound intent before authorized mutation execution", async () => {
        const { executor, clientService } = createExecutor();
        const args = { name: "김산모", primaryEmployeeId: 1, careCenter: false, voucherClient: true };
        const fakeIntent = {
            id: "intent-1", userId: context.userId, branchId: context.branchId, sessionId: context.sessionId,
            toolName: "createClient", payload: args, payloadHash: hashLegacyChatPayload(args),
        };

        const result = await executor.executeAuthorized(context, "createClient", args, fakeIntent);

        expect(result).toEqual({ success: false, error: "Only confirmed mutation tools can use this path" });
        expect(clientService.create).not.toHaveBeenCalled();
    });

    it("redacts previously persisted full account strings before model/client transcript use", () => {
        const transcript = "입금 계좌번호: 110-123-456789";

        const redacted = redactSensitiveLegacyChatContent(transcript);

        expect(redacted).toContain("[REDACTED]");
        expect(redacted).not.toContain("110-123-456789");
    });

    it("does not advertise model-supplied confirmation flags in legacy mutation schemas", () => {
        for (const toolName of CUD_TOOLS) {
            const declaration = allTools.find((tool) => tool.name === toolName);
            expect(declaration?.parameters.properties).not.toHaveProperty("confirmed");
            expect(declaration?.parameters.required ?? []).not.toContain("confirmed");
        }
    });
});
