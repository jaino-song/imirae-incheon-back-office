/**
 * The headless dispatch is allowed to fail — what must never happen is staff
 * being stranded on a dead processing step. These tests drive the real component
 * through a failing dispatch and assert the eformsign editor actually opens,
 * i.e. `openDocument(..., "eformsign_iframe", ...)` is called.
 *
 * Both failure shapes are covered, because they reach the fallback through
 * different branches:
 *   - backend answered `ok:false` + `fallbackHint:"iframe"`  (verdict known)
 *   - the request itself threw, e.g. a client-side timeout   (verdict unknown)
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

const mockOpenDocument = jest.fn();
const mockDispatchHeadless = jest.fn();
const mockGenerateDocument = jest.fn();
const mockAuthenticate = jest.fn();

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock("@/providers/LocaleProvider", () => ({
    useLocale: () => "ko",
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
    useGetAuthUser: () => ({ data: { phone: "010-1234-5678" } }),
}));

jest.mock("@/hooks/useEformsign", () => ({
    useEformsign: () => ({
        isLoaded: true,
        isLoading: false,
        error: null,
        openDocument: mockOpenDocument,
    }),
}));

jest.mock("@/services/api", () => ({
    eformsignApi: {
        authenticate: (...args: unknown[]) => mockAuthenticate(...args),
        dispatchHeadless: (...args: unknown[]) => mockDispatchHeadless(...args),
        generateDocument: (...args: unknown[]) => mockGenerateDocument(...args),
        createDocRecord: jest.fn().mockResolvedValue({}),
        adoptDocument: jest.fn().mockResolvedValue({}),
    },
}));

const idleMutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 42 }), isPending: false });
jest.mock("@/hooks/useClients", () => ({
    useCreateClient: () => idleMutation(),
    useUpdateClient: () => idleMutation(),
    useDeleteClient: () => idleMutation(),
}));

jest.mock("@/hooks/useEmployees", () => ({
    useEmployees: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks", () => ({
    useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
    useVoucherYears: () => ({ data: [2026], isLoading: false }),
    useAreaTemplates: () => ({ data: [], isLoading: false }),
}));

// The SSE channel is orthogonal here; a no-op source keeps the dispatch path
// from touching EventSource, which jsdom does not implement.
jest.mock("@/lib/sse/reconnecting-event-source", () => ({
    createReconnectingEventSource: () => ({ close: jest.fn() }),
}));

const CONTRACT_INFO_STEP_INDEX = 3;

function seedValidContractForm(): void {
    useFormStore.setState({
        clientId: 42,
        isManualEntry: false,
        name: "송진호",
        phone: "010-6621-1878",
        birthday: "960414",
        dueDate: "",
        address: "인천시 강다",
        employeeId: 7,
        employeeName: "김정인",
        employeePhone: "01057871878",
        showEmployee2: false,
        employee2Id: null,
        startDate: "2026-08-05",
        endDate: "2026-08-25",
        paymentDate: "2026-08-05",
        fullPrice: "1000000",
        grant: "800000",
        actualPrice: "200000",
        voucherType: "일반",
        voucherDuration: "15",
        area: "인천",
    });
}

function renderForm() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <ContractCreationForm activeStep={CONTRACT_INFO_STEP_INDEX} onActiveStepChange={jest.fn()} />
        </QueryClientProvider>,
    );
}

async function submitAndExpectIframeOpens() {
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalled(), { timeout: 5000 });
    // The manual re-entry is deferred a tick and then waits 500ms before opening,
    // so give the assertion room rather than racing it.
    await waitFor(() => expect(mockOpenDocument).toHaveBeenCalled(), { timeout: 5000 });

    expect(mockOpenDocument).toHaveBeenCalledWith(
        expect.anything(),
        "eformsign_iframe",
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
}

describe("ContractCreationForm — eformsign iframe fallback on headless failure", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthenticate.mockResolvedValue({ success: true });
        mockGenerateDocument.mockResolvedValue({ document: { id: "tpl-1" }, user_data: {} });
        seedValidContractForm();
    });

    it("opens the embedded iframe when the backend reports a definite failure", async () => {
        mockDispatchHeadless.mockResolvedValue({
            ok: false,
            reason: "Timed out after 100000ms while advancing eformsign creation gates",
            fallbackHint: "iframe",
            failedStep: "client-started",
            durationMs: 100000,
        });

        renderForm();
        await submitAndExpectIframeOpens();

        // The second run must be the manual one — otherwise we would have looped
        // back into another headless attempt instead of opening the editor.
        expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);
        expect(mockGenerateDocument).toHaveBeenCalled();
    });

    it("opens the embedded iframe when the dispatch request itself fails", async () => {
        mockDispatchHeadless.mockRejectedValue(new Error("timeout of 180000ms exceeded"));

        renderForm();
        await submitAndExpectIframeOpens();

        // Outcome is unknown on this path, so staff must still be warned about
        // duplicating a contract that may already have been sent.
        expect(screen.getByText(/전자문서 목록에서 생성 여부를 먼저 확인/)).toBeInTheDocument();
    });
});
