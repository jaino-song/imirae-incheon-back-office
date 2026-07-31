import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";

describe("DispatchDocumentHeadlessUsecase", () => {
    it("persists the current eformsign status after headless creation", async () => {
        const eformsignService = {
            generateDocumentOptions: jest.fn().mockReturnValue({
                mode: { type: "01" },
                prefill: { document_name: "산모신생아건강관리서비스 계약서" },
            }),
        };
        const headlessService = {
            dispatchCreation: jest.fn().mockResolvedValue({
                ok: true,
                documentId: "doc-1",
                durationMs: 1200,
            }),
        };
        const areaTemplateService = {
            findByArea: jest.fn().mockResolvedValue(null),
        };
        const getAccessTokenUsecase = {
            execute: jest.fn().mockResolvedValue({
                oauth_token: {
                    access_token: "access-token",
                    refresh_token: "refresh-token",
                },
            }),
        };
        const createEformsignDocUsecase = {
            execute: jest.fn().mockResolvedValue(undefined),
        };
        const fetchEformsignDocFromApiUsecase = {
            execute: jest.fn().mockResolvedValue({
                template: {
                    id: "template-1",
                    name: "서구 계약서 (검토 단계)",
                },
                current_status: {
                    status_type: "003",
                    step_type: "01",
                    step_index: "4",
                    step_name: "완료",
                    expired_date: 0,
                    _expired: false,
                },
            }),
        };
        const progressService = {
            emit: jest.fn(),
        };
        const clientRepository = {
            findById: jest.fn().mockResolvedValue({
                name: "김고객",
                phone: "010-1234-5678",
            }),
        };
        const assignmentGuard = {
            assertAssignedProvider: jest.fn().mockResolvedValue({ scheduleId: 10 }),
        };

        const usecase = new DispatchDocumentHeadlessUsecase(
            eformsignService as never,
            headlessService as never,
            areaTemplateService as never,
            getAccessTokenUsecase as never,
            createEformsignDocUsecase as never,
            fetchEformsignDocFromApiUsecase as never,
            progressService as never,
            clientRepository as never,
            assignmentGuard as never,
            { findByClientId: jest.fn().mockResolvedValue([]) } as never,
            { execute: jest.fn().mockResolvedValue([]) } as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 7,
            progressId: "progress-1",
            contractData: {
                customerName: "김고객",
                customerContact: "010-1234-5678",
            } as never,
        })).resolves.toEqual({
            ok: true,
            documentId: "doc-1",
            durationMs: 1200,
        });

        expect(createEformsignDocUsecase.execute).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                documentId: "doc-1",
                documentName: "산모신생아건강관리서비스 계약서",
                clientId: 7,
                statusType: "003",
                statusDetail: "완료",
                stepType: "01",
                stepIndex: "4",
                stepName: "완료",
                templateName: "서구 계약서 (검토 단계)",
                customerName: "김고객",
            }),
        );
    });

    it("falls back to the initial sign-request status when eformsign status fetch fails", async () => {
        const eformsignService = {
            generateDocumentOptions: jest.fn().mockReturnValue({ mode: { type: "01" } }),
        };
        const headlessService = {
            dispatchCreation: jest.fn().mockResolvedValue({
                ok: true,
                documentId: "doc-2",
                durationMs: 900,
            }),
        };
        const areaTemplateService = {
            findByArea: jest.fn().mockResolvedValue(null),
        };
        const getAccessTokenUsecase = {
            execute: jest.fn().mockResolvedValue({
                oauth_token: {
                    access_token: "access-token",
                    refresh_token: "refresh-token",
                },
            }),
        };
        const createEformsignDocUsecase = {
            execute: jest.fn().mockResolvedValue(undefined),
        };
        const fetchEformsignDocFromApiUsecase = {
            execute: jest.fn().mockRejectedValue(new Error("document not found")),
        };
        const progressService = {
            emit: jest.fn(),
        };
        const clientRepository = {
            findById: jest.fn().mockResolvedValue(null),
        };
        const assignmentGuard = {
            assertAssignedProvider: jest.fn().mockResolvedValue({ scheduleId: 11 }),
        };

        const usecase = new DispatchDocumentHeadlessUsecase(
            eformsignService as never,
            headlessService as never,
            areaTemplateService as never,
            getAccessTokenUsecase as never,
            createEformsignDocUsecase as never,
            fetchEformsignDocFromApiUsecase as never,
            progressService as never,
            clientRepository as never,
            assignmentGuard as never,
            { findByClientId: jest.fn().mockResolvedValue([]) } as never,
            { execute: jest.fn().mockResolvedValue([]) } as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 8,
            contractData: {
                customerName: "이고객",
                customerContact: "010-0000-0000",
            } as never,
        })).resolves.toEqual({
            ok: true,
            documentId: "doc-2",
            durationMs: 900,
        });

        expect(createEformsignDocUsecase.execute).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                documentId: "doc-2",
                documentName: null,
                clientId: 8,
                statusType: "060",
                statusDetail: "서명 요청됨",
                stepType: "01",
                stepIndex: "1",
                stepName: "서명 요청",
            }),
        );
    });

    it("stops before eformsign authentication when the client assignment is missing", async () => {
        const getAccessTokenUsecase = { execute: jest.fn() };
        const headlessService = { dispatchCreation: jest.fn() };
        const assignmentGuard = {
            assertAssignedProvider: jest.fn().mockRejectedValue(
                new Error("고객의 제공인력 배정을 먼저 저장해 주세요."),
            ),
        };
        const usecase = new DispatchDocumentHeadlessUsecase(
            { generateDocumentOptions: jest.fn() } as never,
            headlessService as never,
            { findByArea: jest.fn() } as never,
            getAccessTokenUsecase as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            { emit: jest.fn() } as never,
            { findById: jest.fn() } as never,
            assignmentGuard as never,
            { findByClientId: jest.fn().mockResolvedValue([]) } as never,
            { execute: jest.fn().mockResolvedValue([]) } as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 55,
            contractData: {
                caretaker1Contact: "010-1111-2222",
            } as never,
        })).resolves.toEqual(expect.objectContaining({
            ok: false,
            reason: "고객의 제공인력 배정을 먼저 저장해 주세요.",
        }));

        expect(assignmentGuard.assertAssignedProvider).toHaveBeenCalledWith(
            "branch-1",
            55,
            "010-1111-2222",
        );
        expect(getAccessTokenUsecase.execute).not.toHaveBeenCalled();
        expect(headlessService.dispatchCreation).not.toHaveBeenCalled();
    });

    it("returns the remote document id when local persistence fails", async () => {
        const usecase = new DispatchDocumentHeadlessUsecase(
            { generateDocumentOptions: jest.fn().mockReturnValue({}) } as never,
            { dispatchCreation: jest.fn().mockResolvedValue({ ok: true, documentId: "remote-1", durationMs: 50 }) } as never,
            { findByArea: jest.fn().mockResolvedValue({ templateId: "template-1" }) } as never,
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "a", refresh_token: "r" } }) } as never,
            { execute: jest.fn().mockRejectedValue(new Error("db down")) } as never,
            { execute: jest.fn().mockRejectedValue(new Error("not found")) } as never,
            { emit: jest.fn() } as never,
            { findById: jest.fn().mockResolvedValue(null) } as never,
            { assertAssignedProvider: jest.fn() } as never,
            { findByClientId: jest.fn().mockResolvedValue([]) } as never,
            { execute: jest.fn().mockResolvedValue([]) } as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 7,
            contractData: { area: "seoul", customerName: "고객" } as never,
        })).resolves.toEqual(expect.objectContaining({
            ok: false,
            reason: "local_persist_failed",
            remoteDocumentId: "remote-1",
            fallbackHint: "adopt",
        }));
    });

    // A headless failure is only safe to retry in the iframe if the run never got
    // as far as clicking 전송. Past that point eformsign may already hold the
    // document, and reopening the editor sends a second contract.
    describe("post-send failures", () => {
        const buildUsecase = (overrides: {
            dispatchCreation: jest.Mock;
            remoteDocuments?: unknown[];
            createDoc?: jest.Mock;
        }) => new DispatchDocumentHeadlessUsecase(
            { generateDocumentOptions: jest.fn().mockReturnValue({}) } as never,
            { dispatchCreation: overrides.dispatchCreation } as never,
            { findByArea: jest.fn().mockResolvedValue(null) } as never,
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "a", refresh_token: "r" } }) } as never,
            { execute: overrides.createDoc ?? jest.fn().mockResolvedValue(undefined) } as never,
            { execute: jest.fn().mockRejectedValue(new Error("not found")) } as never,
            { emit: jest.fn() } as never,
            { findById: jest.fn().mockResolvedValue(null) } as never,
            { assertAssignedProvider: jest.fn().mockResolvedValue({ scheduleId: 1 }) } as never,
            { findByClientId: jest.fn().mockResolvedValue([]) } as never,
            { execute: jest.fn().mockResolvedValue(overrides.remoteDocuments ?? []) } as never,
        );

        const params = {
            clientId: 7,
            contractData: { customerName: "김고객", customerContact: "010-0000-0000" } as never,
        };

        it("still offers the iframe when the run failed before reaching 전송", async () => {
            const dispatchCreation = jest.fn().mockImplementation(async ({ onProgress }) => {
                onProgress?.("client-started");
                return { ok: false, reason: "Timed out ... no gate became actionable", durationMs: 70_000 };
            });

            await expect(buildUsecase({ dispatchCreation }).execute("branch-1", params))
                .resolves.toEqual(expect.objectContaining({
                    ok: false,
                    fallbackHint: "iframe",
                    failedStep: "client-started",
                }));
        });

        it("never offers the iframe once 전송 was already clicked", async () => {
            const dispatchCreation = jest.fn().mockImplementation(async ({ onProgress }) => {
                onProgress?.("client-started");
                onProgress?.("info-inserted");
                onProgress?.("creating"); // emitted at the moment 전송 is clicked
                return { ok: false, reason: "eformsign SDK completed without a success callback", durationMs: 90_000 };
            });

            const result = await buildUsecase({ dispatchCreation }).execute("branch-1", params);

            // Reopening the editor here is what duplicates a contract that may
            // already have gone out, so this hint must never be "iframe".
            expect(result).toEqual(expect.objectContaining({
                ok: false,
                reason: "remote_unconfirmed",
                fallbackHint: "manual_check",
            }));
        });

        it("adopts the document when a post-send failure turns out to have sent it", async () => {
            const dispatchCreation = jest.fn().mockImplementation(async ({ onProgress }) => {
                onProgress?.("creating");
                return { ok: false, reason: "eformsign SDK completed without a success callback", durationMs: 90_000 };
            });
            const createDoc = jest.fn().mockResolvedValue(undefined);

            const result = await buildUsecase({
                dispatchCreation,
                createDoc,
                remoteDocuments: [{
                    id: "recovered-1",
                    created_date: Date.now(),
                    document_name: "김고객 산모신생아건강관리서비스 계약서",
                }],
            }).execute("branch-1", params);

            expect(result).toEqual(expect.objectContaining({ ok: true, documentId: "recovered-1" }));
            expect(createDoc).toHaveBeenCalledWith("branch-1", expect.objectContaining({
                documentId: "recovered-1",
                clientId: 7,
            }));
        });
    });

    it("rejects a recent pending duplicate and allows force", async () => {
        const dispatchCreation = jest.fn().mockResolvedValue({ ok: false, reason: "stop", durationMs: 1 });
        const repository = { findByClientId: jest.fn().mockResolvedValue([{
            documentId: "existing-1",
            templateId: "template-1",
            statusType: "060",
            createdDate: new Date(),
        }]) };
        const usecase = new DispatchDocumentHeadlessUsecase(
            { generateDocumentOptions: jest.fn().mockReturnValue({}) } as never,
            { dispatchCreation } as never,
            { findByArea: jest.fn().mockResolvedValue({ templateId: "template-1" }) } as never,
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "a", refresh_token: "r" } }) } as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            { emit: jest.fn() } as never,
            { findById: jest.fn() } as never,
            { assertAssignedProvider: jest.fn() } as never,
            repository as never,
            { execute: jest.fn() } as never,
        );
        const params = { clientId: 7, contractData: { area: "seoul" } as never };

        await expect(usecase.execute("branch-1", params)).resolves.toEqual(expect.objectContaining({
            reason: "duplicate_pending_document",
            existingDocumentId: "existing-1",
        }));
        await usecase.execute("branch-1", { ...params, force: true });
        expect(dispatchCreation).toHaveBeenCalledTimes(1);
    });
});
