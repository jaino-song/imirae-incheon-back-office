import { BadRequestException, ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AreaTemplateService } from "application/services/area-template.service";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignService } from "application/services/eformsign.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { EformsignController } from "interface/controllers/eformsign.controller";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";
import { EformsignDocumentSnapshotService } from "application/services/eformsign-document-snapshot.service";
import request from "supertest";

// Known transport-level flake (~1/8 full-suite runs under parallel-worker
// load, observed locally 2026-06-06 and once in CI): a supertest request
// intermittently dies with "socket hang up" on the early-400 validation
// paths. Retry masks only the transport race — a deterministic failure
// still fails on the retry.
jest.retryTimes(1, { logErrorsBeforeRetry: true });

describe("EformsignController (Integration)", () => {
    let app: INestApplication;
    let eformsignService: jest.Mocked<Pick<
        EformsignService,
        | "generateSignature"
        | "getAccessToken"
        | "refreshAccessToken"
        | "generateDocumentOptions"
        | "deleteDocuments"
        | "downloadDocumentFile"
        | "getAllDocuments"
        | "getInProgressDocuments"
        | "getCompletedDocuments"
        | "getDocumentById"
    >>;
    let areaTemplateService: jest.Mocked<Pick<AreaTemplateService, "findByArea">>;
    let eformsignDocService: jest.Mocked<Pick<EformsignDocService, "findAll" | "findDocumentIdsForOtherBranches">>;
    let assignmentGuard: jest.Mocked<Pick<ContractClientAssignmentGuardService, "assertAssignedProvider">>;
    let branchFindUnique: jest.Mock;

    const authGuard = {
        canActivate: (context: ExecutionContext) => {
            const requestContext = context.switchToHttp().getRequest();
            requestContext.user = {
                userId: "user-1",
                branchId: "branch-1",
                role: "owner",
                branchRole: "owner",
            };
            requestContext.tenant = {
                userId: "user-1",
                branchId: "branch-1",
                globalRole: "owner",
                branchRole: "owner",
            };
            return true;
        },
    };

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [EformsignController],
            providers: [
                {
                    provide: EformsignService,
                    useValue: {
                        generateSignature: jest.fn(),
                        getAccessToken: jest.fn(),
                        refreshAccessToken: jest.fn(),
                        generateDocumentOptions: jest.fn(),
                        deleteDocuments: jest.fn(),
                        downloadDocumentFile: jest.fn(),
                        getAllDocuments: jest.fn(),
                        getInProgressDocuments: jest.fn(),
                        getCompletedDocuments: jest.fn(),
                        getDocumentById: jest.fn(),
                    },
                },
                {
                    provide: AreaTemplateService,
                    useValue: {
                        findByArea: jest.fn(),
                    },
                },
                {
                    provide: EformsignDocService,
                    useValue: {
                        findAll: jest.fn(),
                        findDocumentIdsForOtherBranches: jest.fn(),
                    },
                },
                {
                    provide: PrismaService,
                    useValue: {
                        branch: { findUnique: jest.fn() },
                    },
                },
                {
                    provide: ContractClientAssignmentGuardService,
                    useValue: {
                        assertAssignedProvider: jest.fn().mockResolvedValue({ scheduleId: 1 }),
                    },
                },
                // 실제 구현을 그대로 쓴다. VALKEY_URL이 없는 테스트 환경에서는 프로세스
                // 로컬 in-memory 스토어로 동작하고, 인스턴스는 테스트마다 새로 만들어진다.
                EformsignDocumentSnapshotService,
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(authGuard)
            .overrideGuard(TenantGuard)
            .useValue(authGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        eformsignService = moduleFixture.get(EformsignService);
        areaTemplateService = moduleFixture.get(AreaTemplateService);
        eformsignDocService = moduleFixture.get(EformsignDocService);
        assignmentGuard = moduleFixture.get(ContractClientAssignmentGuardService);
        branchFindUnique = (moduleFixture.get(PrismaService) as unknown as { branch: { findUnique: jest.Mock } }).branch.findUnique;
        // default: a non-incheon branch, so per-branch filtering applies
        branchFindUnique.mockResolvedValue({ slug: "gimpo" });
        // default: no other-branch docs (overridden in incheon/HQ tests)
        eformsignDocService.findDocumentIdsForOtherBranches.mockResolvedValue([]);
        eformsignService.getDocumentById.mockImplementation(async (_accessToken: string, documentId: string) => ({ id: documentId }));
    });

    afterEach(async () => {
        await app.close();
    });

    it("rejects non-numeric signature execution time before service execution", async () => {
        const response = await request(app.getHttpServer())
            .post("/api/generate-signature")
            .send({ executionTime: "abc" });

        expect(response.status).toBe(400);
        expect(eformsignService.generateSignature).not.toHaveBeenCalled();
    });

    it("rejects missing refresh token before service execution", async () => {
        const response = await request(app.getHttpServer())
            .post("/api/refresh-token")
            .send({ executionTime: 1780000000000 });

        expect(response.status).toBe(400);
        expect(eformsignService.refreshAccessToken).not.toHaveBeenCalled();
    });

    it("rejects malformed contract data before generating document options", async () => {
        const response = await request(app.getHttpServer())
            .post("/api/generate-document")
            .send({
                contractData: {
                    customerName: "산모",
                },
                accessToken: "access-token",
                refreshToken: "refresh-token",
            });

        expect(response.status).toBe(400);
        expect(areaTemplateService.findByArea).not.toHaveBeenCalled();
        expect(eformsignService.generateDocumentOptions).not.toHaveBeenCalled();
    });

    it("rejects document generation before calling eformsign when the client has no assignment", async () => {
        assignmentGuard.assertAssignedProvider.mockRejectedValue(
            new BadRequestException("고객의 제공인력 배정을 먼저 저장해 주세요."),
        );

        const response = await request(app.getHttpServer())
            .post("/api/generate-document")
            .send({
                clientId: 55,
                accessToken: "access-token",
                refreshToken: "refresh-token",
                contractData: {
                    customerName: "산모",
                    customerContact: "010-1111-2222",
                    customerDOB: "900101",
                    customerAddress: "인천",
                    caretaker1Name: "관리사",
                    caretaker1Contact: "010-9999-8888",
                    type: "A형",
                    days: "10",
                    area: "namdong",
                    contractDuration: "2026-07-01 ~ 2026-07-14",
                    startYear: "26",
                    startMonth: "07",
                    startDay: "01",
                    startDate: "2026-07-01",
                    endYear: "26",
                    endMonth: "07",
                    endDay: "14",
                    endDate: "2026-07-14",
                    paymentYear: "26",
                    paymentMonth: "07",
                    paymentDay: "01",
                    fullPrice: "1000000",
                    grant: "800000",
                    actualPrice: "200000",
                },
            });

        expect(response.status).toBe(400);
        expect(assignmentGuard.assertAssignedProvider).toHaveBeenCalledWith(
            "branch-1",
            55,
            "010-9999-8888",
        );
        expect(eformsignService.generateDocumentOptions).not.toHaveBeenCalled();
    });

    it("rejects invalid delete permanence query before service execution", async () => {
        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=maybe")
            .send({ document_ids: ["doc-1"] });

        expect(response.status).toBe(400);
        expect(eformsignService.deleteDocuments).not.toHaveBeenCalled();
    });

    it("rejects invalid download file type before service execution", async () => {
        const response = await request(app.getHttpServer())
            .get("/api/documents/doc-1/download_files?accessToken=access-token&fileType=zip");

        expect(response.status).toBe(400);
        expect(eformsignService.downloadDocumentFile).not.toHaveBeenCalled();
    });

    it("forbids downloading a document owned by another branch", async () => {
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "branch-1-doc" }] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents/other-branch-doc/download_files?accessToken=access-token");

        expect(response.status).toBe(403);
        expect(eformsignService.downloadDocumentFile).not.toHaveBeenCalled();
    });

    it("forbids the headquarters branch from downloading another branch's document", async () => {
        branchFindUnique.mockResolvedValue({ slug: "incheon" });
        eformsignDocService.findDocumentIdsForOtherBranches.mockResolvedValue(["other-branch-doc"]);

        const response = await request(app.getHttpServer())
            .get("/api/documents/other-branch-doc/download_files?accessToken=access-token");

        expect(response.status).toBe(403);
        expect(eformsignService.downloadDocumentFile).not.toHaveBeenCalled();
    });

    it("lets the headquarters branch download an unmapped document", async () => {
        branchFindUnique.mockResolvedValue({ slug: "incheon" });
        eformsignDocService.findDocumentIdsForOtherBranches.mockResolvedValue(["other-branch-doc"]);
        eformsignService.downloadDocumentFile.mockResolvedValue({
            status: 200,
            contentType: "application/pdf",
            contentDisposition: "attachment; filename=document.pdf",
            body: Buffer.from("pdf"),
        });

        const response = await request(app.getHttpServer())
            .get("/api/documents/unmapped-doc/download_files?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(eformsignService.downloadDocumentFile).toHaveBeenCalledWith(
            "access-token",
            "unmapped-doc",
            "document",
        );
    });

    it("returns only documents created by the current branch (getAllDocuments)", async () => {
        eformsignService.getAllDocuments.mockResolvedValue({
            documents: [
                { id: "branch-1-doc" },
                { id: "other-branch-doc" },
                { id: "unmapped-doc" },
            ],
            total_rows: 3,
            limit: 100,
            skip: 0,
        });
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "branch-1-doc" },
        ] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([{ id: "branch-1-doc" }]);
        expect(response.body.total_rows).toBe(1);
        expect(eformsignDocService.findAll).toHaveBeenCalledWith("branch-1");
    });

    it("paginates the template-included branch document set", async () => {
        eformsignService.getAllDocuments.mockResolvedValue({
            documents: [
                { id: "service-record-doc", template: { id: "service-record-template" } },
                { id: "contract-doc", template: { id: "contract-template" } },
            ],
            total_rows: 2,
            limit: 100,
            skip: 0,
        });
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "service-record-doc" },
            { documentId: "contract-doc" },
        ] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&templateId=service-record-template&templateMatch=include");

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            documents: [{ id: "service-record-doc", template: { id: "service-record-template" } }],
            total_rows: 1,
        });
    });

    it("paginates the template-excluded branch document set", async () => {
        eformsignService.getAllDocuments.mockResolvedValue({
            documents: [
                { id: "service-record-doc", template: { id: "service-record-template" } },
                { id: "contract-doc", template: { id: "contract-template" } },
            ],
            total_rows: 2,
            limit: 100,
            skip: 0,
        });
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "service-record-doc" },
            { documentId: "contract-doc" },
        ] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&templateId=service-record-template&templateMatch=exclude");

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            documents: [{ id: "contract-doc", template: { id: "contract-template" } }],
            total_rows: 1,
        });
    });

    it("returns an empty completed page when no branch document matches the template", async () => {
        eformsignService.getCompletedDocuments.mockResolvedValue({
            documents: [{ id: "contract-doc", template: { id: "contract-template" } }],
        });
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "contract-doc" }] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents/completed?accessToken=access-token&templateId=service-record-template&templateMatch=include");

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ documents: [], total_rows: 0 });
    });

    it("rejects an unsupported template match mode", async () => {
        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&templateId=service-record-template&templateMatch=unknown");

        expect(response.status).toBe(400);
        expect(eformsignService.getAllDocuments).not.toHaveBeenCalled();
    });

    it("filters per-type document lists to the current branch (no bypass)", async () => {
        eformsignService.getInProgressDocuments.mockResolvedValue({
            documents: [
                { id: "branch-1-doc" },
                { id: "other-branch-doc" },
            ],
        });
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "branch-1-doc" },
        ] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents/in-progress?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([{ id: "branch-1-doc" }]);
        expect(eformsignDocService.findAll).toHaveBeenCalledWith("branch-1");
    });

    it("finds current-branch status documents after pages containing only other branches", async () => {
        const otherBranchDocuments = Array.from({ length: 100 }, (_, index) => ({
            id: `other-branch-doc-${index}`,
        }));
        eformsignService.getInProgressDocuments.mockImplementation((async (_token: string, _limit: number, skip: number) => {
            if (skip === 0) {
                return { documents: otherBranchDocuments, total_rows: 101, limit: 100, skip: 0 };
            }
            if (skip === 100) {
                return { documents: [{ id: "branch-1-doc" }], total_rows: 101, limit: 100, skip: 100 };
            }
            return { documents: [], total_rows: 101, limit: 100, skip };
        }) as any);
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "branch-1-doc" }] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents/in-progress?accessToken=access-token&limit=20&skip=0");

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            documents: [{ id: "branch-1-doc" }],
            total_rows: 1,
            limit: 20,
            skip: 0,
        });
        expect(eformsignService.getInProgressDocuments).toHaveBeenNthCalledWith(1, "access-token", 100, 0);
        expect(eformsignService.getInProgressDocuments).toHaveBeenNthCalledWith(2, "access-token", 100, 100);
    });

    it("enriches per-type branch-filtered documents with customer fields", async () => {
        eformsignService.getInProgressDocuments.mockResolvedValue({
            documents: [
                { id: "branch-1-doc" },
                { id: "other-branch-doc" },
            ],
        });
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "branch-1-doc" },
        ] as any);
        eformsignService.getDocumentById.mockResolvedValueOnce({
            id: "branch-1-doc",
            fields: [{ id: "이용자 성명", value: "송진호" }],
        });

        const response = await request(app.getHttpServer())
            .get("/api/documents/in-progress?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([
            {
                id: "branch-1-doc",
                fields: [{ id: "이용자 성명", value: "송진호" }],
            },
        ]);
        expect(eformsignService.getDocumentById).toHaveBeenCalledTimes(1);
        expect(eformsignService.getDocumentById).toHaveBeenCalledWith("access-token", "branch-1-doc");
    });

    it("lets the incheon (HQ) branch see its own + unmapped docs, excluding other branches'", async () => {
        branchFindUnique.mockResolvedValue({ slug: "incheon" });
        // branch-1 (incheon) created branch-1-doc; other-branch-doc is owned by another
        // branch; unmapped-doc has no local mapping. Incheon sees its own + unmapped.
        eformsignDocService.findDocumentIdsForOtherBranches.mockResolvedValue(["other-branch-doc"]);
        eformsignService.getAllDocuments.mockImplementation((async (_token: string, _limit?: number, skip?: number) => {
            if (skip === 0) {
                return {
                    documents: [
                        { id: "branch-1-doc" },
                        { id: "other-branch-doc" },
                        { id: "unmapped-doc" },
                    ],
                    total_rows: 3,
                    limit: 100,
                    skip: 0,
                };
            }
            return { documents: [], total_rows: 0, limit: 100, skip: skip ?? 0 };
        }) as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([
            { id: "branch-1-doc" },
            { id: "unmapped-doc" },
        ]);
        expect(response.body.total_rows).toBe(2);
        expect(eformsignDocService.findDocumentIdsForOtherBranches).toHaveBeenCalledWith("branch-1");
        expect(eformsignDocService.findAll).not.toHaveBeenCalled();
    });

    it("loads branch contracts from a later company page (no early stop on an empty first page)", async () => {
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "late-doc" }] as any);
        eformsignService.getAllDocuments.mockImplementation((async (_accessToken: string, _limit?: number, skip?: number) => {
            if (skip === 0) {
                // first company page holds only other branches' docs (non-empty → old code would stop here)
                return { documents: [{ id: "other-a" }, { id: "other-b" }], total_rows: 2, limit: 100, skip: 0 };
            }
            if (skip === 100) {
                return { documents: [{ id: "late-doc" }, { id: "other-c" }], total_rows: 2, limit: 100, skip: 100 };
            }
            return { documents: [], total_rows: 0, limit: 100, skip: skip ?? 0 };
        }) as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([{ id: "late-doc" }]);
        expect(response.body.total_rows).toBe(1);
    });

    it("paginates within the branch-scoped set, newest first", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "d1" },
            { documentId: "d2" },
            { documentId: "d3" },
        ] as any);
        eformsignService.getAllDocuments.mockImplementation((async (_accessToken: string, _limit?: number, skip?: number) => {
            if (skip === 0) {
                return {
                    documents: [
                        { id: "d2", created_date: "200" },
                        { id: "other", created_date: "250" },
                        { id: "d1", created_date: "300" },
                        { id: "d3", created_date: "100" },
                    ],
                    total_rows: 4,
                    limit: 100,
                    skip: 0,
                };
            }
            return { documents: [], total_rows: 0, limit: 100, skip: skip ?? 0 };
        }) as any);

        const page1 = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&limit=2&skip=0");
        expect(page1.status).toBe(200);
        expect(page1.body.documents).toEqual([
            { id: "d1", created_date: "300" },
            { id: "d2", created_date: "200" },
        ]);
        expect(page1.body.total_rows).toBe(3);

        const page2 = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&limit=2&skip=2");
        expect(page2.body.documents).toEqual([{ id: "d3", created_date: "100" }]);
        expect(page2.body.total_rows).toBe(3);
    });

    it("enriches only the paginated branch-scoped documents with customer fields", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "d1" },
            { documentId: "d2" },
            { documentId: "d3" },
        ] as any);
        eformsignService.getAllDocuments.mockImplementation((async (_accessToken: string, _limit?: number, skip?: number) => {
            if (skip === 0) {
                return {
                    documents: [
                        { id: "d3", created_date: "100" },
                        { id: "d2", created_date: "200" },
                        { id: "d1", created_date: "300" },
                    ],
                    total_rows: 3,
                    limit: 100,
                    skip: 0,
                };
            }
            return { documents: [], total_rows: 0, limit: 100, skip: skip ?? 0 };
        }) as any);
        eformsignService.getDocumentById.mockResolvedValueOnce({
            id: "d2",
            fields: [{ id: "이용자 성명", value: "김고객" }],
            detail_template_info: [{ field_values: { "이용자 성명": "김고객" } }],
        });

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&limit=1&skip=1");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([
            {
                id: "d2",
                created_date: "200",
                fields: [{ id: "이용자 성명", value: "김고객" }],
                detail_template_info: [{ field_values: { "이용자 성명": "김고객" } }],
            },
        ]);
        expect(response.body.total_rows).toBe(3);
        expect(eformsignService.getDocumentById).toHaveBeenCalledTimes(1);
        expect(eformsignService.getDocumentById).toHaveBeenCalledWith("access-token", "d2");
    });

    it("keeps the original list document when customer-field enrichment fails", async () => {
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "d1" }] as any);
        eformsignService.getAllDocuments.mockImplementation((async (_accessToken: string, _limit?: number, skip?: number) => {
            if (skip === 0) {
                return {
                    documents: [{ id: "d1", created_date: "100" }],
                    total_rows: 1,
                    limit: 100,
                    skip: 0,
                };
            }
            return { documents: [], total_rows: 0, limit: 100, skip: skip ?? 0 };
        }) as any);
        eformsignService.getDocumentById.mockRejectedValueOnce(new Error("detail failed"));

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([{ id: "d1", created_date: "100" }]);
        expect(response.body.total_rows).toBe(1);
        expect(eformsignService.getDocumentById).toHaveBeenCalledWith("access-token", "d1");
    });

    it("does not fetch detail when the list document already has customer fields", async () => {
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "d1" }] as any);
        eformsignService.getAllDocuments.mockImplementation((async (_accessToken: string, _limit?: number, skip?: number) => {
            if (skip === 0) {
                return {
                    documents: [
                        {
                            id: "d1",
                            created_date: "100",
                            fields: [{ id: "이용자 성명", value: "이미있음" }],
                        },
                    ],
                    total_rows: 1,
                    limit: 100,
                    skip: 0,
                };
            }
            return { documents: [], total_rows: 0, limit: 100, skip: skip ?? 0 };
        }) as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([
            {
                id: "d1",
                created_date: "100",
                fields: [{ id: "이용자 성명", value: "이미있음" }],
            },
        ]);
        expect(eformsignService.getDocumentById).not.toHaveBeenCalled();
    });

    it("returns branch-scoped status signals (status-counts)", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "d1" },
            { documentId: "d2" },
        ] as any);
        eformsignService.getAllDocuments.mockImplementation((async (_token: string, _limit?: number, skip?: number) => {
            if (skip === 0) {
                return {
                    documents: [
                        {
                            id: "d1",
                            created_date: "200",
                            current_status: {
                                status_type: "060",
                                step_type: "05",
                                step_name: "이용자",
                                step_recipients: [{ recipient_type: "01" }],
                            },
                            recipients: [{ name: "송진호", recipient_type: "02" }],
                        },
                        {
                            id: "other",
                            created_date: "150",
                            current_status: {
                                status_type: "003",
                                step_type: "06",
                                step_name: "제공기관 검토",
                                step_recipients: [],
                            },
                        },
                        {
                            id: "d2",
                            created_date: "100",
                            current_status: {
                                status_type: "001",
                                step_type: "05",
                                step_name: "이용자",
                                step_recipients: [{ recipient_type: "02" }],
                            },
                        },
                    ],
                    total_rows: 3,
                    limit: 100,
                    skip: 0,
                };
            }
            return { documents: [], total_rows: 0, limit: 100, skip: skip ?? 0 };
        }) as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents/status-counts?accessToken=access-token");

        expect(response.status).toBe(200);
        // branch docs only ("other" dropped), newest-first, mapped to raw signals.
        // The 송진호-named doc (d1) is present — names must NOT be excluded.
        expect(response.body.documents).toEqual([
            {
                status_type: "060",
                step_type: "05",
                step_name: "이용자",
                step_recipient_types: ["01"],
            },
            {
                status_type: "001",
                step_type: "05",
                step_name: "이용자",
                step_recipient_types: ["02"],
            },
        ]);
        expect(eformsignDocService.findAll).toHaveBeenCalledWith("branch-1");
    });

    it("excludes other branches' docs from the incheon (HQ) status signals (status-counts)", async () => {
        branchFindUnique.mockResolvedValue({ slug: "incheon" });
        // "other" belongs to another branch → excluded; d1 (incheon's own) + unmapped kept.
        eformsignDocService.findDocumentIdsForOtherBranches.mockResolvedValue(["other"]);
        eformsignService.getAllDocuments.mockImplementation((async (_token: string, _limit?: number, skip?: number) => {
            if (skip === 0) {
                return {
                    documents: [
                        {
                            id: "d1",
                            current_status: {
                                status_type: "060",
                                step_type: "05",
                                step_name: "이용자",
                                step_recipients: [{ recipient_type: "01" }],
                            },
                        },
                        {
                            id: "other",
                            current_status: {
                                status_type: "003",
                                step_type: "06",
                                step_name: "제공기관 검토",
                                step_recipients: [],
                            },
                        },
                        {
                            id: "unmapped",
                            current_status: {
                                status_type: "001",
                                step_type: "05",
                                step_name: "이용자",
                                step_recipients: [{ recipient_type: "02" }],
                            },
                        },
                    ],
                    total_rows: 3,
                    limit: 100,
                    skip: 0,
                };
            }
            return { documents: [], total_rows: 0, limit: 100, skip: skip ?? 0 };
        }) as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents/status-counts?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([
            {
                status_type: "060",
                step_type: "05",
                step_name: "이용자",
                step_recipient_types: ["01"],
            },
            {
                status_type: "001",
                step_type: "05",
                step_name: "이용자",
                step_recipient_types: ["02"],
            },
        ]);
        expect(eformsignDocService.findDocumentIdsForOtherBranches).toHaveBeenCalledWith("branch-1");
        expect(eformsignDocService.findAll).not.toHaveBeenCalled();
    });

    it("excludes other branches' docs from incheon (HQ) per-type lists (in-progress)", async () => {
        branchFindUnique.mockResolvedValue({ slug: "incheon" });
        eformsignDocService.findDocumentIdsForOtherBranches.mockResolvedValue(["other-branch-doc"]);
        eformsignService.getInProgressDocuments.mockResolvedValue({
            documents: [
                { id: "branch-1-doc" },
                { id: "other-branch-doc" },
                { id: "unmapped-doc" },
            ],
        });

        const response = await request(app.getHttpServer())
            .get("/api/documents/in-progress?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([
            { id: "branch-1-doc" },
            { id: "unmapped-doc" },
        ]);
        expect(eformsignDocService.findDocumentIdsForOtherBranches).toHaveBeenCalledWith("branch-1");
        expect(eformsignDocService.findAll).not.toHaveBeenCalled();
    });
});
