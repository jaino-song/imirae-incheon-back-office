import { Logger } from "@nestjs/common";

import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";

const TEST_PRINCIPAL = {
    userId: "test-user",
    branchId: "branch-1",
    globalRole: "owner",
    branchRole: "owner",
} as const;

function createCredentialBoundary(accessToken = "token") {
    return {
        withCredentials: jest.fn(async (
            _principal: unknown,
            _capability: unknown,
            operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
        ) => operation({ accessToken, refreshToken: "refresh-token" })),
    };
}

describe("AdoptEformsignDocUsecase", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("uses document-id upsert semantics on repeated adoption", async () => {
        const now = Date.parse("2026-07-03T00:00:00.000Z");
        jest.spyOn(Date, "now").mockReturnValue(now);
        const create = { execute: jest.fn().mockResolvedValue({ documentId: "doc-1" }) };
        const mirror = { syncDocumentWithToken: jest.fn().mockResolvedValue(undefined) };
        const usecase = new AdoptEformsignDocUsecase(
            createCredentialBoundary() as never,
            { execute: jest.fn().mockResolvedValue({
                id: "doc-1",
                updated_date: 1_751_500_800_000,
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
            mirror as never,
        );

        await usecase.execute("branch-1", { documentId: "doc-1", clientId: 7 }, TEST_PRINCIPAL);
        await usecase.execute("branch-1", { documentId: "doc-1", clientId: 7 }, TEST_PRINCIPAL);

        expect(create.execute).toHaveBeenCalledTimes(2);
        expect(create.execute).toHaveBeenNthCalledWith(2, "branch-1", expect.objectContaining({
            documentId: "doc-1",
            clientId: 7,
            preserveExistingMirrorProjection: true,
            templateName: "표준 계약서",
            customerName: "김고객",
            creatorName: "생성자",
            lastEditorName: "최종 편집자",
            stepRecipientTypes: ["01", "06"],
            expiredDate: new Date(now + 3 * 24 * 60 * 60 * 1000),
        }));
        expect(mirror.syncDocumentWithToken).toHaveBeenNthCalledWith(
            2,
            "token",
            "doc-1",
            { expectedUpdatedDate: 1_751_500_800_000 },
        );
        expect(create.execute.mock.invocationCallOrder[0]!).toBeLessThan(
            mirror.syncDocumentWithToken.mock.invocationCallOrder[0]!,
        );
    });

    it.each([
        ["doc_complete", "003"],
        ["50", "050"],
    ])("normalizes persisted vendor status %s to %s", async (rawStatus, expectedStatus) => {
        const create = { execute: jest.fn().mockResolvedValue({ documentId: "doc-status" }) };
        const mirror = { syncDocumentWithToken: jest.fn().mockResolvedValue(undefined) };
        const usecase = new AdoptEformsignDocUsecase(
            createCredentialBoundary() as never,
            { execute: jest.fn().mockResolvedValue({
                id: "doc-status",
                document_name: "계약서",
                template: { id: "template-1", name: "표준 계약서" },
                current_status: {
                    status_type: rawStatus,
                    status_doc_detail: "완료",
                    step_type: "05",
                    step_index: "1",
                    step_name: "완료",
                    step_recipients: [],
                    expired_date: 0,
                },
            }) } as never,
            create as never,
            { findByPhone: jest.fn() } as never,
            mirror as never,
        );

        await usecase.execute("branch-1", { documentId: "doc-status", clientId: 7 }, TEST_PRINCIPAL);

        expect(create.execute).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({ statusType: expectedStatus }),
        );
    });

    it("preserves no-expiry semantics when adopting a document with zero remaining days", async () => {
        const create = { execute: jest.fn().mockResolvedValue({ documentId: "doc-no-expiry" }) };
        const mirror = { syncDocumentWithToken: jest.fn().mockResolvedValue(undefined) };
        const usecase = new AdoptEformsignDocUsecase(
            createCredentialBoundary() as never,
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
            mirror as never,
        );

        await usecase.execute("branch-1", { documentId: "doc-no-expiry", clientId: 7 }, TEST_PRINCIPAL);

        expect(create.execute).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                expiredDate: new Date("9999-12-31T23:59:59.999Z"),
            }),
        );
    });

    it("keeps adoption successful when post-commit mirroring must be retried", async () => {
        const mirrorError = new Error("mirror failed");
        const createResult = {
            documentId: "doc-complete",
            warnings: ["client_link_failed" as const],
        };
        const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
        const usecase = new AdoptEformsignDocUsecase(
            createCredentialBoundary() as never,
            { execute: jest.fn().mockResolvedValue({
                id: "doc-complete",
                updated_date: 1_751_500_800_000,
                document_name: "완료 계약서",
                template: { id: "template-1", name: "표준 계약서" },
                current_status: {
                    status_type: "003",
                    status_doc_detail: "완료",
                    step_type: "05",
                    step_index: "1",
                    step_name: "완료",
                    step_recipients: [],
                    expired_date: 0,
                },
            }) } as never,
            { execute: jest.fn().mockResolvedValue(createResult) } as never,
            { findByPhone: jest.fn() } as never,
            { syncDocumentWithToken: jest.fn().mockRejectedValue(mirrorError) } as never,
        );

        await expect(usecase.execute("branch-1", {
            documentId: "doc-complete",
            clientId: 7,
        }, TEST_PRINCIPAL)).resolves.toMatchObject({
            documentId: "doc-complete",
            warnings: ["client_link_failed", "mirror_sync_failed"],
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("local mirror remains incomplete"));
        expect(warn.mock.calls.flat().join(" ")).not.toContain("will retry");
        expect(warn.mock.calls.flat().join(" ")).not.toContain("doc-complete");
        expect(warn.mock.calls.flat().join(" ")).not.toContain(mirrorError.message);
    });
});
