import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import request from "supertest";
import { BankAccountInfoController } from "interface/controllers/bank-account-info.controller";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";

describe("BankAccountInfoController (Integration)", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    const BRANCH_A = "branch-a-id";
    const BRANCH_B = "branch-b-id";

    let app: INestApplication;
    let bankAccountInfoService: jest.Mocked<BankAccountInfoService>;
    // Reassignable per-test so individual tests can simulate a different caller (a different
    // branch's admin, or a session missing branchId) without re-compiling the testing module.
    let currentUser: { userId: string; role: string; branchId?: string };

    type BankAccountInfoOverrides = Partial<{
        area: string;
        bankName: string | null;
        accNum: string | null;
    }>;

    const createMockBankAccountInfo = (overrides: BankAccountInfoOverrides = {}): BankAccountInfoEntity => {
        return new BankAccountInfoEntity(
            overrides.area ?? "Seoul",
            overrides.bankName ?? "신한은행",
            overrides.accNum ?? "110-123-456789",
        );
    };

    const getMethodGuards = (methodName: "findAll" | "findByArea") => {
        return Reflect.getMetadata(
            GUARDS_METADATA,
            BankAccountInfoController.prototype[methodName],
        ) ?? [];
    };

    beforeEach(async () => {
        currentUser = { userId: "owner-user-id", role: "owner", branchId: BRANCH_A };

        const mockBankAccountInfoService = {
            create: jest.fn(),
            findAll: jest.fn(),
            findByArea: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [BankAccountInfoController],
            providers: [
                {
                    provide: BankAccountInfoService,
                    useValue: mockBankAccountInfoService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue({
                canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
                    const request = context.switchToHttp().getRequest();
                    request.user = currentUser;
                    return true;
                },
            })
            .overrideGuard(OwnerOrAdminGuard)
            .useValue({ canActivate: () => true })
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        bankAccountInfoService = moduleFixture.get(BankAccountInfoService);
    });

    afterEach(async () => {
        await app.close();
    });

    // ============================================
    // POST /bank-account-infos - Create
    // ============================================
    describe("POST /bank-account-infos", () => {
        describe("given valid bank account info data", () => {
            it("should create a new bank account info and return 201", async () => {
                // Arrange
                const createDto = {
                    area: "Incheon",
                    bankName: "국민은행",
                    accNum: "123-456-789012",
                };
                const createdInfo = createMockBankAccountInfo(createDto);
                bankAccountInfoService.create.mockResolvedValue(createdInfo);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/bank-account-infos")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(bankAccountInfoService.create).toHaveBeenCalledWith(
                    expect.objectContaining({
                        area: "Incheon",
                        bankName: "국민은행",
                        accNum: "123-456-789012",
                    }),
                    BRANCH_A,
                );
            });
        });

        describe("given the caller's session has no selected branch", () => {
            it("should fail closed with 403 and never reach the service", async () => {
                currentUser = { userId: "owner-user-id", role: "owner" };

                const response = await request(app.getHttpServer())
                    .post("/bank-account-infos")
                    .send({ area: "Incheon", bankName: "국민은행", accNum: "123-456-789012" });

                expect(response.status).toBe(403);
                expect(bankAccountInfoService.create).not.toHaveBeenCalled();
            });
        });

        describe("given a caller from a different branch", () => {
            it("should pass the CALLER's branch, never a client-supplied one — the usecase rejects a foreign area", async () => {
                // The area id in the body is client-supplied and is NOT authorization:
                // the controller forwards only the session branch, so a branch-B admin
                // writing against a branch-A area id is rejected downstream.
                currentUser = { userId: "admin-user-id", role: "admin", branchId: BRANCH_B };
                bankAccountInfoService.create.mockResolvedValue(createMockBankAccountInfo());

                await request(app.getHttpServer())
                    .post("/bank-account-infos")
                    .send({ area: "branch-a-area", bankName: "국민은행", accNum: "123-456-789012" });

                expect(bankAccountInfoService.create).toHaveBeenCalledWith(
                    expect.objectContaining({ area: "branch-a-area" }),
                    BRANCH_B,
                );
            });
        });

        describe("given different bank names", () => {
            it.each([
                "신한은행",
                "국민은행",
                "우리은행",
                "하나은행",
                "농협",
            ])("should create bank account info with bank %s", async (bankName) => {
                // Arrange
                const createDto = {
                    area: "TestArea",
                    bankName,
                    accNum: "111-222-333444",
                };
                const createdInfo = createMockBankAccountInfo(createDto);
                bankAccountInfoService.create.mockResolvedValue(createdInfo);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/bank-account-infos")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(bankAccountInfoService.create).toHaveBeenCalledWith(
                    expect.objectContaining({ bankName }),
                    BRANCH_A,
                );
            });
        });
    });

    // ============================================
    // GET /bank-account-infos - List All
    // ============================================
    describe("GET /bank-account-infos", () => {
        it("should require owner/admin authentication", () => {
            expect(getMethodGuards("findAll")).toEqual(
                expect.arrayContaining([JwtGuard, OwnerOrAdminGuard]),
            );
        });

        describe("given bank account infos exist", () => {
            it("should return all bank account infos scoped to the caller's branch", async () => {
                // Arrange
                const infos = [
                    createMockBankAccountInfo({ area: "Seoul" }),
                    createMockBankAccountInfo({ area: "Busan" }),
                    createMockBankAccountInfo({ area: "Incheon" }),
                ];
                bankAccountInfoService.findAll.mockResolvedValue(infos);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toHaveLength(3);
                expect(bankAccountInfoService.findAll).toHaveBeenCalledWith(BRANCH_A);
            });
        });

        describe("given no bank account infos exist", () => {
            it("should return empty array", async () => {
                // Arrange
                bankAccountInfoService.findAll.mockResolvedValue([]);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });

        describe("given a different branch's admin session (negative case)", () => {
            it("should pass that caller's own branch, not a hardcoded one", async () => {
                // Arrange
                currentUser = { ...currentUser, branchId: BRANCH_B };
                bankAccountInfoService.findAll.mockResolvedValue([]);

                // Act
                await request(app.getHttpServer()).get("/bank-account-infos");

                // Assert
                expect(bankAccountInfoService.findAll).toHaveBeenCalledWith(BRANCH_B);
                expect(bankAccountInfoService.findAll).not.toHaveBeenCalledWith(BRANCH_A);
            });
        });

        describe("given a session without a selected branch (fail-closed)", () => {
            it("should return 403 and never call the service", async () => {
                // Arrange
                currentUser = { userId: "owner-user-id", role: "owner" };

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos");

                // Assert
                expect(response.status).toBe(403);
                expect(bankAccountInfoService.findAll).not.toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // GET /bank-account-infos/area - Find By Area
    // ============================================
    describe("GET /bank-account-infos/area", () => {
        it("should require owner/admin authentication", () => {
            expect(getMethodGuards("findByArea")).toEqual(
                expect.arrayContaining([JwtGuard, OwnerOrAdminGuard]),
            );
        });

        describe("given bank account info exists for area", () => {
            it("should return the bank account info", async () => {
                // Arrange
                const info = createMockBankAccountInfo({
                    area: "Daegu",
                    bankName: "대구은행",
                    accNum: "999-888-777666",
                });
                bankAccountInfoService.findByArea.mockResolvedValue(info);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos/area")
                    .query({ area: "Daegu" });

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.findByArea).toHaveBeenCalledWith("Daegu", BRANCH_A);
            });
        });

        describe("given bank account info does not exist for area", () => {
            it("should return null from service", async () => {
                // Arrange
                bankAccountInfoService.findByArea.mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos/area")
                    .query({ area: "NonexistentArea" });

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.findByArea).toHaveBeenCalledWith("NonexistentArea", BRANCH_A);
            });
        });

        describe("given different area names", () => {
            it.each([
                "Seoul",
                "Busan",
                "Incheon",
                "Daegu",
                "Gwangju",
            ])("should find bank account info for area %s", async (area) => {
                // Arrange
                const info = createMockBankAccountInfo({ area });
                bankAccountInfoService.findByArea.mockResolvedValue(info);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos/area")
                    .query({ area });

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.findByArea).toHaveBeenCalledWith(area, BRANCH_A);
            });
        });

        describe("given a different branch's admin session (negative case)", () => {
            it("should pass that caller's own branch, not a hardcoded one", async () => {
                // Arrange
                currentUser = { ...currentUser, branchId: BRANCH_B };
                bankAccountInfoService.findByArea.mockResolvedValue(null);

                // Act
                await request(app.getHttpServer())
                    .get("/bank-account-infos/area")
                    .query({ area: "Daegu" });

                // Assert
                expect(bankAccountInfoService.findByArea).toHaveBeenCalledWith("Daegu", BRANCH_B);
                expect(bankAccountInfoService.findByArea).not.toHaveBeenCalledWith("Daegu", BRANCH_A);
            });
        });

        describe("given a session without a selected branch (fail-closed)", () => {
            it("should return 403 and never call the service", async () => {
                // Arrange
                currentUser = { userId: "owner-user-id", role: "owner" };

                // Act
                const response = await request(app.getHttpServer())
                    .get("/bank-account-infos/area")
                    .query({ area: "Daegu" });

                // Assert
                expect(response.status).toBe(403);
                expect(bankAccountInfoService.findByArea).not.toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // PATCH /bank-account-infos - Update
    // ============================================
    describe("PATCH /bank-account-infos", () => {
        describe("given valid update data", () => {
            it("should update the bank account info", async () => {
                // Arrange
                const updateDto = {
                    bankName: "우리은행",
                    accNum: "111-222-333444",
                };
                const updatedInfo = createMockBankAccountInfo({
                    area: "Seoul",
                    ...updateDto,
                });
                bankAccountInfoService.update.mockResolvedValue(updatedInfo);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/bank-account-infos")
                    .query({ area: "Seoul" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.update).toHaveBeenCalledWith(
                    "Seoul",
                    expect.objectContaining({
                        bankName: "우리은행",
                        accNum: "111-222-333444",
                    }),
                    BRANCH_A,
                );
            });
        });

        describe("given partial update (only bankName)", () => {
            it("should only update bankName", async () => {
                // Arrange
                const partialDto = { bankName: "하나은행" };
                const updatedInfo = createMockBankAccountInfo({
                    area: "Busan",
                    bankName: "하나은행",
                });
                bankAccountInfoService.update.mockResolvedValue(updatedInfo);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/bank-account-infos")
                    .query({ area: "Busan" })
                    .send(partialDto);

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.update).toHaveBeenCalledWith(
                    "Busan",
                    expect.objectContaining({ bankName: "하나은행" }),
                    BRANCH_A,
                );
            });
        });

        describe("given partial update (only accNum)", () => {
            it("should only update accNum", async () => {
                // Arrange
                const partialDto = { accNum: "000-000-000000" };
                const updatedInfo = createMockBankAccountInfo({
                    area: "Incheon",
                    accNum: "000-000-000000",
                });
                bankAccountInfoService.update.mockResolvedValue(updatedInfo);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/bank-account-infos")
                    .query({ area: "Incheon" })
                    .send(partialDto);

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.update).toHaveBeenCalledWith(
                    "Incheon",
                    expect.objectContaining({ accNum: "000-000-000000" }),
                    BRANCH_A,
                );
            });
        });

        describe("given a different branch's admin session (negative case)", () => {
            it("should pass that caller's own branch, not a hardcoded one", async () => {
                // Arrange
                currentUser = { ...currentUser, branchId: BRANCH_B };
                const updatedInfo = createMockBankAccountInfo({ area: "Seoul", bankName: "우리은행" });
                bankAccountInfoService.update.mockResolvedValue(updatedInfo);

                // Act
                await request(app.getHttpServer())
                    .patch("/bank-account-infos")
                    .query({ area: "Seoul" })
                    .send({ bankName: "우리은행" });

                // Assert
                expect(bankAccountInfoService.update).toHaveBeenCalledWith(
                    "Seoul",
                    expect.objectContaining({ bankName: "우리은행" }),
                    BRANCH_B,
                );
            });
        });

        describe("given a session without a selected branch (fail-closed)", () => {
            it("should return 403 and never call the service", async () => {
                // Arrange
                currentUser = { userId: "owner-user-id", role: "owner" };

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/bank-account-infos")
                    .query({ area: "Seoul" })
                    .send({ bankName: "우리은행" });

                // Assert
                expect(response.status).toBe(403);
                expect(bankAccountInfoService.update).not.toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // DELETE /bank-account-infos - Delete
    // ============================================
    describe("DELETE /bank-account-infos", () => {
        describe("given valid area", () => {
            it("should delete the bank account info", async () => {
                // Arrange
                bankAccountInfoService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/bank-account-infos")
                    .query({ area: "Seoul" });

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.delete).toHaveBeenCalledWith("Seoul", BRANCH_A);
            });
        });

        describe("given different areas", () => {
            it.each([
                "Seoul",
                "Busan",
                "Incheon",
                "Daegu",
                "TestArea",
            ])("should delete bank account info for area %s", async (area) => {
                // Arrange
                bankAccountInfoService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/bank-account-infos")
                    .query({ area });

                // Assert
                expect(response.status).toBe(200);
                expect(bankAccountInfoService.delete).toHaveBeenCalledWith(area, BRANCH_A);
            });
        });

        describe("given a different branch's admin session (negative case)", () => {
            it("should pass that caller's own branch, not a hardcoded one", async () => {
                // Arrange
                currentUser = { ...currentUser, branchId: BRANCH_B };
                bankAccountInfoService.delete.mockResolvedValue(undefined);

                // Act
                await request(app.getHttpServer())
                    .delete("/bank-account-infos")
                    .query({ area: "Seoul" });

                // Assert
                expect(bankAccountInfoService.delete).toHaveBeenCalledWith("Seoul", BRANCH_B);
            });
        });

        describe("given a session without a selected branch (fail-closed)", () => {
            it("should return 403 and never call the service", async () => {
                // Arrange
                currentUser = { userId: "owner-user-id", role: "owner" };

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/bank-account-infos")
                    .query({ area: "Seoul" });

                // Assert
                expect(response.status).toBe(403);
                expect(bankAccountInfoService.delete).not.toHaveBeenCalled();
            });
        });
    });
});
