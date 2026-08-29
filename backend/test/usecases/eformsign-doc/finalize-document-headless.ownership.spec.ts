import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";

const TEST_PRINCIPAL = {
    userId: "test-user",
    branchId: "branch-a",
    globalRole: "owner",
    branchRole: "owner",
} as const;

const document = {
    id: 42,
    documentId: "provider-doc-1",
    documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
    clientId: 7,
    employeeScheduleId: 13,
    templateId: "template-1",
    statusType: "070",
    expired: false,
    updatedDate: new Date("2026-08-29T00:00:00.000Z"),
};

function buildUsecase(localDocument: unknown) {
    const eformsignService = {
        generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
    };
    const headlessService = {
        dispatchFinalize: jest.fn().mockResolvedValue({ ok: true, durationMs: 11 }),
    };
    const credentialBoundary = {
        withCredentials: jest.fn(async (
            _principal: unknown,
            _capability: unknown,
            operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
        ) => operation({ accessToken: "server-access", refreshToken: "server-refresh" })),
    };
    const progressService = { emit: jest.fn() };
    const repository = {
        findByDocumentId: jest.fn().mockResolvedValue(localDocument),
    };
    const assignmentGuard = {
        assertAssignedClient: jest.fn().mockResolvedValue({ scheduleId: 13 }),
    };
    const dispatchBoundary = {
        claim: jest.fn().mockResolvedValue({
            disposition: "claimed",
            intent: { id: "intent-1", branchId: "branch-a" },
        }),
        markAccepted: jest.fn().mockResolvedValue(null),
        markUncertain: jest.fn().mockResolvedValue(null),
        releaseBeforeSend: jest.fn().mockResolvedValue(null),
    };

    return {
        eformsignService,
        headlessService,
        credentialBoundary,
        repository,
        dispatchBoundary,
        usecase: new FinalizeDocumentHeadlessUsecase(
            eformsignService as never,
            headlessService as never,
            credentialBoundary as never,
            progressService as never,
            undefined,
            undefined,
            repository as never,
            assignmentGuard as never,
            dispatchBoundary as never,
        ),
    };
}

describe("FinalizeDocumentHeadlessUsecase ownership boundary", () => {
    it("refuses a provider id that has no current branch-owned local row", async () => {
        const { usecase, credentialBoundary, headlessService, eformsignService } = buildUsecase(null);

        await expect(usecase.execute({
            branchId: "branch-a",
            documentId: "provider-doc-1",
        }, TEST_PRINCIPAL)).resolves.toMatchObject({
            ok: false,
            reason: "authorization_denied",
            fallbackHint: "manual_check",
        });
        expect(credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(eformsignService.generateStaffCompletionOptions).not.toHaveBeenCalled();
        expect(headlessService.dispatchFinalize).not.toHaveBeenCalled();
    });

    it("proves local assignment before server-owned provider access", async () => {
        const {
            usecase,
            repository,
            credentialBoundary,
            eformsignService,
            headlessService,
            dispatchBoundary,
        } = buildUsecase(document);

        await expect(usecase.execute({
            branchId: "branch-a",
            documentId: "provider-doc-1",
        }, TEST_PRINCIPAL)).resolves.toMatchObject({ ok: true, completed: true });

        expect(repository.findByDocumentId).toHaveBeenCalledWith("branch-a", "provider-doc-1");
        expect(credentialBoundary.withCredentials).toHaveBeenCalledTimes(1);
        expect(eformsignService.generateStaffCompletionOptions).toHaveBeenCalledWith(
            "provider-doc-1",
            "server-access",
            "server-refresh",
            undefined,
        );
        expect(headlessService.dispatchFinalize).toHaveBeenCalledTimes(1);
        expect(dispatchBoundary.claim).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-a",
            localDocumentId: 42,
            assignmentId: 13,
            action: "finalize",
        }));
    });

    it.each([
        ["terminal", { statusType: "050" }],
        ["expired", { expired: true }],
        ["unsupported document kind", { documentKind: "legacy" }],
        ["stale assignment", { employeeScheduleId: 99 }],
        ["unassigned scheduled row", { clientId: null, employeeScheduleId: 13 }],
        ["unassigned row", { clientId: null, employeeScheduleId: null }],
    ])("refuses a %s lifecycle target before provider access", async (_label, overrides) => {
        const { usecase, credentialBoundary, headlessService, eformsignService, dispatchBoundary } =
            buildUsecase({ ...document, ...overrides });

        await expect(usecase.execute({
            branchId: "branch-a",
            documentId: "provider-doc-1",
        }, TEST_PRINCIPAL)).resolves.toMatchObject({
            ok: false,
            reason: "authorization_denied",
            fallbackHint: "manual_check",
        });
        expect(credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(eformsignService.generateStaffCompletionOptions).not.toHaveBeenCalled();
        expect(headlessService.dispatchFinalize).not.toHaveBeenCalled();
        expect(dispatchBoundary.claim).not.toHaveBeenCalled();
    });
});
