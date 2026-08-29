import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import request from "supertest";
import { EmployeeController } from "interface/controllers/employee.controller";
import { EmployeeService } from "application/services/employee.service";
import { EmployeeEntity } from "domain/entities/employee.entity";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";

describe("EmployeeController (Integration)", () => {
    it.each(["create", "changeOpenStatus", "update", "delete"])("requires owner/admin authority for %s", (methodName) => {
        const guards = Reflect.getMetadata(
            GUARDS_METADATA,
            EmployeeController.prototype[methodName as keyof typeof EmployeeController.prototype],
        ) ?? [];
        expect(guards).toContain(OwnerOrAdminGuard);
    });
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    let app: INestApplication;
    let moduleFixture: TestingModule;
    let employeeService: jest.Mocked<EmployeeService>;

    type EmployeeOverrides = Partial<{
        id: number;
        name: string;
        workArea: string[];
        phone: string;
        grade: string;
        openToNextWork: boolean;
        registeredDate: Date;
    }>;

    const createMockEmployee = (overrides: EmployeeOverrides = {}): EmployeeEntity => {
        return new EmployeeEntity(
            overrides.id ?? 1,
            overrides.name ?? "Test Employee",
            overrides.workArea ?? ["Seoul", "Incheon"],
            overrides.phone ?? "010-1234-5678",
            overrides.grade ?? "프리미엄",
            overrides.openToNextWork ?? true,
            overrides.registeredDate ?? new Date("2025-01-01"),
        );
    };

    beforeEach(async () => {
        const mockEmployeeService = {
            create: jest.fn(),
            findAll: jest.fn(),
            findById: jest.fn(),
            findByWorkArea: jest.fn(),
            findByGrade: jest.fn(),
            findByOpenStatus: jest.fn(),
            findByRegisteredDate: jest.fn(),
            findByRegisteredDateRange: jest.fn(),
            findAllOpenToNextWork: jest.fn(),
            listActiveClients: jest.fn(),
            listWorkHistory: jest.fn(),
            checkPhoneExists: jest.fn(),
            changeOpenStatus: jest.fn(),
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

        moduleFixture = await Test.createTestingModule({
            controllers: [EmployeeController],
            providers: [
                {
                    provide: EmployeeService,
                    useValue: mockEmployeeService,
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

        employeeService = moduleFixture.get(EmployeeService);
    });

    afterEach(async () => {
        await app.close();
    });

    // ============================================
    // POST /employees - Create
    // ============================================
    describe("POST /employees", () => {
        describe("given valid employee data", () => {
            it("should create a new employee and return 201", async () => {
                // Arrange
                const createDto = {
                    name: "New Employee",
                    workArea: ["Seoul"],
                    phone: "010-9999-8888",
                    grade: "베스트",
                    openToNextWork: true,
                };
                const createdEmployee = createMockEmployee({ id: 5, ...createDto });
                employeeService.create.mockResolvedValue(createdEmployee);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/employees")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(employeeService.create).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        name: "New Employee",
                        workArea: ["Seoul"],
                        grade: "베스트",
                    }),
                );
            });

            it("should expose the current Korean registration date when the field is omitted", async () => {
                jest.useFakeTimers().setSystemTime(new Date("2026-08-27T23:30:00.000Z"));
                try {
                    const createDto = {
                        name: "오늘 등록 직원",
                        workArea: ["Seoul"],
                        phone: "010-9999-7777",
                        grade: "베스트",
                        openToNextWork: true,
                    };
                    employeeService.create.mockResolvedValue(
                        EmployeeEntity.create(
                            createDto.name,
                            createDto.workArea,
                            createDto.phone,
                            createDto.grade,
                            createDto.openToNextWork,
                        ),
                    );

                    const response = await request(app.getHttpServer())
                        .post("/employees")
                        .send(createDto);

                    expect(response.status).toBe(201);
                    expect(response.body.registeredDate).toBe("2026-08-28T00:00:00.000Z");
                } finally {
                    jest.useRealTimers();
                }
            });
        });

        describe("given employee with registeredDate", () => {
            it("should pass registeredDate to service", async () => {
                // Arrange
                const createDto = {
                    name: "Dated Employee",
                    workArea: ["Busan"],
                    phone: "010-1111-2222",
                    grade: "프리미엄",
                    openToNextWork: false,
                    registeredDate: "2025-06-15",
                };
                const createdEmployee = createMockEmployee({ id: 10, name: "Dated Employee" });
                employeeService.create.mockResolvedValue(createdEmployee);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/employees")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(employeeService.create).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        registeredDate: "2025-06-15",
                    }),
                );
            });
        });
    });

    // ============================================
    // GET /employees - List All
    // ============================================
    describe("GET /employees", () => {
        describe("given employees exist", () => {
            it("should return all employees", async () => {
                // Arrange
                const employees = [
                    createMockEmployee({ id: 1, name: "Employee A" }),
                    createMockEmployee({ id: 2, name: "Employee B" }),
                ];
                employeeService.findAll.mockResolvedValue(employees);

                // Act
                const response = await request(app.getHttpServer()).get("/employees");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toHaveLength(2);
                expect(employeeService.findAll).toHaveBeenCalledWith(expect.any(String));
            });
        });

        describe("given no employees exist", () => {
            it("should return empty array", async () => {
                // Arrange
                employeeService.findAll.mockResolvedValue([]);

                // Act
                const response = await request(app.getHttpServer()).get("/employees");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });
    });

    // ============================================
    // GET /employees/check-phone - Check Phone
    // ============================================
    describe("GET /employees/check-phone", () => {
        it("should check phone duplication against employees only", async () => {
            employeeService.checkPhoneExists.mockResolvedValue(true);

            const response = await request(app.getHttpServer())
                .get("/employees/check-phone")
                .query({ phone: "010-1234-5678" });

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ exists: true });
            expect(employeeService.checkPhoneExists).toHaveBeenCalledWith(expect.any(String), "010-1234-5678");
        });
    });

    // ============================================
    // GET /employees/id - Find By ID
    // ============================================
    describe("GET /employees/id", () => {
        describe("given employee exists", () => {
            it("should return the employee", async () => {
                // Arrange
                const employee = createMockEmployee({ id: 7, name: "Specific Employee" });
                employeeService.findById.mockResolvedValue(employee);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employees/id")
                    .query({ id: "7" });

                // Assert
                expect(response.status).toBe(200);
                expect(employeeService.findById).toHaveBeenCalledWith(expect.any(String), 7);
            });
        });

        describe("given employee does not exist", () => {
            it("should return null from service", async () => {
                // Arrange
                employeeService.findById.mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employees/id")
                    .query({ id: "999" });

                // Assert
                expect(response.status).toBe(200);
                expect(employeeService.findById).toHaveBeenCalledWith(expect.any(String), 999);
            });
        });

        it("should reject invalid ids before calling service", async () => {
            const response = await request(app.getHttpServer())
                .get("/employees/id")
                .query({ id: "abc" });

            expect(response.status).toBe(400);
            expect(employeeService.findById).not.toHaveBeenCalled();
        });
    });

    describe("GET /employees/:id/active-clients", () => {
        it("should return the active client response shape", async () => {
            employeeService.listActiveClients.mockResolvedValue([
                {
                    clientId: 11,
                    clientName: "박서연",
                    role: "primary",
                    startDate: new Date("2026-07-01T00:00:00.000Z"),
                    endDate: new Date("2026-12-31T00:00:00.000Z"),
                    serviceStatus: "active",
                },
            ]);

            const controller = moduleFixture.get(EmployeeController);
            const response = await controller.listActiveClients({ branchId: "org-1" }, "7");

            expect(employeeService.listActiveClients).toHaveBeenCalledWith("org-1", 7);
            expect(JSON.parse(JSON.stringify(response))).toMatchInlineSnapshot(`
[
  {
    "clientId": 11,
    "clientName": "박서연",
    "endDate": "2026-12-31T00:00:00.000Z",
    "role": "primary",
    "serviceStatus": "active",
    "startDate": "2026-07-01T00:00:00.000Z",
  },
]
`);
        });
    });

    describe("GET /employees/:id/work-history", () => {
        it("validates pagination and passes the selected branch to the service", async () => {
            employeeService.listWorkHistory.mockResolvedValue({
                data: [],
                total: 0,
                page: 2,
                limit: 10,
                totalPages: 0,
            });

            const response = await request(app.getHttpServer())
                .get("/employees/7/work-history")
                .query({ page: "2", limit: "10" });

            expect(response.status).toBe(200);
            expect(employeeService.listWorkHistory).toHaveBeenCalledWith("org-1", 7, 2, 10);
        });

        it("rejects invalid pagination before calling the service", async () => {
            const response = await request(app.getHttpServer())
                .get("/employees/7/work-history")
                .query({ page: "0", limit: "10" });

            expect(response.status).toBe(400);
            expect(employeeService.listWorkHistory).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // GET /employees/work-area - Find By Work Area
    // ============================================
    describe("GET /employees/work-area", () => {
        it("should return employees by work area", async () => {
            // Arrange
            const employees = [
                createMockEmployee({ id: 1, workArea: ["Seoul"] }),
                createMockEmployee({ id: 2, workArea: ["Seoul", "Incheon"] }),
            ];
            employeeService.findByWorkArea.mockResolvedValue(employees);

            // Act
            const response = await request(app.getHttpServer())
                .get("/employees/work-area")
                .query({ workArea: "Seoul" });

            // Assert
            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(2);
            expect(employeeService.findByWorkArea).toHaveBeenCalledWith(expect.any(String), "Seoul");
        });
    });

    // ============================================
    // GET /employees/grade - Find By Grade
    // ============================================
    describe("GET /employees/grade", () => {
        it("should return employees by grade", async () => {
            // Arrange
            const employees = [
                createMockEmployee({ id: 1, grade: "프리미엄" }),
                createMockEmployee({ id: 2, grade: "프리미엄" }),
            ];
            employeeService.findByGrade.mockResolvedValue(employees);

            // Act
            const response = await request(app.getHttpServer())
                .get("/employees/grade")
                .query({ grade: "프리미엄" });

            // Assert
            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(2);
            expect(employeeService.findByGrade).toHaveBeenCalledWith(expect.any(String), "프리미엄");
        });
    });

    // ============================================
    // GET /employees/open-status - Find By Open Status
    // ============================================
    describe("GET /employees/open-status", () => {
        describe("given openToNextWork=true", () => {
            it("should return employees open to next work", async () => {
                // Arrange
                const employees = [createMockEmployee({ openToNextWork: true })];
                employeeService.findByOpenStatus.mockResolvedValue(employees);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employees/open-status")
                    .query({ openToNextWork: "true" });

                // Assert
                expect(response.status).toBe(200);
                expect(employeeService.findByOpenStatus).toHaveBeenCalledWith(expect.any(String), true);
            });
        });

        describe("given openToNextWork=false", () => {
            it("should return employees not open to next work", async () => {
                // Arrange
                const employees = [createMockEmployee({ openToNextWork: false })];
                employeeService.findByOpenStatus.mockResolvedValue(employees);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employees/open-status")
                    .query({ openToNextWork: "false" });

                // Assert
                expect(response.status).toBe(200);
                expect(employeeService.findByOpenStatus).toHaveBeenCalledWith(expect.any(String), false);
            });
        });

        describe("given no query parameter", () => {
            it("should default to true", async () => {
                // Arrange
                const employees = [createMockEmployee({ openToNextWork: true })];
                employeeService.findByOpenStatus.mockResolvedValue(employees);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/employees/open-status");

                // Assert
                expect(response.status).toBe(200);
                expect(employeeService.findByOpenStatus).toHaveBeenCalledWith(expect.any(String), true);
            });
        });

        it.each(["garbage", "TRUE", "1"])(
            "should reject an invalid openToNextWork value (%s) before calling the service",
            async (openToNextWork) => {
                const response = await request(app.getHttpServer())
                    .get("/employees/open-status")
                    .query({ openToNextWork });

                expect(response.status).toBe(400);
                expect(employeeService.findByOpenStatus).not.toHaveBeenCalled();
            },
        );
    });

    // ============================================
    // GET /employees/registered-date - Find By Registered Date
    // ============================================
    describe("GET /employees/registered-date", () => {
        it("should return employees by registered date", async () => {
            // Arrange
            const date = "2025-01-15";
            const employees = [createMockEmployee({ registeredDate: new Date(date) })];
            employeeService.findByRegisteredDate.mockResolvedValue(employees);

            // Act
            const response = await request(app.getHttpServer())
                .get("/employees/registered-date")
                .query({ date });

            // Assert
            expect(response.status).toBe(200);
            expect(employeeService.findByRegisteredDate).toHaveBeenCalledWith(
                expect.any(String),
                new Date(date),
            );
        });

        it("should reject invalid registered date before calling service", async () => {
            const response = await request(app.getHttpServer())
                .get("/employees/registered-date")
                .query({ date: "not-a-date" });

            expect(response.status).toBe(400);
            expect(employeeService.findByRegisteredDate).not.toHaveBeenCalled();
        });
    });

    // ============================================
    // GET /employees/registered-range - Find By Date Range
    // ============================================
    describe("GET /employees/registered-range", () => {
        it("should return employees in date range", async () => {
            // Arrange
            const startDate = "2025-01-01";
            const endDate = "2025-01-31";
            const employees = [createMockEmployee({ id: 1 }), createMockEmployee({ id: 2 })];
            employeeService.findByRegisteredDateRange.mockResolvedValue(employees);

            // Act
            const response = await request(app.getHttpServer())
                .get("/employees/registered-range")
                .query({ startDate, endDate });

            // Assert
            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(2);
            expect(employeeService.findByRegisteredDateRange).toHaveBeenCalledWith(
                expect.any(String),
                new Date(startDate),
                new Date(endDate),
            );
        });
    });

    // ============================================
    // GET /employees/open-to-next-work - Find All Open To Next Work
    // ============================================
    describe("GET /employees/open-to-next-work", () => {
        it("should return all employees open to next work", async () => {
            // Arrange
            const employees = [
                createMockEmployee({ id: 1, openToNextWork: true }),
                createMockEmployee({ id: 2, openToNextWork: true }),
            ];
            employeeService.findAllOpenToNextWork.mockResolvedValue(employees);

            // Act
            const response = await request(app.getHttpServer())
                .get("/employees/open-to-next-work");

            // Assert
            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(2);
            expect(employeeService.findAllOpenToNextWork).toHaveBeenCalledWith(expect.any(String));
        });
    });

    // ============================================
    // PATCH /employees/open-status - Change Open Status
    // ============================================
    describe("PATCH /employees/open-status", () => {
        it("should change employee open status to true", async () => {
            // Arrange
            const updatedEmployee = createMockEmployee({ id: 5, openToNextWork: true });
            employeeService.changeOpenStatus.mockResolvedValue(updatedEmployee);

            // Act
            const response = await request(app.getHttpServer())
                .patch("/employees/open-status")
                .query({ id: "5" })
                .send({ openToNextWork: true });

            // Assert
            expect(response.status).toBe(200);
            expect(employeeService.changeOpenStatus).toHaveBeenCalledWith(expect.any(String), 5, true);
        });

        it("should change employee open status to false", async () => {
            // Arrange
            const updatedEmployee = createMockEmployee({ id: 3, openToNextWork: false });
            employeeService.changeOpenStatus.mockResolvedValue(updatedEmployee);

            // Act
            const response = await request(app.getHttpServer())
                .patch("/employees/open-status")
                .query({ id: "3" })
                .send({ openToNextWork: false });

            // Assert
            expect(response.status).toBe(200);
            expect(employeeService.changeOpenStatus).toHaveBeenCalledWith(expect.any(String), 3, false);
        });
    });

    // ============================================
    // PATCH /employees - Update
    // ============================================
    describe("PATCH /employees", () => {
        describe("given valid update data", () => {
            it("should update the employee", async () => {
                // Arrange
                const updateDto = {
                    name: "Updated Name",
                    grade: "스탠다드",
                };
                const updatedEmployee = createMockEmployee({ id: 3, ...updateDto });
                employeeService.update.mockResolvedValue(updatedEmployee);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/employees")
                    .query({ id: "3" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(employeeService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    3,
                    expect.objectContaining({
                        name: "Updated Name",
                        grade: "스탠다드",
                    }),
                );
            });
        });

        describe("given partial update", () => {
            it("should only update provided fields", async () => {
                // Arrange
                const partialDto = { phone: "010-0000-0000" };
                const updatedEmployee = createMockEmployee({ id: 4, phone: "010-0000-0000" });
                employeeService.update.mockResolvedValue(updatedEmployee);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/employees")
                    .query({ id: "4" })
                    .send(partialDto);

                // Assert
                expect(response.status).toBe(200);
                expect(employeeService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    4,
                    expect.objectContaining({
                        phone: "010-0000-0000",
                    }),
                );
            });
        });

        describe("given workArea update", () => {
            it("should update workArea array", async () => {
                // Arrange
                const updateDto = { workArea: ["Seoul", "Busan", "Daegu"] };
                const updatedEmployee = createMockEmployee({ id: 2, ...updateDto });
                employeeService.update.mockResolvedValue(updatedEmployee);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/employees")
                    .query({ id: "2" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(employeeService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    2,
                    expect.objectContaining({
                        workArea: ["Seoul", "Busan", "Daegu"],
                    }),
                );
            });
        });
    });

    // ============================================
    // DELETE /employees - Delete
    // ============================================
    describe("DELETE /employees", () => {
        describe("given valid employee id", () => {
            it("should delete the employee", async () => {
                // Arrange
                employeeService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/employees")
                    .query({ id: "8" });

                // Assert
                expect(response.status).toBe(200);
                expect(employeeService.delete).toHaveBeenCalledWith(expect.any(String), 8);
            });
        });

        describe("given different employee ids", () => {
            it.each([1, 10, 100, 999])("should delete employee with id %i", async (id) => {
                // Arrange
                employeeService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/employees")
                    .query({ id: String(id) });

                // Assert
                expect(response.status).toBe(200);
                expect(employeeService.delete).toHaveBeenCalledWith(expect.any(String), id);
            });
        });
    });
});
