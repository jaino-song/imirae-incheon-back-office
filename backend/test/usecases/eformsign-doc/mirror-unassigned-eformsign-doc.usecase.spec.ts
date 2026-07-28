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
                template: { id: "template-1", name: "계약서" },
                current_status: {
                    status_type: "060",
                    status_doc_detail: "서명 요청됨",
                    step_type: "",
                    step_index: "",
                    step_name: "",
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
                templateId: "template-1",
                createdDate: new Date("2026-07-01T01:00:00.000Z"),
                updatedDate: new Date("2026-07-02T02:00:00.000Z"),
                stepType: "01",
                stepIndex: "1",
                stepName: "서명 요청",
                stepRecipientType: "01",
                stepRecipientName: "외부 생성 계약서",
                stepRecipientSms: "미확인",
                expiredDate: new Date(now + 30 * 24 * 60 * 60 * 1000),
            }),
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
        );
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("reversed-doc"),
        );
    });
});
