import { ToolExecutorService } from "../tool-executor.service";

type ServiceMocks = {
    clientService: {
        findAllPaginated: jest.Mock;
        findById: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        findAll: jest.Mock;
        findByFilter: jest.Mock;
        terminateService: jest.Mock;
        requestReplacement: jest.Mock;
    };
    employeeService: {
        findAll: jest.Mock;
        findById: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        delete: jest.Mock;
        findAllOpenToNextWork: jest.Mock;
        findByWorkArea: jest.Mock;
        findByGrade: jest.Mock;
        changeOpenStatus: jest.Mock;
    };
    messageService: {
        findAll: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        delete: jest.Mock;
    };
    areaTemplateService: {
        findAll: jest.Mock;
        findByArea: jest.Mock;
    };
    eformsignDocService: {
        createAndSendContract: jest.Mock;
        findByDocumentId: jest.Mock;
        findByClientId: jest.Mock;
        findAll: jest.Mock;
    };
    voucherPriceInfoService: {
        list: jest.Mock;
        findByType: jest.Mock;
    };
    bankAccountInfoService: {
        findAll: jest.Mock;
        findByArea: jest.Mock;
    };
    employeeScheduleService: {
        findAll: jest.Mock;
        findByPrimaryEmployeeId: jest.Mock;
        findBySecondaryEmployeeId: jest.Mock;
    };
};

function createExecutor(): { executor: ToolExecutorService; mocks: ServiceMocks } {
    const mocks: ServiceMocks = {
        clientService: {
            findAllPaginated: jest.fn().mockResolvedValue({
                data: [],
                total: 0,
                page: 1,
                totalPages: 0,
            }),
            findById: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            update: jest.fn(),
            findAll: jest.fn().mockResolvedValue([]),
            findByFilter: jest.fn().mockResolvedValue([]),
            terminateService: jest.fn(),
            requestReplacement: jest.fn(),
        },
        employeeService: {
            findAll: jest.fn().mockResolvedValue([]),
            findById: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            findAllOpenToNextWork: jest.fn().mockResolvedValue([]),
            findByWorkArea: jest.fn().mockResolvedValue([]),
            findByGrade: jest.fn().mockResolvedValue([]),
            changeOpenStatus: jest.fn(),
        },
        messageService: {
            findAll: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        },
        areaTemplateService: {
            findAll: jest.fn().mockResolvedValue([]),
            findByArea: jest.fn(),
        },
        eformsignDocService: {
            createAndSendContract: jest.fn(),
            findByDocumentId: jest.fn(),
            findByClientId: jest.fn(),
            findAll: jest.fn().mockResolvedValue([]),
        },
        voucherPriceInfoService: {
            list: jest.fn().mockResolvedValue([]),
            findByType: jest.fn().mockResolvedValue([]),
        },
        bankAccountInfoService: {
            findAll: jest.fn().mockResolvedValue([]),
            findByArea: jest.fn(),
        },
        employeeScheduleService: {
            findAll: jest.fn().mockResolvedValue([]),
            findByPrimaryEmployeeId: jest.fn().mockResolvedValue([]),
            findBySecondaryEmployeeId: jest.fn().mockResolvedValue([]),
        },
    };

    const executor = new ToolExecutorService(
        mocks.clientService as never,
        mocks.employeeService as never,
        mocks.messageService as never,
        mocks.areaTemplateService as never,
        mocks.eformsignDocService as never,
        mocks.voucherPriceInfoService as never,
        mocks.bankAccountInfoService as never,
        mocks.employeeScheduleService as never,
    );

    return { executor, mocks };
}

