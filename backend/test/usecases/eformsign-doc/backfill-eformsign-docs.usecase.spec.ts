import {
    BackfillEformsignDocsError,
    BackfillEformsignDocsUsecase,
} from "application/usecases/eformsign-doc/backfill-eformsign-docs.usecase";
import { MirrorUnassignedEformsignDocUsecase } from "application/usecases/eformsign-doc/mirror-unassigned-eformsign-doc.usecase";
import { EformsignDocStaleUpdateError } from "domain/repositories/eformsign-doc.repository.interface";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";
import { normalizeEformsignDocumentResponse } from "infrastructure/api/eformsign-response.normalizer";

const createRemoteDocument = (
    id: string,
    statusType = "060",
): EformsignApiDocumentResponse => normalizeEformsignDocumentResponse({
    id,
    document_number: `NUMBER-${id}`,
    template: { id: "template-1", name: "계약서" },
    document_name: `문서 ${id}`,
    creator: { recipient_type: "01", id: "creator", name: "생성자" },
    created_date: String(Date.parse("2026-07-01T00:00:00.000Z")),
    updated_date: String(Date.parse("2026-07-02T00:00:00.000Z")),
    current_status: {
        status_type: statusType,
        status_doc_type: "",
        status_doc_detail: "상태",
        step_type: 5,
        step_index: 0,
        step_name: "이용자",
        step_recipients: [],
        step_group: 1,
    },
});

