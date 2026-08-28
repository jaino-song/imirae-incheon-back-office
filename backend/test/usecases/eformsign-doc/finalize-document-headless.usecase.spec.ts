import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { EformsignOperationAlreadyRunningError } from "infrastructure/locking/eformsign-operation-lock.service";

const TEST_PRINCIPAL = {
    userId: "test-user",
    branchId: "branch-1",
    globalRole: "owner",
    branchRole: "owner",
} as const;

function createCredentialBoundary() {
    return {
        withCredentials: jest.fn(async (
            _principal: unknown,
            _capability: unknown,
            operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
        ) => operation({ accessToken: "access-token", refreshToken: "refresh-token" })),
    };
}

describe("FinalizeDocumentHeadlessUsecase", () => {
    it("does not start a second finalization for the same document", async () => {
        const headlessService = { dispatchFinalize: jest.fn() };
        const credentialBoundary = createCredentialBoundary();
        const operationLock = {
            runExclusive: jest.fn().mockRejectedValue(new EformsignOperationAlreadyRunningError()),
        };
        const usecase = new FinalizeDocumentHeadlessUsecase(
            { generateStaffDocumentOptions: jest.fn(), fetchDocumentStatusCode: jest.fn() } as never,
            headlessService as never,
            credentialBoundary as never,
            { emit: jest.fn() } as never,
            operationLock as never,
        );

        await expect(usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({
            ok: false,
            reason: "operation_in_progress",
            fallbackHint: "manual_check",
        }));
        expect(credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(headlessService.dispatchFinalize).not.toHaveBeenCalled();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

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
        const credentialBoundary = createCredentialBoundary();
        const progressService = {
            emit: jest.fn(),
        };
        const documentMirrorService = {
            syncDocument: jest.fn().mockResolvedValue({ status: "synced" }),
        };

        const usecase = new FinalizeDocumentHeadlessUsecase(
            eformsignService as never,
            headlessService as never,
            credentialBoundary as never,
            progressService as never,
            undefined,
            documentMirrorService as never,
        );

        await expect(usecase.execute({
            documentId: "service-record-1",
            progressId: "progress-1",
        }, TEST_PRINCIPAL)).resolves.toEqual({
            ok: true,
            completed: true,
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
        expect(documentMirrorService.syncDocument).toHaveBeenCalledWith(
            "service-record-1",
            {
                branchId: "branch-1",
                globalRole: "owner",
                branchRole: "owner",
                userId: "test-user",
            },
            {
                force: true,
                publishChangeReason: "mirror:finalize",
                suppressOutboundAutomation: true,
                strictCompletionReconciliation: true,
            },
        );
    });

    it("retries a post-finalize mirror failure without changing the confirmed vendor result", async () => {
        jest.useFakeTimers();
        const documentMirrorService = {
            syncDocument: jest.fn()
                .mockRejectedValueOnce(new Error("PDF not ready"))
                .mockResolvedValueOnce({ status: "synced" }),
        };
        const usecase = new FinalizeDocumentHeadlessUsecase(
            {
                generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
            } as never,
            {
                dispatchFinalize: jest.fn().mockResolvedValue({
                    ok: true,
                    durationMs: 640,
                    gateOutcome: "request-send-clicked",
                }),
            } as never,
            createCredentialBoundary() as never,
            { emit: jest.fn() } as never,
            undefined,
            documentMirrorService as never,
        );

        await expect(usecase.execute({ documentId: "doc-retry" }, TEST_PRINCIPAL)).resolves.toEqual({
            ok: true,
            completed: true,
            durationMs: 640,
        });
        await jest.runAllTimersAsync();

        expect(documentMirrorService.syncDocument).toHaveBeenCalledTimes(2);
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
            return new FinalizeDocumentHeadlessUsecase(
                eformsignService as never,
                headlessService as never,
                createCredentialBoundary() as never,
                { emit: jest.fn() } as never,
            );
        }

        it("rejects the run when eformsign has not actually completed the document", async () => {
            // The incident shape: the SDK said success, the popup 전송 was never
            // clicked, and the document sat at 070 (제공기관 검토) untouched.
            jest.useFakeTimers();
            const usecase = buildUsecase("success-latched", jest.fn().mockResolvedValue("070"));

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual(
                expect.objectContaining({
                    ok: false,
                    reason: "eformsign reported success without submitting the document",
                    fallbackHint: "iframe",
                }),
            );
        });

        it("accepts the run when eformsign confirms the document completed", async () => {
            const usecase = buildUsecase("success-latched", jest.fn().mockResolvedValue("003"));

            await expect(usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL)).resolves.toEqual({
                ok: true,
                completed: true,
                durationMs: 900,
            });
        });

        it("waits for a delayed vendor completion before rejecting a latched success", async () => {
            jest.useFakeTimers();
            const fetchDocumentStatusCode = jest.fn()
                .mockResolvedValueOnce("070")
                .mockResolvedValueOnce("072");
            const usecase = buildUsecase("success-latched", fetchDocumentStatusCode);

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual({
                ok: true,
                completed: true,
                durationMs: 900,
            });
            expect(fetchDocumentStatusCode).toHaveBeenCalledTimes(2);
        });

        it("retries an unreadable vendor response before requiring a manual check", async () => {
            jest.useFakeTimers();
            const fetchDocumentStatusCode = jest.fn()
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce("072");
            const usecase = buildUsecase("success-latched", fetchDocumentStatusCode);

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual({
                ok: true,
                completed: true,
                durationMs: 900,
            });
            expect(fetchDocumentStatusCode).toHaveBeenCalledTimes(2);
        });

        it("asks for a manual check when the vendor status cannot be read", async () => {
            jest.useFakeTimers();
            const usecase = buildUsecase("success-latched", jest.fn().mockResolvedValue(undefined));

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual(
                expect.objectContaining({ ok: false, fallbackHint: "manual_check" }),
            );
        });

        it("trusts a run that clicked the popup 전송 without consulting the vendor", async () => {
            const fetchDocumentStatusCode = jest.fn();
            const usecase = buildUsecase("request-send-clicked", fetchDocumentStatusCode);

            await expect(usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL)).resolves.toEqual({
                ok: true,
                completed: true,
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
        function buildUsecase(
            fetchDocumentStatusCode: jest.Mock,
            reachedSend = true,
            fetchDocumentWorkflowState?: jest.Mock,
            sdkReportedSent = false,
        ) {
            const eformsignService = {
                generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
                fetchDocumentStatusCode,
                ...(fetchDocumentWorkflowState ? { fetchDocumentWorkflowState } : {}),
            };
            const headlessService = {
                dispatchFinalize: jest.fn().mockImplementation(async ({ onProgress }) => {
                    onProgress?.("client-started");
                    if (reachedSend) onProgress?.("creating");
                    if (sdkReportedSent) onProgress?.("sent");
                    return { ok: false, reason: "gate timeout", durationMs: 31_000 };
                }),
            };
            const progressService = { emit: jest.fn() };

            return {
                progressService,
                usecase: new FinalizeDocumentHeadlessUsecase(
                    eformsignService as never,
                    headlessService as never,
                    createCredentialBoundary() as never,
                    progressService as never,
                ),
            };
        }

        it("reports success when eformsign shows the document already completed", async () => {
            // 072 = doc_accept_reviewer: the finalize landed, only the SDK
            // callback went missing.
            const { usecase, progressService } = buildUsecase(jest.fn().mockResolvedValue("072"));

            await expect(usecase.execute({ documentId: "doc-1", progressId: "p-1" }, TEST_PRINCIPAL)).resolves.toEqual({
                ok: true,
                completed: true,
                durationMs: 31_000,
            });
            expect(progressService.emit).toHaveBeenCalledWith("p-1", "sent");
        });

        it("reports an advanced-but-incomplete provider step distinctly", async () => {
            const fetchDocumentStatusCode = jest.fn();
            const fetchDocumentWorkflowState = jest.fn()
                .mockResolvedValueOnce({
                    statusCode: "060",
                    stepType: "05",
                    stepIndex: "3",
                    stepName: "제공기관 확인",
                })
                .mockResolvedValueOnce({
                    statusCode: "070",
                    stepType: "06",
                    stepIndex: "4",
                    stepName: "제공기관 검토",
                });
            const { usecase, progressService } = buildUsecase(
                fetchDocumentStatusCode,
                true,
                fetchDocumentWorkflowState,
                true,
            );

            await expect(usecase.execute({ documentId: "doc-1", progressId: "p-1" }, TEST_PRINCIPAL))
                .resolves.toEqual({ ok: true, completed: false, durationMs: 31_000 });
            expect(fetchDocumentStatusCode).not.toHaveBeenCalled();
            expect(fetchDocumentWorkflowState).toHaveBeenCalledTimes(2);
            expect(progressService.emit).not.toHaveBeenCalledWith("p-1", "sent");
        });

        it("treats a terminal rejection as failure instead of workflow advancement", async () => {
            const fetchDocumentWorkflowState = jest.fn()
                .mockResolvedValueOnce({
                    statusCode: "070",
                    stepType: "06",
                    stepIndex: "4",
                    stepName: "제공기관 검토",
                })
                .mockResolvedValueOnce({
                    statusCode: "071",
                    stepType: "06",
                    stepIndex: "4",
                    stepName: "검토 반려",
                });
            const { usecase, progressService } = buildUsecase(
                jest.fn(),
                true,
                fetchDocumentWorkflowState,
            );

            await expect(usecase.execute({ documentId: "doc-1", progressId: "p-1" }, TEST_PRINCIPAL))
                .resolves.toEqual(expect.objectContaining({
                    ok: false,
                    reason: "eformsign_terminal_failure",
                    fallbackHint: "manual_check",
                }));
            expect(progressService.emit).not.toHaveBeenCalledWith("p-1", "sent");
        });

        it("requires a manual check when a send was attempted but the step remains pending", async () => {
            // 070 = doc_request_reviewer: still awaiting provider review. The
            // send click already happened, so reopening the iframe could send a
            // duplicate document and is never a safe fallback.
            jest.useFakeTimers();
            const { usecase } = buildUsecase(jest.fn().mockResolvedValue("070"));

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual(
                expect.objectContaining({ ok: false, fallbackHint: "manual_check" }),
            );
        });

        it("asks for a manual check when the vendor status cannot be read", async () => {
            jest.useFakeTimers();
            const { usecase } = buildUsecase(jest.fn().mockRejectedValue(new Error("502 Bad Gateway")));

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual(
                expect.objectContaining({ ok: false, fallbackHint: "manual_check" }),
            );
        });

        it("keeps a thrown SDK error on manual check after the send callback", async () => {
            const headlessService = {
                dispatchFinalize: jest.fn().mockImplementation(async ({ onProgress }) => {
                    await onProgress?.("creating");
                    throw new Error("headless SDK disconnected");
                }),
            };
            const usecase = new FinalizeDocumentHeadlessUsecase(
                { generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }) } as never,
                headlessService as never,
                createCredentialBoundary() as never,
                { emit: jest.fn() } as never,
            );

            await expect(usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL)).resolves.toEqual(
                expect.objectContaining({
                    ok: false,
                    reason: "headless SDK disconnected",
                    fallbackHint: "manual_check",
                }),
            );
        });

        it("does not consult the vendor when the run never reached 전송", async () => {
            const fetchDocumentStatusCode = jest.fn();
            const { usecase } = buildUsecase(fetchDocumentStatusCode, false);

            await expect(usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL)).resolves.toEqual(
                expect.objectContaining({ ok: false, fallbackHint: "iframe" }),
            );
            expect(fetchDocumentStatusCode).not.toHaveBeenCalled();
        });
    });
});
