import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { ClientController } from "interface/controllers/client.controller";
import { ClientService } from "application/services/client.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { ClientEntity } from "domain/entities/client.entity";

describe("ClientController (Integration)", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    let app: INestApplication;
    let clientService: jest.Mocked<ClientService>;

    type ClientOverrides = Partial<{
        id: number;
        name: string;
        address: string | null;
        phone: string | null;
        type: string | null;
        duration: number | null;
        fullPrice: string | null;
        grant: string | null;
        actualPrice: string | null;
        startDate: Date | null;
        endDate: Date | null;
        careCenter: boolean;
        voucherClient: boolean;
        birthday: string | null;
        contractStatus: string | null;
        breastPump: boolean;
        eDocId: string | null;
    }>;

    const createMockClient = (overrides: ClientOverrides = {}): ClientEntity => {
        return new ClientEntity(
            overrides.id ?? 1,
            overrides.name ?? "Test Client",
            overrides.address ?? "Seoul",
            overrides.phone ?? "010-1234-5678",
            overrides.type ?? "standard",
            overrides.duration ?? 30,
            overrides.fullPrice ?? "100000",
            overrides.grant ?? "50000",
            overrides.actualPrice ?? "50000",
            overrides.startDate ?? new Date("2025-01-01"),
            overrides.endDate ?? new Date("2025-01-31"),
            overrides.careCenter ?? true,
            overrides.voucherClient ?? false,
            overrides.birthday ?? "1990-01-15",
            overrides.contractStatus ?? "active",
            overrides.breastPump ?? false,
            overrides.eDocId ?? null,
        );
    };

    const createClientWithEmployeeInfo = (client: ClientEntity) => ({
        ...client,
        primaryEmployee: null,
        secondaryEmployee: null,
        hasSigned: false,
        documentStatus: null,
        badges: [],
        actionRequired: null,
    });

    beforeEach(async () => {
        const mockClientService = {
            create: jest.fn(),
            findAll: jest.fn(),
            findAllPaginated: jest.fn(),
            findById: jest.fn(),
            getActionRequiredAlerts: jest.fn(),
            getDashboardOverview: jest.fn(),
            getStats: jest.fn(),
            checkPhoneExists: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        };

        const mockAuthGuard = {
            canActivate: (context: ExecutionContext) => {
                const requestContext = context.switchToHttp().getRequest();
                requestContext.user = {
                    userId: "user-1",
                    branchId: "org-1",
                    role: "admin",
                    branchRole: "admin",
                };
                requestContext.tenant = {
                    userId: "user-1",
                    branchId: "org-1",
                    globalRole: "admin",
                    branchRole: "admin",
                };
                return true;
            },
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [ClientController],
            providers: [
                {
                    provide: ClientService,
                    useValue: mockClientService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockAuthGuard)
            .overrideGuard(TenantGuard)
            .useValue(mockAuthGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        clientService = moduleFixture.get(ClientService);
    });

    afterEach(async () => {
        await app.close();
    });

    // ============================================
    // POST /clients - Create
    // ============================================
    describe("POST /clients", () => {
        describe("given valid client data", () => {
            it("should create a new client and return 201", async () => {
                // Arrange
                const createDto = {
                    name: "New Client",
                    primaryEmployeeId: 10,
                    address: "Incheon",
                    phone: "010-9999-8888",
                    careCenter: true,
                    voucherClient: false,
                    breastPump: false,
                };
                const createdClient = createMockClient({ id: 5, ...createDto });
                clientService.create.mockResolvedValue(createdClient);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/clients")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(clientService.create).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        name: "New Client",
                        primaryEmployeeId: 10,
                    }),
                );
            });

            it("should pass message automation preferences to the service when provided", async () => {
                // Arrange
                const createDto = {
                    name: "Contract Client",
                    address: "Incheon",
                    phone: "010-1111-2222",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    suppressGreetingSms: true,
                    applyMessageAutomation: false,
                };
                clientService.create.mockResolvedValue(createMockClient({ id: 6, ...createDto }));

                // Act
                const response = await request(app.getHttpServer())
                    .post("/clients")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(clientService.create).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        name: "Contract Client",
                        suppressGreetingSms: true,
                        applyMessageAutomation: false,
                    }),
                );
            });
        });

        describe("given missing required fields", () => {
            it("should return 400 for missing name", async () => {
                // Arrange
                const invalidDto = {
                    primaryEmployeeId: 10,
                    careCenter: true,
                    voucherClient: false,
                    breastPump: false,
                };

                // Act
                const response = await request(app.getHttpServer())
                    .post("/clients")
                    .send(invalidDto);

                // Assert
                expect(response.status).toBe(400);
            });
        });
    });

    // ============================================
    // GET /clients - List All
    // ============================================
    describe("GET /clients", () => {
        describe("given clients exist", () => {
            it("should return all clients", async () => {
                // Arrange
                const clients = [
                    createClientWithEmployeeInfo(createMockClient({ id: 1, name: "Client A" })),
                    createClientWithEmployeeInfo(createMockClient({ id: 2, name: "Client B" })),
                ];
                clientService.findAll.mockResolvedValue(clients);

                // Act
                const response = await request(app.getHttpServer()).get("/clients");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toHaveLength(2);
                expect(clientService.findAll).toHaveBeenCalledWith(expect.any(String));
            });
        });

        describe("given pagination parameters", () => {
            it("should return paginated results", async () => {
                // Arrange
                const paginatedResult = {
                    data: [createClientWithEmployeeInfo(createMockClient({ id: 1 }))],
                    total: 10,
                    page: 1,
                    limit: 5,
                    totalPages: 2,
                };
                clientService.findAllPaginated.mockResolvedValue(paginatedResult);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/clients")
                    .query({ page: "1", limit: "5" });

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.findAllPaginated).toHaveBeenCalledWith(
                    expect.any(String),
                    1,
                    5,
                    undefined,
                );
            });

            it("should pass search query to paginated method", async () => {
                // Arrange
                const paginatedResult = {
                    data: [],
                    total: 0,
                    page: 1,
                    limit: 10,
                    totalPages: 0,
                };
                clientService.findAllPaginated.mockResolvedValue(paginatedResult);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/clients")
                    .query({ page: "1", limit: "10", search: "Kim" });

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.findAllPaginated).toHaveBeenCalledWith(
                    expect.any(String),
                    1,
                    10,
                    "Kim",
                );
            });

            it("should reject invalid pagination before calling service", async () => {
                const response = await request(app.getHttpServer())
                    .get("/clients")
                    .query({ page: "abc", limit: "20" });

                expect(response.status).toBe(400);
                expect(clientService.findAllPaginated).not.toHaveBeenCalled();
            });
        });

        it("should return dashboard overview", async () => {
            // Arrange
            const overview = {
                stats: {
                    activeClients: 1,
                    contractsNotSent: 2,
                    contractsPendingSignature: 3,
                    upcomingThisMonth: 4,
                    upcomingNextMonth: 5,
                },
                clients: {
                    data: [createClientWithEmployeeInfo(createMockClient({ id: 1 }))],
                    total: 1,
                    page: 1,
                    limit: 50,
                    totalPages: 1,
                },
            };
            clientService.getDashboardOverview.mockResolvedValue(overview);

            // Act
            const response = await request(app.getHttpServer())
                .get("/clients/dashboard-overview")
                .query({ limit: "25" });

            // Assert
            expect(response.status).toBe(200);
            expect(response.body.stats.activeClients).toBe(1);
            expect(clientService.getDashboardOverview).toHaveBeenCalledWith(expect.any(String), 25);
        });

        it("should reject invalid dashboard overview limits before calling service", async () => {
            const response = await request(app.getHttpServer())
                .get("/clients/dashboard-overview")
                .query({ limit: "-1" });

            expect(response.status).toBe(400);
            expect(clientService.getDashboardOverview).not.toHaveBeenCalled();
        });

        it("should return action-required alerts", async () => {
            // Arrange
            const alerts = [
                {
                    id: 1,
                    name: "Client A",
                    createdAt: new Date("2026-01-01T00:00:00.000Z"),
                    reason: "서명 필요" as const,
                    priority: 2 as const,
                },
            ];
            clientService.getActionRequiredAlerts.mockResolvedValue(alerts);

            // Act
            const response = await request(app.getHttpServer())
                .get("/clients/alerts")
                .query({ limit: "3" });

            // Assert
            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(1);
            expect(response.body[0].reason).toBe("서명 필요");
            expect(clientService.getActionRequiredAlerts).toHaveBeenCalledWith(expect.any(String), 3);
        });

        describe("given no clients exist", () => {
            it("should return empty array", async () => {
                // Arrange
                clientService.findAll.mockResolvedValue([]);

                // Act
                const response = await request(app.getHttpServer()).get("/clients");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });
    });

    // ============================================
    // GET /clients/check-phone - Check Phone
    // ============================================
    describe("GET /clients/check-phone", () => {
        it("should check phone duplication against clients only", async () => {
            clientService.checkPhoneExists.mockResolvedValue(false);

            const response = await request(app.getHttpServer())
                .get("/clients/check-phone")
                .query({ phone: "010-1234-5678" });

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ exists: false });
            expect(clientService.checkPhoneExists).toHaveBeenCalledWith(expect.any(String), "010-1234-5678");
        });
    });

    // ============================================
    // GET /clients/:id - Find By ID
    // ============================================
    describe("GET /clients/:id", () => {
        describe("given client exists", () => {
            it("should return the client", async () => {
                // Arrange
                const client = createClientWithEmployeeInfo(createMockClient({ id: 7, name: "Specific Client" }));
                clientService.findById.mockResolvedValue(client);

                // Act
                const response = await request(app.getHttpServer()).get("/clients/7");

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.findById).toHaveBeenCalledWith(expect.any(String), 7);
            });
        });

        describe("given client does not exist", () => {
            it("should return null from service", async () => {
                // Arrange
                clientService.findById.mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer()).get("/clients/999");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual({});
                expect(clientService.findById).toHaveBeenCalledWith(expect.any(String), 999);
            });
        });

        describe("given id param is not numeric", () => {
            it("should return 400 without calling the service", async () => {
                // Act
                const response = await request(app.getHttpServer()).get("/clients/undefined");

                // Assert
                expect(response.status).toBe(400);
                expect(clientService.findById).not.toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // PATCH /clients/:id - Update
    // ============================================
    describe("PATCH /clients/:id", () => {
        describe("given valid update data", () => {
            it("should update the client", async () => {
                // Arrange
                const updateDto = {
                    name: "Updated Name",
                    address: "Busan",
                };
                const updatedClient = createMockClient({ id: 3, ...updateDto });
                clientService.update.mockResolvedValue(updatedClient);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/clients/3")
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    3,
                    expect.objectContaining({
                        name: "Updated Name",
                        address: "Busan",
                    }),
                );
            });
        });

        describe("given partial update", () => {
            it("should only update provided fields", async () => {
                // Arrange
                const partialDto = { phone: "010-0000-0000" };
                const updatedClient = createMockClient({ id: 4, phone: "010-0000-0000" });
                clientService.update.mockResolvedValue(updatedClient);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/clients/4")
                    .send(partialDto);

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    4,
                    expect.objectContaining({
                        phone: "010-0000-0000",
                    }),
                );
            });
        });

        it.each(["name", "voucherClient", "breastPump"])(
            "should reject explicit null for non-nullable %s before invoking the service",
            async (field) => {
                const response = await request(app.getHttpServer())
                    .patch("/clients/4")
                    .send({ [field]: null });

                expect(response.status).toBe(400);
                expect(clientService.update).not.toHaveBeenCalled();
            },
        );

        describe("given an empty update", () => {
            it("should preserve the relink-only wire contract", async () => {
                const existingClient = createMockClient({ id: 5 });
                clientService.update.mockResolvedValue(existingClient);

                const response = await request(app.getHttpServer())
                    .patch("/clients/5")
                    .send({});

                expect(response.status).toBe(200);
                expect(clientService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    5,
                    {
                        name: undefined,
                        primaryEmployeeId: undefined,
                        secondaryEmployeeId: undefined,
                        address: undefined,
                        phone: undefined,
                        type: undefined,
                        duration: undefined,
                        fullPrice: undefined,
                        grant: undefined,
                        actualPrice: undefined,
                        startDate: undefined,
                        endDate: undefined,
                        careCenter: undefined,
                        voucherClient: undefined,
                        birthday: undefined,
                        dueDate: undefined,
                        birthDate: undefined,
                        serviceStatus: undefined,
                        breastPump: undefined,
                        eDocId: undefined,
                        areaId: undefined,
                    },
                );
            });
        });
    });

    // ============================================
    // DELETE /clients/:id - Delete
    // ============================================
    describe("DELETE /clients/:id", () => {
        describe("given valid client id", () => {
            it("should delete the client", async () => {
                // Arrange
                clientService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer()).delete("/clients/8");

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.delete).toHaveBeenCalledWith(expect.any(String), 8);
            });
        });

        describe("given different client ids", () => {
            it.each([1, 10, 100, 999])("should delete client with id %i", async (id) => {
                // Arrange
                clientService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer()).delete(`/clients/${id}`);

                // Assert
                expect(response.status).toBe(200);
                expect(clientService.delete).toHaveBeenCalledWith(expect.any(String), id);
            });
        });
    });
});