describe("BackfillEformsignDocsUsecase", () => {
    const accessToken = "shared-access-token";

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("purges a requested document only after the post-scan verification confirms vendor 404", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockRejectedValue(new EformsignApiError("missing", 404)),
        };
        const mirrorService = {
            // Permanent deletion is normally requested for a 049 trash row, which is
            // intentionally absent from the active-id query.
            findActiveDocumentIds: jest.fn().mockResolvedValue([]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue(["missing-doc"]),
            purgeDocuments: jest.fn().mockResolvedValue(undefined),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(undefined),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute()).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(mirrorService.purgeDocuments).toHaveBeenCalledWith(["missing-doc"]);
        expect(mirrorService.markDocumentsDeleted).not.toHaveBeenCalled();
    });

    it("keeps an ordinary vendor-absent document as a recoverable tombstone", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockRejectedValue(new EformsignApiError("missing", 404)),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["missing-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue([]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn().mockResolvedValue(undefined),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(undefined),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute()).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(mirrorService.markDocumentsDeleted).toHaveBeenCalledWith(["missing-doc"]);
        expect(mirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("tombstones a document when detail returns the vendor deleted-document code", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockRejectedValue(
                new EformsignApiError("deleted", 400, "4000006"),
            ),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["deleted-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue([]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn().mockResolvedValue(undefined),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(undefined),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute()).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(mirrorService.markDocumentsDeleted).toHaveBeenCalledWith(["deleted-doc"]);
    });

    it("fails closed for an unrelated vendor 400 during absence verification", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockRejectedValue(
                new EformsignApiError("bad request", 400, "4000001"),
            ),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["uncertain-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue([]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn(),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute()).rejects.toThrow(
            /failed to verify locally active eformsign document uncertain-doc/i,
        );
        expect(mirrorService.markDocumentsDeleted).not.toHaveBeenCalled();
    });

    it("retries a confirmed-present purge by cancelling and purges only after vendor success", async () => {
        const document = createRemoteDocument("pending-doc");
        const retryGeneration = new Date("2026-07-30T01:00:00.000Z");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [document],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockResolvedValue(document),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            syncDocumentWithToken: jest.fn().mockResolvedValue({ status: "synced" }),
            requestPermanentPurge: jest.fn().mockResolvedValue([
                { documentId: "pending-doc", generation: retryGeneration },
            ]),
            purgeDocuments: jest.fn().mockResolvedValue(undefined),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(undefined),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const eformsignService = {
            cancelDocuments: jest.fn().mockResolvedValue({
                result: { success_result: ["pending-doc"] },
            }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            { findByDocumentIdUnscoped: jest.fn().mockResolvedValue({ id: 1 }) } as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "pending-doc" }) } as never,
            mirrorService as never,
            eformsignService as never,
        );

        await expect(usecase.execute()).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(client.getDocument).toHaveBeenCalledWith(accessToken, "pending-doc");
        expect(mirrorService.requestPermanentPurge).toHaveBeenCalledWith(["pending-doc"]);
        // The retry cancels rather than deletes: the delete endpoint keeps the vendor's
        // copy, so a sweep must not erase it hours later.
        expect(eformsignService.cancelDocuments).toHaveBeenCalledWith(
            accessToken,
            ["pending-doc"],
        );
        expect(mirrorService.clearPermanentPurgeRequest).not.toHaveBeenCalled();
        expect(mirrorService.purgeDocuments).toHaveBeenCalledWith(["pending-doc"]);
    });

    it("finishes the purge when the vendor refuses to cancel an already-finished document", async () => {
        // 042 = cancelled at the vendor. The mirror still reads 060 here, because a live
        // purge intent fences every writer of statusType — which is the whole reason this
        // branch consults the vendor's status instead.
        const document = createRemoteDocument("pending-doc", "042");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [document],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockResolvedValue(document),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            syncDocumentWithToken: jest.fn().mockResolvedValue({ status: "synced" }),
            requestPermanentPurge: jest.fn().mockResolvedValue([
                { documentId: "pending-doc", generation: new Date("2026-07-30T01:00:00.000Z") },
            ]),
            purgeDocuments: jest.fn().mockResolvedValue(undefined),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn(),
            // Left deliberately wrong: the frozen mirror would say "not terminal", and
            // trusting it is what made this loop run forever.
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const eformsignService = {
            cancelDocuments: jest.fn().mockResolvedValue({
                result: { fail_result: [{ document_id: "pending-doc", code: "4000031" }] },
            }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            { findByDocumentIdUnscoped: jest.fn().mockResolvedValue({ id: 1 }) } as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "pending-doc" }) } as never,
            mirrorService as never,
            eformsignService as never,
        );

        await expect(usecase.execute()).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        // eformsign never cancels a finished document, so retrying forever would make every
        // sweep from here on reattempt a call that cannot succeed.
        expect(mirrorService.purgeDocuments).toHaveBeenCalledWith(["pending-doc"]);
        expect(mirrorService.clearPermanentPurgeRequest).not.toHaveBeenCalled();
    });

    it("retains a retried purge intent for an ambiguous vendor cancel outcome", async () => {
        const document = createRemoteDocument("pending-doc");
        const retryGeneration = new Date("2026-07-30T01:00:00.000Z");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [document],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockResolvedValue(document),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            syncDocumentWithToken: jest.fn().mockResolvedValue({ status: "synced" }),
            requestPermanentPurge: jest.fn().mockResolvedValue([
                { documentId: "pending-doc", generation: retryGeneration },
            ]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn(),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const eformsignService = {
            cancelDocuments: jest.fn().mockResolvedValue({
                result: {
                    fail_result: [{ document_id: "pending-doc", code: "4000031" }],
                },
            }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            { findByDocumentIdUnscoped: jest.fn().mockResolvedValue({ id: 1 }) } as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "pending-doc" }) } as never,
            mirrorService as never,
            eformsignService as never,
        );

        await expect(usecase.execute()).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(mirrorService.requestPermanentPurge).toHaveBeenCalledWith(["pending-doc"]);
        expect(mirrorService.clearPermanentPurgeRequest).not.toHaveBeenCalled();
        expect(mirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("clears only the retry generation for a definitive vendor cancel rejection", async () => {
        const document = createRemoteDocument("pending-doc");
        const retryGeneration = new Date("2026-07-30T01:00:00.000Z");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [document],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockResolvedValue(document),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue(["pending-doc"]),
            syncDocumentWithToken: jest.fn().mockResolvedValue({ status: "synced" }),
            requestPermanentPurge: jest.fn().mockResolvedValue([
                { documentId: "pending-doc", generation: retryGeneration },
            ]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(["pending-doc"]),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const eformsignService = {
            cancelDocuments: jest.fn().mockResolvedValue({
                result: {
                    fail_result: [{ document_id: "pending-doc", code: "4000164" }],
                },
            }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            { findByDocumentIdUnscoped: jest.fn().mockResolvedValue({ id: 1 }) } as never,
            { mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "pending-doc" }) } as never,
            mirrorService as never,
            eformsignService as never,
        );

        await expect(usecase.execute()).resolves.toEqual(expect.objectContaining({ failed: 0 }));
        expect(mirrorService.clearPermanentPurgeRequest).toHaveBeenCalledWith([
            { documentId: "pending-doc", generation: retryGeneration },
        ]);
        expect(mirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("fails closed when an absent local document cannot be verified", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getDocument: jest.fn().mockRejectedValue(new EformsignApiError("unavailable", 503)),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn().mockResolvedValue(["uncertain-doc"]),
            findPermanentPurgeRequestedDocumentIds: jest.fn().mockResolvedValue([]),
            purgeDocuments: jest.fn(),
            markDocumentsDeleted: jest.fn(),
            clearPermanentPurgeRequest: jest.fn().mockResolvedValue(undefined),
            findTerminalDocumentIds: jest.fn().mockResolvedValue([]),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute()).rejects.toThrow(
            /failed to verify locally active eformsign document uncertain-doc/i,
        );
        expect(mirrorService.markDocumentsDeleted).not.toHaveBeenCalled();
        expect(mirrorService.purgeDocuments).not.toHaveBeenCalled();
    });

    it("does not run the absence post-pass after an incomplete vendor scan", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({ oauth_token: { access_token: accessToken } }),
            getInProgressDocumentsPage: jest.fn().mockRejectedValue(new Error("list unavailable")),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({ documents: [], total_rows: 0 }),
        };
        const mirrorService = {
            findActiveDocumentIds: jest.fn(),
            findPermanentPurgeRequestedDocumentIds: jest.fn(),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            { findByDocumentIdUnscoped: jest.fn() } as never,
            { mirrorRemoteDocument: jest.fn() } as never,
            mirrorService as never,
        );

        await expect(usecase.execute()).rejects.toThrow(/failed for types=01/i);
        expect(mirrorService.findActiveDocumentIds).not.toHaveBeenCalled();
        expect(mirrorService.findPermanentPurgeRequestedDocumentIds).not.toHaveBeenCalled();
    });

    it("reuses one token and scans beyond 1000 documents until total_rows", async () => {
        const inProgress = Array.from(
            { length: 1_205 },
            (_, index) => createRemoteDocument(`progress-${index + 1}`),
        );
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn(
                (_token: string, limit: number, skip: number) => Promise.resolve({
                    documents: inProgress.slice(skip, skip + limit),
                    total_rows: inProgress.length,
                }),
            ),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn((document: EformsignApiDocumentResponse) =>
                Promise.resolve({ documentId: document.id })),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        const summary = await usecase.execute();

        expect(client.getAccessToken).toHaveBeenCalledTimes(1);
        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(26);
        expect(client.getInProgressDocumentsPage).toHaveBeenLastCalledWith(
            accessToken,
            100,
            1_200,
        );
        expect(client.getCompletedDocumentsPage).toHaveBeenCalledWith(
            accessToken,
            100,
            0,
        );
        expect(client.getRejectedDocumentsPage).toHaveBeenCalledWith(
            accessToken,
            100,
            0,
        );
        expect(summary).toEqual(expect.objectContaining({
            fetched: 1_205,
            created: 1_205,
            updated: 0,
            skipped: 0,
            failed: 0,
            pages: 15,
        }));
        expect(summary.byDocumentType).toEqual(expect.objectContaining({
            "01": expect.objectContaining({
                status: "completed",
                fetched: 1_205,
                pages: 13,
            }),
            "03": expect.objectContaining({ status: "completed", pages: 1 }),
            "04": expect.objectContaining({ status: "completed", pages: 1 }),
        }));
    });

    it("scans rejected documents with type 04", async () => {
        const rejected = createRemoteDocument("rejected-doc", "080");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [rejected],
                total_rows: 1,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: rejected.id }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        const summary = await usecase.execute();

        expect(client.getRejectedDocumentsPage).toHaveBeenCalledWith(
            accessToken,
            100,
            0,
        );
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledWith(
            rejected,
            { allowAssignedUpdate: true },
        );
        expect(summary.byDocumentType["04"]).toEqual(expect.objectContaining({
            status: "completed",
            fetched: 1,
            created: 1,
        }));
    });

    it("continues later document types when an earlier API page fails", async () => {
        const pageError = new Error("remote page failed");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn()
                .mockResolvedValueOnce({
                    documents: [
                        createRemoteDocument("doc-1"),
                        createRemoteDocument("doc-2"),
                    ],
                    total_rows: 3,
                })
                .mockRejectedValueOnce(pageError),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn((document: EformsignApiDocumentResponse) =>
                Promise.resolve({ documentId: document.id })),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        const result = usecase.execute();

        await expect(result).rejects.toMatchObject({
            summary: {
                fetched: 2,
                created: 2,
                updated: 0,
                skipped: 0,
                failed: 0,
                pages: 3,
                byDocumentType: {
                    "01": expect.objectContaining({
                        status: "failed",
                        fetched: 2,
                        error: expect.stringContaining("type=01"),
                    }),
                    "03": expect.objectContaining({ status: "completed" }),
                    "04": expect.objectContaining({ status: "completed" }),
                },
            },
        });
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
        expect(client.getCompletedDocumentsPage).toHaveBeenCalledTimes(2);
        expect(client.getRejectedDocumentsPage).toHaveBeenCalledTimes(2);
    });

    it("syncs full detail and PDFs after a stale projection write, then counts it as skipped", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [
                    createRemoteDocument("terminal-doc", "060"),
                    createRemoteDocument("fresh-doc", "060"),
                ],
                total_rows: 2,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue({
                branchId: "branch-1",
                document: { documentId: "existing" },
            }),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn()
                .mockRejectedValueOnce(new EformsignDocStaleUpdateError("terminal-doc"))
                .mockResolvedValueOnce({ documentId: "fresh-doc" }),
        };
        const documentMirrorService = {
            syncDocumentWithToken: jest.fn().mockResolvedValue({ status: "synced" }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
            documentMirrorService as never,
        );

        const summary = await usecase.execute();

        expect(summary).toEqual(expect.objectContaining({
            fetched: 2,
            created: 0,
            updated: 1,
            skipped: 1,
            failed: 0,
            pages: 3,
        }));
        expect(mirror.mirrorRemoteDocument).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ id: "terminal-doc" }),
            { allowAssignedUpdate: true },
        );
        expect(documentMirrorService.syncDocumentWithToken).toHaveBeenNthCalledWith(
            1,
            accessToken,
            "terminal-doc",
            { expectedUpdatedDate: expect.any(Number) },
        );
    });

    it("finishes the page after a document write failure but refuses to report success", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [
                    createRemoteDocument("failed-doc"),
                    createRemoteDocument("saved-doc"),
                ],
                total_rows: 2,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn()
                .mockRejectedValueOnce(new Error("write failed"))
                .mockResolvedValueOnce({ documentId: "saved-doc" }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        // The second document must still be written — one bad row may not abort the
        // sweep — but a mirror missing a document is not a completed backfill.
        await expect(usecase.execute()).rejects.toMatchObject({
            summary: expect.objectContaining({
                fetched: 2,
                created: 1,
                updated: 0,
                skipped: 0,
                failed: 1,
                byDocumentType: expect.objectContaining({
                    "01": expect.objectContaining({
                        status: "failed",
                        error: expect.stringContaining("could not mirror every document"),
                    }),
                }),
            }),
        });
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
    });

    it("fails closed when a completed document is missing its current-version audit trail", async () => {
        const completedDocument = createRemoteDocument("completed-doc", "doc_complete");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [completedDocument],
                total_rows: 1,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({
                documentId: completedDocument.id,
            }),
        };
        const documentMirrorService = {
            syncDocumentWithToken: jest.fn().mockRejectedValue(
                new Error("missing current-version files: audit_trail"),
            ),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            { findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null) } as never,
            mirror as never,
            documentMirrorService as never,
        );

        await expect(usecase.execute()).rejects.toMatchObject({
            summary: expect.objectContaining({
                fetched: 1,
                created: 0,
                failed: 1,
                byDocumentType: expect.objectContaining({
                    "03": expect.objectContaining({ status: "failed" }),
                }),
            }),
        });
        expect(documentMirrorService.syncDocumentWithToken).toHaveBeenCalledWith(
            accessToken,
            completedDocument.id,
            { expectedUpdatedDate: completedDocument.updated_date },
        );
    });

    it("fails the sweep when the execution lease is lost during the final write", async () => {
        // shouldContinue is polled before every write, so a lease lost during the last
        // one would otherwise be reported as a clean success.
        let writes = 0;
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [
                    createRemoteDocument("first-doc"),
                    createRemoteDocument("last-doc"),
                ],
                total_rows: 2,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn((document: EformsignApiDocumentResponse) => {
                writes += 1;
                return Promise.resolve({ documentId: document.id });
            }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute({
            shouldContinue: () => writes < 2,
        })).rejects.toThrow(/lost its execution lease/);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
    });

    it("stops when a non-empty page repeats without any new document ids", async () => {
        const repeated = createRemoteDocument("repeated-doc");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [repeated],
                total_rows: 2,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "repeated-doc" }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute()).rejects.toBeInstanceOf(BackfillEformsignDocsError);

        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(2);
        expect(client.getCompletedDocumentsPage).toHaveBeenCalledTimes(2);
        expect(client.getRejectedDocumentsPage).toHaveBeenCalledTimes(2);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(1);
    });

    it("fails the document type when total_rows decreases during offset pagination", async () => {
        const firstPage = Array.from(
            { length: 100 },
            (_, index) => createRemoteDocument(`document-${index + 1}`),
        );
        const shiftedSecondPage = Array.from(
            { length: 99 },
            (_, index) => createRemoteDocument(`document-${index + 102}`),
        );
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn()
                .mockResolvedValueOnce({
                    documents: firstPage,
                    total_rows: 200,
                })
                .mockResolvedValueOnce({
                    documents: shiftedSecondPage,
                    total_rows: 199,
                }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(
                (document: EformsignApiDocumentResponse) =>
                    Promise.resolve({ documentId: document.id }),
            ),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute()).rejects.toMatchObject({
            summary: {
                byDocumentType: {
                    "01": expect.objectContaining({
                        status: "failed",
                        error: expect.stringContaining("total_rows decreased"),
                    }),
                    "03": expect.objectContaining({ status: "completed" }),
                    "04": expect.objectContaining({ status: "completed" }),
                },
            },
        });

        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(2);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(100);
    });

    it("fails closed when the list keeps growing faster than the sweep pages through it", async () => {
        // Every page brings new documents and reports a still-larger total, so the loop
        // has no natural end. This runs as an operator job; it must stop and say why.
        let served = 0;
        const growingPage = () => {
            const documents = Array.from(
                { length: 100 },
                (_, index) => createRemoteDocument(`document-${served + index + 1}`),
            );
            served += 100;
            return { documents, total_rows: served + 101 };
        };
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn(() => Promise.resolve(growingPage())),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(
                (document: EformsignApiDocumentResponse) =>
                    Promise.resolve({ documentId: document.id }),
            ),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute()).rejects.toMatchObject({
            summary: {
                byDocumentType: {
                    "01": expect.objectContaining({
                        status: "failed",
                        error: expect.stringContaining("page budget"),
                    }),
                },
            },
        });
    });

    it("fails closed when total_rows increases then returns to its initial value with incomplete unique coverage", async () => {
        const firstPage = Array.from(
            { length: 100 },
            (_, index) => createRemoteDocument(`document-${index + 1}`),
        );
        const shiftedSecondPage = Array.from(
            { length: 100 },
            (_, index) => createRemoteDocument(`document-${index + 100}`),
        );
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn()
                .mockResolvedValueOnce({
                    documents: firstPage,
                    total_rows: 200,
                })
                .mockResolvedValueOnce({
                    documents: shiftedSecondPage,
                    total_rows: 201,
                })
                .mockResolvedValueOnce({
                    documents: [],
                    total_rows: 200,
                }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(
                (document: EformsignApiDocumentResponse) =>
                    Promise.resolve({ documentId: document.id }),
            ),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute()).rejects.toMatchObject({
            summary: {
                fetched: 200,
                created: 199,
                byDocumentType: {
                    "01": expect.objectContaining({
                        status: "failed",
                        error: expect.stringMatching(
                            /coverage incomplete.*uniqueSeen=199.*currentTotal=200.*missing=1.*rerun/i,
                        ),
                    }),
                    "03": expect.objectContaining({ status: "completed" }),
                    "04": expect.objectContaining({ status: "completed" }),
                },
            },
        });

        expect(client.getInProgressDocumentsPage).toHaveBeenNthCalledWith(
            3,
            accessToken,
            100,
            200,
        );
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(199);
    });

    it("fails closed when same-size list churn hides a live document across offsets", async () => {
        const firstPage = Array.from(
            { length: 100 },
            (_, index) => createRemoteDocument(`document-${index + 1}`),
        );
        const churnedSecondPage = [
            ...Array.from(
                { length: 99 },
                (_, index) => createRemoteDocument(`document-${index + 102}`),
            ),
            createRemoteDocument("replacement-document"),
        ];
        const stableFirstPage = Array.from(
            { length: 100 },
            (_, index) => createRemoteDocument(`document-${index + 2}`),
        );
        const stableSecondPage = [
            ...Array.from(
                { length: 99 },
                (_, index) => createRemoteDocument(`document-${index + 102}`),
            ),
            createRemoteDocument("replacement-document"),
        ];
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn()
                .mockResolvedValueOnce({
                    documents: firstPage,
                    total_rows: 200,
                })
                .mockResolvedValueOnce({
                    documents: churnedSecondPage,
                    total_rows: 200,
                })
                .mockResolvedValueOnce({
                    documents: stableFirstPage,
                    total_rows: 200,
                })
                .mockResolvedValueOnce({
                    documents: stableSecondPage,
                    total_rows: 200,
                }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(
                (document: EformsignApiDocumentResponse) =>
                    Promise.resolve({ documentId: document.id }),
            ),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute()).rejects.toMatchObject({
            summary: {
                byDocumentType: {
                    "01": expect.objectContaining({
                        status: "failed",
                        error: expect.stringMatching(
                            /coverage changed between consecutive scans.*firstCount=200.*verificationCount=200.*missingFromVerification=1.*newInVerification=1.*retry/i,
                        ),
                    }),
                    "03": expect.objectContaining({ status: "completed" }),
                    "04": expect.objectContaining({ status: "completed" }),
                },
            },
        });

        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(4);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(200);
    });

    it("fails fast when total_rows is missing from a list response", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: {
                    access_token: accessToken,
                    refresh_token: "refresh-token",
                },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn(),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute()).rejects.toMatchObject({
            summary: {
                byDocumentType: {
                    "01": expect.objectContaining({ status: "failed" }),
                    "03": expect.objectContaining({ status: "completed" }),
                    "04": expect.objectContaining({ status: "completed" }),
                },
            },
        });

        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(1);
        expect(mirror.mirrorRemoteDocument).not.toHaveBeenCalled();
    });

    it("reissues an access token after 401 and resumes the same page", async () => {
        const refreshedAccessToken = "refreshed-access-token";
        const documents = [
            createRemoteDocument("page-1"),
            createRemoteDocument("page-2"),
        ];
        const getInProgressDocumentsPage = jest.fn(
            (token: string, _limit: number, skip: number) => {
                if (skip === 0) {
                    return Promise.resolve({
                        documents: [documents[0]],
                        total_rows: documents.length,
                    });
                }
                if (token === accessToken) {
                    return Promise.reject(new EformsignApiError("expired", 401));
                }
                return Promise.resolve({
                    documents: [documents[1]],
                    total_rows: documents.length,
                });
            },
        );
        const client = {
            getAccessToken: jest.fn()
                .mockResolvedValueOnce({
                    oauth_token: { access_token: accessToken },
                })
                .mockResolvedValueOnce({
                    oauth_token: { access_token: refreshedAccessToken },
                }),
            getInProgressDocumentsPage,
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn((document: EformsignApiDocumentResponse) =>
                Promise.resolve({ documentId: document.id })),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute()).resolves.toMatchObject({
            fetched: 2,
            created: 2,
        });

        expect(getInProgressDocumentsPage.mock.calls).toEqual([
            [accessToken, 100, 0],
            [accessToken, 100, 1],
            [refreshedAccessToken, 100, 1],
            [refreshedAccessToken, 100, 0],
            [refreshedAccessToken, 100, 1],
        ]);
        expect(client.getAccessToken).toHaveBeenCalledTimes(2);
        expect(client.getAccessToken).toHaveBeenNthCalledWith(2, expect.any(Number));
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
        expect(client.getCompletedDocumentsPage).toHaveBeenCalledTimes(2);
        expect(client.getRejectedDocumentsPage).toHaveBeenCalledTimes(2);
    });

    it("reissues an access token after 401 during the coverage confirmation pass", async () => {
        const refreshedAccessToken = "refreshed-confirmation-token";
        const documents = [
            createRemoteDocument("confirmation-page-1"),
            createRemoteDocument("confirmation-page-2"),
        ];
        const getInProgressDocumentsPage = jest.fn()
            .mockResolvedValueOnce({
                documents: [documents[0]],
                total_rows: documents.length,
            })
            .mockResolvedValueOnce({
                documents: [documents[1]],
                total_rows: documents.length,
            })
            .mockRejectedValueOnce(new EformsignApiError("expired", 401))
            .mockResolvedValueOnce({
                documents: [documents[0]],
                total_rows: documents.length,
            })
            .mockResolvedValueOnce({
                documents: [documents[1]],
                total_rows: documents.length,
            });
        const client = {
            getAccessToken: jest.fn()
                .mockResolvedValueOnce({
                    oauth_token: { access_token: accessToken },
                })
                .mockResolvedValueOnce({
                    oauth_token: { access_token: refreshedAccessToken },
                }),
            getInProgressDocumentsPage,
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(
                (document: EformsignApiDocumentResponse) =>
                    Promise.resolve({ documentId: document.id }),
            ),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute()).resolves.toMatchObject({
            fetched: 2,
            created: 2,
            failed: 0,
        });

        expect(getInProgressDocumentsPage.mock.calls).toEqual([
            [accessToken, 100, 0],
            [accessToken, 100, 1],
            [accessToken, 100, 0],
            [refreshedAccessToken, 100, 0],
            [refreshedAccessToken, 100, 1],
        ]);
        expect(client.getAccessToken).toHaveBeenCalledTimes(2);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
    });

    it("reissues an access token after a per-document detail or PDF sync returns 401", async () => {
        const refreshedAccessToken = "refreshed-document-token";
        const document = createRemoteDocument("detail-auth-retry");
        const client = {
            getAccessToken: jest.fn()
                .mockResolvedValueOnce({
                    oauth_token: { access_token: accessToken },
                })
                .mockResolvedValueOnce({
                    oauth_token: { access_token: refreshedAccessToken },
                }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [document],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({
                documentId: document.id,
            }),
        };
        const documentMirrorService = {
            syncDocumentWithToken: jest.fn()
                .mockRejectedValueOnce(new EformsignApiError("expired", 401))
                .mockResolvedValueOnce({
                    status: "synced",
                    documentId: document.id,
                }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
            documentMirrorService as never,
        );

        await expect(usecase.execute({
            suppressOutboundAutomation: true,
        })).resolves.toMatchObject({
            fetched: 1,
            created: 1,
            failed: 0,
        });

        expect(documentMirrorService.syncDocumentWithToken.mock.calls).toEqual([
            [
                accessToken,
                document.id,
                {
                    expectedUpdatedDate: document.updated_date,
                    suppressOutboundAutomation: true,
                },
            ],
            [
                refreshedAccessToken,
                document.id,
                {
                    expectedUpdatedDate: document.updated_date,
                    suppressOutboundAutomation: true,
                },
            ],
        ]);
        expect(client.getAccessToken).toHaveBeenCalledTimes(2);
    });

    it("stops after one token reissue when the retried page is still unauthorized", async () => {
        const client = {
            getAccessToken: jest.fn()
                .mockResolvedValueOnce({
                    oauth_token: { access_token: accessToken },
                })
                .mockResolvedValueOnce({
                    oauth_token: { access_token: "refreshed-access-token" },
                }),
            getInProgressDocumentsPage: jest.fn()
                .mockRejectedValue(new EformsignApiError("unauthorized", 401)),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn(),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn(),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        await expect(usecase.execute()).rejects.toBeInstanceOf(
            BackfillEformsignDocsError,
        );

        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(2);
        expect(client.getAccessToken).toHaveBeenCalledTimes(2);
        expect(mirror.mirrorRemoteDocument).not.toHaveBeenCalled();
    });

    it("normalizes a remote status code before the backfill mirror persists it", async () => {
        const remote = createRemoteDocument("normalized-doc", " DOC_EXPIRED ");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: {
                    access_token: accessToken,
                    refresh_token: "refresh-token",
                },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [remote],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
            upsertUnassignedByDocumentId: jest.fn(
                (document) => Promise.resolve(document),
            ),
        };
        const mirror = new MirrorUnassignedEformsignDocUsecase(
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            repository as never,
        );
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror,
        );

        await usecase.execute();

        // The list carries no _expired, but an 080 document is expired by definition, so
        // the row must not be created claiming otherwise — and having derived it, the
        // write is no longer the blind overwrite updateExpired:false guards against.
        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({ statusType: "080", expired: true }),
            {
                allowAssignedUpdate: true,
                updateListDisplayFields: true,
                // The list has no expired_date, so the computed date is only a fallback.
                updateExpiredDate: false,
            },
        );
    });

    it("mirrors a document once when two inboxes both list it", async () => {
        // Type "04" is eformsign's document-management inbox, not a rejected-only one, so
        // it overlaps the other scans. Now that this runs nightly, writing those rows a
        // second time every night would be pure waste.
        const shared = createRemoteDocument("shared-doc");
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [shared],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [shared],
                total_rows: 1,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "shared-doc" }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        const summary = await usecase.execute();

        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(1);
        // Both scans still have to page it: each inbox's coverage check compares against
        // its own total_rows, so the duplicate has to count as seen for type 04 as well.
        expect(summary).toEqual(expect.objectContaining({
            fetched: 2,
            created: 1,
            duplicates: 1,
        }));
        expect(summary.byDocumentType["04"]).toEqual(
            expect.objectContaining({ status: "completed", duplicates: 1, created: 0 }),
        );
    });

    it("re-mirrors a document when a later inbox carries newer state", async () => {
        // A document that completes between the in-progress scan and the completed scan
        // shows up twice, the second copy newer. Skipping on identity alone would keep the
        // mirror a night behind on exactly the documents that just changed.
        const earlier = createRemoteDocument("moving-doc");
        const later = {
            ...createRemoteDocument("moving-doc", "050"),
            updated_date: earlier.updated_date + 60_000,
        };
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [earlier],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [later],
                total_rows: 1,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
        };
        const mirror = {
            mirrorRemoteDocument: jest.fn().mockResolvedValue({ documentId: "moving-doc" }),
        };
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
        );

        const summary = await usecase.execute();

        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(2);
        expect(mirror.mirrorRemoteDocument).toHaveBeenLastCalledWith(
            expect.objectContaining({ current_status: expect.objectContaining({ status_type: "050" }) }),
            { allowAssignedUpdate: true },
        );
        expect(summary.duplicates).toBe(0);
    });

    it("keeps a stored status detail when the list response carries none", async () => {
        // The list schema has no status_doc_detail, so the mirror falls back to the step
        // name. That derived value may seed a new row but must not replace "만료"/"거부"
        // on an existing one.
        const remote = createRemoteDocument("detail-less-doc");
        delete (remote.current_status as { status_doc_detail?: string }).status_doc_detail;
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [remote],
                total_rows: 1,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_rows: 0,
            }),
        };
        const repository = {
            findByDocumentIdUnscoped: jest.fn().mockResolvedValue(null),
            upsertUnassignedByDocumentId: jest.fn(
                (document) => Promise.resolve(document),
            ),
        };
        const mirror = new MirrorUnassignedEformsignDocUsecase(
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            repository as never,
        );
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror,
        );

        await usecase.execute();

        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ updateStatusDetail: false }),
        );
    });
});
