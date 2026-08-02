import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientEntity } from "domain/entities/client.entity";

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
        ...overrides,
    });

    const branchId = "org-1";

    let clientModel: ReturnType<typeof createMockPrismaClient>;
    let prisma: PrismaService;
    let repository: SbClientRepository;

    beforeEach(() => {
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

    // ============================================
    // findStartingWithinDays
    // ============================================
    describe("findStartingWithinDays", () => {
        describe("given clients with start dates within the specified days", () => {
            it("should query with gt (not gte) to exclude clients starting today", async () => {
                // Arrange
                const rows = [createClientRow({ id: 1, name: "Future Client" })];
                clientModel.findMany.mockResolvedValue(rows);

                // Act
                await repository.findStartingWithinDays(branchId, 7);

                // Assert
                const callArgs = clientModel.findMany.mock.calls[0][0];
                expect(callArgs.where.startDate.gt).toBeDefined();
                expect(callArgs.where.startDate.gte).toBeUndefined();
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
            it("should query with gt (not gte) to exclude clients starting today", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findWithIncompleteContractsStartingWithinDays(branchId, 7);

                // Assert
                const callArgs = clientModel.findMany.mock.calls[0][0];
                expect(callArgs.where.startDate.gt).toBeDefined();
                expect(callArgs.where.startDate.gte).toBeUndefined();
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
            it("should query with gt (not gte) to exclude clients starting today", async () => {
                // Arrange
                clientModel.findMany.mockResolvedValue([]);

                // Act
                await repository.findWithoutContractSentStartingWithinDays(branchId, 7);

                // Assert
                const callArgs = clientModel.findMany.mock.calls[0][0];
                expect(callArgs.where.startDate.gt).toBeDefined();
                expect(callArgs.where.startDate.gte).toBeUndefined();
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
