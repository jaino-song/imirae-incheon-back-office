import { SbEmployeeRepository } from "infrastructure/database/repositories/sb.employee.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { EmployeeEntity } from "domain/entities/employee.entity";

describe("SbEmployeeRepository", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const createMockPrismaEmployee = () => ({
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
    });

    const createMockPrismaEmployeeSchedule = () => ({
        count: jest.fn(),
        findMany: jest.fn(),
    });

    const createEmployeeRow = (overrides = {}) => ({
        id: 1,
        name: "Alice",
        workArea: ["Incheon"],
        phone: "010-1234-5678",
        grade: "프리미엄",
        openToNextWork: true,
        companyRegisteredDate: new Date("2024-01-01T00:00:00.000Z"),
        primaryEmployeeSchedules: [],
        secondaryEmployeeSchedules: [],
        ...overrides,
    });

    interface EmployeeParams {
        id?: number;
        name?: string;
        workArea?: string[];
        phone?: string;
        grade?: string;
        openToNextWork?: boolean;
        registeredDate?: Date;
    }

    const createEmployeeEntity = (overrides: EmployeeParams = {}) => {
        return new EmployeeEntity(
            overrides.id ?? 0,
            overrides.name ?? "Test Employee",
            overrides.workArea ?? ["Seoul"],
            overrides.phone ?? "010-0000-0000",
            overrides.grade ?? "베스트",
            overrides.openToNextWork ?? false,
            overrides.registeredDate ?? new Date("2024-02-01T00:00:00.000Z"),
        );
    };

    const branchId = "org-1";

    let employeeModel: ReturnType<typeof createMockPrismaEmployee>;
    let employeeScheduleModel: ReturnType<typeof createMockPrismaEmployeeSchedule>;
    let prisma: PrismaService;
    let repository: SbEmployeeRepository;

    beforeEach(() => {
        employeeModel = createMockPrismaEmployee();
        employeeScheduleModel = createMockPrismaEmployeeSchedule();
        prisma = {
            employee: employeeModel,
            employee_schedule: employeeScheduleModel,
        } as unknown as PrismaService;
        repository = new SbEmployeeRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        describe("given an employee exists with the specified id", () => {
            it("should return the mapped EmployeeEntity", async () => {
                // Arrange
                const row = createEmployeeRow();
                employeeModel.findFirst.mockResolvedValue(row);

                // Act
                const result = await repository.findById(branchId, 1);

                // Assert
                expect(employeeModel.findFirst).toHaveBeenCalledWith({
                    where: { id: 1, branchId: branchId },
                });
                expect(result).toBeInstanceOf(EmployeeEntity);
                expect(result).toMatchObject({
                    id: 1,
                    name: "Alice",
                    workArea: ["Incheon"],
                    phone: "010-1234-5678",
                    grade: "프리미엄",
                    openToNextWork: true,
                });
            });

        });

        describe("given no employee exists with the specified id", () => {
            it("should return null", async () => {
                // Arrange
                employeeModel.findFirst.mockResolvedValue(null);

                // Act
                const result = await repository.findById(branchId, 999);

                // Assert
                expect(employeeModel.findFirst).toHaveBeenCalledWith({
                    where: { id: 999, branchId: branchId },
                });
                expect(result).toBeNull();
            });
        });
    });

    // ============================================
    // findByPhone
    // ============================================
    describe("findByPhone", () => {
        it("should return the employee whose normalized phone matches", async () => {
            const row = createEmployeeRow({ id: 3, phone: "010-1234-5678" });
            employeeModel.findMany.mockResolvedValue([
                createEmployeeRow({ id: 2, phone: "010-0000-0000" }),
                { id: row.id, phone: row.phone },
            ]);
            employeeModel.findFirst.mockResolvedValue(row);

            const result = await repository.findByPhone(branchId, "01012345678");

            expect(employeeModel.findMany).toHaveBeenCalledWith({
                where: { branchId },
                select: { id: true, phone: true },
            });
            expect(employeeModel.findFirst).toHaveBeenCalledWith({
                where: { id: 3, branchId },
            });
            expect(result).toMatchObject({ id: 3, phone: "010-1234-5678" });
        });

        it("should return null when no employee phone matches", async () => {
            employeeModel.findMany.mockResolvedValue([
                { id: 2, phone: "010-0000-0000" },
            ]);

            const result = await repository.findByPhone(branchId, "01012345678");

            expect(result).toBeNull();
            expect(employeeModel.findFirst).not.toHaveBeenCalled();
        });
    });

    describe("findActiveClientsByEmployee", () => {
        it("should query only current non-replaced assignments and map primary and secondary roles", async () => {
            employeeScheduleModel.findMany.mockResolvedValue([
                {
                    primaryEmployeeId: 7,
                    secondaryEmployeeId: null,
                    startDate: new Date("2026-07-01T00:00:00.000Z"),
                    endDate: new Date("2026-12-31T00:00:00.000Z"),
                    client: {
                        id: 11,
                        name: "박서연",
                        serviceStatus: "active",
                        startDate: new Date("2026-07-01T00:00:00.000Z"),
                        endDate: new Date("2026-12-31T00:00:00.000Z"),
                    },
                },
                {
                    primaryEmployeeId: 3,
                    secondaryEmployeeId: 7,
                    startDate: new Date("2026-08-01T00:00:00.000Z"),
                    endDate: new Date("2027-01-31T00:00:00.000Z"),
                    client: {
                        id: 12,
                        name: "김민지",
                        serviceStatus: "waiting",
                        startDate: new Date("2026-08-01T00:00:00.000Z"),
                        endDate: null,
                    },
                },
            ]);

            const result = await repository.findActiveClientsByEmployee(branchId, 7);

            expect(employeeScheduleModel.findMany).toHaveBeenCalledWith({
                where: {
                    branchId,
                    replaced: false,
                    endDate: { gte: expect.any(Date) },
                    OR: [
                        { primaryEmployeeId: 7 },
                        { secondaryEmployeeId: 7 },
                    ],
                },
                select: {
                    primaryEmployeeId: true,
                    secondaryEmployeeId: true,
                    client: {
                        select: {
                            id: true,
                            name: true,
                            serviceStatus: true,
                            startDate: true,
                            endDate: true,
                        },
                    },
                },
                orderBy: { startDate: "asc" },
            });
            expect(result).toEqual([
                {
                    clientId: 11,
                    clientName: "박서연",
                    role: "primary",
                    startDate: new Date("2026-07-01T00:00:00.000Z"),
                    endDate: new Date("2026-12-31T00:00:00.000Z"),
                    serviceStatus: "active",
                },
                {
                    clientId: 12,
                    clientName: "김민지",
                    role: "secondary",
                    startDate: new Date("2026-08-01T00:00:00.000Z"),
                    endDate: null,
                    serviceStatus: "waiting",
                },
            ]);
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        describe("given employees exist in the database", () => {
            it("should return all employees as EmployeeEntity array with status", async () => {
                // Arrange
                const rows = [
                    createEmployeeRow({ id: 1, name: "Alice", openToNextWork: true }),
                    createEmployeeRow({ id: 2, name: "Bob", openToNextWork: true }),
                ];
                employeeModel.findMany.mockResolvedValue(rows);

                // Act
                const result = await repository.findAll(branchId);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        include: expect.objectContaining({
                            primaryEmployeeSchedules: expect.any(Object),
                            secondaryEmployeeSchedules: expect.any(Object),
                        }),
                        where: { branchId: branchId, deletedAt: null },
                    }),
                );
                expect(result).toHaveLength(2);
                expect(result[0]).toMatchObject({ id: 1, name: "Alice", status: "available" });
                expect(result[1]).toMatchObject({ id: 2, name: "Bob", status: "available" });
            });
        });

        describe("given no employees exist", () => {
            it("should return an empty array", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([]);

                // Act
                const result = await repository.findAll(branchId);

                // Assert
                expect(result).toEqual([]);
            });
        });

        describe("status computation", () => {
            it.each([
                ["active primary schedule and open", { openToNextWork: true, primaryEmployeeSchedules: [{ id: 1 }] }, "working", true],
                ["active primary schedule and closed", { openToNextWork: false, primaryEmployeeSchedules: [{ id: 1 }] }, "working", false],
                ["active secondary schedule and open", { openToNextWork: true, secondaryEmployeeSchedules: [{ id: 2 }] }, "working", true],
                ["active secondary schedule and closed", { openToNextWork: false, secondaryEmployeeSchedules: [{ id: 2 }] }, "working", false],
                ["no active schedule and open", { openToNextWork: true }, "available", true],
                ["no active schedule and closed", { openToNextWork: false }, "unavailable", false],
            ] as const)(
                "should derive %s from active assignment before availability",
                async (_caseName, overrides, expectedStatus, expectedOpenToNextWork) => {
                    const row = createEmployeeRow(overrides);
                    employeeModel.findMany.mockResolvedValue([row]);

                    const result = await repository.findAll(branchId);

                    expect(result).toHaveLength(1);
                    expect(result[0]).toMatchObject({
                        status: expectedStatus,
                        openToNextWork: expectedOpenToNextWork,
                    });
                },
            );

            it("should request only current unreplaced schedules and exclude soft-deleted employees", async () => {
                const activeRow = createEmployeeRow({ id: 1, openToNextWork: true });
                const deletedRow = createEmployeeRow({ id: 2, deletedAt: new Date("2026-01-01T00:00:00.000Z") });
                employeeModel.findMany.mockResolvedValue([activeRow]);

                const result = await repository.findAll(branchId);

                const query = employeeModel.findMany.mock.calls[0]?.[0];
                expect(query).toEqual({
                    where: { branchId, deletedAt: null },
                    include: {
                        primaryEmployeeSchedules: {
                            where: {
                                startDate: { lte: expect.any(Date) },
                                endDate: { gte: expect.any(Date) },
                                replaced: false,
                            },
                            take: 1,
                        },
                        secondaryEmployeeSchedules: {
                            where: {
                                startDate: { lte: expect.any(Date) },
                                endDate: { gte: expect.any(Date) },
                                replaced: false,
                            },
                            take: 1,
                        },
                    },
                });
                expect(result.map((employee) => employee.id)).toEqual([activeRow.id]);
                expect(result.map((employee) => employee.id)).not.toContain(deletedRow.id);
            });

            it("should treat ended and replaced schedules excluded by the active query as no active assignment", async () => {
                const row = createEmployeeRow({
                    openToNextWork: false,
                    primaryEmployeeSchedules: [],
                    secondaryEmployeeSchedules: [],
                });
                employeeModel.findMany.mockResolvedValue([row]);

                const result = await repository.findAll(branchId);

                expect(result[0]).toMatchObject({
                    status: "unavailable",
                    openToNextWork: false,
                });
                const query = employeeModel.findMany.mock.calls[0]?.[0];
                expect(query).toEqual(expect.objectContaining({
                    include: expect.objectContaining({
                        primaryEmployeeSchedules: expect.objectContaining({
                            where: expect.objectContaining({ replaced: false }),
                        }),
                        secondaryEmployeeSchedules: expect.objectContaining({
                            where: expect.objectContaining({ replaced: false }),
                        }),
                    }),
                }));
            });
        });
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        describe("given a valid EmployeeEntity", () => {
            it("should persist employee and return created entity", async () => {
                // Arrange
                const entity = createEmployeeEntity();
                const createdRow = createEmployeeRow({
                    id: 5,
                    name: "Test Employee",
                    workArea: ["Seoul"],
                    phone: "010-0000-0000",
                    grade: "베스트",
                    openToNextWork: false,
                });
                employeeModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(branchId, entity);

                // Assert
                expect(employeeModel.findFirst).not.toHaveBeenCalled();
                expect(employeeModel.create).toHaveBeenCalledWith({
                    data: {
                        name: "Test Employee",
                        workArea: ["Seoul"],
                        phone: "010-0000-0000",
                        grade: "베스트",
                        openToNextWork: false,
                        companyRegisteredDate: new Date("2024-02-01T00:00:00.000Z"),
                        birthday: null,
                        branchId: branchId,
                    },
                });
                expect(result).toMatchObject({ id: 5, name: "Test Employee" });
            });
        });

        describe("given an employee id is assigned by the database", () => {
            it("should return the generated id without inserting an explicit id", async () => {
                // Arrange
                const entity = createEmployeeEntity();
                const createdRow = createEmployeeRow({ id: 1, name: "Test Employee" });
                employeeModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(branchId, entity);

                // Assert
                expect(employeeModel.create).toHaveBeenCalledWith({
                    data: expect.not.objectContaining({ id: expect.anything() }),
                });
                expect(result.id).toBe(1);
            });
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        describe("given an existing EmployeeEntity with changes", () => {
            it("should update employee with correct data", async () => {
                // Arrange
                const entity = new EmployeeEntity(
                    7,
                    "Charlie",
                    ["Busan"],
                    "010-2222-0000",
                    "스탠다드",
                    true,
                    new Date("2023-12-31T00:00:00.000Z"),
                );
                const updatedRow = createEmployeeRow({
                    id: 7,
                    name: "Charlie",
                    workArea: ["Busan"],
                    phone: "010-2222-0000",
                    grade: "스탠다드",
                });
                employeeModel.updateMany.mockResolvedValue({ count: 1 });
                employeeModel.findFirst.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(branchId, entity);

                // Assert
                expect(employeeModel.updateMany).toHaveBeenCalledWith({
                    where: { id: 7, branchId: branchId, deletedAt: null },
                    data: {
                        name: "Charlie",
                        workArea: ["Busan"],
                        phone: "010-2222-0000",
                        grade: "스탠다드",
                        openToNextWork: true,
                        birthday: null,
                    },
                });
                expect(result).toMatchObject({ id: 7, workArea: ["Busan"] });
            });
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        describe("given a valid employee id", () => {
            it("should set deletedAt without hard deleting the employee", async () => {
                // Arrange
                employeeModel.updateMany.mockResolvedValue({ count: 1 });

                // Act
                await repository.delete(branchId, 3);

                // Assert
                expect(employeeModel.updateMany).toHaveBeenCalledWith({
                    where: { id: 3, branchId: branchId, deletedAt: null },
                    data: { deletedAt: expect.any(Date) },
                });
                expect(employeeModel.deleteMany).not.toHaveBeenCalled();
            });
        });
    });

    describe("hasActiveAssignments", () => {
        it("should count current unreplaced primary and secondary assignments", async () => {
            employeeScheduleModel.count.mockResolvedValue(1);

            const result = await repository.hasActiveAssignments(branchId, 3);

            expect(result).toBe(true);
            expect(employeeScheduleModel.count).toHaveBeenCalledWith({
                where: {
                    branchId,
                    replaced: false,
                    endDate: { gte: expect.any(Date) },
                    OR: [
                        { primaryEmployeeId: 3 },
                        { secondaryEmployeeId: 3 },
                    ],
                },
            });
        });
    });

    // ============================================
    // Filter Methods
    // ============================================
    describe("findByWorkArea", () => {
        describe("given a work area filter", () => {
            it("should query with correct where clause", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([createEmployeeRow()]);

                // Act
                await repository.findByWorkArea(branchId, "Incheon");

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { workArea: { has: "Incheon" }, branchId: branchId, deletedAt: null },
                });
            });
        });
    });

    describe("findByGrade", () => {
        describe("given a grade filter", () => {
            it("should query with correct where clause", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([createEmployeeRow()]);

                // Act
                await repository.findByGrade(branchId, "프리미엄");

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { grade: "프리미엄", branchId: branchId, deletedAt: null },
                });
            });

        });

        describe("given different grades", () => {
            it.each(["프리미엄", "베스트", "스탠다드", "D"])("should filter by grade %s", async (grade) => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findByGrade(branchId, grade);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { grade, branchId: branchId, deletedAt: null },
                });
            });
        });
    });

    describe("findByOpenToNextWork", () => {
        describe("given openToNextWork is true", () => {
            it("should filter employees available for work", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([createEmployeeRow()]);

                // Act
                await repository.findByOpenToNextWork(branchId, true);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { openToNextWork: true, branchId: branchId, deletedAt: null },
                });
            });
        });

        describe("given openToNextWork is false", () => {
            it("should filter employees not available for work", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findByOpenToNextWork(branchId, false);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { openToNextWork: false, branchId: branchId, deletedAt: null },
                });
            });
        });
    });

    describe("findByRegisteredDate", () => {
        describe("given a specific date", () => {
            it("should query with date range for that day", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([createEmployeeRow()]);
                const date = new Date("2024-05-05T12:00:00.000Z");

                // Act
                await repository.findByRegisteredDate(branchId, date);

                // Assert
                const call = employeeModel.findMany.mock.calls[0][0];
                expect(call.where.companyRegisteredDate.gte).toBeInstanceOf(Date);
                expect(call.where.companyRegisteredDate.lte).toBeInstanceOf(Date);
                expect(call.where.companyRegisteredDate.gte.getTime())
                    .toBeLessThanOrEqual(call.where.companyRegisteredDate.lte.getTime());
            });
        });
    });

    describe("findByRegisteredDateRange", () => {
        describe("given a date range", () => {
            it("should query with correct date bounds", async () => {
                // Arrange
                employeeModel.findMany.mockResolvedValue([createEmployeeRow()]);
                const start = new Date("2024-01-01T00:00:00.000Z");
                const end = new Date("2024-01-31T23:59:59.000Z");

                // Act
                await repository.findByRegisteredDateRange(branchId, start, end);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: {
                        companyRegisteredDate: {
                            gte: start,
                            lte: end,
                        },
                        branchId: branchId,
                        deletedAt: null,
                    },
                });
            });
        });
    });

    // ============================================
    // Status Update Methods
    // ============================================
    describe("changeOpenToNextWork", () => {
        describe("given an employee id and new status", () => {
            it("should update the openToNextWork field", async () => {
                // Arrange
                employeeModel.updateMany.mockResolvedValue({ count: 1 });

                // Act
                await repository.changeOpenToNextWork(branchId, 10, false);

                // Assert
                expect(employeeModel.updateMany).toHaveBeenCalledWith({
                    where: { id: 10, branchId: branchId, deletedAt: null },
                    data: { openToNextWork: false },
                });
            });
        });

        describe("given toggling status to true", () => {
            it("should set openToNextWork to true", async () => {
                // Arrange
                employeeModel.updateMany.mockResolvedValue({ count: 1 });

                // Act
                await repository.changeOpenToNextWork(branchId, 15, true);

                // Assert
                expect(employeeModel.updateMany).toHaveBeenCalledWith({
                    where: { id: 15, branchId: branchId, deletedAt: null },
                    data: { openToNextWork: true },
                });
            });
        });
    });

    describe("findAllOpenToNextWork", () => {
        describe("when called", () => {
            it("should return all employees available for next work", async () => {
                // Arrange
                const rows = [
                    createEmployeeRow({ id: 1, openToNextWork: true }),
                    createEmployeeRow({ id: 2, openToNextWork: true }),
                ];
                employeeModel.findMany.mockResolvedValue(rows);

                // Act
                const result = await repository.findAllOpenToNextWork(branchId);

                // Assert
                expect(employeeModel.findMany).toHaveBeenCalledWith({
                    where: { openToNextWork: true, branchId: branchId, deletedAt: null },
                });
                expect(result).toHaveLength(2);
            });
        });
    });
});