describe("ToolExecutorService", () => {
    it("should default missing search pagination but reject invalid provided values", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "searchClients", { query: "김" }))
            .resolves.toMatchObject({ success: true });
        expect(mocks.clientService.findAllPaginated).toHaveBeenCalledWith("branch-1", 1, 10, "김");

        mocks.clientService.findAllPaginated.mockClear();
        await expect(executor.execute("branch-1", "searchClients", { query: "김", page: "abc" }))
            .resolves.toMatchObject({ success: false, error: expect.stringContaining("page") });
        expect(mocks.clientService.findAllPaginated).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "searchClients", { query: "김", limit: -1 }))
            .resolves.toMatchObject({ success: false, error: expect.stringContaining("limit") });
    });

    it("should reject invalid required identifiers before calling downstream services", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "getClient", { clientId: "abc" }))
            .resolves.toMatchObject({ success: false, error: expect.stringContaining("clientId") });
        expect(mocks.clientService.findById).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "getEmployee", { employeeId: 0 }))
            .resolves.toMatchObject({ success: false, error: expect.stringContaining("employeeId") });
        expect(mocks.employeeService.findById).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "getContractStatus", { clientId: 0 }))
            .resolves.toMatchObject({ success: false, error: expect.stringContaining("clientId") });
        expect(mocks.eformsignDocService.findByClientId).not.toHaveBeenCalled();
    });

    it("should reject invalid creation and update numeric fields before mutation services run", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "createClient", {
            confirmed: true,
            name: "김산모",
            primaryEmployeeId: "nan",
            careCenter: false,
            voucherClient: true,
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("primaryEmployeeId") });
        expect(mocks.clientService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "requestEmployeeReplacement", {
            confirmed: true,
            clientName: "김산모",
            newPrimaryEmployeeName: "박관리",
            newSecondaryEmployeeId: 0,
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("newSecondaryEmployeeId") });
        expect(mocks.clientService.requestReplacement).not.toHaveBeenCalled();
    });

    it("should reject invalid optional year filters instead of passing NaN", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "getVoucherPriceByType", {
            type: "A통합1형",
            year: "soon",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("year") });
        expect(mocks.voucherPriceInfoService.findByType).not.toHaveBeenCalled();

        mocks.voucherPriceInfoService.list.mockResolvedValue([
            { id: 1, type: "A통합1형", duration: 10n, fullPrice: "100", grant: "50", actualPrice: "50", year: 2025 },
            { id: 2, type: "A통합1형", duration: 15n, fullPrice: "150", grant: "70", actualPrice: "80", year: 2026 },
        ]);

        await expect(executor.execute("branch-1", "listVoucherPrices", { year: 2026 }))
            .resolves.toMatchObject({
                success: true,
                data: [
                    expect.objectContaining({ id: 2, year: 2026 }),
                ],
            });
    });

    it("should reject non-boolean client flags instead of coercing strings", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "createClient", {
            confirmed: true,
            name: "김산모",
            primaryEmployeeId: 1,
            careCenter: "false",
            voucherClient: true,
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("careCenter") });
        expect(mocks.clientService.create).not.toHaveBeenCalled();

        mocks.clientService.create.mockResolvedValue({ id: 7, name: "김산모" });
        await expect(executor.execute("branch-1", "createClient", {
            confirmed: true,
            name: "김산모",
            primaryEmployeeId: 1,
            careCenter: false,
            voucherClient: true,
            breastPump: false,
        })).resolves.toMatchObject({ success: true });
        expect(mocks.clientService.create).not.toHaveBeenCalled();
    });

    it("should reject non-boolean employee availability values", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "createEmployee", {
            confirmed: true,
            id: 1,
            name: "박관리",
            phone: "010-0000-0000",
            grade: "A",
            openToNextWork: "false",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("openToNextWork") });
        expect(mocks.employeeService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "changeEmployeeAvailability", {
            confirmed: true,
            employeeId: 1,
            available: "false",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("available") });
        expect(mocks.employeeService.changeOpenStatus).not.toHaveBeenCalled();
    });

    it("should honor employee availability filters during search", async () => {
        const { executor, mocks } = createExecutor();
        mocks.employeeService.findAll.mockResolvedValue([
            { id: 1, name: "김관리", phone: "010-1111-1111", grade: "A", openToNextWork: true },
            { id: 2, name: "김관리2", phone: "010-2222-2222", grade: "B", openToNextWork: false },
        ]);

        await expect(executor.execute("branch-1", "searchEmployees", {
            query: "김관리",
            openToNextWork: true,
        })).resolves.toMatchObject({
            success: true,
            data: [
                expect.objectContaining({ id: 1, openToNextWork: true }),
            ],
        });

        await expect(executor.execute("branch-1", "searchEmployees", {
            query: "김관리",
            openToNextWork: "true",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("openToNextWork") });
    });

    it("should reject missing required strings and invalid enum filters before service calls", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "createEmployee", {
            confirmed: true,
            phone: "010-0000-0000",
            grade: "A",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("name") });
        expect(mocks.employeeService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "createMessage", {
            confirmed: true,
            title: "공지",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("text") });
        expect(mocks.messageService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "updateMessage", {
            confirmed: true,
            messageId: 1,
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("title") });
        expect(mocks.messageService.update).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "createAndSendContract", {
            confirmed: true,
            clientId: 1,
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("areaId") });
        expect(mocks.areaTemplateService.findByArea).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "getClientsByFilter", {
            filter: "everything",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("filter") });
        expect(mocks.clientService.findByFilter).not.toHaveBeenCalled();
    });

    it("should reject malformed date strings before mutation services run", async () => {
        const { executor, mocks } = createExecutor();

        await expect(executor.execute("branch-1", "createClient", {
            confirmed: true,
            name: "김산모",
            primaryEmployeeId: 1,
            careCenter: false,
            voucherClient: true,
            startDate: "2026-02-31",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("startDate") });
        expect(mocks.clientService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "createClient", {
            confirmed: true,
            name: "김산모",
            primaryEmployeeId: 1,
            careCenter: false,
            voucherClient: true,
            birthday: "2026-01-01",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("birthday") });
        expect(mocks.clientService.create).not.toHaveBeenCalled();

        await expect(executor.execute("branch-1", "createEmployee", {
            confirmed: true,
            name: "박관리",
            phone: "010-0000-0000",
            grade: "A",
            companyRegisteredDate: "tomorrow",
        })).resolves.toMatchObject({ success: false, error: expect.stringContaining("companyRegisteredDate") });
        expect(mocks.employeeService.create).not.toHaveBeenCalled();
    });
});
