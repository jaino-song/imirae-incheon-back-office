import {
    EformsignDocumentMirrorService,
    EformsignStoredFileIntegrityError,
    redactCredentialFields,
} from "application/services/eformsign-document-mirror.service";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import {
    EformsignDocOwnershipConflictError,
    EformsignDocStaleUpdateError,
} from "domain/repositories/eformsign-doc.repository.interface";
import { normalizeEformsignDocumentResponse } from "infrastructure/api/eformsign-response.normalizer";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";

const PDF = Buffer.from("%PDF-1.4\nlocal mirror test\n%%EOF");
const UPDATED_AT = Date.parse("2026-07-29T03:00:00.000Z");

function richDetail(): EformsignApiDocumentResponse {
    return normalizeEformsignDocumentResponse({
        id: "doc-1",
        document_number: "DOC-2026-1",
        document_name: "산모신생아 건강관리 계약서",
        template: { id: "template-1", name: "서비스 계약서" },
        creator: { recipient_type: "01", id: "creator@example.com", name: "담당자" },
        last_editor: { recipient_type: "01", id: "editor@example.com", name: "최종 확인자" },
        created_date: Date.parse("2026-07-28T03:00:00.000Z"),
        updated_date: UPDATED_AT,
        current_status: {
            status_type: "doc_complete",
            status_doc_type: "complete",
            status_doc_detail: "완료",
            step_type: "06",
            step_index: "3",
            step_name: "제공기관 최종확인",
            step_recipients: [{
                recipient_type: "06",
                id: "provider@example.com",
                name: "제공기관",
                sms: "01012345678",
            }],
            step_group: 3,
        },
        fields: [
            { id: "이용자 성명", value: "테스트 고객", type: "text" },
            { id: "이용자 연락처", value: "01012345678", type: "text" },
            { id: "주소", value: "인천광역시", type: "text" },
            { id: "계약기간", value: "2026-08-01~2026-08-14", type: "text" },
            { id: "본인부담금", value: "123000", type: "text" },
        ],
        histories: [{ status_type: "060", updated_date: UPDATED_AT - 1_000 }],
        previous_status: [{ step_type: "05", step_name: "이용자 서명" }],
        next_status: [],
        recipients: [{ name: "테스트 고객", sms: "01012345678" }],
        detail_template_info: [{ id: "계약기간", type: "text" }],
        external_token: "must-not-be-persisted",
        outside_token: "must-also-not-be-persisted",
        nested: {
            access_token: "also-secret",
            refreshToken: "camel-case-secret",
            client_secret: "nested-client-secret",
            visible: "preserved",
            nonFinite: Number.NaN,
        },
    });
}

