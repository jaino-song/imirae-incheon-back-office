import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientEntity } from "domain/entities/client.entity";
import { clearSchemaCapabilityCache } from "infrastructure/database/schema-capabilities";
import { clientAgentTargetVersion } from "application/usecases/client/client-agent-target";

describe("SbClientRepository", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================
    
    const createMockPrismaClient = () => ({
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
    });

    const createClientRow = (overrides = {}) => ({
        id: 1,
        name: "John Doe",
        address: "Incheon",
        phone: "010-1111-2222",
        type: "A",
        duration: 15,
        fullPrice: "100000",
        grant: "50000",
        actualPrice: "50000",
        startDate: new Date("2024-01-01T00:00:00.000Z"),
        endDate: new Date("2024-06-01T00:00:00.000Z"),
        careCenter: true,
        voucherClient: false,
        birthday: "900101",
        serviceStatus: "completed",
        breastPump: true,
        eDocId: null,
        dueDate: null,
        ...overrides,
    });

    const createClientEntity = (overrides = {}) => ClientEntity.create({
        name: "Test Client",
        address: "Test Address",
        phone: "010-0000-1111",
        type: "B",
        duration: 12,
        fullPrice: "120000",
        grant: "60000",
        actualPrice: "60000",
        startDate: new Date("2024-02-01T00:00:00.000Z"),
        endDate: new Date("2024-08-01T00:00:00.000Z"),
        careCenter: false,
        voucherClient: true,
        birthday: "950315",
        serviceStatus: "waiting",
        breastPump: false,
        eDocId: null,
        dueDate: null,
        birthDate: null,
        ...overrides,
    });

    const branchId = "org-1";

    let clientModel: ReturnType<typeof createMockPrismaClient>;
    let prisma: PrismaService;
    let repository: SbClientRepository;

    beforeEach(() => {
        // hasColumn() memoizes per (table, column) in a module-level cache, so it
        // must be cleared between tests — otherwise a column-absent test run
        // before a column-present test (or vice versa) would leak its cached
        // answer and silently pass/fail for the wrong reason.
        clearSchemaCapabilityCache();
        clientModel = createMockPrismaClient();
        prisma = {
            client: clientModel,
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
        } as unknown as PrismaService;
        repository = new SbClientRepository(prisma);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // findById
    // ============================================
    describe("findById", () => {
        describe("given a valid client id exists", () => {
            it("should return the mapped ClientEntity", async () => {
                // Arrange
                const row = createClientRow();
                clientModel.findFirst.mockResolvedValue(row);

                // Act
                const result = await repository.findById(branchId, 1);

                // Assert
                expect(clientModel.findFirst).toHaveBeenCalledTimes(1);
                expect(clientModel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 1, branchId: branchId },
                    select: expect.any(Object),
                }));
                expect(result).toBeInstanceOf(ClientEntity);
                expect(result).toMatchObject({
                    id: 1,
                    name: "John Doe",
                    address: "Incheon",
                    careCenter: true,
                    birthday: "900101",
                    serviceStatus: "completed",
                    breastPump: true,
                });
            });
        });

        describe("given a client id does not exist", () => {
            it("should return null", async () => {
                // Arrange
                clientModel.findFirst.mockResolvedValue(null);

                // Act
                const result = await repository.findById(branchId, 999);

                // Assert
                expect(clientModel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 999, branchId: branchId },
                    select: expect.any(Object),
                }));
                expect(result).toBeNull();
            });
        });
    });

    // ============================================
    // findAll
    // ============================================
    describe("findAll", () => {
        describe("given clients exist in the database", () => {
            it("should return all clients as ClientEntity array", async () => {
                // Arrange
                const rows = [
                    createClientRow({ id: 1, name: "John" }),
                    createClientRow({ id: 2, name: "Jane" }),
                ];
                clientModel.findMany.mockResolvedValue(rows);

                // Act
                const result = await repository.findAll(branchId);

                // Assert
                expect(clientModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { branchId: branchId },
                    select: expect.any(Object),
                }));
                expect(result).toHaveLength(2);
                expect(result[0]).toBeInstanceOf(ClientEntity);
                expect(result[0]).toMatchObject({ id: 1, name: "John" });
                expect(result[1]).toMatchObject({ id: 2, name: "Jane" });
            });
        });

        describe("given no clients exist", () => {
            it("should return an empty array", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);

                // Act
                const result = await repository.findAll(branchId);

                // Assert
                expect(result).toEqual([]);
            });
        });
    });

    // ============================================
    // findAllPaginated
    // ============================================
    describe("findAllPaginated", () => {
        describe("given page 1 with limit 10 and no search", () => {
            it("should return paginated result with correct metadata", async () => {
                // Arrange
                const rows = [
                    createClientRow({ id: 1, name: "John" }),
                    createClientRow({ id: 2, name: "Jane" }),
                ];
                clientModel.findMany.mockResolvedValue(rows);
                clientModel.count.mockResolvedValue(15);

                // Act
                const result = await repository.findAllPaginated(branchId, 1, 10);

                // Assert
                expect(clientModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { branchId: branchId },
                    skip: 0,
                    take: 10,
                    orderBy: { id: "desc" },
                    select: expect.any(Object),
                }));
                expect(clientModel.count).toHaveBeenCalledWith({
                    where: { branchId: branchId },
                });
                expect(result).toEqual({
                    data: expect.arrayContaining([
                        expect.objectContaining({ id: 1, name: "John" }),
                        expect.objectContaining({ id: 2, name: "Jane" }),
                    ]),
                    total: 15,
                    page: 1,
                    limit: 10,
                    totalPages: 2,
                });
            });
        });

        describe("given page 2 with limit 10", () => {
            it("should calculate correct skip offset", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);
                clientModel.count.mockResolvedValue(25);

                // Act
                await repository.findAllPaginated(branchId, 2, 10);

                // Assert
                expect(clientModel.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        skip: 10,
                        take: 10,
                    })
                );
            });
        });

        describe("given page 3 with limit 5", () => {
            it("should calculate correct skip offset for different page sizes", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);
                clientModel.count.mockResolvedValue(100);

                // Act
                await repository.findAllPaginated(branchId, 3, 5);

                // Assert
                expect(clientModel.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        skip: 10, // (3-1) * 5 = 10
                        take: 5,
                    })
                );
            });
        });

        describe("given a search term", () => {
            it("should apply search filter to name, address, and phone", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([createClientRow()]);
                clientModel.count.mockResolvedValue(1);

                const expectedWhere = {
                    OR: [
                        { name: { contains: "John", mode: "insensitive" } },
                        { address: { contains: "John", mode: "insensitive" } },
                        { phone: { contains: "John", mode: "insensitive" } },
                    ],
                    branchId: branchId,
                };

                // Act
                const result = await repository.findAllPaginated(branchId, 1, 10, "John");

                // Assert
                expect(clientModel.findMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: expectedWhere,
                    skip: 0,
                    take: 10,
                    orderBy: { id: "desc" },
                    select: expect.any(Object),
                }));
                expect(clientModel.count).toHaveBeenCalledWith({ where: expectedWhere });
                expect(result.data).toHaveLength(1);
                expect(result.total).toBe(1);
            });
        });

        describe("given no results found", () => {
            it("should return empty data with zero totals", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);
                clientModel.count.mockResolvedValue(0);

                // Act
                const result = await repository.findAllPaginated(branchId, 1, 10);

                // Assert
                expect(result).toEqual({
                    data: [],
                    total: 0,
                    page: 1,
                    limit: 10,
                    totalPages: 0,
                });
            });
        });

        describe("given total is exact multiple of limit", () => {
            it("should calculate totalPages correctly", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);
                clientModel.count.mockResolvedValue(20);

                // Act
                const result = await repository.findAllPaginated(branchId, 1, 10);

                // Assert
                expect(result.totalPages).toBe(2);
            });
        });

        describe("given total is not exact multiple of limit", () => {
            it("should round up totalPages", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);
                clientModel.count.mockResolvedValue(21);

                // Act
                const result = await repository.findAllPaginated(branchId, 1, 10);

                // Assert
                expect(result.totalPages).toBe(3);
            });
        });
    });

    // ============================================
    // create
    // ============================================
    describe("create", () => {
        const createTransaction = () => ({
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
            client: {
                create: jest.fn(),
            },
        });

        describe("given a valid ClientEntity", () => {
            it("should persist client with correct data mapping", async () => {
                // Arrange
                const entity = createClientEntity();
                const createdRow = createClientRow({
                    id: 5,
                    name: "Test Client",
                });
                clientModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(branchId, entity);

                // Assert
                expect(clientModel.create).toHaveBeenCalledWith(expect.objectContaining({
                    data: expect.objectContaining({
                        name: "Test Client",
                        address: "Test Address",
                        phone: "010-0000-1111",
                        type: "B",
                        duration: 12,
                        fullPrice: "120000",
                        grant: "60000",
                        actualPrice: "60000",
                        startDate: new Date("2024-02-01T00:00:00.000Z"),
                        endDate: new Date("2024-08-01T00:00:00.000Z"),
                        careCenter: false,
                        voucherClient: true,
                        birthday: "950315",
                        serviceStatus: "waiting",
                        breastPump: false,
                        eDocId: null,
                        dueDate: null,
                        birthDate: null,
                        branchId: branchId,
                    }),
                    select: expect.any(Object),
                }));
                expect(result).toBeInstanceOf(ClientEntity);
                expect(result.id).toBe(5);
            });
        });

        it("runs cold schema capability probes on the supplied transaction connection", async () => {
            const entity = createClientEntity();
            const transaction = createTransaction();
            transaction.client.create.mockResolvedValue(createClientRow({
                id: 15,
                name: "Test Client",
            }));

            await repository.create(branchId, entity, transaction as never);

            expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
            expect(transaction.$queryRawUnsafe).toHaveBeenCalledTimes(3);
        });

        describe("given entity with a birthDate", () => {
            it("should persist and return birthDate", async () => {
                // Arrange
                const birthDate = new Date("2026-08-05T00:00:00.000Z");
                const entity = createClientEntity({ birthDate });
                const createdRow = createClientRow({
                    id: 8,
                    birthDate,
                });
                clientModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(branchId, entity);

                // Assert
                expect(clientModel.create).toHaveBeenCalledWith(expect.objectContaining({
                    data: expect.objectContaining({
                        birthDate,
                    }),
                    select: expect.any(Object),
                }));
                expect(result.birthDate).toEqual(birthDate);
            });
        });

        describe("given entity with null optional fields", () => {
            it("should handle null values correctly", async () => {
                // Arrange
                const entity = createClientEntity({
                    address: null,
                    phone: null,
                    type: null,
                    birthday: null,
                    serviceStatus: null,
                });
                const createdRow = createClientRow({
                    id: 6,
                    address: null,
                    phone: null,
                    type: null,
                    birthday: null,
                    serviceStatus: null,
                });
                clientModel.create.mockResolvedValue(createdRow);

                // Act
                const result = await repository.create(branchId, entity);

                // Assert
                expect(clientModel.create).toHaveBeenCalledWith(expect.objectContaining({
                    data: expect.objectContaining({
                        address: null,
                        phone: null,
                        type: null,
                        birthday: null,
                        serviceStatus: null,
                    }),
                    select: expect.any(Object),
                }));
                expect(result.address).toBeNull();
            });
        });

        it("creates the client and initial employee schedule in one nested write", async () => {
            const entity = createClientEntity();
            clientModel.create.mockResolvedValue({
                ...createClientRow({ id: 9, name: "Test Client" }),
                employeeSchedules: [{ id: 44 }],
            });

            const result = await repository.createWithInitialSchedule(branchId, entity, {
                primaryEmployeeId: 5,
                secondaryEmployeeId: 6,
                workAddress: "Test Address",
                startDate: new Date("2024-02-01T00:00:00.000Z"),
                endDate: new Date("2024-08-01T00:00:00.000Z"),
            });

            expect(clientModel.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    branchId,
                    employeeSchedules: {
                        create: {
                            branchId,
                            primaryEmployeeId: 5,
                            secondaryEmployeeId: 6,
                            workAddress: "Test Address",
                            startDate: new Date("2024-02-01T00:00:00.000Z"),
                            endDate: new Date("2024-08-01T00:00:00.000Z"),
                            replaced: false,
                        },
                    },
                }),
                select: expect.objectContaining({
                    employeeSchedules: expect.any(Object),
                }),
            }));
            expect(result.client.id).toBe(9);
            expect(result.scheduleId).toBe(44);
        });

        it("keeps initial-schedule schema probes on the supplied transaction connection", async () => {
            const entity = createClientEntity();
            const transaction = createTransaction();
            transaction.client.create.mockResolvedValue({
                ...createClientRow({ id: 16, name: "Test Client" }),
                employeeSchedules: [{ id: 45 }],
            });

            await repository.createWithInitialSchedule(branchId, entity, {
                primaryEmployeeId: 5,
                secondaryEmployeeId: null,
                workAddress: "Test Address",
                startDate: new Date("2024-02-01T00:00:00.000Z"),
                endDate: new Date("2024-08-01T00:00:00.000Z"),
            }, transaction as never);

            expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
            expect(transaction.$queryRawUnsafe).toHaveBeenCalledTimes(3);
        });
    });

    // ============================================
    // update
    // ============================================
    describe("update", () => {
        describe("given an existing ClientEntity with changes", () => {
            it("should update client with correct data mapping", async () => {
                // Arrange
                const entity = new ClientEntity(
                    7,
                    "Updated Name",
                    "Updated Address",
                    "010-3333-4444",
                    "C",
                    6,
                    "60000",
                    "30000",
                    "30000",
                    new Date("2024-03-01T00:00:00.000Z"),
                    new Date("2024-09-01T00:00:00.000Z"),
                    true,
                    false,
                    "880520",
                    "in_progress",
                    true,
                    null,
                );
                const updatedRow = createClientRow({
                    id: 7,
                    name: "Updated Name",
                });
                clientModel.updateMany.mockResolvedValue({ count: 1 });
                clientModel.findFirst.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(branchId, entity);

                // Assert
                expect(clientModel.updateMany).toHaveBeenCalledWith({
                    where: { id: 7, branchId: branchId },
                    data: {
                        name: "Updated Name",
                        address: "Updated Address",
                        phone: "010-3333-4444",
                        type: "C",
                        duration: 6,
                        fullPrice: "60000",
                        grant: "30000",
                        actualPrice: "30000",
                        startDate: new Date("2024-03-01T00:00:00.000Z"),
                        endDate: new Date("2024-09-01T00:00:00.000Z"),
                        careCenter: true,
                        voucherClient: false,
                        birthday: "880520",
                        serviceStatus: "in_progress",
                        breastPump: true,
                        suppressGreetingSms: false,
                        eDocId: null,
                        dueDate: null,
                        birthDate: null,
                        areaId: null,
                    },
                });
                expect(clientModel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 7, branchId: branchId },
                    select: expect.any(Object),
                }));
                expect(result).toBeInstanceOf(ClientEntity);
                expect(result.id).toBe(7);
            });
        });

        describe("given an existing ClientEntity with a birthDate", () => {
            it("should update client birthDate", async () => {
                // Arrange
                const birthDate = new Date("2026-08-05T00:00:00.000Z");
                const entity = new ClientEntity(
                    7,
                    "Updated Name",
                    "Updated Address",
                    "010-3333-4444",
                    "C",
                    6,
                    "60000",
                    "30000",
                    "30000",
                    new Date("2024-03-01T00:00:00.000Z"),
                    new Date("2024-09-01T00:00:00.000Z"),
                    true,
                    false,
                    "880520",
                    "in_progress",
                    true,
                    null,
                    null,
                    null,
                    null,
                    null,
                    false,
                    birthDate,
                );
                const updatedRow = createClientRow({
                    id: 7,
                    name: "Updated Name",
                    birthDate,
                });
                clientModel.updateMany.mockResolvedValue({ count: 1 });
                clientModel.findFirst.mockResolvedValue(updatedRow);

                // Act
                const result = await repository.update(branchId, entity);

                // Assert
                expect(clientModel.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: 7, branchId: branchId },
                    data: expect.objectContaining({
                        birthDate,
                    }),
                }));
                expect(result.birthDate).toEqual(birthDate);
            });
        });

        describe("given entity with breastPump toggled", () => {
            it("should correctly update breastPump field", async () => {
                // Arrange
                const entity = new ClientEntity(
                    8, "Client", null, null, null, null,
                    null, null, null, null, null, false, false,
                    null, null, true, null, // breastPump = true, eDocId = null
                );
                const updatedRow = createClientRow({ id: 8, breastPump: true });
                clientModel.updateMany.mockResolvedValue({ count: 1 });
                clientModel.findFirst.mockResolvedValue(updatedRow);

                // Act
                await repository.update(branchId, entity);

                // Assert
                expect(clientModel.updateMany).toHaveBeenCalledWith({
                    where: { id: 8, branchId: branchId },
                    data: expect.objectContaining({
                        breastPump: true,
                    }),
                });
            });
        });
    });

    describe("approval-bound update", () => {
        const createTransaction = () => ({
            $queryRaw: jest.fn().mockResolvedValue([]),
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: true }]),
            client: {
                findFirst: jest.fn(),
                updateMany: jest.fn(),
            },
        });

        it("locks the branch-owned row before comparing and mutating", async () => {
            const row = createClientRow({ id: 42, branchId });
            const transaction = createTransaction();
            transaction.client.findFirst
                .mockResolvedValueOnce(row)
                .mockResolvedValueOnce({ ...row, name: "Updated" });
            transaction.client.updateMany.mockResolvedValue({ count: 1 });
            const current = ClientEntity.reconstitute(
                row.id, row.name, row.address, row.phone, row.type, row.duration,
                row.fullPrice, row.grant, row.actualPrice, row.startDate, row.endDate,
                row.careCenter, row.voucherClient, row.birthday, row.dueDate,
                row.serviceStatus, row.breastPump, row.eDocId, null, null, branchId,
                false, null,
            );

            const result = await repository.updateIfTargetVersion(
                branchId,
                row.id,
                clientAgentTargetVersion(current),
                { name: "Updated" },
                transaction as never,
            );

            expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
            expect(transaction.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: row.id, branchId },
                data: expect.objectContaining({ name: "Updated" }),
            }));
            expect(result).toMatchObject({ id: row.id, name: "Updated" });
        });

        it("does not mutate when the locked row no longer matches the approved target", async () => {
            const row = createClientRow({ id: 43, branchId, name: "Changed" });
            const transaction = createTransaction();
            transaction.client.findFirst.mockResolvedValue(row);

            const result = await repository.updateIfTargetVersion(
                branchId,
                row.id,
                "stale-target-version",
                { name: "Should not persist" },
                transaction as never,
            );

            expect(result).toBeNull();
            expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
            expect(transaction.client.updateMany).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // birth_date deploy-window gating (mirrors area_id/supportsAreaId)
    // ============================================
    describe("given the birth_date column does not exist yet (pre-migration deploy window)", () => {
        const mockColumnExists = (missingColumns: string[]) => {
            (prisma.$queryRawUnsafe as jest.Mock).mockImplementation(
                (_sql: string, _table: string, column: string) =>
                    Promise.resolve([{ exists: !missingColumns.includes(column) }]),
            );
        };

        it("omits birthDate from the select so findById does not reference the missing column", async () => {
            mockColumnExists(["birth_date"]);
            clientModel.findFirst.mockResolvedValue(createClientRow({ id: 1 }));

            await repository.findById(branchId, 1);

            const { select } = clientModel.findFirst.mock.calls[0][0];
            expect(select).not.toHaveProperty("birthDate");
            expect(select).toMatchObject({ areaId: true });
        });

        it("strips birthDate from the create payload so client.create does not send the missing column", async () => {
            mockColumnExists(["birth_date"]);
            const entity = createClientEntity({ birthDate: new Date("1995-03-15T00:00:00.000Z") });
            clientModel.create.mockResolvedValue(createClientRow({ id: 10 }));

            await repository.create(branchId, entity);

            const { data } = clientModel.create.mock.calls[0][0];
            expect(data).not.toHaveProperty("birthDate");
        });

        it("strips birthDate from the update payload so client.updateMany does not send the missing column", async () => {
            mockColumnExists(["birth_date"]);
            const entity = new ClientEntity(
                11, "Client", null, null, null, null, null, null, null,
                null, null, false, false, null, null, true, null,
                null, null, null, null, false,
                new Date("1995-03-15T00:00:00.000Z"),
            );
            clientModel.updateMany.mockResolvedValue({ count: 1 });
            clientModel.findFirst.mockResolvedValue(createClientRow({ id: 11 }));

            await repository.update(branchId, entity);

            const { data } = clientModel.updateMany.mock.calls[0][0];
            expect(data).not.toHaveProperty("birthDate");
        });
    });

    describe("given the birth_date column exists (post-migration)", () => {
        it("includes birthDate in the select and create/update payloads", async () => {
            const entity = createClientEntity({ birthDate: new Date("1995-03-15T00:00:00.000Z") });
            clientModel.create.mockResolvedValue(createClientRow({ id: 12, birthDate: new Date("1995-03-15T00:00:00.000Z") }));

            await repository.create(branchId, entity);

            const { data, select } = clientModel.create.mock.calls[0][0];
            expect(data).toHaveProperty("birthDate", new Date("1995-03-15T00:00:00.000Z"));
            expect(select).toMatchObject({ birthDate: true });
        });
    });

    // ============================================
    // findStartingWithinDays
    // ============================================
    describe("findStartingWithinDays", () => {
        describe("given clients with start dates within the specified days", () => {
            it("should query with gte (not gt) so clients starting today are included", async () => {
                // Arrange
                const rows = [createClientRow({ id: 1, name: "Future Client" })];
                clientModel.findMany.mockResolvedValue(rows);

                // Act
                await repository.findStartingWithinDays(branchId, 7);

                // Assert
                const callArgs = clientModel.findMany.mock.calls[0][0];
                expect(callArgs.where.startDate.gte).toBeDefined();
                expect(callArgs.where.startDate.gt).toBeUndefined();
                expect(callArgs.where.startDate.lte).toBeDefined();
            });

            it("should return mapped ClientEntity array", async () => {
                // Arrange
                const rows = [
                    createClientRow({ id: 1, name: "Client A" }),
                    createClientRow({ id: 2, name: "Client B" }),
                ];
                clientModel.findMany.mockResolvedValue(rows);

                // Act
                const result = await repository.findStartingWithinDays(branchId, 7);

                // Assert
                expect(result).toHaveLength(2);
                expect(result[0]).toBeInstanceOf(ClientEntity);
                expect(result[0]!.name).toBe("Client A");
            });
        });

        describe("given no clients within date range", () => {
            it("should return empty array", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);

                // Act
                const result = await repository.findStartingWithinDays(branchId, 7);

                // Assert
                expect(result).toEqual([]);
            });
        });
    });

    // ============================================
    // findWithIncompleteContractsStartingWithinDays
    // ============================================
    describe("findWithIncompleteContractsStartingWithinDays", () => {
        describe("given clients with incomplete contracts starting soon", () => {
            it("should query with gte (not gt) so clients starting today are included", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findWithIncompleteContractsStartingWithinDays(branchId, 7);

                // Assert
                const callArgs = clientModel.findMany.mock.calls[0][0];
                expect(callArgs.where.startDate.gte).toBeDefined();
                expect(callArgs.where.startDate.gt).toBeUndefined();
            });

            it("should filter by eDocId not null and statusType not 050", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findWithIncompleteContractsStartingWithinDays(branchId, 7);

                // Assert
                const callArgs = clientModel.findMany.mock.calls[0][0];
                expect(callArgs.where.eDocId).toEqual({ not: null });
                expect(callArgs.where.eformsignDocByEDocId.statusType).toEqual({ not: '050' });
            });
        });
    });

    // ============================================
    // findWithoutContractSentStartingWithinDays
    // ============================================
    describe("findWithoutContractSentStartingWithinDays", () => {
        describe("given clients without contracts sent starting soon", () => {
            it("should query with gte (not gt) so clients starting today are included", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findWithoutContractSentStartingWithinDays(branchId, 7);

                // Assert
                const callArgs = clientModel.findMany.mock.calls[0][0];
                expect(callArgs.where.startDate.gte).toBeDefined();
                expect(callArgs.where.startDate.gt).toBeUndefined();
            });

            it("should filter by eDocId being null", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findWithoutContractSentStartingWithinDays(branchId, 7);

                // Assert
                const callArgs = clientModel.findMany.mock.calls[0][0];
                expect(callArgs.where.eDocId).toBeNull();
            });
        });
    });

    // ============================================
    // delete
    // ============================================
    describe("delete", () => {
        beforeEach(() => {
            clientModel.deleteMany.mockResolvedValue({ count: 1 });
        });

        describe("given a valid client id", () => {
            it("should delete only the tenant-scoped client", async () => {
                // Act
                await repository.delete(branchId, 4);

                // Assert
                expect(clientModel.deleteMany).toHaveBeenCalledTimes(1);
                expect(clientModel.deleteMany).toHaveBeenCalledWith({
                    where: { id: 4, branchId: branchId },
                });
            });
        });

        describe("given different client ids", () => {
            it.each([1, 10, 100, 999])("should delete client with id %i", async (id) => {
                // Act
                await repository.delete(branchId, id);

                // Assert
                expect(clientModel.deleteMany).toHaveBeenCalledWith({
                    where: { id, branchId: branchId },
                });
            });
        });
    });
});
