import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { AreaTemplateController } from "interface/controllers/area-template.controller";
import { AreaTemplateService } from "application/services/area-template.service";
import {
    AreaTemplateEntity,
    AvailableAreaEntity,
} from "domain/entities/area-template.entity";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";

describe("AreaTemplateController (Integration)", () => {
    // ============================================
    // Test Fixtures & Setup
    // ============================================

    let app: INestApplication;
    let areaTemplateService: jest.Mocked<AreaTemplateService>;

    type AreaTemplateOverrides = Partial<{
        id: string;
        areaId: string;
        templateId: string;
        templateName: string | null;
    }>;

    const createMockAreaTemplate = (overrides: AreaTemplateOverrides = {}): AreaTemplateEntity => {
        return new AreaTemplateEntity(
            overrides.id ?? "template-uuid-1",
            overrides.areaId ?? "Seoul",
            overrides.templateId ?? "eform-template-001",
            overrides.templateName ?? "서울 계약서 템플릿",
        );
    };

    beforeEach(async () => {
        const mockAreaTemplateService = {
            create: jest.fn(),
            findByArea: jest.fn(),
            findAll: jest.fn(),
            findAvailableAreas: jest.fn(),
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
            controllers: [AreaTemplateController],
            providers: [
                {
                    provide: AreaTemplateService,
                    useValue: mockAreaTemplateService,
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

        areaTemplateService = moduleFixture.get(AreaTemplateService);
    });

    afterEach(async () => {
        await app.close();
    });

    // ============================================
    // POST /area-templates - Create
    // ============================================
    describe("POST /area-templates", () => {
        describe("given valid area template data", () => {
            it("should create a new area template and return 201", async () => {
                // Arrange
                const createDto = {
                    area: "Incheon",
                    templateId: "eform-template-002",
                    templateName: "인천 계약서 템플릿",
                };
                const createdTemplate = createMockAreaTemplate({
                    id: "new-uuid",
                    areaId: "Incheon",
                    templateId: "eform-template-002",
                    templateName: "인천 계약서 템플릿",
                });
                areaTemplateService.create.mockResolvedValue(createdTemplate);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/area-templates")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(areaTemplateService.create).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        area: "Incheon",
                        templateId: "eform-template-002",
                        templateName: "인천 계약서 템플릿",
                    }),
                );
            });
        });

        describe("given area template without templateName", () => {
            it("should create template with null templateName", async () => {
                // Arrange
                const createDto = {
                    area: "Busan",
                    templateId: "eform-template-003",
                };
                const createdTemplate = createMockAreaTemplate({
                    id: "busan-uuid",
                    areaId: "Busan",
                    templateId: "eform-template-003",
                    templateName: null,
                });
                areaTemplateService.create.mockResolvedValue(createdTemplate);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/area-templates")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(areaTemplateService.create).toHaveBeenCalledWith(
                    expect.any(String),
                    expect.objectContaining({
                        area: "Busan",
                        templateId: "eform-template-003",
                    }),
                );
            });
        });

        describe("given different areas", () => {
            it.each([
                "Seoul",
                "Incheon",
                "Busan",
                "Daegu",
                "Gwangju",
            ])("should create template for area %s", async (area) => {
                // Arrange
                const createDto = {
                    area,
                    templateId: `template-${area.toLowerCase()}`,
                };
                const createdTemplate = createMockAreaTemplate({
                    areaId: area,
                    templateId: createDto.templateId,
                });
                areaTemplateService.create.mockResolvedValue(createdTemplate);

                // Act
                const response = await request(app.getHttpServer())
                    .post("/area-templates")
                    .send(createDto);

                // Assert
                expect(response.status).toBe(201);
                expect(areaTemplateService.create).toHaveBeenCalled();
            });
        });
    });

    // ============================================
    // GET /area-templates/available-areas - List Available Areas
    // ============================================
    describe("GET /area-templates/available-areas", () => {
        it("should return branch-local and global areas for the current tenant", async () => {
            const areas = [
                new AvailableAreaEntity("Yeonsugu", "Yeonsu-gu", "연수구"),
                new AvailableAreaEntity("GlobalSupport", "Global support", "공통 지원 지역"),
            ];
            areaTemplateService.findAvailableAreas.mockResolvedValue(areas);

            const response = await request(app.getHttpServer())
                .get("/area-templates/available-areas");

            expect(response.status).toBe(200);
            expect(response.body).toEqual([
                { id: "Yeonsugu", name: "Yeonsu-gu", koreanName: "연수구" },
                { id: "GlobalSupport", name: "Global support", koreanName: "공통 지원 지역" },
            ]);
            expect(areaTemplateService.findAvailableAreas).toHaveBeenCalledWith("org-1");
        });
    });

    // ============================================
    // GET /area-templates - List All
    // ============================================
    describe("GET /area-templates", () => {
        describe("given area templates exist", () => {
            it("should return all area templates", async () => {
                // Arrange
                const templates = [
                    createMockAreaTemplate({ id: "1", areaId: "Seoul" }),
                    createMockAreaTemplate({ id: "2", areaId: "Incheon" }),
                    createMockAreaTemplate({ id: "3", areaId: "Busan" }),
                ];
                areaTemplateService.findAll.mockResolvedValue(templates);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/area-templates");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toHaveLength(3);
                expect(areaTemplateService.findAll).toHaveBeenCalledWith(expect.any(String));
            });
        });

        describe("given no area templates exist", () => {
            it("should return empty array", async () => {
                // Arrange
                areaTemplateService.findAll.mockResolvedValue([]);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/area-templates");

                // Assert
                expect(response.status).toBe(200);
                expect(response.body).toEqual([]);
            });
        });
    });

    // ============================================
    // GET /area-templates/area - Find By Area
    // ============================================
    describe("GET /area-templates/area", () => {
        describe("given area template exists", () => {
            it("should return the area template", async () => {
                // Arrange
                const template = createMockAreaTemplate({
                    id: "seoul-template",
                    areaId: "Seoul",
                    templateId: "eform-seoul-001",
                });
                areaTemplateService.findByArea.mockResolvedValue(template);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/area-templates/area")
                    .query({ area: "Seoul" });

                // Assert
                expect(response.status).toBe(200);
                expect(areaTemplateService.findByArea).toHaveBeenCalledWith(expect.any(String), "Seoul");
            });
        });

        describe("given area template does not exist", () => {
            it("should return null from service", async () => {
                // Arrange
                areaTemplateService.findByArea.mockResolvedValue(null);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/area-templates/area")
                    .query({ area: "NonExistentArea" });

                // Assert
                expect(response.status).toBe(200);
                expect(areaTemplateService.findByArea).toHaveBeenCalledWith(
                    expect.any(String),
                    "NonExistentArea"
                );
            });
        });

        describe("given different area queries", () => {
            it.each([
                "서울",
                "인천",
                "부산",
                "Seoul-West",
                "Incheon-Yeonsu",
            ])("should find template for area %s", async (area) => {
                // Arrange
                const template = createMockAreaTemplate({ areaId: area });
                areaTemplateService.findByArea.mockResolvedValue(template);

                // Act
                const response = await request(app.getHttpServer())
                    .get("/area-templates/area")
                    .query({ area });

                // Assert
                expect(response.status).toBe(200);
                expect(areaTemplateService.findByArea).toHaveBeenCalledWith(expect.any(String), area);
            });
        });
    });

    // ============================================
    // PATCH /area-templates - Update
    // ============================================
    describe("PATCH /area-templates", () => {
        describe("given valid update data", () => {
            it("should update the area template", async () => {
                // Arrange
                const updateDto = {
                    templateId: "eform-updated-001",
                    templateName: "업데이트된 템플릿",
                };
                const updatedTemplate = createMockAreaTemplate({
                    areaId: "Seoul",
                    templateId: "eform-updated-001",
                    templateName: "업데이트된 템플릿",
                });
                areaTemplateService.update.mockResolvedValue(updatedTemplate);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/area-templates")
                    .query({ area: "Seoul" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(areaTemplateService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    "Seoul",
                    expect.objectContaining({
                        templateId: "eform-updated-001",
                        templateName: "업데이트된 템플릿",
                    }),
                );
            });
        });

        describe("given templateId only update", () => {
            it("should update only templateId", async () => {
                // Arrange
                const updateDto = { templateId: "new-template-id" };
                const updatedTemplate = createMockAreaTemplate({
                    areaId: "Incheon",
                    templateId: "new-template-id",
                });
                areaTemplateService.update.mockResolvedValue(updatedTemplate);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/area-templates")
                    .query({ area: "Incheon" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(areaTemplateService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    "Incheon",
                    expect.objectContaining({
                        templateId: "new-template-id",
                    }),
                );
            });
        });

        describe("given templateName null update", () => {
            it("should set templateName to null", async () => {
                // Arrange
                const updateDto = { templateName: null };
                const updatedTemplate = createMockAreaTemplate({
                    areaId: "Busan",
                    templateName: null,
                });
                areaTemplateService.update.mockResolvedValue(updatedTemplate);

                // Act
                const response = await request(app.getHttpServer())
                    .patch("/area-templates")
                    .query({ area: "Busan" })
                    .send(updateDto);

                // Assert
                expect(response.status).toBe(200);
                expect(areaTemplateService.update).toHaveBeenCalledWith(
                    expect.any(String),
                    "Busan",
                    expect.objectContaining({
                        templateName: null,
                    }),
                );
            });
        });
    });

    // ============================================
    // DELETE /area-templates - Delete
    // ============================================
    describe("DELETE /area-templates", () => {
        describe("given valid area", () => {
            it("should delete the area template", async () => {
                // Arrange
                areaTemplateService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/area-templates")
                    .query({ area: "Seoul" });

                // Assert
                expect(response.status).toBe(200);
                expect(areaTemplateService.delete).toHaveBeenCalledWith(expect.any(String), "Seoul");
            });
        });

        describe("given different areas", () => {
            it.each([
                "Seoul",
                "Incheon",
                "Busan",
                "서울",
                "인천-연수구",
            ])("should delete area template for area %s", async (area) => {
                // Arrange
                areaTemplateService.delete.mockResolvedValue(undefined);

                // Act
                const response = await request(app.getHttpServer())
                    .delete("/area-templates")
                    .query({ area });

                // Assert
                expect(response.status).toBe(200);
                expect(areaTemplateService.delete).toHaveBeenCalledWith(expect.any(String), area);
            });
        });
    });
});
