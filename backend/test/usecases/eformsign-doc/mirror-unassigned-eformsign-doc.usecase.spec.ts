import { Logger } from "@nestjs/common";

import { MirrorUnassignedEformsignDocUsecase } from "application/usecases/eformsign-doc/mirror-unassigned-eformsign-doc.usecase";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";

describe("MirrorUnassignedEformsignDocUsecase", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("fetches one remote document and persists it with unassigned defaults", async () => {
        const getAccessTokenUsecase = {
            execute: jest.fn().mockResolvedValue({
                oauth_token: { access_token: "access-token" },
            }),
        };
        const fetchEformsignDocFromApiUsecase = {
            execute: jest.fn().mockResolvedValue({
                id: "remote-doc",
                document_number: "DOC-2026-001",
                document_name: "외부 생성 계약서",
                created_date: Date.parse("2026-07-01T01:00:00.000Z"),
                updated_date: Date.parse("2026-07-02T02:00:00.000Z"),
                template: { id: "template-1", name: "표준 계약서" },
                creator: { recipient_type: "01", id: "creator-id", name: "생성 담당자" },
                last_editor: { name: "최종 편집자" },
                fields: [{ id: "이용자 성명", value: "김고객", type: "text" }],
                current_status: {
                    status_type: "060",
                    status_doc_detail: "서명 요청됨",
                    step_type: "",
                    step_index: "",
                    step_name: "",
                    step_recipients: [
                        { recipient_type: "05", id: "01012345678", name: "김고객" },
                        { recipient_type: "06", id: "reviewer", name: "검토자" },
                    ],
                    expired_date: 0,
                    _expired: false,
                },
            }),
        };
        const repository = {
            upsertUnassignedByDocumentId: jest.fn(
                (doc: EformsignDocEntity) => Promise.resolve(doc),
            ),
        };
        const now = Date.parse("2026-07-03T00:00:00.000Z");
        jest.spyOn(Date, "now").mockReturnValue(now);
        const usecase = new MirrorUnassignedEformsignDocUsecase(
            getAccessTokenUsecase as never,
            fetchEformsignDocFromApiUsecase as never,
            repository as never,
        );

        const result = await usecase.execute("webhook-doc");

        expect(getAccessTokenUsecase.execute).toHaveBeenCalledWith(now);
        expect(fetchEformsignDocFromApiUsecase.execute).toHaveBeenCalledWith(
            "access-token",
            "webhook-doc",
        );
        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId: "remote-doc",
                clientId: null,
                documentKind: null,
                documentName: "외부 생성 계약서",
                documentNumber: "DOC-2026-001",
                templateName: "표준 계약서",
                customerName: "김고객",
                creatorName: "생성 담당자",
                lastEditorName: "최종 편집자",
                stepRecipientTypes: ["05", "06"],
                templateId: "template-1",
                createdDate: new Date("2026-07-01T01:00:00.000Z"),
                updatedDate: new Date("2026-07-02T02:00:00.000Z"),
                stepType: "01",
                stepIndex: "1",
                stepName: "서명 요청",
                stepRecipientType: "05",
                stepRecipientName: "김고객",
                stepRecipientSms: "01012345678",
                expiredDate: new Date("9999-12-31T23:59:59.999Z"),
            }),
            { updateListDisplayFields: true },
        );
        expect(result.documentId).toBe("remote-doc");
    });

    it("falls back to updated_date when remote created_date is invalid", async () => {
        const updatedDate = Date.parse("2026-07-02T02:00:00.000Z");
        const getAccessTokenUsecase = {
            execute: jest.fn().mockResolvedValue({
                oauth_token: { access_token: "access-token" },
            }),
        };
        const fetchEformsignDocFromApiUsecase = {
            execute: jest.fn().mockResolvedValue({
                id: "remote-doc",
                document_number: null,
                document_name: "외부 생성 계약서",
                created_date: undefined,
                updated_date: updatedDate,
                template: { id: "template-1", name: "계약서" },
                current_status: {
                    status_type: "060",
                    status_doc_detail: "서명 요청됨",
                    step_type: "01",
                    step_index: "1",
                    step_name: "서명 요청",
                    step_recipients: [],
                    expired_date: 0,
                    _expired: false,
                },
            }),
        };
        const repository = {
            upsertUnassignedByDocumentId: jest.fn(
                (doc: EformsignDocEntity) => Promise.resolve(doc),
            ),
        };
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
        const usecase = new MirrorUnassignedEformsignDocUsecase(
            getAccessTokenUsecase as never,
            fetchEformsignDocFromApiUsecase as never,
            repository as never,
        );

        await expect(usecase.execute("webhook-doc")).resolves.toBeDefined();

        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                createdDate: new Date(updatedDate),
                updatedDate: new Date(updatedDate),
            }),
            { updateListDisplayFields: true },
        );
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("remote-doc"),
        );
    });

    it("mirrors a document whose remote updated_date precedes its created_date", async () => {
        // The entity rejects updatedDate < createdDate, and processWebhook swallows a
        // mirror failure, so without the clamp such a document is dropped on every
        // webhook forever — there is no backfill yet to pick it back up.
        const createdDate = Date.parse("2026-07-03T05:00:00.000Z");
        const updatedDate = Date.parse("2026-07-03T04:00:00.000Z");
        const getAccessTokenUsecase = {
            execute: jest.fn().mockResolvedValue({
                oauth_token: { access_token: "access-token" },
            }),
        };
        const fetchEformsignDocFromApiUsecase = {
            execute: jest.fn().mockResolvedValue({
                id: "reversed-doc",
                document_number: null,
                document_name: "외부 생성 계약서",
                created_date: createdDate,
                updated_date: updatedDate,
                template: { id: "template-1", name: "계약서" },
                current_status: {
                    status_type: "060",
                    status_doc_detail: "서명 요청됨",
                    step_type: "01",
                    step_index: "1",
                    step_name: "서명 요청",
                    step_recipients: [],
                    expired_date: 0,
                    _expired: false,
                },
            }),
        };
        const repository = {
            upsertUnassignedByDocumentId: jest.fn(
                (doc: EformsignDocEntity) => Promise.resolve(doc),
            ),
        };
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
        const usecase = new MirrorUnassignedEformsignDocUsecase(
            getAccessTokenUsecase as never,
            fetchEformsignDocFromApiUsecase as never,
            repository as never,
        );

        await expect(usecase.execute("webhook-doc")).resolves.toBeDefined();

        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                createdDate: new Date(createdDate),
                updatedDate: new Date(createdDate),
            }),
            { updateListDisplayFields: true },
        );
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("reversed-doc"),
        );
    });

    it("mirrors an already-fetched document without issuing token or detail API calls", async () => {
        const getAccessTokenUsecase = { execute: jest.fn() };
        const fetchEformsignDocFromApiUsecase = { execute: jest.fn() };
        const repository = {
            upsertUnassignedByDocumentId: jest.fn(
                (doc: EformsignDocEntity) => Promise.resolve(doc),
            ),
        };
        const usecase = new MirrorUnassignedEformsignDocUsecase(
            getAccessTokenUsecase as never,
            fetchEformsignDocFromApiUsecase as never,
            repository as never,
        );

        await usecase.mirrorRemoteDocument({
            id: "listed-doc",
            document_number: "DOC-100",
            document_name: "목록 문서",
            created_date: Date.parse("2026-07-01T00:00:00.000Z"),
            updated_date: Date.parse("2026-07-02T00:00:00.000Z"),
            template: { id: "template-1", name: "계약서" },
            creator: { recipient_type: "01", id: "creator", name: "생성자" },
            current_status: {
                status_type: "060",
                status_doc_type: "",
                status_doc_detail: "서명 요청",
                step_type: "05",
                step_index: "0",
                step_name: "이용자",
                step_recipients: [],
                step_group: 1,
            },
        }, {
            allowAssignedUpdate: true,
            now: Date.parse("2026-07-03T00:00:00.000Z"),
        });

        expect(getAccessTokenUsecase.execute).not.toHaveBeenCalled();
        expect(fetchEformsignDocFromApiUsecase.execute).not.toHaveBeenCalled();
        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                documentId: "listed-doc",
                clientId: null,
                documentKind: null,
                employeeScheduleId: null,
                expiredDate: new Date(
                    Date.parse("2026-07-03T00:00:00.000Z")
                    + 30 * 24 * 60 * 60 * 1000,
                ),
                stepIndex: "0",
            }),
            {
                allowAssignedUpdate: true,
                updateListDisplayFields: true,
                updateExpired: false,
                // The 30-day value above is a fallback, not something the list told us.
                updateExpiredDate: false,
            },
        );
    });

    it("uses normalized epoch values instead of replacing numeric strings with now", async () => {
        const repository = {
            upsertUnassignedByDocumentId: jest.fn(
                (doc: EformsignDocEntity) => Promise.resolve(doc),
            ),
        };
        const usecase = new MirrorUnassignedEformsignDocUsecase(
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            repository as never,
        );

        await usecase.mirrorRemoteDocument({
            id: "numeric-string-dates",
            document_number: "DOC-101",
            document_name: "목록 문서",
            created_date: 1_628_500_286_702,
            updated_date: 1_628_500_287_046,
            template: { id: "template-1", name: "계약서" },
            creator: { recipient_type: "01", id: "creator", name: "생성자" },
            current_status: {
                status_type: "060",
                status_doc_type: "",
                status_doc_detail: "서명 요청",
                step_type: "05",
                step_index: "0",
                step_name: "이용자",
                step_recipients: [],
                step_group: 1,
            },
        }, { now: Date.parse("2030-01-01T00:00:00.000Z") });

        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                createdDate: new Date(1_628_500_286_702),
                updatedDate: new Date(1_628_500_287_046),
                stepIndex: "0",
            }),
            expect.objectContaining({ updateExpired: false }),
        );
    });

    it("replaces an open-state detail once the remote reports the document ended", async () => {
        // The list carries no status_doc_detail, so a document whose completion webhook was
        // dropped would keep reading "서명 요청됨" next to a completed status — and the
        // client tab renders that string straight into its status pill.
        const repository = {
            upsertUnassignedByDocumentId: jest.fn(
                (doc: EformsignDocEntity) => Promise.resolve(doc),
            ),
        };
        const usecase = new MirrorUnassignedEformsignDocUsecase(
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            repository as never,
        );

        await usecase.mirrorRemoteDocument({
            id: "expired-doc",
            document_number: "DOC-300",
            document_name: "만료 문서",
            created_date: Date.parse("2026-07-01T00:00:00.000Z"),
            updated_date: Date.parse("2026-07-02T00:00:00.000Z"),
            template: { id: "template-1", name: "계약서" },
            creator: { recipient_type: "01", id: "creator", name: "생성자" },
            current_status: {
                status_type: "080",
                step_type: "05",
                step_index: "1",
                step_name: "이용자",
                step_recipients: [],
                step_group: 1,
            },
        }, { now: Date.parse("2026-07-03T00:00:00.000Z") });

        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({ statusType: "080", statusDetail: "만료" }),
            expect.not.objectContaining({ updateStatusDetail: false }),
        );
    });

    it("clears a wrongly-set expired flag once the remote reports a non-expiry ending", async () => {
        // The list carries no _expired, so this used to be treated as "unknown" for every
        // status. A row that got expired=true by any route then kept it forever, even once
        // the vendor said the document had completed. A terminal status settles it: 080
        // means expired, and any other ending means it is not.
        const repository = {
            upsertUnassignedByDocumentId: jest.fn(
                (doc: EformsignDocEntity) => Promise.resolve(doc),
            ),
        };
        const usecase = new MirrorUnassignedEformsignDocUsecase(
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            repository as never,
        );

        await usecase.mirrorRemoteDocument({
            id: "completed-doc",
            document_number: "DOC-200",
            document_name: "완료 문서",
            created_date: Date.parse("2026-07-01T00:00:00.000Z"),
            updated_date: Date.parse("2026-07-02T00:00:00.000Z"),
            template: { id: "template-1", name: "계약서" },
            creator: { recipient_type: "01", id: "creator", name: "생성자" },
            current_status: {
                status_type: "050",
                step_type: "05",
                step_index: "1",
                step_name: "이용자",
                step_recipients: [],
                step_group: 1,
            },
        }, { now: Date.parse("2026-07-03T00:00:00.000Z") });

        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({ statusType: "050", expired: false }),
            expect.not.objectContaining({ updateExpired: false }),
        );
    });

    it("converts remaining expiry days to a date from the mirror reference time", async () => {
        const repository = {
            upsertUnassignedByDocumentId: jest.fn(
                (doc: EformsignDocEntity) => Promise.resolve(doc),
            ),
        };
        const usecase = new MirrorUnassignedEformsignDocUsecase(
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            repository as never,
        );
        const now = Date.parse("2026-07-03T00:00:00.000Z");

        await usecase.mirrorRemoteDocument({
            id: "expires-in-three-days",
            document_number: "DOC-102",
            document_name: "상세 문서",
            created_date: Date.parse("2026-07-01T00:00:00.000Z"),
            updated_date: Date.parse("2026-07-02T00:00:00.000Z"),
            template: { id: "template-1", name: "계약서" },
            creator: { recipient_type: "01", id: "creator", name: "생성자" },
            current_status: {
                status_type: "060",
                status_doc_type: "",
                status_doc_detail: "서명 요청",
                step_type: "05",
                step_index: "0",
                step_name: "이용자",
                step_recipients: [],
                step_group: 1,
                expired_date: 3,
                _expired: false,
            },
        }, { now });

        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({
                expiredDate: new Date(now + 3 * 24 * 60 * 60 * 1000),
            }),
            expect.any(Object),
        );
    });

    it("uses the shared template id fallback chain for list response shapes", async () => {
        const getAccessTokenUsecase = { execute: jest.fn() };
        const fetchEformsignDocFromApiUsecase = { execute: jest.fn() };
        const repository = {
            upsertUnassignedByDocumentId: jest.fn(
                (doc: EformsignDocEntity) => Promise.resolve(doc),
            ),
        };
        const usecase = new MirrorUnassignedEformsignDocUsecase(
            getAccessTokenUsecase as never,
            fetchEformsignDocFromApiUsecase as never,
            repository as never,
        );

        await usecase.mirrorRemoteDocument({
            ...{
                id: "listed-doc",
                document_number: "DOC-100",
                document_name: "목록 문서",
                created_date: Date.parse("2026-07-01T00:00:00.000Z"),
                updated_date: Date.parse("2026-07-02T00:00:00.000Z"),
                template: { id: "", name: "계약서" },
                detail_template_info: { id: "detail-template" },
                template_id: "flat-template",
                creator: { recipient_type: "01", id: "creator", name: "생성자" },
                current_status: {
                    status_type: "060",
                    status_doc_type: "",
                    status_doc_detail: "서명 요청",
                    step_type: "05",
                    step_index: "1",
                    step_name: "이용자",
                    step_recipients: [],
                    step_group: 1,
                    expired_date: 0,
                    _expired: false,
                },
            },
        } as never);

        expect(repository.upsertUnassignedByDocumentId).toHaveBeenCalledWith(
            expect.objectContaining({ templateId: "detail-template" }),
            { updateListDisplayFields: true },
        );
    });
});
