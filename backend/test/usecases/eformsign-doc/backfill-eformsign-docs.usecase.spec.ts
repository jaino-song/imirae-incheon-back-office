import {
    BackfillEformsignDocsError,
    BackfillEformsignDocsUsecase,
} from "application/usecases/eformsign-doc/backfill-eformsign-docs.usecase";
import { EformsignDocStaleUpdateError } from "domain/repositories/eformsign-doc.repository.interface";
import { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

const createRemoteDocument = (
    id: string,
    statusType = "060",
): EformsignApiDocumentResponse => ({
    id,
    document_number: `NUMBER-${id}`,
    template: { id: "template-1", name: "계약서" },
    document_name: `문서 ${id}`,
    creator: { recipient_type: "01", id: "creator", name: "생성자" },
    created_date: Date.parse("2026-07-01T00:00:00.000Z"),
    updated_date: Date.parse("2026-07-02T00:00:00.000Z"),
    current_status: {
        status_type: statusType,
        status_doc_type: "",
        status_doc_detail: "상태",
        step_type: "05",
        step_index: "1",
        step_name: "이용자",
        step_recipients: [],
        step_group: 1,
        expired_date: 0,
        _expired: false,
    },
});

describe("BackfillEformsignDocsUsecase", () => {
    const accessToken = "shared-access-token";

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("reuses one token and scans beyond 1000 documents until total_count", async () => {
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
                    total_count: inProgress.length,
                }),
            ),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_count: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_count: 0,
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
        expect(client.getInProgressDocumentsPage).toHaveBeenCalledTimes(13);
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
                total_count: 0,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_count: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [rejected],
                total_count: 1,
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
                    total_count: 3,
                })
                .mockRejectedValueOnce(pageError),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_count: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_count: 0,
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
        expect(client.getCompletedDocumentsPage).toHaveBeenCalledTimes(1);
        expect(client.getRejectedDocumentsPage).toHaveBeenCalledTimes(1);
    });

    it("counts repository stale-write errors as skipped and continues", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [
                    createRemoteDocument("terminal-doc", "060"),
                    createRemoteDocument("fresh-doc", "060"),
                ],
                total_count: 2,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_count: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_count: 0,
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
        const usecase = new BackfillEformsignDocsUsecase(
            client as never,
            repository as never,
            mirror as never,
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
    });

    it("counts a document write failure and continues with the remaining page", async () => {
        const client = {
            getAccessToken: jest.fn().mockResolvedValue({
                oauth_token: { access_token: accessToken },
            }),
            getInProgressDocumentsPage: jest.fn().mockResolvedValue({
                documents: [
                    createRemoteDocument("failed-doc"),
                    createRemoteDocument("saved-doc"),
                ],
                total_count: 2,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_count: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_count: 0,
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

        const summary = await usecase.execute();

        expect(summary).toEqual(expect.objectContaining({
            fetched: 2,
            created: 1,
            updated: 0,
            skipped: 0,
            failed: 1,
            pages: 3,
        }));
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
                total_count: 2,
            }),
            getCompletedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_count: 0,
            }),
            getRejectedDocumentsPage: jest.fn().mockResolvedValue({
                documents: [],
                total_count: 0,
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
        expect(client.getCompletedDocumentsPage).toHaveBeenCalledTimes(1);
        expect(client.getRejectedDocumentsPage).toHaveBeenCalledTimes(1);
        expect(mirror.mirrorRemoteDocument).toHaveBeenCalledTimes(1);
    });
});
