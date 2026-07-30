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
import { EformsignListShadowCompareService } from "application/services/eformsign-list-shadow-compare.service";
import { EformsignMirrorListService } from "application/services/eformsign-mirror-list.service";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { EFORMSIGN_DOC_REPOSITORY } from "domain/repositories/eformsign-doc.repository.interface";
import { EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY } from "domain/repositories/eformsign-document-mirror.repository.interface";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import {
    EformsignApiError,
    extractEformsignVendorCode,
} from "infrastructure/api/eformsign-api.error";
import request from "supertest";

// Known transport-level flake (~1/8 full-suite runs under parallel-worker
// load, observed locally 2026-06-06 and once in CI): a supertest request
// intermittently dies with "socket hang up" on the early-400 validation
// paths. Retry masks only the transport race — a deterministic failure
// still fails on the retry.
jest.retryTimes(1, { logErrorsBeforeRetry: true });

describe("EformsignController (Integration)", () => {
    let app: INestApplication;
    let controller: EformsignController;
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
        | "getRejectedDocuments"
        | "getCompletedDocuments"
        | "getDocumentById"
    >>;
    let areaTemplateService: jest.Mocked<Pick<AreaTemplateService, "findByArea">>;
    let eformsignDocService: jest.Mocked<Pick<
        EformsignDocService,
        "findAll" | "findAllForHeadquarters" | "findByDocumentId"
        | "findByDocumentIdIncludingPurgePending" | "findDocumentIdsForOtherBranches"
        | "findDisplayFieldsByDocumentIds"
    >>;
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

    const shadowCompareService = { compareInBackground: jest.fn() };
    const mirrorListService = { buildList: jest.fn() };
    const documentMirrorService = {
        getStoredDetail: jest.fn(),
        getStoredFile: jest.fn(),
        markDocumentsDeleted: jest.fn(),
        purgeDocuments: jest.fn(),
        requestPermanentPurge: jest.fn(),
        clearPermanentPurgeRequest: jest.fn(),
    };
    const permanentPurgeLookup = {
        findListExcludedDocumentIds: jest.fn().mockResolvedValue([]),
        findUnreadyCompletedDocumentIds: jest.fn().mockResolvedValue([]),
        findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue([]),
    };

    beforeEach(async () => {
        shadowCompareService.compareInBackground.mockClear();
        documentMirrorService.getStoredDetail.mockReset();
        documentMirrorService.getStoredFile.mockReset();
        documentMirrorService.markDocumentsDeleted.mockReset();
        documentMirrorService.purgeDocuments.mockReset();
        documentMirrorService.requestPermanentPurge.mockReset();
        documentMirrorService.clearPermanentPurgeRequest.mockReset();
        permanentPurgeLookup.findListExcludedDocumentIds.mockReset();
        permanentPurgeLookup.findListExcludedDocumentIds.mockResolvedValue([]);
        permanentPurgeLookup.findUnreadyCompletedDocumentIds.mockReset();
        permanentPurgeLookup.findUnreadyCompletedDocumentIds.mockResolvedValue([]);
        permanentPurgeLookup.findPermanentPurgeRequestedDocumentIds.mockReset();
        permanentPurgeLookup.findPermanentPurgeRequestedDocumentIds.mockResolvedValue([]);
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
                        getRejectedDocuments: jest.fn(),
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
                        findAllForHeadquarters: jest.fn(),
                        findByDocumentId: jest.fn(),
                        findByDocumentIdIncludingPurgePending: jest.fn(),
                        findDocumentIdsForOtherBranches: jest.fn(),
                        findDisplayFieldsByDocumentIds: jest.fn(),
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
                {
                    provide: EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY,
                    useValue: permanentPurgeLookup,
                },
                {
                    // 그림자 비교는 서빙 결과에 영향을 주지 않아야 한다. 여기서 호출만
                    // 기록하고 아무것도 하지 않게 두면, 응답 검증이 그 사실을 보증한다.
                    provide: EformsignListShadowCompareService,
                    useValue: shadowCompareService,
                },
                {
                    provide: EformsignMirrorListService,
                    useValue: mirrorListService,
                },
                {
                    provide: EformsignDocumentMirrorService,
                    useValue: documentMirrorService,
                },
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
        controller = moduleFixture.get(EformsignController);
        areaTemplateService = moduleFixture.get(AreaTemplateService);
        eformsignDocService = moduleFixture.get(EformsignDocService);
        assignmentGuard = moduleFixture.get(ContractClientAssignmentGuardService);
        branchFindUnique = (moduleFixture.get(PrismaService) as unknown as { branch: { findUnique: jest.Mock } }).branch.findUnique;
        // default: a non-incheon branch, so per-branch filtering applies
        branchFindUnique.mockResolvedValue({ slug: "gimpo" });
        // default: no other-branch docs (overridden in incheon/HQ tests)
        eformsignDocService.findDocumentIdsForOtherBranches.mockResolvedValue([]);
        eformsignDocService.findAllForHeadquarters.mockResolvedValue([]);
        eformsignDocService.findByDocumentId.mockImplementation(
            async (branchId: string, documentId: string) => {
                const docs = await eformsignDocService.findAll(branchId) ?? [];
                return docs.find((doc: { documentId: string }) => doc.documentId === documentId) ?? null;
            },
        );
        eformsignDocService.findByDocumentIdIncludingPurgePending.mockImplementation(
            async (branchId: string, documentId: string) => {
                const docs = await eformsignDocService.findAll(branchId) ?? [];
                return docs.find((doc: { documentId: string }) =>
                    doc.documentId === documentId) ?? null;
            },
        );
        eformsignDocService.findDisplayFieldsByDocumentIds.mockResolvedValue([]);
        eformsignService.getDocumentById.mockImplementation(async (_accessToken: string, documentId: string) => ({ id: documentId }));
        documentMirrorService.getStoredDetail.mockImplementation(
            async (documentId: string) => ({ id: documentId }),
        );
        documentMirrorService.getStoredFile.mockResolvedValue(null);
        documentMirrorService.markDocumentsDeleted.mockResolvedValue(undefined);
        documentMirrorService.purgeDocuments.mockResolvedValue(undefined);
        documentMirrorService.requestPermanentPurge.mockImplementation(
            async (documentIds: string[]) => documentIds.map((documentId) => ({
                documentId,
                generation: new Date("2026-07-30T00:00:00.000Z"),
            })),
        );
        documentMirrorService.clearPermanentPurgeRequest.mockResolvedValue(undefined);
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

    it("permanently deletes only an owned document and purges mirrored PII and PDFs", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "doc-1" },
        ] as never);
        eformsignService.deleteDocuments.mockResolvedValue({
            result: {
                success_result: ["doc-1"],
                fail_result: [],
            },
        });

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=true")
            .send({ document_ids: ["doc-1"] });

        expect(response.status).toBe(200);
        expect(eformsignService.deleteDocuments).toHaveBeenCalledWith(
            "access-token",
            ["doc-1"],
            true,
        );
        expect(documentMirrorService.requestPermanentPurge).toHaveBeenCalledWith(["doc-1"]);
        expect(documentMirrorService.purgeDocuments).toHaveBeenCalledWith([
            "doc-1",
        ]);
        expect(documentMirrorService.markDocumentsDeleted).not.toHaveBeenCalled();
    });

    it("retains permanent-purge intent when vendor success is followed by a local purge failure", async () => {
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "doc-1" }] as never);
        eformsignService.deleteDocuments.mockResolvedValue({
            result: { success_result: ["doc-1"], fail_result: [] },
        });
        documentMirrorService.purgeDocuments.mockRejectedValue(
            new Error("temporary database failure"),
        );

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=true")
            .send({ document_ids: ["doc-1"] });

        expect(response.status).toBe(500);
        expect(documentMirrorService.requestPermanentPurge).toHaveBeenCalledWith(["doc-1"]);
        expect(documentMirrorService.clearPermanentPurgeRequest).not.toHaveBeenCalled();
    });

    it("clears generation-fenced definitive failures before a mixed-response local purge failure", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "deleted-doc" },
            { documentId: "rejected-doc" },
        ] as never);
        eformsignService.deleteDocuments.mockResolvedValue({
            result: {
                success_result: ["deleted-doc"],
                fail_result: [
                    { document_id: "rejected-doc", code: "4000164", message: "not authorized" },
                ],
            },
        });
        documentMirrorService.purgeDocuments.mockRejectedValue(
            new Error("temporary database failure"),
        );

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=true")
            .send({ document_ids: ["deleted-doc", "rejected-doc"] });

        expect(response.status).toBe(500);
        expect(documentMirrorService.clearPermanentPurgeRequest).toHaveBeenCalledWith([
            expect.objectContaining({ documentId: "rejected-doc" }),
        ]);
        expect(documentMirrorService.purgeDocuments).toHaveBeenCalledWith(["deleted-doc"]);
        const clearCallOrder = documentMirrorService.clearPermanentPurgeRequest
            .mock.invocationCallOrder[0];
        const purgeCallOrder = documentMirrorService.purgeDocuments.mock.invocationCallOrder[0];
        expect(clearCallOrder).toBeDefined();
        expect(purgeCallOrder).toBeDefined();
        expect(clearCallOrder!).toBeLessThan(purgeCallOrder!);
    });

    it("still purges vendor-successful documents when clearing definitive failures fails", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "deleted-doc" },
            { documentId: "rejected-doc" },
        ] as never);
        eformsignService.deleteDocuments.mockResolvedValue({
            result: {
                success_result: ["deleted-doc"],
                fail_result: [
                    { document_id: "rejected-doc", code: "4000164", message: "not authorized" },
                ],
            },
        });
        documentMirrorService.clearPermanentPurgeRequest.mockRejectedValue(
            new Error("temporary database failure"),
        );

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=true")
            .send({ document_ids: ["deleted-doc", "rejected-doc"] });

        expect(response.status).toBe(500);
        expect(documentMirrorService.clearPermanentPurgeRequest).toHaveBeenCalledWith([
            expect.objectContaining({ documentId: "rejected-doc" }),
        ]);
        expect(documentMirrorService.purgeDocuments).toHaveBeenCalledWith(["deleted-doc"]);
    });

    it("attempts both cleanup operations and returns a safe error when both fail", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "deleted-doc" },
            { documentId: "rejected-doc" },
        ] as never);
        eformsignService.deleteDocuments.mockResolvedValue({
            result: {
                success_result: ["deleted-doc"],
                fail_result: [
                    { document_id: "rejected-doc", code: "4000164", message: "not authorized" },
                ],
            },
        });
        documentMirrorService.clearPermanentPurgeRequest.mockRejectedValue(
            new Error("clear failure"),
        );
        documentMirrorService.purgeDocuments.mockRejectedValue(
            new Error("purge failure"),
        );

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=true")
            .send({ document_ids: ["deleted-doc", "rejected-doc"] });

        expect(response.status).toBe(500);
        expect(response.body).toEqual({ error: "Permanent document cleanup was incomplete" });
        expect(documentMirrorService.clearPermanentPurgeRequest).toHaveBeenCalledTimes(1);
        expect(documentMirrorService.purgeDocuments).toHaveBeenCalledWith(["deleted-doc"]);
    });

    it("clears permanent-purge intent after a definitive vendor rejection", async () => {
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "doc-1" }] as never);
        eformsignService.deleteDocuments.mockRejectedValue(
            new EformsignApiError("rejected", 400),
        );

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=true")
            .send({ document_ids: ["doc-1"] });

        expect(response.status).toBe(500);
        expect(documentMirrorService.clearPermanentPurgeRequest).toHaveBeenCalledWith([
            expect.objectContaining({ documentId: "doc-1" }),
        ]);
    });

    it.each([
        ["HTTP 404", new EformsignApiError("not found", 404)],
        [
            "vendor code 4000004 from a delete response body",
            new EformsignApiError(
                "missing",
                400,
                extractEformsignVendorCode('{"code":"4000004"}'),
            ),
        ],
        [
            "vendor code 4000006 from a delete response body",
            new EformsignApiError(
                "deleted",
                400,
                extractEformsignVendorCode('{"code":"4000006"}'),
            ),
        ],
    ])("retains permanent-purge intent after confirmed document absence (%s)", async (
        _label,
        error,
    ) => {
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "doc-1" }] as never);
        eformsignService.deleteDocuments.mockRejectedValue(error);

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=true")
            .send({ document_ids: ["doc-1"] });

        expect(response.status).toBe(500);
        expect(documentMirrorService.requestPermanentPurge).toHaveBeenCalledWith(["doc-1"]);
        expect(documentMirrorService.clearPermanentPurgeRequest).not.toHaveBeenCalled();
        expect(documentMirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("retains permanent-purge intent after an ambiguous vendor failure", async () => {
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "doc-1" }] as never);
        eformsignService.deleteDocuments.mockRejectedValue(
            new EformsignApiError("unavailable", 503),
        );

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=true")
            .send({ document_ids: ["doc-1"] });

        expect(response.status).toBe(500);
        expect(documentMirrorService.requestPermanentPurge).toHaveBeenCalledWith(["doc-1"]);
        expect(documentMirrorService.clearPermanentPurgeRequest).not.toHaveBeenCalled();
    });

    it("purges successes while clearing intent only for structured definitive failures", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "deleted-doc" },
            { documentId: "rejected-doc" },
            { documentId: "retry-doc" },
        ] as never);
        eformsignService.deleteDocuments.mockResolvedValue({
            result: {
                success_result: ["deleted-doc"],
                fail_result: [
                    { document_id: " rejected-doc ", code: "4000164", message: "not authorized" },
                    { document_id: "retry-doc", code: 429, message: "retry" },
                    { document_id: "unknown-doc", code: "4000164", message: "not requested" },
                    { document_id: null, code: "4000164", message: "malformed" },
                    "legacy-string-failure",
                ],
            },
        });

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=true")
            .send({ document_ids: ["deleted-doc", "rejected-doc", "retry-doc"] });

        expect(response.status).toBe(200);
        expect(documentMirrorService.purgeDocuments).toHaveBeenCalledWith(["deleted-doc"]);
        expect(documentMirrorService.clearPermanentPurgeRequest)
            .toHaveBeenCalledWith([
                expect.objectContaining({ documentId: "rejected-doc" }),
            ]);
    });

    it("retains intent for malformed or transient structured failures without purging them", async () => {
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "retry-doc" }] as never);
        eformsignService.deleteDocuments.mockResolvedValue({
            result: {
                success_result: [],
                fail_result: [
                    { document_id: "retry-doc", code: 503, message: "temporary" },
                    { document_id: "retry-doc", code: "not-a-code", message: "unknown" },
                    { document_id: "retry-doc", code: "4000031", message: "already deleted" },
                    { code: "4000164", message: "missing id" },
                ],
            },
        });

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=true")
            .send({ document_ids: ["retry-doc"] });

        expect(response.status).toBe(200);
        expect(documentMirrorService.purgeDocuments).toHaveBeenCalledWith([]);
        expect(documentMirrorService.clearPermanentPurgeRequest).toHaveBeenCalledWith([]);
    });

    it("keeps a recoverable tombstone for a non-permanent vendor deletion", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "doc-1" },
        ] as never);
        eformsignService.deleteDocuments.mockResolvedValue({
            result: {
                success_result: ["doc-1"],
                fail_result: [],
            },
        });

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=false")
            .send({ document_ids: ["doc-1"] });

        expect(response.status).toBe(200);
        expect(documentMirrorService.markDocumentsDeleted).toHaveBeenCalledWith([
            "doc-1",
        ]);
        expect(documentMirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("forbids deleting a document owned by another branch", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "branch-1-doc" },
        ] as never);

        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=true")
            .send({ document_ids: ["other-branch-doc"] });

        expect(response.status).toBe(403);
        expect(eformsignService.deleteDocuments).not.toHaveBeenCalled();
        expect(documentMirrorService.markDocumentsDeleted).not.toHaveBeenCalled();
    });

    it("rejects invalid download file type before service execution", async () => {
        const response = await request(app.getHttpServer())
            .get("/api/documents/doc-1/download_files?accessToken=access-token&fileType=zip");

        expect(response.status).toBe(400);
        expect(documentMirrorService.getStoredFile).not.toHaveBeenCalled();
    });

    it("forbids downloading a document owned by another branch", async () => {
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "branch-1-doc" }] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents/other-branch-doc/download_files?accessToken=access-token");

        expect(response.status).toBe(403);
        expect(documentMirrorService.getStoredFile).not.toHaveBeenCalled();
    });

    it("forbids the headquarters branch from downloading another branch's document", async () => {
        branchFindUnique.mockResolvedValue({ slug: "incheon" });
        eformsignDocService.findDocumentIdsForOtherBranches.mockResolvedValue(["other-branch-doc"]);

        const response = await request(app.getHttpServer())
            .get("/api/documents/other-branch-doc/download_files?accessToken=access-token");

        expect(response.status).toBe(403);
        expect(documentMirrorService.getStoredFile).not.toHaveBeenCalled();
    });

    it("lets the headquarters branch download an unmapped document", async () => {
        branchFindUnique.mockResolvedValue({ slug: "incheon" });
        eformsignDocService.findAllForHeadquarters.mockResolvedValue([
            { documentId: "unmapped-doc" },
        ] as any);
        documentMirrorService.getStoredFile.mockResolvedValue({
            status: 200,
            contentType: "application/pdf",
            contentDisposition: "attachment; filename=document.pdf",
            body: Buffer.from("pdf"),
        });

        const response = await request(app.getHttpServer())
            .get("/api/documents/unmapped-doc/download_files");

        expect(response.status).toBe(200);
        expect(documentMirrorService.getStoredFile).toHaveBeenCalledWith(
            "unmapped-doc",
            "document",
        );
    });

    it("serves document detail from the local mirror without an eformsign token", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "branch-1-doc" },
        ] as any);
        documentMirrorService.getStoredDetail.mockResolvedValue({
            id: "branch-1-doc",
            fields: [{ id: "이용자 성명", value: "로컬 고객" }],
            histories: [{ status_type: "003" }],
        });

        const response = await request(app.getHttpServer())
            .get("/api/documents/branch-1-doc");

        expect(response.status).toBe(200);
        expect(response.body).toEqual(expect.objectContaining({
            id: "branch-1-doc",
            fields: [{ id: "이용자 성명", value: "로컬 고객" }],
            histories: [{ status_type: "003" }],
        }));
        expect(eformsignService.getDocumentById).not.toHaveBeenCalled();
    });

    it("does not fall back to eformsign while a local detail snapshot is pending", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "branch-1-doc" },
        ] as any);
        documentMirrorService.getStoredDetail.mockResolvedValue(null);

        const response = await request(app.getHttpServer())
            .get("/api/documents/branch-1-doc");

        expect(response.status).toBe(503);
        expect(eformsignService.getDocumentById).not.toHaveBeenCalled();
    });

    describe("local source-of-truth document reads", () => {
        let mirrorApp: INestApplication;
        const mirrorRepository = {
            findAllVisibleInMirror: jest.fn().mockResolvedValue([]),
            findAllVisibleInMirrorForHeadquarters: jest.fn().mockResolvedValue([]),
        };

        const createMirrorRow = (overrides: {
            documentId: string;
            createdDate?: string;
            statusType?: string;
            customerName?: string | null;
        }) => {
            const createdDate = new Date(overrides.createdDate ?? "2026-07-01T00:00:00.000Z");
            return EformsignDocEntity.reconstitute({
                id: 1,
                documentId: overrides.documentId,
                documentName: `문서 ${overrides.documentId}`,
                documentNumber: `NO-${overrides.documentId}`,
                templateName: "표준 계약서",
                customerName: overrides.customerName === undefined
                    ? "김고객"
                    : overrides.customerName,
                creatorName: "생성자",
                lastEditorName: "편집자",
                stepRecipientTypes: ["05"],
                createdDate,
                updatedDate: createdDate,
                statusType: overrides.statusType ?? "060",
                statusDetail: "서명 요청됨",
                stepType: "01",
                stepIndex: "1",
                stepName: "이용자 서명",
                stepRecipientType: "05",
                stepRecipientName: "송진호",
                stepRecipientSms: "01012345678",
                expiredDate: new Date("2026-08-01T00:00:00.000Z"),
                expired: false,
                clientId: null,
                documentKind: null,
                employeeScheduleId: null,
                templateId: "template-1",
            });
        };

        beforeEach(async () => {
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([]);
            mirrorRepository.findAllVisibleInMirrorForHeadquarters.mockResolvedValue([]);
            const fixture = await Test.createTestingModule({
                controllers: [EformsignController],
                providers: [
                    { provide: EformsignService, useValue: eformsignService },
                    { provide: AreaTemplateService, useValue: { findByArea: jest.fn() } },
                    { provide: EformsignDocService, useValue: eformsignDocService },
                    {
                        provide: PrismaService,
                        useValue: { branch: { findUnique: branchFindUnique } },
                    },
                    {
                        provide: ContractClientAssignmentGuardService,
                        useValue: { assertAssignedProvider: jest.fn() },
                    },
                    EformsignDocumentSnapshotService,
                    {
                        provide: EFORMSIGN_DOCUMENT_MIRROR_REPOSITORY,
                        useValue: permanentPurgeLookup,
                    },
                    { provide: EformsignListShadowCompareService, useValue: shadowCompareService },
                    // 실제 미러 서비스를 쓴다. 스텁을 두면 이 스위트가 검증하는 것이
                    // "컨트롤러가 스텁을 호출한다" 뿐이 되어, 정작 목록이 맞는지는 못 본다.
                    { provide: EFORMSIGN_DOC_REPOSITORY, useValue: mirrorRepository },
                    EformsignMirrorListService,
                    {
                        provide: EformsignDocumentMirrorService,
                        useValue: documentMirrorService,
                    },
                ],
            })
                .overrideGuard(JwtGuard)
                .useValue(authGuard)
                .overrideGuard(TenantGuard)
                .useValue(authGuard)
                .compile();

            mirrorApp = fixture.createNestApplication();
            mirrorApp.useGlobalPipes(new ValidationPipe({ transform: true }));
            await mirrorApp.init();
        });

        afterEach(async () => {
            await mirrorApp.close();
        });

        it("paginates the mirror without calling eformsign", async () => {
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([
                createMirrorRow({ documentId: "doc-old", createdDate: "2026-07-01T00:00:00.000Z" }),
                createMirrorRow({ documentId: "doc-new", createdDate: "2026-07-02T00:00:00.000Z" }),
            ]);

            const first = await request(mirrorApp.getHttpServer())
                .get("/api/documents?limit=1&skip=0");

            expect(first.status).toBe(200);
            expect(first.body.documents.map((d: { id: string }) => d.id)).toEqual(["doc-new"]);
            expect(first.body).toMatchObject({
                total_rows: 2,
                limit: 1,
                skip: 0,
                has_more: true,
            });
            expect(eformsignService.getAllDocuments).not.toHaveBeenCalled();
            // 미러가 서빙 중이면 비교할 상대가 없다.
            expect(shadowCompareService.compareInBackground).not.toHaveBeenCalled();
        });

        it("keeps the cached generation stable when the local mirror moves between pages", async () => {
            // 이미 배포된 클라이언트는 snapshot_version을 해석하지 않을 수 있다.
            // 캐시 hit에서 live 목록으로 바꾸지 않아 offset이 같은 세대를 계속 걷게 한다.
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([
                createMirrorRow({ documentId: "doc-1", createdDate: "2026-07-03T00:00:00.000Z" }),
                createMirrorRow({ documentId: "doc-2", createdDate: "2026-07-02T00:00:00.000Z" }),
            ]);

            const first = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token&limit=1&skip=0");
            expect(first.body.documents.map((d: { id: string }) => d.id)).toEqual(["doc-1"]);
            expect(typeof first.body.snapshot_version).toBe("string");
            const callsAfterFirstPage = mirrorRepository.findAllVisibleInMirror.mock.calls.length;

            // 첫 페이지 뒤에 live 목록이 바뀌어도 두 번째 페이지는 저장된 세대의 doc-2다.
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([
                createMirrorRow({ documentId: "doc-2", createdDate: "2026-07-02T00:00:00.000Z" }),
            ]);
            const second = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token&limit=1&skip=1");

            expect(second.body.documents.map((d: { id: string }) => d.id)).toEqual(["doc-2"]);
            expect(second.body.has_more).toBe(false);
            expect(second.body.snapshot_version).toBe(first.body.snapshot_version);
            expect(mirrorRepository.findAllVisibleInMirror).toHaveBeenCalledTimes(
                callsAfterFirstPage,
            );
        });

        it("reports the generation so the client can notice the list moved", async () => {
            // 클라이언트는 뒤 페이지의 snapshot_version이 다르면 페이지네이션을 리셋한다.
            // 이 값을 빼면 목록이 아래에서 밀려도 신호가 없어 문서를 조용히 건너뛴다.
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([
                createMirrorRow({ documentId: "doc-1" }),
            ]);

            const response = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token");

            expect(typeof response.body.snapshot_version).toBe("string");
        });

        it("answers each tab from status codes", async () => {
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([
                createMirrorRow({ documentId: "doc-open", statusType: "060" }),
                createMirrorRow({ documentId: "doc-done", statusType: "050" }),
                createMirrorRow({ documentId: "doc-gone", statusType: "080" }),
            ]);

            const inProgress = await request(mirrorApp.getHttpServer())
                .get("/api/documents/in-progress?accessToken=access-token");
            const completed = await request(mirrorApp.getHttpServer())
                .get("/api/documents/completed?accessToken=access-token");
            const rejected = await request(mirrorApp.getHttpServer())
                .get("/api/documents/rejected?accessToken=access-token");

            expect(inProgress.body.documents.map((d: { id: string }) => d.id)).toEqual(["doc-open"]);
            expect(completed.body.documents.map((d: { id: string }) => d.id)).toEqual(["doc-done"]);
            expect(rejected.body.documents.map((d: { id: string }) => d.id)).toEqual(["doc-gone"]);
            expect(eformsignService.getInProgressDocuments).not.toHaveBeenCalled();
            expect(eformsignService.getCompletedDocuments).not.toHaveBeenCalled();
            expect(eformsignService.getRejectedDocuments).not.toHaveBeenCalled();
        });

        it("keeps a stale tombstone in unfiltered all reads but fences it from deletion-aware filters", async () => {
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([
                createMirrorRow({ documentId: "doc-tombstone", statusType: "060" }),
            ]);

            const allBeforeDeletion = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token");
            const inProgressBeforeDeletion = await request(mirrorApp.getHttpServer())
                .get("/api/documents/in-progress?accessToken=access-token");

            expect(allBeforeDeletion.body.documents.map((d: { id: string }) => d.id)).toEqual([
                "doc-tombstone",
            ]);
            expect(inProgressBeforeDeletion.body.documents.map((d: { id: string }) => d.id)).toEqual([
                "doc-tombstone",
            ]);

            // Simulate a failed invalidation: the cached entry remains pre-delete, but
            // the durable local row is now a deletion tombstone.
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([
                createMirrorRow({ documentId: "doc-tombstone", statusType: "049" }),
            ]);
            permanentPurgeLookup.findListExcludedDocumentIds.mockResolvedValue([
                "doc-tombstone",
            ]);

            const defaultAll = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token");
            const defaultStatusCounts = await request(mirrorApp.getHttpServer())
                .get("/api/documents/status-counts?accessToken=access-token");
            const deletionFilteredAll = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token&excludeDeleted=true");
            const statusFilteredAll = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token&statusCategory=in-progress");
            const staleInProgress = await request(mirrorApp.getHttpServer())
                .get("/api/documents/in-progress?accessToken=access-token");

            expect(defaultAll.body.documents.map((d: { id: string }) => d.id)).toEqual([
                "doc-tombstone",
            ]);
            expect(defaultStatusCounts.body.documents).toHaveLength(1);
            expect(deletionFilteredAll.body.documents).toEqual([]);
            expect(statusFilteredAll.body.documents).toEqual([]);
            expect(staleInProgress.body.documents).toEqual([]);
        });

        it("shows the customer name on the page it returns", async () => {
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([
                createMirrorRow({ documentId: "doc-1", customerName: "최고객" }),
            ]);

            const response = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token");

            expect(response.body.documents[0].fields).toEqual([
                { id: "이용자 성명", value: "최고객" },
            ]);
        });

        it("reads the headquarters scope, including unclaimed documents", async () => {
            branchFindUnique.mockResolvedValue({ slug: "incheon" });
            mirrorRepository.findAllVisibleInMirrorForHeadquarters.mockResolvedValue([
                createMirrorRow({ documentId: "doc-unclaimed" }),
            ]);

            const response = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token");

            expect(response.status).toBe(200);
            expect(mirrorRepository.findAllVisibleInMirrorForHeadquarters)
                .toHaveBeenCalledWith("branch-1");
            expect(response.body.documents.map((d: { id: string }) => d.id)).toEqual(["doc-unclaimed"]);
        });

        it("leaves an unclaimed document unnamed rather than naming the wrong person", async () => {
            // stepRecipientName은 *현재 단계*가 기다리는 사람이라, 그 단계가 제공기관 검토면
            // 제공기관 이름이다. 미배정 문서에는 지점 스코프 조회가 걸리지 않아 API 경로도
            // 이 값을 쓰지 않는다(단건 조회로 넘어간다). 틀린 이름을 보여주는 것보다
            // 비워 두는 편이 낫고, 웹훅이 한 번이라도 닿으면 진짜 고객명이 채워진다.
            branchFindUnique.mockResolvedValue({ slug: "incheon" });
            mirrorRepository.findAllVisibleInMirrorForHeadquarters.mockResolvedValue([
                createMirrorRow({ documentId: "doc-unclaimed", customerName: null }),
            ]);
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([]);

            const response = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token");

            expect(response.body.documents[0].fields).toBeUndefined();
        });

        it("still names a branch-owned document from its recipient", async () => {
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([
                createMirrorRow({ documentId: "doc-owned", customerName: null }),
            ]);

            const response = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token");

            expect(response.body.documents[0].fields).toEqual([
                { id: "이용자 성명", value: "송진호" },
            ]);
        });

        it("does not let that name widen headquarters search", async () => {
            // 표시용과 검색용은 분리돼 있다. 서빙 경로는 findAll(branchId)로 검색 코퍼스를
            // 만들어 미배정 문서의 수신자명을 찾지 못하므로, 여기서도 찾으면 안 된다.
            branchFindUnique.mockResolvedValue({ slug: "incheon" });
            mirrorRepository.findAllVisibleInMirrorForHeadquarters.mockResolvedValue([
                createMirrorRow({ documentId: "doc-unclaimed", customerName: null }),
            ]);
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([]);

            const response = await request(mirrorApp.getHttpServer())
                .get("/api/documents?accessToken=access-token&search=%EC%86%A1%EC%A7%84%ED%98%B8");

            expect(response.body.documents).toEqual([]);
        });

        it("counts statuses from the same generation the list pages over", async () => {
            mirrorRepository.findAllVisibleInMirror.mockResolvedValue([
                createMirrorRow({ documentId: "doc-1", statusType: "060" }),
                createMirrorRow({ documentId: "doc-2", statusType: "050" }),
            ]);

            const response = await request(mirrorApp.getHttpServer())
                .get("/api/documents/status-counts?accessToken=access-token");

            expect(response.status).toBe(200);
            expect(response.body.documents).toHaveLength(2);
            expect(response.body.documents[0]).toEqual(
                expect.objectContaining({ status_type: expect.any(String) }),
            );
            expect(eformsignService.getAllDocuments).not.toHaveBeenCalled();
        });
    });

    describe.skip("legacy synchronous eformsign read path (removed)", () => {
    it("hands the served page to the shadow comparison without changing it", async () => {
        // D단계의 계약: 화면에 나가는 것은 여전히 외부 API 결과이고, 미러는 같은 질문에
        // 따로 답해 차이만 로그로 남긴다. 비교가 응답을 건드리면 그 계약이 깨진다.
        eformsignService.getAllDocuments.mockResolvedValue({
            documents: [{ id: "branch-1-doc" }, { id: "other-branch-doc" }],
            total_rows: 2,
            limit: 100,
            skip: 0,
        });
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "branch-1-doc" },
        ] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&search=branch");

        expect(response.status).toBe(200);
        expect(response.body.documents).toHaveLength(1);
        expect(shadowCompareService.compareInBackground).toHaveBeenCalledWith(
            expect.objectContaining({
                branchId: "branch-1",
                scope: "all",
                isHeadquarters: false,
                search: "branch",
            }),
            expect.objectContaining({
                // The whole filtered set, which for this request is also the page.
                documentIds: response.body.documents.map((doc: { id: string }) => doc.id),
                fieldsById: expect.any(Map),
            }),
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

    it("compares the rejected tab by status, not by which inbox the vendor used", async () => {
        // Type 04 is eformsign's document-management inbox, not a rejected-only one: it
        // carries in-progress and completed documents too, which the client filters out
        // by status. Handing the raw inbox to the comparison would report every one of
        // those as missing from a mirror that is in fact correct.
        eformsignService.getRejectedDocuments.mockResolvedValue({
            documents: [
                { id: "expired-doc", current_status: { status_type: "080" } },
                { id: "still-open-doc", current_status: { status_type: "060" } },
            ],
        });
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "expired-doc" },
            { documentId: "still-open-doc" },
        ] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents/rejected?accessToken=access-token");

        expect(response.status).toBe(200);
        // The endpoint itself still returns what the inbox held — only the comparison is
        // narrowed, because that is what the tab actually shows.
        expect(response.body.documents).toHaveLength(2);
        expect(shadowCompareService.compareInBackground).toHaveBeenCalledWith(
            expect.objectContaining({ scope: "rejected" }),
            expect.objectContaining({ documentIds: ["expired-doc"] }),
        );
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

    it.each([
        { name: "more documents remain", total: 3, limit: 2, skip: 0, expectedHasMore: true },
        { name: "the page ends at total", total: 2, limit: 2, skip: 0, expectedHasMore: false },
        { name: "the result is empty", total: 0, limit: 2, skip: 0, expectedHasMore: false },
    ])("sets has_more when $name", async ({ total, limit, skip, expectedHasMore }) => {
        const documents = Array.from({ length: total }, (_, index) => ({
            id: `boundary-${index + 1}`,
            created_date: String(total - index),
            fields: [{ id: "고객명", value: `고객 ${index + 1}` }],
        }));
        eformsignDocService.findAll.mockResolvedValue(
            documents.map((document) => ({ documentId: document.id })) as any,
        );
        eformsignService.getAllDocuments.mockResolvedValue({
            documents,
            total_rows: total,
            limit: 100,
            skip: 0,
        });

        const response = await request(app.getHttpServer())
            .get(`/api/documents?accessToken=access-token&limit=${limit}&skip=${skip}`);

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            total_rows: total,
            limit,
            skip,
            has_more: expectedHasMore,
        });
    });

    it("filters by status category before slicing the page", async () => {
        const draftingDocuments = Array.from({ length: 7 }, (_, index) => ({
            id: `drafting-${index + 1}`,
            created_date: String(1200 - index * 100),
            current_status: { status_type: "001", step_type: "02", step_name: "이용자 서명" },
            fields: [{ id: "고객명", value: `대기 고객 ${index + 1}` }],
        }));
        const completedDocuments = Array.from({ length: 5 }, (_, index) => ({
            id: `completed-${index + 1}`,
            created_date: String(500 - index * 100),
            current_status: { status_type: "003" },
            fields: [{ id: "고객명", value: `완료 고객 ${index + 1}` }],
        }));
        const documents = [...draftingDocuments, ...completedDocuments];
        eformsignDocService.findAll.mockResolvedValue(
            documents.map((document) => ({ documentId: document.id })) as any,
        );
        eformsignService.getAllDocuments.mockResolvedValue({
            documents,
            total_rows: documents.length,
            limit: 100,
            skip: 0,
        });

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&statusCategory=completed&limit=9&skip=0");

        expect(response.status).toBe(200);
        expect(response.body.documents.map((document: { id: string }) => document.id)).toEqual(
            completedDocuments.map((document) => document.id),
        );
        expect(response.body).toMatchObject({
            total_rows: completedDocuments.length,
            limit: 9,
            skip: 0,
            has_more: false,
        });
    });

    it("excludes deleted status codes from status category results", async () => {
        const documents = [
            {
                id: "unknown-active",
                created_date: "300",
                current_status: { status_type: "999" },
                fields: [{ id: "고객명", value: "상태 확인 고객" }],
            },
            {
                id: "delete-requested",
                created_date: "200",
                current_status: { status_type: "047" },
                fields: [{ id: "고객명", value: "삭제 요청 고객" }],
            },
            {
                id: "deleted",
                created_date: "100",
                current_status: { status_type: "049" },
                fields: [{ id: "고객명", value: "삭제 고객" }],
            },
        ];
        eformsignDocService.findAll.mockResolvedValue(
            documents.map((document) => ({ documentId: document.id })) as any,
        );
        eformsignService.getAllDocuments.mockResolvedValue({
            documents,
            total_rows: documents.length,
            limit: 100,
            skip: 0,
        });

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&statusCategory=unknown");

        expect(response.status).toBe(200);
        expect(response.body.documents.map((document: { id: string }) => document.id)).toEqual([
            "unknown-active",
        ]);
        expect(response.body).toMatchObject({
            total_rows: 1,
            has_more: false,
        });
    });

    it("filters search before slicing and matches local stepRecipientName by Korean initials", async () => {
        const nonMatchingDocuments = Array.from({ length: 9 }, (_, index) => ({
            id: `non-match-${index + 1}`,
            created_date: String(1200 - index * 100),
            document_name: `일반 계약서 ${index + 1}`,
            fields: [{ id: "고객명", value: `일반 고객 ${index + 1}` }],
        }));
        const matchingDocuments = Array.from({ length: 3 }, (_, index) => ({
            id: `local-match-${index + 1}`,
            created_date: String(300 - index * 100),
            document_name: `별도 계약서 ${index + 1}`,
            fields: [{ id: "고객명", value: `별도 고객 ${index + 1}` }],
        }));
        const documents = [...nonMatchingDocuments, ...matchingDocuments];
        eformsignDocService.findAll.mockResolvedValue(
            documents.map((document) => ({
                documentId: document.id,
                stepRecipientName: document.id.startsWith("local-match") ? "김영희" : "박수진",
            })) as any,
        );
        eformsignService.getAllDocuments.mockResolvedValue({
            documents,
            total_rows: documents.length,
            limit: 100,
            skip: 0,
        });

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&search=ㄱㅇㅎ&limit=9&skip=0");

        expect(response.status).toBe(200);
        expect(response.body.documents.map((document: { id: string }) => document.id)).toEqual(
            matchingDocuments.map((document) => document.id),
        );
        expect(response.body).toMatchObject({
            total_rows: matchingDocuments.length,
            limit: 9,
            skip: 0,
            has_more: false,
        });
        expect(eformsignDocService.findAll).toHaveBeenCalledTimes(2);
    });

    it("keeps filtered page sequences unique with a stable document id tie-breaker", async () => {
        const expectedIds = Array.from({ length: 21 }, (_, index) =>
            `sequence-${String(index + 1).padStart(2, "0")}`,
        );
        const documents = [...expectedIds].reverse().map((id) => ({
            id,
            created_date: "1000",
            current_status: { status_type: "003" },
            fields: [{ id: "고객명", value: `고객 ${id}` }],
        }));
        eformsignDocService.findAll.mockResolvedValue(
            documents.map((document) => ({ documentId: document.id })) as any,
        );
        eformsignService.getAllDocuments.mockResolvedValue({
            documents,
            total_rows: documents.length,
            limit: 100,
            skip: 0,
        });

        const page1 = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&statusCategory=completed&limit=9&skip=0");
        const page2 = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&statusCategory=completed&limit=6&skip=9");
        const page3 = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token&statusCategory=completed&limit=6&skip=15");

        expect([page1.status, page2.status, page3.status]).toEqual([200, 200, 200]);
        const pageIds = [page1, page2, page3].map((page) =>
            page.body.documents.map((document: { id: string }) => document.id),
        );
        expect(pageIds).toEqual([
            expectedIds.slice(0, 9),
            expectedIds.slice(9, 15),
            expectedIds.slice(15, 21),
        ]);
        expect(new Set(pageIds.flat()).size).toBe(expectedIds.length);
        expect(pageIds.flat()).toEqual(expectedIds);
        expect([page1.body.has_more, page2.body.has_more, page3.body.has_more]).toEqual([
            true,
            true,
            false,
        ]);
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

    it("uses one local display-field lookup and skips the eformsign detail API on a local hit", async () => {
        eformsignDocService.findAll.mockResolvedValue([{ documentId: "d1" }] as any);
        eformsignDocService.findDisplayFieldsByDocumentIds.mockResolvedValue([
            { documentId: "d1", customerName: "로컬 고객" },
        ]);
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

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([
            {
                id: "d1",
                created_date: "100",
                fields: [{ id: "이용자 성명", value: "로컬 고객" }],
            },
        ]);
        expect(eformsignDocService.findDisplayFieldsByDocumentIds).toHaveBeenCalledTimes(1);
        expect(eformsignDocService.findDisplayFieldsByDocumentIds).toHaveBeenCalledWith(
            "branch-1",
            ["d1"],
        );
        expect(eformsignService.getDocumentById).not.toHaveBeenCalled();
    });

    it("reuses cached API display fields on a repeated page visit", async () => {
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
        eformsignService.getDocumentById.mockResolvedValue({
            id: "d1",
            fields: [{ id: "이용자 성명", value: "API 고객" }],
        });

        const firstResponse = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token");
        const secondResponse = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token");

        expect(firstResponse.status).toBe(200);
        expect(secondResponse.status).toBe(200);
        expect(secondResponse.body.documents).toEqual(firstResponse.body.documents);
        expect(eformsignService.getDocumentById).toHaveBeenCalledTimes(1);
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
                                status_type: 60,
                                step_type: 5,
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
                                status_type: 1,
                                step_type: 5,
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

    it("normalizes raw numeric vendor codes in status signals without an HTTP socket", async () => {
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "d1" },
        ] as any);
        eformsignService.getAllDocuments.mockImplementation((async (
            _token: string,
            _limit?: number,
            skip?: number,
        ) => {
            if (skip === 0) {
                return {
                    documents: [
                        {
                            id: "d1",
                            created_date: "200",
                            current_status: {
                                status_type: 60,
                                step_type: 5,
                                step_name: "이용자",
                                step_recipients: [{ recipient_type: "01" }],
                            },
                        },
                    ],
                    total_rows: 1,
                    limit: 100,
                    skip: 0,
                };
            }
            return { documents: [], total_rows: 0, limit: 100, skip: skip ?? 0 };
        }) as any);

        const response = await controller.getStatusCounts(
            { branchId: "branch-1" },
            "access-token",
        );

        expect(response).toEqual({
            documents: [
                {
                    status_type: "060",
                    step_type: "05",
                    step_name: "이용자",
                    step_recipient_types: ["01"],
                },
            ],
        });
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
});