describe("EformsignDocumentMirrorService", () => {
    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    it("invalidates snapshots when permanent-purge visibility changes", async () => {
        const generation = new Date("2026-07-30T00:00:00.000Z");
        const request = { documentId: "doc-1", generation };
        const repository = {
            requestPermanentPurge: jest.fn().mockResolvedValue([request]),
            clearPermanentPurgeRequest: jest.fn()
                .mockResolvedValueOnce(["doc-1"])
                .mockResolvedValueOnce([]),
            findState: jest.fn().mockResolvedValue({ branchId: "branch-1" }),
        };
        const snapshots = {
            bumpVersion: jest.fn().mockResolvedValue(1),
            bumpCompanyEpoch: jest.fn().mockResolvedValue(undefined),
        };
        const service = new EformsignDocumentMirrorService(
            {} as never,
            repository as never,
            {} as never,
            {} as never,
            {} as never,
            snapshots as never,
        );

        await expect(service.requestPermanentPurge(["doc-1"])).resolves.toEqual([request]);
        await expect(service.clearPermanentPurgeRequest([request])).resolves.toEqual(["doc-1"]);
        await expect(service.clearPermanentPurgeRequest([request])).resolves.toEqual([]);

        expect(repository.requestPermanentPurge).toHaveBeenCalledWith(["doc-1"]);
        expect(repository.clearPermanentPurgeRequest).toHaveBeenNthCalledWith(1, [request]);
        expect(snapshots.bumpVersion).toHaveBeenCalledTimes(2);
    });

    it("reports ready only when detail and both files share the ready source version", async () => {
        const sourceUpdatedDate = new Date(UPDATED_AT);
        const readyState = {
            documentId: "doc-1",
            branchId: "branch-1",
            detailPayload: richDetail(),
            detailSourceUpdatedDate: sourceUpdatedDate,
            detailSyncedAt: sourceUpdatedDate,
            syncStatus: "ready",
            syncError: null,
            permanentPurgeRequestedAt: null,
            files: ["document", "audit_trail"].map((fileType) => ({
                fileType,
                contentType: "application/pdf",
                contentDisposition: null,
                byteSize: PDF.length,
                sha256: "hash",
                sourceUpdatedDate,
                syncedAt: sourceUpdatedDate,
            })),
        };
        const repository = {
            findState: jest.fn().mockResolvedValue(readyState),
        };
        const service = new EformsignDocumentMirrorService(
            {} as never,
            repository as never,
            {} as never,
            {} as never,
            {} as never,
        );

        await expect(service.isDocumentReady("doc-1")).resolves.toBe(true);

        repository.findState.mockResolvedValue({
            ...readyState,
            syncStatus: "syncing",
        });
        await expect(service.isDocumentReady("doc-1")).resolves.toBe(false);

        for (const statusType of ["doc_revoke", "doc_reject_reviewer"]) {
            repository.findState.mockResolvedValue({
                ...readyState,
                detailPayload: {
                    ...readyState.detailPayload,
                    current_status: {
                        ...readyState.detailPayload.current_status,
                        status_type: statusType,
                    },
                },
            });
            await expect(service.isDocumentReady("doc-1")).resolves.toBe(false);
        }

        repository.findState.mockResolvedValue({
            ...readyState,
            permanentPurgeRequestedAt: new Date(UPDATED_AT + 1),
        });
        await expect(service.isDocumentReady("doc-1")).resolves.toBe(false);
        await expect(service.getStoredDetail("doc-1")).resolves.toBeNull();

        repository.findState.mockResolvedValue({
            ...readyState,
            files: readyState.files.map((file) => ({
                ...file,
                sourceUpdatedDate: new Date(UPDATED_AT - 1),
            })),
        });
        await expect(service.isDocumentReady("doc-1")).resolves.toBe(false);
    });

    it("persists every non-secret detail value and both PDF files", async () => {
        const detail = richDetail();
        const repository = {
            findState: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValue({ branchId: "branch-1" }),
            findFile: jest.fn(),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const client = {
            getDocument: jest.fn().mockResolvedValue(detail),
        };
        const mirrorUsecase = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }),
        };
        const linkByPhoneUsecase = {
            execute: jest.fn().mockResolvedValue("linked"),
        };
        const vendorService = {
            downloadDocumentFile: jest.fn().mockResolvedValue({
                status: 200,
                contentType: "application/pdf",
                contentDisposition: 'attachment; filename="contract.pdf"',
                body: PDF,
            }),
        };
        const snapshots = {
            bumpVersion: jest.fn().mockResolvedValue(1),
            bumpCompanyEpoch: jest.fn().mockResolvedValue(undefined),
        };
        const service = new EformsignDocumentMirrorService(
            client as never,
            repository as never,
            mirrorUsecase as never,
            linkByPhoneUsecase as never,
            vendorService as never,
            snapshots as never,
        );

        const result = await service.syncDocumentWithToken(
            "vendor-token",
            "doc-1",
            { force: true },
        );

        expect(result).toEqual(expect.objectContaining({
            status: "synced",
            storedFileTypes: ["document", "audit_trail"],
            missingFileTypes: [],
        }));
        expect(mirrorUsecase.mirrorRemoteDocument).toHaveBeenCalledWith(detail, {
            allowAssignedUpdate: true,
            fallbackDocumentId: "doc-1",
        });
        expect(repository.saveDetail).toHaveBeenCalledTimes(1);
        expect(repository.saveDetail).toHaveBeenCalledWith(expect.objectContaining({
            customerPhone: "01012345678",
        }));
        const savedDetail = repository.saveDetail.mock.calls[0]?.[0].detailPayload;
        expect(savedDetail).toEqual(redactCredentialFields(detail));
        expect(savedDetail).toEqual(expect.objectContaining({
            fields: detail.fields,
            histories: detail.histories,
            previous_status: detail.previous_status,
            next_status: detail.next_status,
            recipients: detail.recipients,
            detail_template_info: detail.detail_template_info,
        }));
        expect(savedDetail).not.toHaveProperty("external_token");
        expect(savedDetail).not.toHaveProperty("outside_token");
        expect(savedDetail).toHaveProperty("nested.visible", "preserved");
        expect(savedDetail).not.toHaveProperty("nested.access_token");
        expect(savedDetail).not.toHaveProperty("nested.refreshToken");
        expect(savedDetail).not.toHaveProperty("nested.client_secret");
        expect(savedDetail).toHaveProperty("nested.nonFinite", null);
        expect(repository.saveFile).toHaveBeenCalledTimes(2);
        expect(repository.saveFile).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                fileType: "document",
                content: PDF,
                byteSize: PDF.length,
            }),
        );
        expect(repository.saveFile).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                fileType: "audit_trail",
                content: PDF,
                byteSize: PDF.length,
            }),
        );
        expect(repository.markSyncFinished).toHaveBeenCalledWith(
            "doc-1",
            new Date(UPDATED_AT),
            repository.saveDetail.mock.calls[0]?.[0].syncedAt,
            "ready",
            null,
        );
        expect(snapshots.bumpVersion).toHaveBeenCalledTimes(2);
    });

    it("reports ownership changes when ready mirror reconciliation links a branchless document", async () => {
        const detail = richDetail();
        const sourceUpdatedDate = new Date(UPDATED_AT);
        const readyState = {
            documentId: "doc-1",
            branchId: "branch-1",
            detailPayload: detail,
            detailSourceUpdatedDate: sourceUpdatedDate,
            detailSyncedAt: sourceUpdatedDate,
            syncStatus: "ready",
            syncError: null,
            permanentPurgeRequestedAt: null,
            files: ["document", "audit_trail"].map((fileType) => ({
                fileType,
                contentType: "application/pdf",
                contentDisposition: null,
                byteSize: PDF.length,
                sha256: "hash",
                sourceUpdatedDate,
                syncedAt: sourceUpdatedDate,
            })),
        };
        const repository = {
            findState: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(readyState),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const linkByPhoneUsecase = {
            execute: jest.fn().mockResolvedValue("linked"),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
            linkByPhoneUsecase as never,
            {
                downloadDocumentFile: jest.fn().mockResolvedValue({
                    status: 200,
                    contentType: "application/pdf",
                    contentDisposition: null,
                    body: PDF,
                }),
            } as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", { force: true }))
            .resolves.toEqual(expect.objectContaining({
                status: "synced",
                ownershipChanged: true,
            }));
        expect(linkByPhoneUsecase.execute).toHaveBeenCalledWith("doc-1", undefined, {
            detailSourceUpdatedDate: sourceUpdatedDate,
            detailSyncedAt: sourceUpdatedDate,
        });
    });

    it("continues detail and PDF sync when the projection is already newer", async () => {
        const detail = richDetail();
        const repository = {
            findState: jest.fn().mockResolvedValue(null),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const mirrorUsecase = {
            mirrorRemoteDocument: jest.fn().mockRejectedValue(
                new EformsignDocStaleUpdateError("doc-1"),
            ),
        };
        const vendorService = {
            downloadDocumentFile: jest.fn().mockResolvedValue({
                status: 200,
                contentType: "application/pdf",
                contentDisposition: null,
                body: PDF,
            }),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            mirrorUsecase as never,
            { execute: jest.fn().mockResolvedValue("linked") } as never,
            vendorService as never,
        );

        await expect(service.syncDocumentWithToken("vendor-token", "doc-1", { force: true }))
            .resolves.toEqual(expect.objectContaining({
                status: "synced",
                storedFileTypes: ["document", "audit_trail"],
            }));
        expect(repository.saveDetail).toHaveBeenCalledTimes(1);
        expect(vendorService.downloadDocumentFile).toHaveBeenCalledTimes(2);
        expect(repository.markSyncFinished).toHaveBeenCalledTimes(1);
    });

    it("keeps a branch-owned projection untouched while syncing its detail and PDFs on request", async () => {
        const detail = richDetail();
        const repository = {
            findState: jest.fn().mockResolvedValue(null),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const mirrorUsecase = {
            mirrorRemoteDocument: jest.fn().mockRejectedValue(
                new EformsignDocOwnershipConflictError("doc-1"),
            ),
        };
        const vendorService = {
            downloadDocumentFile: jest.fn().mockResolvedValue({
                status: 200,
                contentType: "application/pdf",
                contentDisposition: null,
                body: PDF,
            }),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            mirrorUsecase as never,
            { execute: jest.fn().mockResolvedValue("linked") } as never,
            vendorService as never,
        );

        await expect(service.syncDocumentWithToken("vendor-token", "doc-1", {
            force: true,
            skipBranchOwnedProjection: true,
        })).resolves.toEqual(expect.objectContaining({
            status: "synced",
            storedFileTypes: ["document", "audit_trail"],
        }));

        expect(mirrorUsecase.mirrorRemoteDocument).toHaveBeenCalledWith(detail, {
            fallbackDocumentId: "doc-1",
        });
        expect(repository.saveDetail).toHaveBeenCalledTimes(1);
        expect(vendorService.downloadDocumentFile).toHaveBeenCalledTimes(2);
        expect(repository.markSyncFinished).toHaveBeenCalledTimes(1);
    });

    it("does not suppress non-ownership projection failures when branch-owned projection is skipped", async () => {
        const detail = richDetail();
        const projectionError = new Error("projection write failed");
        const repository = {
            findState: jest.fn().mockResolvedValue(null),
            saveDetail: jest.fn(),
        };
        const mirrorUsecase = {
            mirrorRemoteDocument: jest.fn().mockRejectedValue(projectionError),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            mirrorUsecase as never,
            {} as never,
            {} as never,
        );

        await expect(service.syncDocumentWithToken("vendor-token", "doc-1", {
            force: true,
            skipBranchOwnedProjection: true,
        })).rejects.toBe(projectionError);

        expect(repository.saveDetail).not.toHaveBeenCalled();
    });

    it("advances the attempt generation when two syncs start in the same millisecond", async () => {
        jest.spyOn(Date, "now").mockReturnValue(UPDATED_AT);
        const detail = richDetail();
        const previousAttempt = new Date(UPDATED_AT);
        const repository = {
            findState: jest.fn().mockResolvedValue({
                documentId: "doc-1",
                branchId: "branch-1",
                detailPayload: detail,
                detailSourceUpdatedDate: new Date(UPDATED_AT),
                detailSyncedAt: previousAttempt,
                syncStatus: "partial",
                syncError: "retry",
                files: [],
            }),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn(),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            {
                mirrorRemoteDocument: jest.fn().mockResolvedValue({
                    documentId: "doc-1",
                }),
            } as never,
            { execute: jest.fn().mockResolvedValue("already_linked") } as never,
            {
                downloadDocumentFile: jest.fn().mockResolvedValue({
                    status: 200,
                    contentType: "application/pdf",
                    contentDisposition: null,
                    body: PDF,
                }),
            } as never,
        );

        await service.syncDocumentWithToken("token", "doc-1", { force: true });

        expect(repository.saveDetail).toHaveBeenCalledWith(expect.objectContaining({
            expectedDetailSyncedAt: previousAttempt,
            allowReadySameVersionRepair: true,
            syncedAt: new Date(UPDATED_AT + 1),
        }));
    });

    it("skips an unchanged completed document only after both local files exist", async () => {
        const detail = richDetail();
        const repository = {
            findState: jest.fn().mockResolvedValue({
                documentId: "doc-1",
                branchId: null,
                detailPayload: detail,
                detailSourceUpdatedDate: new Date(UPDATED_AT),
                detailSyncedAt: new Date(UPDATED_AT),
                syncStatus: "ready",
                syncError: null,
                files: [
                    { fileType: "document", sourceUpdatedDate: new Date(UPDATED_AT) },
                    { fileType: "audit_trail", sourceUpdatedDate: new Date(UPDATED_AT) },
                ],
            }),
        };
        const client = { getDocument: jest.fn() };
        const linkByPhoneUsecase = {
            execute: jest.fn().mockResolvedValue("already_linked"),
        };
        const service = new EformsignDocumentMirrorService(
            client as never,
            repository as never,
            {} as never,
            linkByPhoneUsecase as never,
            {} as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", {
            expectedUpdatedDate: UPDATED_AT,
        })).resolves.toEqual(expect.objectContaining({ status: "skipped" }));
        expect(client.getDocument).not.toHaveBeenCalled();
        expect(linkByPhoneUsecase.execute).toHaveBeenCalledWith("doc-1", undefined, {
            detailSourceUpdatedDate: new Date(UPDATED_AT),
            detailSyncedAt: new Date(UPDATED_AT),
        });
    });

    it("repairs a ready same-version mirror with a missing PDF using a new fenced attempt", async () => {
        const detail = richDetail();
        const previousAttempt = new Date(UPDATED_AT);
        const repository = {
            findState: jest.fn().mockResolvedValue({
                documentId: "doc-1",
                branchId: null,
                detailPayload: detail,
                detailSourceUpdatedDate: previousAttempt,
                detailSyncedAt: previousAttempt,
                syncStatus: "ready",
                syncError: null,
                files: [{ fileType: "document", sourceUpdatedDate: previousAttempt }],
            }),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const vendorService = {
            downloadDocumentFile: jest.fn().mockResolvedValue({
                status: 200,
                contentType: "application/pdf",
                contentDisposition: null,
                body: PDF,
            }),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
            { execute: jest.fn().mockResolvedValue("already_linked") } as never,
            vendorService as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1"))
            .resolves.toEqual(expect.objectContaining({ status: "synced" }));
        expect(repository.saveDetail).toHaveBeenCalledWith(expect.objectContaining({
            expectedDetailSyncedAt: previousAttempt,
            allowReadySameVersionRepair: true,
        }));
        expect(vendorService.downloadDocumentFile).toHaveBeenCalledTimes(2);
        expect(repository.saveFile).toHaveBeenCalledTimes(2);
    });

    it("refreshes action-webhook detail without rewriting healthy same-version PDFs", async () => {
        const detail = richDetail();
        const sourceUpdatedDate = new Date(UPDATED_AT);
        const repository = {
            findState: jest.fn().mockResolvedValue({
                documentId: "doc-1",
                branchId: null,
                detailPayload: detail,
                detailSourceUpdatedDate: sourceUpdatedDate,
                detailSyncedAt: sourceUpdatedDate,
                syncStatus: "ready",
                syncError: null,
                permanentPurgeRequestedAt: null,
                files: ["document", "audit_trail"].map((fileType) => ({
                    fileType,
                    sourceUpdatedDate,
                })),
            }),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const client = { getDocument: jest.fn().mockResolvedValue(detail) };
        const vendorService = { downloadDocumentFile: jest.fn() };
        const service = new EformsignDocumentMirrorService(
            client as never,
            repository as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
            { execute: jest.fn().mockResolvedValue("already_linked") } as never,
            vendorService as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", {
            force: true,
            skipHealthySameVersionFileRepair: true,
        })).resolves.toEqual(expect.objectContaining({
            status: "synced",
            storedFileTypes: ["document", "audit_trail"],
            missingFileTypes: [],
        }));

        expect(client.getDocument).toHaveBeenCalledWith("token", "doc-1");
        expect(repository.saveDetail).toHaveBeenCalledWith(expect.objectContaining({
            detailPayload: expect.objectContaining({
                id: "doc-1",
                updated_date: UPDATED_AT,
            }),
            allowReadySameVersionRepair: true,
        }));
        expect(vendorService.downloadDocumentFile).not.toHaveBeenCalled();
        expect(repository.saveFile).not.toHaveBeenCalled();
    });

    it("repairs missing, failed, and newer-version files even when action webhooks skip healthy rewrites", async () => {
        const sourceUpdatedDate = new Date(UPDATED_AT);
        const healthyFiles = ["document", "audit_trail"].map((fileType) => ({
            fileType,
            sourceUpdatedDate,
        }));
        const scenarios = [
            {
                name: "missing",
                state: {
                    syncStatus: "ready",
                    files: healthyFiles.slice(0, 1),
                },
                detail: richDetail(),
            },
            {
                name: "failed",
                state: {
                    syncStatus: "failed",
                    files: healthyFiles,
                },
                detail: richDetail(),
            },
            {
                name: "newer",
                state: {
                    syncStatus: "ready",
                    files: healthyFiles,
                },
                detail: {
                    ...richDetail(),
                    updated_date: UPDATED_AT + 1,
                },
            },
        ];

        for (const scenario of scenarios) {
            const repository = {
                findState: jest.fn().mockResolvedValue({
                    documentId: "doc-1",
                    branchId: null,
                    detailPayload: richDetail(),
                    detailSourceUpdatedDate: sourceUpdatedDate,
                    detailSyncedAt: sourceUpdatedDate,
                    syncStatus: scenario.state.syncStatus,
                    syncError: null,
                    permanentPurgeRequestedAt: null,
                    files: scenario.state.files,
                }),
                saveDetail: jest.fn().mockResolvedValue(true),
                saveFile: jest.fn().mockResolvedValue(true),
                markSyncFinished: jest.fn().mockResolvedValue(true),
                markSyncFailed: jest.fn().mockResolvedValue(undefined),
            };
            const vendorService = {
                downloadDocumentFile: jest.fn().mockResolvedValue({
                    status: 200,
                    contentType: "application/pdf",
                    contentDisposition: null,
                    body: PDF,
                }),
            };
            const service = new EformsignDocumentMirrorService(
                { getDocument: jest.fn().mockResolvedValue(scenario.detail) } as never,
                repository as never,
                { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
                { execute: jest.fn().mockResolvedValue("already_linked") } as never,
                vendorService as never,
            );

            await expect(service.syncDocumentWithToken("token", "doc-1", {
                force: true,
                skipHealthySameVersionFileRepair: true,
            })).resolves.toEqual(expect.objectContaining({ status: "synced" }));

            expect(vendorService.downloadDocumentFile).toHaveBeenCalledTimes(2);
            expect(repository.saveFile).toHaveBeenCalledTimes(2);
        }
    });

    it("propagates the historical-import automation suppression on a fresh mirror", async () => {
        const detail = richDetail();
        const linkByPhoneUsecase = {
            execute: jest.fn().mockResolvedValue("already_linked"),
        };
        const service = new EformsignDocumentMirrorService(
            {} as never,
            {
                findState: jest.fn().mockResolvedValue({
                    documentId: "doc-1",
                    branchId: null,
                    detailPayload: redactCredentialFields(detail),
                    detailSourceUpdatedDate: new Date(UPDATED_AT),
                    detailSyncedAt: new Date(UPDATED_AT),
                    syncStatus: "ready",
                    syncError: null,
                    files: [
                        { fileType: "document", sourceUpdatedDate: new Date(UPDATED_AT) },
                        { fileType: "audit_trail", sourceUpdatedDate: new Date(UPDATED_AT) },
                    ],
                }),
            } as never,
            {} as never,
            linkByPhoneUsecase as never,
            {} as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", {
            expectedUpdatedDate: UPDATED_AT,
            suppressOutboundAutomation: true,
        })).resolves.toEqual(expect.objectContaining({ status: "skipped" }));
        expect(linkByPhoneUsecase.execute).toHaveBeenCalledWith("doc-1", {
            suppressOutboundAutomation: true,
        }, {
            detailSourceUpdatedDate: new Date(UPDATED_AT),
            detailSyncedAt: new Date(UPDATED_AT),
        });
    });

    it("reconciles a ready completed mirror through persistence-only completion effects", async () => {
        const detail = richDetail();
        const sourceUpdatedDate = new Date(UPDATED_AT);
        const repository = {
            findState: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValue({
                    documentId: "doc-1",
                    branchId: "branch-1",
                    detailPayload: redactCredentialFields(detail),
                    detailSourceUpdatedDate: sourceUpdatedDate,
                    detailSyncedAt: sourceUpdatedDate,
                    syncStatus: "ready",
                    syncError: null,
                    files: ["document", "audit_trail"].map((fileType) => ({
                        fileType,
                        sourceUpdatedDate,
                    })),
                }),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const linkByPhoneUsecase = { execute: jest.fn() };
        const completedMirrorReconciler = {
            execute: jest.fn().mockResolvedValue(undefined),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
            linkByPhoneUsecase as never,
            {
                downloadDocumentFile: jest.fn().mockResolvedValue({
                    status: 200,
                    contentType: "application/pdf",
                    contentDisposition: null,
                    body: PDF,
                }),
            } as never,
            undefined,
            completedMirrorReconciler as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", {
            force: true,
            suppressOutboundAutomation: true,
        })).resolves.toEqual(expect.objectContaining({ status: "synced" }));

        expect(completedMirrorReconciler.execute).toHaveBeenCalledWith({
            documentId: "doc-1",
            detail: redactCredentialFields(detail),
            options: { suppressOutboundAutomation: true },
        });
        expect(linkByPhoneUsecase.execute).not.toHaveBeenCalled();
    });

    it("keeps a partial non-completed mirror retryable without completion effects", async () => {
        const completedDetail = richDetail();
        const detail = {
            ...completedDetail,
            current_status: {
                ...completedDetail.current_status,
                status_type: "doc_request_participant",
            },
        };
        const repository = {
            findState: jest.fn().mockResolvedValue(null),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const linkByPhoneUsecase = { execute: jest.fn() };
        const completedMirrorReconciler = { execute: jest.fn() };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
            linkByPhoneUsecase as never,
            {
                downloadDocumentFile: jest.fn()
                    .mockResolvedValueOnce({
                        status: 200,
                        contentType: "application/pdf",
                        contentDisposition: null,
                        body: PDF,
                    })
                    .mockResolvedValueOnce({
                        status: 204,
                        contentType: "application/pdf",
                        contentDisposition: null,
                        body: Buffer.alloc(0),
                    }),
            } as never,
            undefined,
            completedMirrorReconciler as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", { force: true }))
            .resolves.toEqual(expect.objectContaining({
                status: "synced",
                missingFileTypes: ["audit_trail"],
            }));

        expect(repository.markSyncFinished).toHaveBeenCalledWith(
            "doc-1",
            new Date(UPDATED_AT),
            expect.any(Date),
            "partial",
            "Files not ready: audit_trail",
        );
        expect(linkByPhoneUsecase.execute).not.toHaveBeenCalled();
        expect(completedMirrorReconciler.execute).not.toHaveBeenCalled();
    });

    it("fails a completed mirror when its current-version audit trail is unavailable", async () => {
        const detail = richDetail();
        const repository = {
            findState: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValue({ branchId: "branch-1" }),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const snapshots = {
            bumpVersion: jest.fn().mockResolvedValue(1),
            bumpCompanyEpoch: jest.fn().mockResolvedValue(undefined),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
            { execute: jest.fn() } as never,
            {
                downloadDocumentFile: jest.fn()
                    .mockResolvedValueOnce({
                        status: 200,
                        contentType: "application/pdf",
                        contentDisposition: null,
                        body: PDF,
                    })
                    .mockResolvedValueOnce({
                        status: 204,
                        contentType: "application/pdf",
                        contentDisposition: null,
                        body: Buffer.alloc(0),
                    }),
            } as never,
            snapshots as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", { force: true }))
            .rejects.toThrow(/missing current-version files: audit_trail/i);

        expect(repository.markSyncFinished).not.toHaveBeenCalled();
        expect(repository.markSyncFailed).toHaveBeenCalledWith(
            "doc-1",
            new Date(UPDATED_AT),
            expect.any(Date),
            expect.stringContaining("audit_trail"),
        );
        expect(snapshots.bumpVersion).toHaveBeenCalledTimes(1);
    });

    it("does not reconcile a completion after a newer same-version generation wins finish CAS", async () => {
        const detail = richDetail();
        const winnerSyncedAt = new Date(UPDATED_AT + 1);
        const repository = {
            findState: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValue({
                    documentId: "doc-1",
                    branchId: "branch-1",
                    detailPayload: detail,
                    detailSourceUpdatedDate: new Date(UPDATED_AT),
                    detailSyncedAt: winnerSyncedAt,
                    syncStatus: "syncing",
                    syncError: null,
                    permanentPurgeRequestedAt: null,
                    files: [{
                        fileType: "document",
                        sourceUpdatedDate: new Date(UPDATED_AT),
                    }],
                }),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            // A forced same-version retry advanced detailSyncedAt and remains syncing.
            markSyncFinished: jest.fn().mockResolvedValue(false),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const completedMirrorReconciler = {
            execute: jest.fn().mockResolvedValue("already_linked"),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
            { execute: jest.fn() } as never,
            {
                downloadDocumentFile: jest.fn().mockResolvedValue({
                    status: 200,
                    contentType: "application/pdf",
                    contentDisposition: null,
                    body: PDF,
                }),
            } as never,
            undefined,
            completedMirrorReconciler as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", { force: true }))
            .resolves.toEqual(expect.objectContaining({ status: "synced" }));

        expect(repository.markSyncFinished).toHaveBeenCalledWith(
            "doc-1",
            new Date(UPDATED_AT),
            expect.any(Date),
            "ready",
            null,
        );
        expect(completedMirrorReconciler.execute).not.toHaveBeenCalled();
    });

    it("reconciles the ready winner after losing finish CAS", async () => {
        const detail = richDetail();
        const sourceUpdatedDate = new Date(UPDATED_AT);
        const winnerSyncedAt = new Date(UPDATED_AT + 1);
        const readyWinner = {
            documentId: "doc-1",
            branchId: "branch-1",
            detailPayload: detail,
            detailSourceUpdatedDate: sourceUpdatedDate,
            detailSyncedAt: winnerSyncedAt,
            syncStatus: "ready",
            syncError: null,
            permanentPurgeRequestedAt: null,
            files: ["document", "audit_trail"].map((fileType) => ({
                fileType,
                sourceUpdatedDate,
            })),
        };
        const repository = {
            findState: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValue(readyWinner),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(false),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const completedMirrorReconciler = {
            execute: jest.fn().mockResolvedValue("already_linked"),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
            { execute: jest.fn() } as never,
            {
                downloadDocumentFile: jest.fn().mockResolvedValue({
                    status: 200,
                    contentType: "application/pdf",
                    contentDisposition: null,
                    body: PDF,
                }),
            } as never,
            undefined,
            completedMirrorReconciler as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", { force: true }))
            .resolves.toEqual(expect.objectContaining({ status: "synced" }));

        expect(completedMirrorReconciler.execute).toHaveBeenCalledWith({
            documentId: "doc-1",
            detail,
        });
    });

    it("replays completed persistence effects from an isFresh mirror without a vendor fetch", async () => {
        const detail = richDetail();
        const sourceUpdatedDate = new Date(UPDATED_AT);
        const readyState = {
            documentId: "doc-1",
            branchId: "branch-1",
            detailPayload: detail,
            detailSourceUpdatedDate: sourceUpdatedDate,
            detailSyncedAt: sourceUpdatedDate,
            syncStatus: "ready",
            syncError: null,
            files: ["document", "audit_trail"].map((fileType) => ({
                fileType,
                contentType: "application/pdf",
                contentDisposition: null,
                byteSize: PDF.length,
                sha256: "hash",
                sourceUpdatedDate,
                syncedAt: sourceUpdatedDate,
            })),
        };
        const repository = { findState: jest.fn().mockResolvedValue(readyState) };
        const linkByPhoneUsecase = { execute: jest.fn() };
        const completedMirrorReconciler = {
            execute: jest.fn().mockResolvedValue("already_linked"),
        };
        const client = { getDocument: jest.fn() };
        const service = new EformsignDocumentMirrorService(
            client as never,
            repository as never,
            {} as never,
            linkByPhoneUsecase as never,
            {} as never,
            undefined,
            completedMirrorReconciler as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1"))
            .resolves.toEqual(expect.objectContaining({ status: "skipped" }));

        expect(client.getDocument).not.toHaveBeenCalled();
        expect(completedMirrorReconciler.execute).toHaveBeenCalledWith({
            documentId: "doc-1",
            detail,
        });
        expect(linkByPhoneUsecase.execute).not.toHaveBeenCalled();
    });

    it("retries a strict completion when the ready generation changes during reconciliation", async () => {
        const detail = richDetail();
        const sourceUpdatedDate = new Date(UPDATED_AT);
        const readyState = {
            documentId: "doc-1",
            branchId: "branch-1",
            detailPayload: detail,
            detailSourceUpdatedDate: sourceUpdatedDate,
            detailSyncedAt: sourceUpdatedDate,
            syncStatus: "ready",
            syncError: null,
            permanentPurgeRequestedAt: null,
            files: ["document", "audit_trail"].map((fileType) => ({
                fileType,
                sourceUpdatedDate,
            })),
        };
        const completedMirrorReconciler = {
            execute: jest.fn().mockResolvedValue("mirror_not_ready"),
        };
        const client = { getDocument: jest.fn() };
        const service = new EformsignDocumentMirrorService(
            client as never,
            { findState: jest.fn().mockResolvedValue(readyState) } as never,
            {} as never,
            {} as never,
            {} as never,
            undefined,
            completedMirrorReconciler as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", {
            strictCompletionReconciliation: true,
        })).rejects.toThrow(/generation changed/i);

        expect(client.getDocument).not.toHaveBeenCalled();
    });

    it("keeps non-completed mirrors on the existing link-only reconciliation path", async () => {
        const detail = richDetail();
        detail.current_status.status_type = "060";
        const sourceUpdatedDate = new Date(UPDATED_AT);
        const readyState = {
            documentId: "doc-1",
            branchId: "branch-1",
            detailPayload: detail,
            detailSourceUpdatedDate: sourceUpdatedDate,
            detailSyncedAt: sourceUpdatedDate,
            syncStatus: "ready",
            syncError: null,
            files: ["document", "audit_trail"].map((fileType) => ({
                fileType,
                contentType: "application/pdf",
                contentDisposition: null,
                byteSize: PDF.length,
                sha256: "hash",
                sourceUpdatedDate,
                syncedAt: sourceUpdatedDate,
            })),
        };
        const repository = { findState: jest.fn().mockResolvedValue(readyState) };
        const linkByPhoneUsecase = { execute: jest.fn().mockResolvedValue("already_linked") };
        const completedMirrorReconciler = { execute: jest.fn() };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn() } as never,
            repository as never,
            {} as never,
            linkByPhoneUsecase as never,
            {} as never,
            undefined,
            completedMirrorReconciler as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1"))
            .resolves.toEqual(expect.objectContaining({ status: "skipped" }));

        expect(linkByPhoneUsecase.execute).toHaveBeenCalledWith("doc-1", undefined, {
            detailSourceUpdatedDate: sourceUpdatedDate,
            detailSyncedAt: sourceUpdatedDate,
        });
        expect(completedMirrorReconciler.execute).not.toHaveBeenCalled();
    });

    it("keeps a completed mirror ready when client reconciliation fails", async () => {
        const detail = richDetail();
        const repository = {
            findState: jest.fn().mockResolvedValue(null),
            findFile: jest.fn(),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const service = new EformsignDocumentMirrorService(
            {
                getDocument: jest.fn().mockResolvedValue(detail),
            } as never,
            repository as never,
            {
                mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }),
            } as never,
            {
                execute: jest.fn().mockRejectedValue(new Error("client retry later")),
            } as never,
            {
                downloadDocumentFile: jest.fn().mockResolvedValue({
                    status: 200,
                    contentType: "application/pdf",
                    contentDisposition: null,
                    body: PDF,
                }),
            } as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", { force: true }))
            .resolves.toEqual(expect.objectContaining({ status: "synced" }));
        expect(repository.markSyncFinished).toHaveBeenCalledWith(
            "doc-1",
            new Date(UPDATED_AT),
            repository.saveDetail.mock.calls[0]?.[0].syncedAt,
            "ready",
            null,
        );
        expect(repository.markSyncFailed).not.toHaveBeenCalled();
    });

    it("keeps the ready mirror but rethrows completion reconciliation failures in strict mode", async () => {
        const detail = richDetail();
        const repository = {
            findState: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValue({
                    documentId: "doc-1",
                    branchId: "branch-1",
                    detailPayload: redactCredentialFields(detail),
                    detailSourceUpdatedDate: new Date(UPDATED_AT),
                    detailSyncedAt: new Date(UPDATED_AT),
                    syncStatus: "ready",
                    syncError: null,
                    files: ["document", "audit_trail"].map((fileType) => ({
                        fileType,
                        sourceUpdatedDate: new Date(UPDATED_AT),
                    })),
                }),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const lifecycleError = new Error("lifecycle database unavailable");
        const completedMirrorReconciler = {
            execute: jest.fn().mockRejectedValue(lifecycleError),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
            {} as never,
            {
                downloadDocumentFile: jest.fn().mockResolvedValue({
                    status: 200,
                    contentType: "application/pdf",
                    contentDisposition: null,
                    body: PDF,
                }),
            } as never,
            undefined,
            completedMirrorReconciler as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", {
            force: true,
            strictCompletionReconciliation: true,
        })).rejects.toThrow(lifecycleError);

        expect(repository.markSyncFinished).toHaveBeenCalledWith(
            "doc-1",
            new Date(UPDATED_AT),
            repository.saveDetail.mock.calls[0]?.[0].syncedAt,
            "ready",
            null,
        );
        expect(repository.markSyncFailed).not.toHaveBeenCalled();
        expect(completedMirrorReconciler.execute).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId: "doc-1",
                detail: redactCredentialFields(detail),
                throwOnCompletionReconciliationError: true,
                deferServiceRecordLifecycle: true,
            }),
        );
    });

    it("does not reconcile when a CAS winner is still syncing its current-version PDFs", async () => {
        const detail = richDetail();
        const newerSourceUpdatedDate = new Date(UPDATED_AT + 60_000);
        const currentState = {
            documentId: "doc-1",
            branchId: null,
            detailPayload: detail,
            detailSourceUpdatedDate: newerSourceUpdatedDate,
            detailSyncedAt: newerSourceUpdatedDate,
            syncStatus: "syncing",
            syncError: null,
            files: [{
                fileType: "document",
                sourceUpdatedDate: newerSourceUpdatedDate,
            }],
        };
        const repository = {
            findState: jest.fn().mockResolvedValue(currentState),
            saveDetail: jest.fn().mockResolvedValue(false),
            saveFile: jest.fn(),
            markSyncFinished: jest.fn(),
            markSyncFailed: jest.fn(),
        };
        const mirrorUsecase = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }),
        };
        const linkByPhoneUsecase = {
            execute: jest.fn().mockResolvedValue("already_linked"),
        };
        const vendorService = {
            downloadDocumentFile: jest.fn(),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            mirrorUsecase as never,
            linkByPhoneUsecase as never,
            vendorService as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", { force: true }))
            .resolves.toEqual({
                status: "skipped",
                documentId: "doc-1",
                sourceUpdatedDate: newerSourceUpdatedDate,
                storedFileTypes: ["document"],
                missingFileTypes: ["audit_trail"],
            });
        expect(repository.saveFile).not.toHaveBeenCalled();
        expect(repository.markSyncFinished).not.toHaveBeenCalled();
        expect(repository.markSyncFailed).not.toHaveBeenCalled();
        expect(vendorService.downloadDocumentFile).not.toHaveBeenCalled();
        expect(linkByPhoneUsecase.execute).not.toHaveBeenCalled();
    });

    it("reconciles when a CAS winner is ready with both current-version PDFs", async () => {
        const detail = richDetail();
        const newerSourceUpdatedDate = new Date(UPDATED_AT + 60_000);
        const currentState = {
            documentId: "doc-1",
            branchId: null,
            detailPayload: detail,
            detailSourceUpdatedDate: newerSourceUpdatedDate,
            detailSyncedAt: newerSourceUpdatedDate,
            syncStatus: "ready",
            syncError: null,
            files: ["document", "audit_trail"].map((fileType) => ({
                fileType,
                sourceUpdatedDate: newerSourceUpdatedDate,
            })),
        };
        const repository = {
            findState: jest.fn().mockResolvedValue(currentState),
            saveDetail: jest.fn().mockResolvedValue(false),
            saveFile: jest.fn(),
            markSyncFinished: jest.fn(),
            markSyncFailed: jest.fn(),
        };
        const linkByPhoneUsecase = {
            execute: jest.fn().mockResolvedValue("already_linked"),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
            linkByPhoneUsecase as never,
            { downloadDocumentFile: jest.fn() } as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", { force: true }))
            .resolves.toEqual(expect.objectContaining({
                status: "skipped",
                sourceUpdatedDate: newerSourceUpdatedDate,
                storedFileTypes: ["document", "audit_trail"],
                missingFileTypes: [],
            }));

        expect(linkByPhoneUsecase.execute).toHaveBeenCalledWith("doc-1", undefined, {
            detailSourceUpdatedDate: new Date("2026-07-29T03:01:00.000Z"),
            detailSyncedAt: new Date("2026-07-29T03:01:00.000Z"),
        });
    });

    it("retries a partial mirror even when the source timestamp is unchanged", async () => {
        const detail = richDetail();
        const repository = {
            findState: jest.fn().mockResolvedValue({
                documentId: "doc-1",
                branchId: null,
                detailPayload: detail,
                detailSourceUpdatedDate: new Date(UPDATED_AT),
                detailSyncedAt: new Date(UPDATED_AT),
                syncStatus: "partial",
                syncError: "Files not ready: audit_trail",
                files: [{ fileType: "document" }],
            }),
        };
        const client = {
            getDocument: jest.fn().mockRejectedValue(new Error("retry attempted")),
        };
        const service = new EformsignDocumentMirrorService(
            client as never,
            repository as never,
            {} as never,
            {} as never,
            {} as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", {
            expectedUpdatedDate: UPDATED_AT,
        })).rejects.toThrow("retry attempted");
        expect(client.getDocument).toHaveBeenCalledWith("token", "doc-1");
    });

    it("invalidates branch snapshots after recoverable or permanent deletion", async () => {
        const repository = {
            markDeleted: jest.fn().mockResolvedValue(undefined),
            purgeContent: jest.fn().mockResolvedValue(undefined),
            findState: jest.fn().mockResolvedValue({
                documentId: "doc-1",
                branchId: "branch-1",
            }),
        };
        const snapshots = {
            bumpVersion: jest.fn().mockResolvedValue(1),
            bumpCompanyEpoch: jest.fn(),
        };
        const service = new EformsignDocumentMirrorService(
            {} as never,
            repository as never,
            {} as never,
            {} as never,
            {} as never,
            snapshots as never,
        );

        await service.markDocumentsDeleted(["doc-1"]);
        await service.purgeDocuments(["doc-1"]);

        expect(snapshots.bumpVersion).toHaveBeenCalledTimes(2);
        expect(snapshots.bumpVersion).toHaveBeenNthCalledWith(1, "branch-1");
        expect(snapshots.bumpVersion).toHaveBeenNthCalledWith(2, "branch-1");
        expect(snapshots.bumpCompanyEpoch).not.toHaveBeenCalled();
    });

    it("fetches a redacted current detail without projecting it into the mirror", async () => {
        const detail = richDetail();
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: "vendor-token" },
            }),
            getDocument: jest.fn().mockResolvedValue(detail),
        };
        const repository = {
            saveDetail: jest.fn(),
        };
        const service = new EformsignDocumentMirrorService(
            client as never,
            repository as never,
            {} as never,
            {} as never,
            {} as never,
        );

        const result = await service.fetchCurrentDetail("doc-1");

        expect(client.getDocument).toHaveBeenCalledWith("vendor-token", "doc-1");
        expect(result).not.toHaveProperty("external_token");
        expect(result).not.toHaveProperty("nested.access_token");
        expect(repository.saveDetail).not.toHaveBeenCalled();
    });

    it("rejects a stored PDF whose bytes do not match DB integrity metadata", async () => {
        const repository = {
            findFile: jest.fn().mockResolvedValue({
                fileType: "document",
                content: PDF,
                contentType: "application/pdf",
                contentDisposition: null,
                byteSize: PDF.length,
                sha256: "0".repeat(64),
                sourceUpdatedDate: new Date(UPDATED_AT),
                syncedAt: new Date(UPDATED_AT),
            }),
            markFileIntegrityFailure: jest.fn().mockResolvedValue(undefined),
        };
        const service = new EformsignDocumentMirrorService(
            {} as never,
            repository as never,
            {} as never,
            {} as never,
            {} as never,
        );

        await expect(service.getStoredFile("doc-1", "document"))
            .rejects.toBeInstanceOf(EformsignStoredFileIntegrityError);
        expect(repository.markFileIntegrityFailure).toHaveBeenCalledWith(expect.objectContaining({
            documentId: "doc-1",
            fileType: "document",
            sourceUpdatedDate: new Date(UPDATED_AT),
            syncedAt: new Date(UPDATED_AT),
        }));
    });

    it("returns current stored PDF metadata without reading the PDF bytes", async () => {
        const sourceUpdatedDate = new Date(UPDATED_AT);
        const repository = {
            findState: jest.fn().mockResolvedValue({
                documentId: "doc-1",
                branchId: "branch-1",
                detailPayload: richDetail(),
                detailSourceUpdatedDate: sourceUpdatedDate,
                detailSyncedAt: sourceUpdatedDate,
                syncStatus: "ready",
                syncError: null,
                permanentPurgeRequestedAt: null,
                files: [{
                    fileType: "document",
                    contentType: "application/pdf",
                    contentDisposition: "inline",
                    byteSize: PDF.length,
                    sha256: "hash",
                    sourceUpdatedDate,
                    syncedAt: sourceUpdatedDate,
                }],
            }),
            findFile: jest.fn(),
        };
        const service = new EformsignDocumentMirrorService(
            {} as never,
            repository as never,
            {} as never,
            {} as never,
            {} as never,
        );

        await expect(service.getStoredFileMetadata("doc-1", "document"))
            .resolves.toEqual({
                status: 200,
                contentType: "application/pdf",
                contentDisposition: "inline",
                byteSize: PDF.length,
            });
        expect(repository.findState).toHaveBeenCalledWith("doc-1");
        expect(repository.findFile).not.toHaveBeenCalled();
    });

    it("repairs an integrity-failed current version with both PDFs", async () => {
        const detail = richDetail();
        const previousAttempt = new Date(UPDATED_AT);
        const repository = {
            findState: jest.fn().mockResolvedValue({
                documentId: "doc-1",
                branchId: null,
                detailPayload: detail,
                detailSourceUpdatedDate: previousAttempt,
                detailSyncedAt: previousAttempt,
                syncStatus: "failed",
                syncError: "Stored document failed integrity validation",
                files: ["document", "audit_trail"].map((fileType) => ({
                    fileType,
                    sourceUpdatedDate: previousAttempt,
                })),
            }),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(true),
            markSyncFinished: jest.fn().mockResolvedValue(true),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const vendorService = {
            downloadDocumentFile: jest.fn().mockResolvedValue({
                status: 200,
                contentType: "application/pdf",
                contentDisposition: null,
                body: PDF,
            }),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "doc-1" }) } as never,
            { execute: jest.fn().mockResolvedValue("already_linked") } as never,
            vendorService as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1"))
            .resolves.toEqual(expect.objectContaining({ status: "synced" }));
        expect(repository.saveDetail).toHaveBeenCalledWith(expect.objectContaining({
            expectedDetailSyncedAt: previousAttempt,
            allowReadySameVersionRepair: true,
        }));
        expect(vendorService.downloadDocumentFile).toHaveBeenCalledTimes(2);
        expect(repository.saveFile).toHaveBeenCalledTimes(2);
    });

    it("does not report a fenced file write as stored", async () => {
        const detail = richDetail();
        const repository = {
            findState: jest.fn().mockResolvedValue(null),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn().mockResolvedValue(false),
            markSyncFinished: jest.fn(),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            {
                mirrorRemoteDocument: jest.fn().mockResolvedValue({
                    documentId: "doc-1",
                }),
            } as never,
            { execute: jest.fn() } as never,
            {
                downloadDocumentFile: jest.fn().mockResolvedValue({
                    status: 200,
                    contentType: "application/pdf",
                    contentDisposition: null,
                    body: PDF,
                }),
            } as never,
        );

        await expect(service.syncDocumentWithToken("token", "doc-1", {
            force: true,
        })).rejects.toThrow(/missing current-version files: document, audit_trail/i);
        expect(repository.markSyncFinished).not.toHaveBeenCalled();
        expect(repository.markSyncFailed).toHaveBeenCalledWith(
            "doc-1",
            new Date(UPDATED_AT),
            repository.saveDetail.mock.calls[0]?.[0].syncedAt,
            expect.stringContaining("missing current-version files: document, audit_trail"),
        );
    });

    it("preserves a PDF download 401 as a typed authentication error", async () => {
        const detail = richDetail();
        const repository = {
            findState: jest.fn().mockResolvedValue(null),
            saveDetail: jest.fn().mockResolvedValue(true),
            saveFile: jest.fn(),
            markSyncFinished: jest.fn(),
            markSyncFailed: jest.fn().mockResolvedValue(undefined),
        };
        const service = new EformsignDocumentMirrorService(
            { getDocument: jest.fn().mockResolvedValue(detail) } as never,
            repository as never,
            {
                mirrorRemoteDocument: jest.fn().mockResolvedValue({
                    documentId: "doc-1",
                }),
            } as never,
            { execute: jest.fn() } as never,
            {
                downloadDocumentFile: jest.fn().mockResolvedValue({
                    status: 401,
                    contentType: "application/json",
                    contentDisposition: null,
                    body: Buffer.from("{}"),
                }),
            } as never,
        );

        await expect(service.syncDocumentWithToken(
            "expired-token",
            "doc-1",
            { force: true },
        )).rejects.toEqual(expect.objectContaining({
            name: EformsignApiError.name,
            status: 401,
        }));
    });
});
