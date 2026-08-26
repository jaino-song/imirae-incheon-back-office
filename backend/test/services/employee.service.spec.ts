import { Test, TestingModule } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { EmployeeService } from "application/services/employee.service";
import {
    ChangeEmployeeOpenStatusUsecase,
    CreateEmployeeUsecase,
    DeleteEmployeeUsecase,
    FindEmployeeByIdUsecase,
    ListEmployeesByGradeUsecase,
    ListEmployeesByOpenStatusUsecase,
    ListEmployeesByRegisteredDateRangeUsecase,
    ListEmployeesByRegisteredDateUsecase,
    ListEmployeesByWorkAreaUsecase,
    ListActiveClientsByEmployeeUsecase,
    ListWorkHistoryByEmployeeUsecase,
    ListEmployeesOpenToNextWorkUsecase,
    ListEmployeesUsecase,
    UpdateEmployeeUsecase,
} from "application/usecases/employee";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { EmployeeFactory } from "../utils";

describe("EmployeeService", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================
    let service: EmployeeService;

    // Mock use cases
    let createUsecase: jest.Mocked<CreateEmployeeUsecase>;
    let findByIdUsecase: jest.Mocked<FindEmployeeByIdUsecase>;
    let updateUsecase: jest.Mocked<UpdateEmployeeUsecase>;
    let deleteUsecase: jest.Mocked<DeleteEmployeeUsecase>;
    let listUsecase: jest.Mocked<ListEmployeesUsecase>;
    let listByWorkAreaUsecase: jest.Mocked<ListEmployeesByWorkAreaUsecase>;
    let listByGradeUsecase: jest.Mocked<ListEmployeesByGradeUsecase>;
    let listByOpenStatusUsecase: jest.Mocked<ListEmployeesByOpenStatusUsecase>;
    let listByRegisteredDateUsecase: jest.Mocked<ListEmployeesByRegisteredDateUsecase>;
    let listByRegisteredDateRangeUsecase: jest.Mocked<ListEmployeesByRegisteredDateRangeUsecase>;
    let changeOpenStatusUsecase: jest.Mocked<ChangeEmployeeOpenStatusUsecase>;
    let listOpenToNextWorkUsecase: jest.Mocked<ListEmployeesOpenToNextWorkUsecase>;
    let employeeRepository: jest.Mocked<Pick<IEmployeeRepository, "findByPhone">>;

    const branchId = "org-1";

    beforeEach(async () => {
        // Create mock implementations
        const mockCreateUsecase = { execute: jest.fn() };
        const mockFindByIdUsecase = { execute: jest.fn() };
        const mockUpdateUsecase = { execute: jest.fn() };
        const mockDeleteUsecase = { execute: jest.fn() };
        const mockListUsecase = { execute: jest.fn() };
        const mockListByWorkAreaUsecase = { execute: jest.fn() };
        const mockListByGradeUsecase = { execute: jest.fn() };
        const mockListByOpenStatusUsecase = { execute: jest.fn() };
        const mockListByRegisteredDateUsecase = { execute: jest.fn() };
        const mockListByRegisteredDateRangeUsecase = { execute: jest.fn() };
        const mockChangeOpenStatusUsecase = { execute: jest.fn() };
        const mockListOpenToNextWorkUsecase = { execute: jest.fn() };
        const mockEmployeeRepository = { findByPhone: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EmployeeService,
                { provide: CreateEmployeeUsecase, useValue: mockCreateUsecase },
                { provide: FindEmployeeByIdUsecase, useValue: mockFindByIdUsecase },
                { provide: UpdateEmployeeUsecase, useValue: mockUpdateUsecase },
                { provide: DeleteEmployeeUsecase, useValue: mockDeleteUsecase },
                { provide: ListEmployeesUsecase, useValue: mockListUsecase },
                { provide: ListEmployeesByWorkAreaUsecase, useValue: mockListByWorkAreaUsecase },
                { provide: ListEmployeesByGradeUsecase, useValue: mockListByGradeUsecase },
                { provide: ListEmployeesByOpenStatusUsecase, useValue: mockListByOpenStatusUsecase },
                { provide: ListEmployeesByRegisteredDateUsecase, useValue: mockListByRegisteredDateUsecase },
                { provide: ListEmployeesByRegisteredDateRangeUsecase, useValue: mockListByRegisteredDateRangeUsecase },
                { provide: ChangeEmployeeOpenStatusUsecase, useValue: mockChangeOpenStatusUsecase },
                { provide: ListEmployeesOpenToNextWorkUsecase, useValue: mockListOpenToNextWorkUsecase },
                { provide: ListActiveClientsByEmployeeUsecase, useValue: { execute: jest.fn() } },
                { provide: ListWorkHistoryByEmployeeUsecase, useValue: { execute: jest.fn() } },
                { provide: EMPLOYEE_REPOSITORY, useValue: mockEmployeeRepository },
            ],
        }).compile();

        service = module.get<EmployeeService>(EmployeeService);
        createUsecase = module.get(CreateEmployeeUsecase);
        findByIdUsecase = module.get(FindEmployeeByIdUsecase);
        updateUsecase = module.get(UpdateEmployeeUsecase);
        deleteUsecase = module.get(DeleteEmployeeUsecase);
        listUsecase = module.get(ListEmployeesUsecase);
        listByWorkAreaUsecase = module.get(ListEmployeesByWorkAreaUsecase);
        listByGradeUsecase = module.get(ListEmployeesByGradeUsecase);
        listByOpenStatusUsecase = module.get(ListEmployeesByOpenStatusUsecase);
        listByRegisteredDateUsecase = module.get(ListEmployeesByRegisteredDateUsecase);
        listByRegisteredDateRangeUsecase = module.get(ListEmployeesByRegisteredDateRangeUsecase);
        changeOpenStatusUsecase = module.get(ChangeEmployeeOpenStatusUsecase);
        listOpenToNextWorkUsecase = module.get(ListEmployeesOpenToNextWorkUsecase);
        employeeRepository = module.get(EMPLOYEE_REPOSITORY);
    });

    // ============================================
    // checkPhoneExists
    // ============================================
    describe("checkPhoneExists", () => {
        it("should check duplicate phones through the employee repository only", async () => {
            const employee = EmployeeFactory.create({ id: 1, phone: "010-1234-5678" });
            employeeRepository.findByPhone.mockResolvedValue(employee);

            const result = await service.checkPhoneExists(branchId, "010-1234-5678");

            expect(result).toBe(true);
            expect(employeeRepository.findByPhone).toHaveBeenCalledWith(branchId, "01012345678");
        });

        it("should return false without querying when the phone is invalid", async () => {
            const result = await service.checkPhoneExists(branchId, "1234");

            expect(result).toBe(false);
            expect(employeeRepository.findByPhone).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        it("should map a branch phone unique conflict to 409", async () => {
            const error = new Prisma.PrismaClientKnownRequestError("duplicate", {
                code: "P2002",
                clientVersion: "test",
                meta: { target: ["branch_id", "phone"] },
            });
            createUsecase.execute.mockRejectedValue(error);

            await expect(service.create(branchId, {
                name: "중복 직원",
                workArea: ["서울"],
                phone: "010-1234-5678",
                grade: "베스트",
                openToNextWork: true,
            })).rejects.toMatchObject({
                status: 409,
                response: { statusCode: 409, code: "P2002", error: "Conflict", field: "phone" },
            });
        });
        it("should delegate to CreateEmployeeUsecase with all parameters", async () => {
            // Arrange
            const params = {
                name: "테스트 직원",
                workArea: ["인천 연수구"],
                phone: "010-1234-5678",
                grade: "프리미엄",
                openToNextWork: true,
            };
            const mockEmployee = EmployeeFactory.create({ id: 1, ...params });
            createUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            const result = await service.create(branchId, params);

            // Assert
            expect(createUsecase.execute).toHaveBeenCalledWith(
                branchId,
                params.name,
                params.workArea,
                params.phone,
                params.grade,
                params.openToNextWork,
                undefined,
                undefined,
            );
            expect(result).toBe(mockEmployee);
        });

        it("should convert string registeredDate to Date", async () => {
            // Arrange
            const params = {
                name: "테스트 직원",
                workArea: ["서울"],
                phone: "010-0000-0000",
                grade: "베스트",
                openToNextWork: false,
                registeredDate: "2024-06-15",
            };
            const mockEmployee = EmployeeFactory.create({ id: 1 });
            createUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            await service.create(branchId, params);

            // Assert
            expect(createUsecase.execute).toHaveBeenCalledWith(
                branchId,
                params.name,
                params.workArea,
                params.phone,
                params.grade,
                params.openToNextWork,
                new Date("2024-06-15"),
                undefined,
            );
        });

        it("should handle missing registeredDate", async () => {
            // Arrange
            const params = {
                name: "테스트 직원",
                workArea: ["서울"],
                phone: "010-0000-0000",
                grade: "베스트",
                openToNextWork: false,
            };
            const mockEmployee = EmployeeFactory.create({ id: 1 });
            createUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            await service.create(branchId, params);

            // Assert
            expect(createUsecase.execute).toHaveBeenCalledWith(
                branchId,
                params.name,
                params.workArea,
                params.phone,
                params.grade,
                params.openToNextWork,
                undefined,
                undefined,
            );
        });
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        it("should delegate to FindEmployeeByIdUsecase", async () => {
            // Arrange
            const mockEmployee = EmployeeFactory.create({ id: 5 });
            findByIdUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            const result = await service.findById(branchId, 5);

            // Assert
            expect(findByIdUsecase.execute).toHaveBeenCalledWith(branchId, 5);
            expect(result).toBe(mockEmployee);
        });

        it("should return null when employee not found", async () => {
            // Arrange
            findByIdUsecase.execute.mockResolvedValue(null);

            // Act
            const result = await service.findById(branchId, 999);

            // Assert
            expect(result).toBeNull();
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        it("should map a branch phone unique conflict to 409", async () => {
            const error = new Prisma.PrismaClientKnownRequestError("duplicate", {
                code: "P2002",
                clientVersion: "test",
                meta: { target: ["branchId", "phone"] },
            });
            updateUsecase.execute.mockRejectedValue(error);

            await expect(service.update(branchId, 3, { phone: "010-1234-5678" })).rejects.toMatchObject({
                status: 409,
                response: { statusCode: 409, code: "P2002", error: "Conflict", field: "phone" },
            });
        });
        it("should delegate to UpdateEmployeeUsecase with id and params", async () => {
            // Arrange
            const updateParams = {
                name: "수정된 이름",
                grade: "스탠다드",
            };
            const mockEmployee = EmployeeFactory.create({ id: 3, ...updateParams });
            updateUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            const result = await service.update(branchId, 3, updateParams);

            // Assert
            expect(updateUsecase.execute).toHaveBeenCalledWith(branchId, 3, updateParams);
            expect(result).toBe(mockEmployee);
        });

        it("should handle partial update params", async () => {
            // Arrange
            const partialParams = { phone: "010-9999-0000" };
            const mockEmployee = EmployeeFactory.create({ id: 7 });
            updateUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            await service.update(branchId, 7, partialParams);

            // Assert
            expect(updateUsecase.execute).toHaveBeenCalledWith(branchId, 7, partialParams);
        });

        it("should handle empty update params", async () => {
            // Arrange
            const mockEmployee = EmployeeFactory.create({ id: 1 });
            updateUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            await service.update(branchId, 1, {});

            // Assert
            expect(updateUsecase.execute).toHaveBeenCalledWith(branchId, 1, {});
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        it("should delegate to DeleteEmployeeUsecase", async () => {
            // Arrange
            deleteUsecase.execute.mockResolvedValue(undefined);

            // Act
            await service.delete(branchId, 10);

            // Assert
            expect(deleteUsecase.execute).toHaveBeenCalledWith(branchId, 10);
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        it("should delegate to ListEmployeesUsecase", async () => {
            // Arrange
            const mockEmployees = EmployeeFactory.createMany(3);
            listUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findAll(branchId);

            // Assert
            expect(listUsecase.execute).toHaveBeenCalledWith(branchId);
            expect(result).toBe(mockEmployees);
        });

        it("should return empty array when no employees", async () => {
            // Arrange
            listUsecase.execute.mockResolvedValue([]);

            // Act
            const result = await service.findAll(branchId);

            // Assert
            expect(result).toEqual([]);
        });
    });

    // ============================================
    // findByWorkArea
    // ============================================
    describe("findByWorkArea", () => {
        it("should delegate to ListEmployeesByWorkAreaUsecase", async () => {
            // Arrange
            const mockEmployees = EmployeeFactory.createMany(2);
            listByWorkAreaUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByWorkArea(branchId, "인천 연수구");

            // Assert
            expect(listByWorkAreaUsecase.execute).toHaveBeenCalledWith(branchId, "인천 연수구");
            expect(result).toBe(mockEmployees);
        });
    });

    // ============================================
    // findByGrade
    // ============================================
    describe("findByGrade", () => {
        it("should delegate to ListEmployeesByGradeUsecase", async () => {
            // Arrange
            const mockEmployees = EmployeeFactory.createMany(2);
            listByGradeUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByGrade(branchId, "프리미엄");

            // Assert
            expect(listByGradeUsecase.execute).toHaveBeenCalledWith(branchId, "프리미엄");
            expect(result).toBe(mockEmployees);
        });

    });

    // ============================================
    // findByOpenStatus
    // ============================================
    describe("findByOpenStatus", () => {
        it("should delegate to ListEmployeesByOpenStatusUsecase with true", async () => {
            // Arrange
            const mockEmployees = [EmployeeFactory.createAvailable({ id: 1 })];
            listByOpenStatusUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByOpenStatus(branchId, true);

            // Assert
            expect(listByOpenStatusUsecase.execute).toHaveBeenCalledWith(branchId, true);
            expect(result).toBe(mockEmployees);
        });

        it("should delegate to ListEmployeesByOpenStatusUsecase with false", async () => {
            // Arrange
            const mockEmployees = [EmployeeFactory.createUnavailable({ id: 1 })];
            listByOpenStatusUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByOpenStatus(branchId, false);

            // Assert
            expect(listByOpenStatusUsecase.execute).toHaveBeenCalledWith(branchId, false);
            expect(result).toBe(mockEmployees);
        });
    });

    // ============================================
    // findByRegisteredDate
    // ============================================
    describe("findByRegisteredDate", () => {
        it("should delegate to ListEmployeesByRegisteredDateUsecase", async () => {
            // Arrange
            const date = new Date("2024-01-15");
            const mockEmployees = EmployeeFactory.createMany(2);
            listByRegisteredDateUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByRegisteredDate(branchId, date);

            // Assert
            expect(listByRegisteredDateUsecase.execute).toHaveBeenCalledWith(branchId, date);
            expect(result).toBe(mockEmployees);
        });
    });

    // ============================================
    // findByRegisteredDateRange
    // ============================================
    describe("findByRegisteredDateRange", () => {
        it("should delegate to ListEmployeesByRegisteredDateRangeUsecase", async () => {
            // Arrange
            const start = new Date("2024-01-01");
            const end = new Date("2024-01-31");
            const mockEmployees = EmployeeFactory.createMany(3);
            listByRegisteredDateRangeUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findByRegisteredDateRange(branchId, start, end);

            // Assert
            expect(listByRegisteredDateRangeUsecase.execute).toHaveBeenCalledWith(branchId, start, end);
            expect(result).toBe(mockEmployees);
        });
    });

    // ============================================
    // changeOpenStatus
    // ============================================
    describe("changeOpenStatus", () => {
        it("should delegate to ChangeEmployeeOpenStatusUsecase", async () => {
            // Arrange
            const mockEmployee = EmployeeFactory.create({ id: 5, openToNextWork: false });
            changeOpenStatusUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            const result = await service.changeOpenStatus(branchId, 5, false);

            // Assert
            expect(changeOpenStatusUsecase.execute).toHaveBeenCalledWith(branchId, 5, false);
            expect(result).toBe(mockEmployee);
        });

        it("should change status to true", async () => {
            // Arrange
            const mockEmployee = EmployeeFactory.createAvailable({ id: 3 });
            changeOpenStatusUsecase.execute.mockResolvedValue(mockEmployee);

            // Act
            const result = await service.changeOpenStatus(branchId, 3, true);

            // Assert
            expect(changeOpenStatusUsecase.execute).toHaveBeenCalledWith(branchId, 3, true);
            expect(result.openToNextWork).toBe(true);
        });
    });

    // ============================================
    // findAllOpenToNextWork
    // ============================================
    describe("findAllOpenToNextWork", () => {
        it("should delegate to ListEmployeesOpenToNextWorkUsecase", async () => {
            // Arrange
            const mockEmployees = [
                EmployeeFactory.createAvailable({ id: 1 }),
                EmployeeFactory.createAvailable({ id: 2 }),
            ];
            listOpenToNextWorkUsecase.execute.mockResolvedValue(mockEmployees);

            // Act
            const result = await service.findAllOpenToNextWork(branchId);

            // Assert
            expect(listOpenToNextWorkUsecase.execute).toHaveBeenCalledWith(branchId);
            expect(result).toBe(mockEmployees);
        });

        it("should return empty array when no available employees", async () => {
            // Arrange
            listOpenToNextWorkUsecase.execute.mockResolvedValue([]);

            // Act
            const result = await service.findAllOpenToNextWork(branchId);

            // Assert
            expect(result).toEqual([]);
        });
    });
});
