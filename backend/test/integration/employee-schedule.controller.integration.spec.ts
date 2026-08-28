import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import request from "supertest";
import { EmployeeScheduleController } from "interface/controllers/employee-schedule.controller";
import { EmployeeScheduleService } from "application/services/employee-schedule.service";
import { EmployeeScheduleEntity } from "domain/entities/employee-schedule.entity";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";

describe("EmployeeScheduleController (Integration)", () => {
    it.each(["create", "update", "delete"])("requires owner/admin authority for %s", (methodName) => {
        const guards = Reflect.getMetadata(
            GUARDS_METADATA,
            EmployeeScheduleController.prototype[methodName as keyof typeof EmployeeScheduleController.prototype],
        ) ?? [];
        expect(guards).toContain(OwnerOrAdminGuard);
    });
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    let app: INestApplication;
    let employeeScheduleService: jest.Mocked<EmployeeScheduleService>;

    type EmployeeScheduleOverrides = Partial<{
        id: number;
        clientId: number;
        primaryEmployeeId: number;
        secondaryEmployeeId: number | null;
        workAddress: string;
        startDate: Date;
        endDate: Date;
        replaced: boolean;
    }>;

    const createMockEmployeeSchedule = (overrides: EmployeeScheduleOverrides = {}): EmployeeScheduleEntity => {
        return new EmployeeScheduleEntity(
            overrides.id ?? 1,
            overrides.clientId ?? 100,
            overrides.primaryEmployeeId ?? 10,
            overrides.secondaryEmployeeId ?? null,
            overrides.workAddress ?? "Seoul, Gangnam-gu",
            overrides.startDate ?? new Date("2025-01-01"),
            overrides.endDate ?? new Date("2025-01-31"),
            overrides.replaced ?? false,
        );
    };

    beforeEach(async () => {
        const mockEmployeeScheduleService = {
            create: jest.fn(),
            findAll: jest.fn(),
            findByPrimaryEmployeeId: jest.fn(),
            findBySecondaryEmployeeId: jest.fn(),
            findById: jest.fn(),
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
            controllers: [EmployeeScheduleController],
            providers: [
                {
                    provide: EmployeeScheduleService,
                    useValue: mockEmployeeScheduleService,
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

        employeeScheduleService = moduleFixture.get(EmployeeScheduleService);
    });

    afterEach(async () => {
        await app.close();
    });

    describe("query validation", () => {
        it("should reject invalid primary employee ids before calling service", async () => {
            const response = await request(app.getHttpServer())
                .get("/employee-schedules/primary-employee")
                .query({ primaryEmployeeId: "0.1" });

            expect(response.status).toBe(400);
            expect(employeeScheduleService.findByPrimaryEmployeeId).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // POST /employee-schedules - Create
    // ============================================
    describe("POST /employee-schedules", () => {
        describe("given valid employee schedule data", () => {
            it("should create a new employee schedule and return 201", async () => {
                // Arrange
                const createDto = {
                    clientId: 100,
                    primaryEmployeeId: 10,
                    secondaryEmployeeId: 20,
                    workAddress: "Incheon, Yeonsu-gu",
                    startDate: "2025-02-01",
                    endDate: "2025-02-28",
                    replaced: false,
                };
                const createdSchedule = createMockEmployeeSchedule({
                    id: 5,
                    clientId: 100,
                    primaryEmployeeId: 10,
                    secondaryEmployeeId: 20,
                    workAddress: "Incheon, Yeonsu-gu",
                    startDate: new Date("2025-02-01"),
                    endDate: new Date("2025-02-28"),
                });
                employeeScheduleService.create.mockResolvedValue(createdSchedule);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/employee-schedules")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(employeeScheduleService.create).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        clientId: 100,
                        primaryEmployeeId: 10,
                        secondaryEmployeeId: 20,
                        workAddress: "Incheon, Yeonsu-gu",
                    }),
                );
            });
        });

        describe("given minimal employee schedule data (without secondary employee)", () => {
            it("should create schedule with null secondary employee", async () => {
                // Arrange
                const createDto = {
                    clientId: 200,
                    primaryEmployeeId: 15,
                    workAddress: "Busan",
                    startDate: "2025-03-01",
                    endDate: "2025-03-31",
                };
                const createdSchedule = createMockEmployeeSchedule({
                    id: 6,
                    clientId: 200,
                    primaryEmployeeId: 15,
                    secondaryEmployeeId: null,
                });
                employeeScheduleService.create.mockResolvedValue(createdSchedule);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/employee-schedules")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(employeeScheduleService.create).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        clientId: 200,
                        primaryEmployeeId: 15,
                        secondaryEmployeeId: null,
                    }),
                );
            });
        });

        describe("given missing required fields", () => {
            it("should return 400 for missing clientId", async () => {
                // Arrange
                const invalidDto = {
                    primaryEmployeeId: 10,
                    workAddress: "Seoul",
                    startDate: "2025-01-01",
                    endDate: "2025-01-31",
                };

                // Act
                const response = await request(app.getHttpServer())
                    .post("/employee-schedules")
                    .send(invalidDto);

                // Assert
                expect(response.status).toBe(400);
            });

            it("should return 400 for invalid date format", async () => {
                // Arrange
                const invalidDto = {
                    clientId: 100,
                    primaryEmployeeId: 10,
                    workAddress: "Seoul",
                    startDate: "invalid-date",
                    endDate: "2025-01-31",
                };

                // Act
                const response = await request(app.getHttpServer())
                    .post("/employee-schedules")
                    .send(invalidDto);

                // Assert
                expect(response.status).toBe(400);
            });
        });
    });

    // ============================================
    // GET /employee-schedules - List All
    // ============================================
    describe("GET /employee-schedules", () => {
        describe("given employee schedules exist", () => {
            it("should return all employee schedules", async () => {
                // Arrange
                const schedules = [
                    createMockEmployeeSchedule({ id: 1, clientId: 100 }),
                    createMockEmployeeSchedule({ id: 2, clientId: 101 }),
                    createMockEmployeeSchedule({ id: 3, clientId: 102 }),
                ];
                employeeScheduleService.findAll.mockResolvedValue(schedules);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employee-schedules");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toHaveLength(3);
                expect(employeeScheduleService.findAll).toHaveBeenCalledWith(expect.any(String));
            });
        });

        describe("given no employee schedules exist", () => {
            it("should return empty array", async () => {
                // Arrange
                employeeScheduleService.findAll.mockResolvedValue([]);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employee-schedules");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });
    });

    // ============================================
    // GET /employee-schedules/primary-employee - Find By Primary Employee
    // ============================================
    describe("GET /employee-schedules/primary-employee", () => {
        describe("given schedules exist for primary employee", () => {
            it("should return schedules by primary employee id", async () => {
                // Arrange
                const schedules = [
                    createMockEmployeeSchedule({ id: 1, primaryEmployeeId: 10 }),
                    createMockEmployeeSchedule({ id: 2, primaryEmployeeId: 10 }),
                ];
                employeeScheduleService.findByPrimaryEmployeeId.mockResolvedValue(schedules);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employee-schedules/primary-employee")
                    .query({ primaryEmployeeId: "10" });

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toHaveLength(2);
                expect(employeeScheduleService.findByPrimaryEmployeeId).toHaveBeenCalledWith(
                    expect.any(String),
                    10,
                );
            });
        });

        describe("given no schedules for primary employee", () => {
            it("should return empty array", async () => {
                // Arrange
                employeeScheduleService.findByPrimaryEmployeeId.mockResolvedValue([]);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employee-schedules/primary-employee")
                    .query({ primaryEmployeeId: "999" });

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });
    });

    // ============================================
    // GET /employee-schedules/secondary-employee - Find By Secondary Employee
    // ============================================
    describe("GET /employee-schedules/secondary-employee", () => {
        describe("given schedules exist for secondary employee", () => {
            it("should return schedules by secondary employee id", async () => {
                // Arrange
                const schedules = [
                    createMockEmployeeSchedule({ id: 1, secondaryEmployeeId: 20 }),
                ];
                employeeScheduleService.findBySecondaryEmployeeId.mockResolvedValue(schedules);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employee-schedules/secondary-employee")
                    .query({ secondaryEmployeeId: "20" });

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toHaveLength(1);
                expect(employeeScheduleService.findBySecondaryEmployeeId).toHaveBeenCalledWith(
                    expect.any(String),
                    20,
                );
            });
        });

        describe("given no schedules for secondary employee", () => {
            it("should return empty array", async () => {
                // Arrange
                employeeScheduleService.findBySecondaryEmployeeId.mockResolvedValue([]);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employee-schedules/secondary-employee")
                    .query({ secondaryEmployeeId: "999" });

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });
    });

    // ============================================
    // GET /employee-schedules/id - Find By ID
    // ============================================
    describe("GET /employee-schedules/id", () => {
        describe("given employee schedule exists", () => {
            it("should return the employee schedule", async () => {
                // Arrange
                const schedule = createMockEmployeeSchedule({
                    id: 7,
                    workAddress: "Daegu",
                });
                employeeScheduleService.findById.mockResolvedValue(schedule);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employee-schedules/id")
                    .query({ id: "7" });

                // Assert
                expect(response.status).toBe(200);
                expect(employeeScheduleService.findById).toHaveBeenCalledWith(expect.any(String), 7);
            });
        });

        describe("given employee schedule does not exist", () => {
            it("should return null from service", async () => {
                // Arrange
                employeeScheduleService.findById.mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employee-schedules/id")
                    .query({ id: "999" });

                // Assert
                expect(response.status).toBe(200);
                expect(employeeScheduleService.findById).toHaveBeenCalledWith(expect.any(String), 999);
            });
        });
    });

    // ============================================
    // PATCH /employee-schedules - Update
    // ============================================
    describe("PATCH /employee-schedules", () => {
        describe("given valid update data", () => {
            it("should update the employee schedule", async () => {
                // Arrange
                const updateDto = {
                    workAddress: "Updated Address",
                    replaced: true,
                };
                const updatedSchedule = createMockEmployeeSchedule({
                    id: 3,
                    workAddress: "Updated Address",
                    replaced: true,
                });
                employeeScheduleService.update.mockResolvedValue(updatedSchedule);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/employee-schedules")
                    .query({ id: "3" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(employeeScheduleService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    3,
                    expect.objectContaining({
                        workAddress: "Updated Address",
                        replaced: true,
                    }),
                );
            });
        });

        describe("given date update", () => {
            it("should update start and end dates", async () => {
                // Arrange
                const updateDto = {
                    startDate: "2025-06-01",
                    endDate: "2025-06-30",
                };
                const updatedSchedule = createMockEmployeeSchedule({
                    id: 4,
                    startDate: new Date("2025-06-01"),
                    endDate: new Date("2025-06-30"),
                });
                employeeScheduleService.update.mockResolvedValue(updatedSchedule);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/employee-schedules")
                    .query({ id: "4" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(employeeScheduleService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    4,
                    expect.objectContaining({
                        startDate: "2025-06-01",
                        endDate: "2025-06-30",
                    }),
                );
            });
        });

        describe("given replaced status update", () => {
            it("should update replaced status to true", async () => {
                // Arrange
                const updateDto = { replaced: true };
                const updatedSchedule = createMockEmployeeSchedule({
                    id: 5,
                    replaced: true,
                });
                employeeScheduleService.update.mockResolvedValue(updatedSchedule);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/employee-schedules")
                    .query({ id: "5" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(employeeScheduleService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    5,
                    expect.objectContaining({
                        replaced: true,
                    }),
                );
            });
        });
    });

    // ============================================
    // DELETE /employee-schedules - Delete
    // ============================================
    describe("DELETE /employee-schedules", () => {
        describe("given valid employee schedule id", () => {
            it("should delete the employee schedule", async () => {
                // Arrange
                employeeScheduleService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/employee-schedules")
                    .query({ id: "8" });

                // Assert
                expect(response.status).toBe(200);
                expect(employeeScheduleService.delete).toHaveBeenCalledWith(expect.any(String), 8);
            });
        });

        describe("given different employee schedule ids", () => {
            it.each([1, 10, 100, 999])("should delete employee schedule with id %i", async (id) => {
                // Arrange
                employeeScheduleService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/employee-schedules")
                    .query({ id: String(id) });

                // Assert
                expect(response.status).toBe(200);
                expect(employeeScheduleService.delete).toHaveBeenCalledWith(expect.any(String), id);
            });
        });
    });
});
