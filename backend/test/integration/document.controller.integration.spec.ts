import { ExecutionContext, ForbiddenException, INestApplication, Logger, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentService } from "application/services/document.service";
import { DocumentEntity } from "domain/entities/document.entity";
import {
    FILE_STORAGE_PORT,
    FileStorageObjectNotFoundError,
    FileStoragePort,
} from "domain/ports/file-storage.port";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { DocumentController } from "interface/controllers/document.controller";
import request from "supertest";

describe("DocumentController (Integration)", () => {
    let app: INestApplication;
    let documentService: jest.Mocked<DocumentService>;
    let fileStorage: jest.Mocked<FileStoragePort>;

    function createDocumentEntity(
        orgId: string,
        storageUrl: string | null = "https://example.test/contract.pdf",
        overrides: { name?: string; mimetype?: string } = {},
    ): DocumentEntity {
        return DocumentEntity.reconstitute(
            "doc-1",
            overrides.name ?? "Contract",
            null,
            "contract",
            ["signed"],
            overrides.mimetype ?? "application/pdf",
            100,
            "documents/contract.pdf",
            storageUrl,
            orgId,
            "user-1",
            new Date("2026-01-01T00:00:00.000Z"),
            new Date("2026-01-01T00:00:00.000Z"),
        );
    }

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
            controllers: [DocumentController],
            providers: [
                {
                    provide: DocumentService,
                    useValue: {
                        create: jest.fn(),
                        findById: jest.fn(),
                        findByOrgId: jest.fn(),
                        findByCategoryId: jest.fn(),
                        findAll: jest.fn(),
                        update: jest.fn(),
                        delete: jest.fn(),
                        deleteStoragePath: jest.fn(),
                    },
                },
                {
                    provide: FILE_STORAGE_PORT,
                    useValue: {
                        upload: jest.fn(),
                        createSignedUrl: jest.fn(),
                        download: jest.fn(),
                        delete: jest.fn(),
                    },
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

        documentService = moduleFixture.get(DocumentService);
        fileStorage = moduleFixture.get(FILE_STORAGE_PORT);
    });

    afterEach(async () => {
        await app.close();
    });

    it("should reject malformed upload tags before storage or persistence", async () => {
        const response = await request(app.getHttpServer())
            .post("/documents/upload")
            .field("name", "Contract")
            .field("categoryId", "contract")
            .field("tags", "not-json")
            .attach("file", Buffer.from("fake-file"), "contract.pdf");

        expect(response.status).toBe(400);
        expect(response.body.message).toBe("tags must be a valid JSON array");
        expect(fileStorage.upload).not.toHaveBeenCalled();
        expect(documentService.create).not.toHaveBeenCalled();
    });

    it("should use tenant branch as document metadata branch when creating documents", async () => {
        fileStorage.createSignedUrl.mockResolvedValue("https://example.test/signed-contract.pdf");
        documentService.create.mockResolvedValue(createDocumentEntity("branch-1", null));

        const response = await request(app.getHttpServer())
            .post("/documents")
            .send({
                name: "Contract",
                categoryId: "contract",
                tags: ["signed"],
                mimetype: "application/pdf",
                filesize: 100,
                storagepath: "documents/contract.pdf",
                storageurl: "https://example.test/contract.pdf",
                branchid: "branch-2",
                uploadedby: "user-1",
            });

        expect(response.status).toBe(201);
        expect(response.body.orgId).toBe("branch-1");
        expect(response.body.storageUrl).toBe("https://example.test/signed-contract.pdf");
        expect(documentService.create).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                branchid: "branch-1",
            }),
        );
        expect(documentService.create.mock.calls[0]?.[1]).not.toHaveProperty("storageurl");
        expect(fileStorage.createSignedUrl).toHaveBeenCalledWith("documents/contract.pdf");
    });

    it("should reject unavailable storage paths before signing a URL", async () => {
        documentService.create.mockRejectedValue(new ForbiddenException("storage path unavailable"));

        const response = await request(app.getHttpServer())
            .post("/documents")
            .send({
                name: "Contract",
                categoryId: "contract",
                tags: ["signed"],
                mimetype: "application/pdf",
                filesize: 100,
                storagepath: "documents/shared.pdf",
                uploadedby: "user-1",
            });

        expect(response.status).toBe(403);
        expect(response.body.message).toBe("storage path unavailable");
        expect(fileStorage.createSignedUrl).not.toHaveBeenCalled();
    });

    it("should use tenant branch as document metadata branch when uploading documents", async () => {
        fileStorage.upload.mockResolvedValue("https://example.test/signed-contract.pdf");
        documentService.create.mockResolvedValue(createDocumentEntity("branch-1", null));

        const response = await request(app.getHttpServer())
            .post("/documents/upload")
            .field("name", "Contract")
            .field("categoryId", "contract")
            .field("tags", JSON.stringify(["signed"]))
            .field("branchid", "branch-2")
            .attach("file", Buffer.from("fake-file"), "contract.pdf");

        expect(response.status).toBe(201);
        expect(response.body.orgId).toBe("branch-1");
        expect(response.body.storageUrl).toBe("https://example.test/signed-contract.pdf");
        expect(documentService.create).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                branchid: "branch-1",
            }),
        );
        expect(documentService.create.mock.calls[0]?.[1]).not.toHaveProperty("storageurl");
        expect(fileStorage.createSignedUrl).not.toHaveBeenCalled();
    });

    it("should use tenant user as document uploader when uploading documents", async () => {
        fileStorage.upload.mockResolvedValue("https://example.test/signed-contract.pdf");
        documentService.create.mockResolvedValue(createDocumentEntity("branch-1", null));

        const response = await request(app.getHttpServer())
            .post("/documents/upload")
            .field("name", "Contract")
            .field("categoryId", "contract")
            .field("tags", JSON.stringify(["signed"]))
            .field("uploadedby", "attacker-user")
            .field("uploadedBy", "camel-attacker-user")
            .attach("file", Buffer.from("fake-file"), "contract.pdf");

        expect(response.status).toBe(201);
        expect(documentService.create).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                uploadedby: "user-1",
            }),
        );
    });

    it("should return document list metadata without signing storage URLs", async () => {
        documentService.findAll.mockResolvedValue([
            createDocumentEntity("branch-1", null),
        ]);
        fileStorage.createSignedUrl.mockRejectedValue(new Error("storage unavailable"));

        const response = await request(app.getHttpServer()).get("/documents");

        expect(response.status).toBe(200);
        expect(response.body).toEqual([
            expect.objectContaining({
                id: "doc-1",
                storagePath: "documents/contract.pdf",
                storageUrl: null,
            }),
        ]);
        expect(documentService.findAll).toHaveBeenCalledWith("branch-1");
        expect(fileStorage.createSignedUrl).not.toHaveBeenCalled();
    });

    it("should sign stored document paths when returning a document detail", async () => {
        documentService.findById.mockResolvedValue(
            createDocumentEntity("branch-1", "https://public.example.test/contract.pdf"),
        );
        fileStorage.createSignedUrl.mockResolvedValue("https://example.test/signed-contract.pdf");

        const response = await request(app.getHttpServer()).get("/documents/doc-1");

        expect(response.status).toBe(200);
        expect(response.body.storageUrl).toBe("https://example.test/signed-contract.pdf");
        expect(fileStorage.createSignedUrl).toHaveBeenCalledWith("documents/contract.pdf");
    });

    it("should return not found when a document detail file is missing from storage", async () => {
        documentService.findById.mockResolvedValue(createDocumentEntity("branch-1", null));
        fileStorage.createSignedUrl.mockRejectedValue(
            new FileStorageObjectNotFoundError("documents/contract.pdf", "signed-url"),
        );

        const response = await request(app.getHttpServer()).get("/documents/doc-1");

        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Document file not found");
    });

    it("should return not found when a document file is missing from storage", async () => {
        documentService.findById.mockResolvedValue(createDocumentEntity("branch-1", null));
        fileStorage.download.mockRejectedValue(new Error("Failed to download: Object not found"));

        const response = await request(app.getHttpServer()).get("/documents/doc-1/download");

        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Document file not found");
    });

    it("should reject uploads whose MIME type is not allowlisted before touching storage", async () => {
        const response = await request(app.getHttpServer())
            .post("/documents/upload")
            .field("name", "Payload")
            .field("categoryId", "contract")
            .field("tags", JSON.stringify([]))
            .attach("file", Buffer.from("<script>alert(1)</script>"), {
                filename: "payload.html",
                contentType: "text/html",
            });

        expect(response.status).toBe(400);
        expect(response.body.message).toBe("unsupported file type: text/html");
        expect(fileStorage.upload).not.toHaveBeenCalled();
        expect(documentService.create).not.toHaveBeenCalled();
    });

    it("should reject parameterised MIME variants that normalize to a forbidden type", async () => {
        const response = await request(app.getHttpServer())
            .post("/documents/upload")
            .field("name", "Payload")
            .field("categoryId", "contract")
            .attach("file", Buffer.from("<svg onload=alert(1)></svg>"), {
                filename: "payload.svg",
                contentType: "IMAGE/SVG+XML; charset=utf-8",
            });

        expect(response.status).toBe(400);
        expect(response.body.message).toBe("unsupported file type: image/svg+xml");
        expect(fileStorage.upload).not.toHaveBeenCalled();
    });

    it("should serve stored non-previewable MIME types as an opaque attachment, never inline", async () => {
        documentService.findById.mockResolvedValue(
            createDocumentEntity("branch-1", null, { name: "payload.html", mimetype: "text/html" }),
        );
        fileStorage.download.mockResolvedValue(Buffer.from("<script>alert(1)</script>"));

        const response = await request(app.getHttpServer()).get("/documents/doc-1/download");

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toBe("application/octet-stream");
        expect(response.headers["content-disposition"]).toMatch(/^attachment; /);
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("should not serve image/svg+xml inline even though it is an image type", async () => {
        documentService.findById.mockResolvedValue(
            createDocumentEntity("branch-1", null, { name: "diagram.svg", mimetype: "image/svg+xml" }),
        );
        fileStorage.download.mockResolvedValue(Buffer.from('<svg onload="alert(1)"></svg>'));

        const response = await request(app.getHttpServer()).get("/documents/doc-1/download");

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toBe("application/octet-stream");
        expect(response.headers["content-disposition"]).toMatch(/^attachment; /);
    });

    it("should keep serving PDF documents inline with nosniff protection", async () => {
        documentService.findById.mockResolvedValue(createDocumentEntity("branch-1", null));
        fileStorage.download.mockResolvedValue(Buffer.from("%PDF-1.4"));

        const response = await request(app.getHttpServer()).get("/documents/doc-1/download");

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toBe("application/pdf");
        expect(response.headers["content-disposition"]).toBe(
            "inline; filename=\"Contract.pdf\"; filename*=UTF-8''Contract.pdf",
        );
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("should delete the just-uploaded storage object when document creation fails", async () => {
        fileStorage.upload.mockResolvedValue("https://example.test/signed-contract.pdf");
        documentService.create.mockRejectedValue(new ForbiddenException("storage path unavailable"));
        documentService.deleteStoragePath.mockResolvedValue(undefined);

        const response = await request(app.getHttpServer())
            .post("/documents/upload")
            .field("name", "Contract")
            .field("categoryId", "contract")
            .field("tags", JSON.stringify(["signed"]))
            .attach("file", Buffer.from("fake-file"), "contract.pdf");

        expect(response.status).toBe(403);
        expect(response.body.message).toBe("storage path unavailable");
        const uploadedPath = fileStorage.upload.mock.calls[0]?.[1];
        expect(uploadedPath).toBeDefined();
        expect(documentService.deleteStoragePath).toHaveBeenCalledWith(uploadedPath);
    });

    it("should rethrow the original creation error when orphan cleanup also fails", async () => {
        const errorLogSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        try {
            fileStorage.upload.mockResolvedValue("https://example.test/signed-contract.pdf");
            documentService.create.mockRejectedValue(new ForbiddenException("storage path unavailable"));
            documentService.deleteStoragePath.mockRejectedValue(new Error("storage unavailable"));

            const response = await request(app.getHttpServer())
                .post("/documents/upload")
                .field("name", "Contract")
                .field("categoryId", "contract")
                .attach("file", Buffer.from("fake-file"), "contract.pdf");

            expect(response.status).toBe(403);
            expect(response.body.message).toBe("storage path unavailable");
            expect(documentService.deleteStoragePath).toHaveBeenCalled();
        } finally {
            errorLogSpy.mockRestore();
        }
    });

    it("should emit an RFC 5987 filename* so Korean document names download intact", async () => {
        documentService.findById.mockResolvedValue(
            createDocumentEntity("branch-1", null, { name: "서류.pdf" }),
        );
        fileStorage.download.mockResolvedValue(Buffer.from("%PDF-1.4"));

        const response = await request(app.getHttpServer())
            .get("/documents/doc-1/download")
            .query({ attachment: "true" });

        expect(response.status).toBe(200);
        expect(response.headers["content-disposition"]).toBe(
            "attachment; filename=\"__.pdf\"; filename*=UTF-8''%EC%84%9C%EB%A5%98.pdf",
        );
    });

    it("should sanitize quotes and newlines so document names cannot break the download header", async () => {
        documentService.findById.mockResolvedValue(
            createDocumentEntity("branch-1", null, { name: 'Con"tract\r\n.pdf' }),
        );
        fileStorage.download.mockResolvedValue(Buffer.from("%PDF-1.4"));

        const response = await request(app.getHttpServer())
            .get("/documents/doc-1/download")
            .query({ attachment: "true" });

        expect(response.status).toBe(200);
        const disposition = response.headers["content-disposition"];
        expect(disposition).toBe(
            "attachment; filename=\"Con_tract__.pdf\"; filename*=UTF-8''Con%22tract%0D%0A.pdf",
        );
        expect(disposition).not.toMatch(/[\r\n]/);
    });
});
