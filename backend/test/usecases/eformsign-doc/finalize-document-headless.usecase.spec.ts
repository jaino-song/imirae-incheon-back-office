import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";

describe("FinalizeDocumentHeadlessUsecase", () => {
    it("finalizes a service record without requiring an end-date prefill", async () => {
        const eformsignService = {
            generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
        };
        const headlessService = {
            dispatchFinalize: jest.fn().mockResolvedValue({
                ok: true,
                durationMs: 640,
            }),
        };
        const getAccessTokenUsecase = {
            execute: jest.fn().mockResolvedValue({
                oauth_token: {
                    access_token: "access-token",
                    refresh_token: "refresh-token",
                },
            }),
        };
        const progressService = {
            emit: jest.fn(),
        };

        const usecase = new FinalizeDocumentHeadlessUsecase(
            eformsignService as never,
            headlessService as never,
            getAccessTokenUsecase as never,
            progressService as never,
        );

        await expect(usecase.execute({
            documentId: "service-record-1",
            progressId: "progress-1",
        })).resolves.toEqual({
            ok: true,
            durationMs: 640,
        });

        expect(eformsignService.generateStaffCompletionOptions).toHaveBeenCalledWith(
            "service-record-1",
            "access-token",
            "refresh-token",
            undefined,
        );
        expect(headlessService.dispatchFinalize).toHaveBeenCalledWith({
            documentOption: { mode: { type: "02" } },
            documentId: "service-record-1",
            onProgress: expect.any(Function),
        });
    });

    describe("when the run succeeds on the success latch", () => {
        /**
         * The latch exit stops at the SDK callback without necessarily having
         * clicked the popup 전송 that submits. Since the callback's completion
         * code is inferred rather than documented, this path must not be able to
         * report a completion eformsign never performed.
         */
        function buildUsecase(gateOutcome: string | undefined, fetchDocumentStatusCode: jest.Mock) {
            const eformsignService = {
                generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
                fetchDocumentStatusCode,
            };
            const headlessService = {
                dispatchFinalize: jest.fn().mockResolvedValue({
                    ok: true,
                    durationMs: 900,
                    ...(gateOutcome ? { gateOutcome } : {}),
                }),
            };
            const getAccessTokenUsecase = {
                execute: jest.fn().mockResolvedValue({
                    oauth_token: { access_token: "access-token", refresh_token: "refresh-token" },
                }),
            };

            return new FinalizeDocumentHeadlessUsecase(
                eformsignService as never,
                headlessService as never,
                getAccessTokenUsecase as never,
                { emit: jest.fn() } as never,
            );
        }

        it("rejects the run when eformsign has not actually completed the document", async () => {
            // The incident shape: the SDK said success, the popup 전송 was never
            // clicked, and the document sat at 070 (제공기관 검토) untouched.
            const usecase = buildUsecase("success-latched", jest.fn().mockResolvedValue("070"));

            await expect(usecase.execute({ documentId: "doc-1" })).resolves.toEqual(
                expect.objectContaining({
                    ok: false,
                    reason: "eformsign reported success without submitting the document",
                    fallbackHint: "iframe",
                }),
            );
        });

        it("accepts the run when eformsign confirms the document completed", async () => {
            const usecase = buildUsecase("success-latched", jest.fn().mockResolvedValue("003"));

            await expect(usecase.execute({ documentId: "doc-1" })).resolves.toEqual({
                ok: true,
                durationMs: 900,
            });
        });

        it("asks for a manual check when the vendor status cannot be read", async () => {
            const usecase = buildUsecase("success-latched", jest.fn().mockResolvedValue(undefined));

            await expect(usecase.execute({ documentId: "doc-1" })).resolves.toEqual(
                expect.objectContaining({ ok: false, fallbackHint: "manual_check" }),
            );
        });

        it("trusts a run that clicked the popup 전송 without consulting the vendor", async () => {
            const fetchDocumentStatusCode = jest.fn();
            const usecase = buildUsecase("request-send-clicked", fetchDocumentStatusCode);

            await expect(usecase.execute({ documentId: "doc-1" })).resolves.toEqual({
                ok: true,
                durationMs: 900,
            });
            expect(fetchDocumentStatusCode).not.toHaveBeenCalled();
        });
    });

    describe("when the run fails after 전송 was clicked", () => {
        /**
         * The gate emits "creating" on the 전송 click, so these runs sit on an
         * unknown side of the submit. Which fallback they earn depends entirely
         * on what eformsign says the document's status actually is.
         */
        function buildUsecase(fetchDocumentStatusCode: jest.Mock, reachedSend = true) {
            const eformsignService = {
                generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
                fetchDocumentStatusCode,
            };
            const headlessService = {
                dispatchFinalize: jest.fn().mockImplementation(async ({ onProgress }) => {
                    onProgress?.("client-started");
                    if (reachedSend) onProgress?.("creating");
                    return { ok: false, reason: "gate timeout", durationMs: 31_000 };
                }),
            };
            const getAccessTokenUsecase = {
                execute: jest.fn().mockResolvedValue({
                    oauth_token: { access_token: "access-token", refresh_token: "refresh-token" },
                }),
            };
            const progressService = { emit: jest.fn() };

            return {
                progressService,
                usecase: new FinalizeDocumentHeadlessUsecase(
                    eformsignService as never,
                    headlessService as never,
                    getAccessTokenUsecase as never,
                    progressService as never,
                ),
            };
        }

        it("reports success when eformsign shows the document already completed", async () => {
            // 072 = doc_accept_reviewer: the finalize landed, only the SDK
            // callback went missing.
            const { usecase, progressService } = buildUsecase(jest.fn().mockResolvedValue("072"));

            await expect(usecase.execute({ documentId: "doc-1", progressId: "p-1" })).resolves.toEqual({
                ok: true,
                durationMs: 31_000,
            });
            expect(progressService.emit).toHaveBeenCalledWith("p-1", "sent");
        });

        it("asks for the iframe only when eformsign confirms the step is unfinished", async () => {
            // 070 = doc_request_reviewer: still awaiting provider review.
            const { usecase } = buildUsecase(jest.fn().mockResolvedValue("070"));

            await expect(usecase.execute({ documentId: "doc-1" })).resolves.toEqual(
                expect.objectContaining({ ok: false, fallbackHint: "iframe" }),
            );
        });

        it("asks for a manual check when the vendor status cannot be read", async () => {
            const { usecase } = buildUsecase(jest.fn().mockRejectedValue(new Error("502 Bad Gateway")));

            await expect(usecase.execute({ documentId: "doc-1" })).resolves.toEqual(
                expect.objectContaining({ ok: false, fallbackHint: "manual_check" }),
            );
        });

        it("does not consult the vendor when the run never reached 전송", async () => {
            const fetchDocumentStatusCode = jest.fn();
            const { usecase } = buildUsecase(fetchDocumentStatusCode, false);

            await expect(usecase.execute({ documentId: "doc-1" })).resolves.toEqual(
                expect.objectContaining({ ok: false, fallbackHint: "iframe" }),
            );
            expect(fetchDocumentStatusCode).not.toHaveBeenCalled();
        });
    });
});
