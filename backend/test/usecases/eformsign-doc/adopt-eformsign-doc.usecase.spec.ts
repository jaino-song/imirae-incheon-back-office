import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";

describe("AdoptEformsignDocUsecase", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("uses document-id upsert semantics on repeated adoption", async () => {
        const now = Date.parse("2026-07-03T00:00:00.000Z");
        jest.spyOn(Date, "now").mockReturnValue(now);
        const create = { execute: jest.fn().mockResolvedValue({ documentId: "doc-1" }) };
        const usecase = new AdoptEformsignDocUsecase(
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "token" } }) } as never,
            { execute: jest.fn().mockResolvedValue({
                id: "doc-1",
                document_name: "계약서 - 고객",
                template: { id: "template-1", name: "표준 계약서" },
                creator: { name: "생성자" },
                last_editor: { name: "최종 편집자" },
                fields: [{ id: "이용자 성명", value: "김고객" }],
                current_status: {
                    status_type: "060",
                    status_doc_detail: "서명 요청됨",
                    step_type: "01",
                    step_index: "1",
                    step_name: "서명 요청",
                    step_recipients: [
                        { recipient_type: "01", id: "01012345678", name: "고객" },
                        { recipient_type: "06", id: "reviewer", name: "검토자" },
                    ],
                    expired_date: 3,
                },
            }) } as never,
            create as never,
            { findByPhone: jest.fn() } as never,
        );

        await usecase.execute("branch-1", { documentId: "doc-1", clientId: 7 });
        await usecase.execute("branch-1", { documentId: "doc-1", clientId: 7 });

        expect(create.execute).toHaveBeenCalledTimes(2);
        expect(create.execute).toHaveBeenNthCalledWith(2, "branch-1", expect.objectContaining({
            documentId: "doc-1",
            clientId: 7,
            templateName: "표준 계약서",
            customerName: "김고객",
            creatorName: "생성자",
            lastEditorName: "최종 편집자",
            stepRecipientTypes: ["01", "06"],
            expiredDate: new Date(now + 3 * 24 * 60 * 60 * 1000),
        }));
    });

    it("preserves no-expiry semantics when adopting a document with zero remaining days", async () => {
        const create = { execute: jest.fn().mockResolvedValue({ documentId: "doc-no-expiry" }) };
        const usecase = new AdoptEformsignDocUsecase(
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "token" } }) } as never,
            { execute: jest.fn().mockResolvedValue({
                id: "doc-no-expiry",
                document_name: "무기한 계약서",
                template: { id: "template-1", name: "표준 계약서" },
                creator: { name: "생성자" },
                current_status: {
                    status_type: "060",
                    status_doc_detail: "서명 요청됨",
                    step_type: "01",
                    step_index: "1",
                    step_name: "서명 요청",
                    step_recipients: [],
                    expired_date: 0,
                },
            }) } as never,
            create as never,
            { findByPhone: jest.fn() } as never,
        );

        await usecase.execute("branch-1", { documentId: "doc-no-expiry", clientId: 7 });

        expect(create.execute).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                expiredDate: new Date("9999-12-31T23:59:59.999Z"),
            }),
        );
    });
});
