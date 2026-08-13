/**
 * Coverage for the wizard's `initialClient` mode (clients-page "산모 계약서
 * 생성" menu → MaternityContractDialog): the one-time prefill effect at
 * ContractCreationForm.tsx:669-682, the disabled client selector at :1236,
 * and that the pre-existing default (no `initialClient`) client-select path
 * is unaffected.
 *
 * Rendering-based (behavioral), mirroring
 * ContractCreationForm.iframe-fallback.test.tsx rather than the source-string
 * assertions in ContractCreationForm.test.tsx.
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useFormStore } from "@/stores/form-store";
import type { Client } from "@/lib/client/types";
import { ContractCreationForm } from "../ContractCreationForm";

const mockOpenDocument = jest.fn();
const mockDispatchHeadless = jest.fn();
const mockGenerateDocument = jest.fn();
const mockAuthenticate = jest.fn();
const mockCreateClientMutateAsync = jest.fn().mockResolvedValue({ id: 999 });
const mockUpdateClientMutateAsync = jest.fn().mockResolvedValue({});
const mockDeleteClientMutateAsync = jest.fn().mockResolvedValue({});

let mockClients: Client[] = [];

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

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ mutateAsync: mockCreateClientMutateAsync, isPending: false }),
  useUpdateClient: () => ({ mutateAsync: mockUpdateClientMutateAsync, isPending: false }),
  useDeleteClient: () => ({ mutateAsync: mockDeleteClientMutateAsync, isPending: false }),
  // Only used when step 1 (client selector) is actually rendered.
  useAllClients: () => ({ data: mockClients, isLoading: false }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks", () => ({
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
  useVoucherYears: () => ({ data: [2026], isLoading: false }),
  useAreaTemplates: () => ({ data: [], isLoading: false }),
}));

// The SSE channel is orthogonal here; a no-op source keeps the headless
// dispatch path from touching EventSource, which jsdom does not implement.
jest.mock("@/lib/sse/reconnecting-event-source", () => ({
  createReconnectingEventSource: () => ({ close: jest.fn() }),
}));

const CONTRACT_INFO_STEP_INDEX = 3;

const BASE_CLIENT: Client = {
  id: 0,
  name: "",
  birthday: null,
  dueDate: null,
  birthDate: null,
  address: null,
  phone: null,
  primaryEmployee: null,
  secondaryEmployee: null,
  type: null,
  duration: null,
  fullPrice: null,
  grant: null,
  actualPrice: null,
  startDate: null,
  endDate: null,
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: null,
  eDocId: null,
  areaId: null,
  hasSigned: false,
  documentStatus: null,
};

function makeClient(overrides: Partial<Client>): Client {
  return { ...BASE_CLIENT, ...overrides };
}

// Full fixture for the prefill assertions: every field the plan asks for.
const clientA = makeClient({
  id: 101,
  name: "김민지",
  phone: "010-1111-2222",
  birthday: "950101",
  address: "인천시 남동구 123",
  dueDate: "2026-09-01",
  birthDate: "2026-08-20",
  type: "일반",
  duration: 15,
  fullPrice: "1000000",
  grant: "800000",
  actualPrice: "200000",
  startDate: "2026-08-05",
  endDate: "2026-08-26",
  areaId: "Namdonggu",
});

// A second, mostly-empty client for the idempotent-remount case — no
// birthDate/voucher/pricing fields, so any residue from clientA would show.
const clientB = makeClient({
  id: 202,
  name: "이서연",
  phone: "010-3333-4444",
  birthday: "970202",
  address: "인천시 서구 456",
  dueDate: "2026-10-10",
  areaId: "Seogu",
});

// Used only for the default-mode (no initialClient) regression case.
const clientC = makeClient({
  id: 303,
  name: "박지영",
  phone: "010-5555-6666",
  startDate: "2026-08-10",
});

function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function seedValidContract(overrides: Partial<ReturnType<typeof useFormStore.getState>> = {}) {
  useFormStore.setState({
    clientId: 42,
    name: "송진호",
    phone: "010-6621-1878",
    birthday: "960414",
    dueDate: "",
    birthDate: "",
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
    ...overrides,
  });
}

describe("ContractCreationForm — initialClient mode", () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    }

    global.ResizeObserver = ResizeObserverMock;
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ success: true });
    mockGenerateDocument.mockResolvedValue({ document: { id: "tpl-1" }, user_data: {} });
    mockClients = [];
    useFormStore.getState().resetAll();
  });

  it("prefills step-1 fields and area in the store, leaving paymentDate empty despite startDate", () => {
    renderWithProviders(<ContractCreationForm initialClient={clientA} />);

    const state = useFormStore.getState();
    expect(state.name).toBe(clientA.name);
    expect(state.phone).toBe(clientA.phone);
    expect(state.birthday).toBe(clientA.birthday);
    expect(state.address).toBe(clientA.address);
    expect(state.dueDate).toBe(clientA.dueDate);
    expect(state.birthDate).toBe(clientA.birthDate);
    expect(state.area).toBe(clientA.areaId);

    // Rest of the fixture also lands in the store via the normal
    // handleClientSelect path the effect delegates to.
    expect(state.voucherType).toBe(clientA.type);
    expect(state.voucherDuration).toBe(String(clientA.duration));
    expect(state.fullPrice).toBe(clientA.fullPrice);
    expect(state.grant).toBe(clientA.grant);
    expect(state.actualPrice).toBe(clientA.actualPrice);
    expect(state.startDate).toBe(clientA.startDate);
    // endDate is then recomputed by the separate business-day auto-calc
    // effect (unrelated to initialClient), so we only assert it's populated
    // rather than pin its exact value to the fixture's raw endDate.
    expect(state.endDate).not.toBe("");

    // The one behavior this feature must guarantee even though startDate is set.
    expect(state.paymentDate).toBe("");

    // Spot-check the rendered DOM reflects the same values.
    expect(screen.getByRole("combobox", { name: "산모님 성함" })).toHaveTextContent(clientA.name);
    expect(screen.getByLabelText("출산일")).toHaveValue("260820");
  });

  it("disables the client selector trigger when initialClient is provided", () => {
    renderWithProviders(<ContractCreationForm initialClient={clientA} />);

    const trigger = screen.getByRole("combobox", { name: "산모님 성함" });
    expect(trigger).toBeDisabled();
  });

  it("still auto-sets paymentDate to the selected client's startDate without initialClient (contracts-page regression guard)", () => {
    mockClients = [clientC];
    renderWithProviders(<ContractCreationForm />);

    const trigger = screen.getByRole("combobox", { name: "산모님 성함" });
    expect(trigger).not.toBeDisabled();

    fireEvent.click(trigger);
    fireEvent.change(screen.getByPlaceholderText("새로 입력 또는 기존 고객 선택"), {
      target: { value: clientC.name },
    });
    // The client's name now also matches in the trigger button itself (the
    // inline manual-value mirrors the typed query), so scope to the option row.
    fireEvent.click(screen.getByText(clientC.name, { selector: "span.font-medium" }));

    expect(useFormStore.getState().paymentDate).toBe(clientC.startDate);
  });

  it("re-applies cleanly for a different initialClient after unmount+remount, with no residue from the previous client", () => {
    const { unmount } = renderWithProviders(<ContractCreationForm initialClient={clientA} />);
    expect(useFormStore.getState().birthDate).toBe(clientA.birthDate);
    expect(useFormStore.getState().area).toBe(clientA.areaId);
    unmount();

    renderWithProviders(<ContractCreationForm initialClient={clientB} />);

    const state = useFormStore.getState();
    expect(state.name).toBe(clientB.name);
    expect(state.area).toBe(clientB.areaId);
    // clientB has no birthDate — a leftover from clientA would fail this.
    expect(state.birthDate).toBe("");
    expect(state.voucherType).toBe("");
    expect(state.fullPrice).toBe("");
    expect(state.paymentDate).toBe("");
  });

  it("carries a typed YYMMDD 출산일 through to the update-client mutation as an ISO birthDate", async () => {
    seedValidContract({ birthDate: "" });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onActiveStepChange = jest.fn();
    function Wrapper({ activeStep }: { activeStep: number }) {
      return (
        <QueryClientProvider client={queryClient}>
          <ContractCreationForm activeStep={activeStep} onActiveStepChange={onActiveStepChange} />
        </QueryClientProvider>
      );
    }

    const { rerender } = render(<Wrapper activeStep={0} />);

    // 출산일 (delivery date) is a near-term date, so the YYMMDD input's "YY"
    // maps to 20YY (see parseYymmddInputToIso) — "26" -> 2026, not 1926.
    fireEvent.change(screen.getByLabelText("출산일"), { target: { value: "260805" } });
    expect(screen.getByLabelText("출산일")).toHaveValue("260805");

    // Same component instance (same key/position) — local birthDateInput
    // state survives the step jump, exactly like the wizard's own stepper.
    rerender(<Wrapper activeStep={CONTRACT_INFO_STEP_INDEX} />);

    mockDispatchHeadless.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(mockUpdateClientMutateAsync).toHaveBeenCalled());
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 42,
        dto: expect.objectContaining({ birthDate: "2026-08-05" }),
      }),
    );
  });

  it("sends null when an existing client's 출산일 is explicitly cleared", async () => {
    seedValidContract({ birthDate: "2026-08-05" });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ContractCreationForm activeStep={0} onActiveStepChange={jest.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("출산일"), { target: { value: "" } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <ContractCreationForm activeStep={CONTRACT_INFO_STEP_INDEX} onActiveStepChange={jest.fn()} />
      </QueryClientProvider>,
    );
    mockDispatchHeadless.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(mockUpdateClientMutateAsync).toHaveBeenCalled());
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ dto: expect.objectContaining({ birthDate: null }) }),
    );
  });

  it("signals onSubmissionStateChange(true) then (false) around a contract-creation run", async () => {
    seedValidContract();
    mockDispatchHeadless.mockResolvedValue({ ok: true });
    const onSubmissionStateChange = jest.fn();

    renderWithProviders(
      <ContractCreationForm
        activeStep={CONTRACT_INFO_STEP_INDEX}
        onActiveStepChange={jest.fn()}
        onSubmissionStateChange={onSubmissionStateChange}
      />,
    );

    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    expect(onSubmissionStateChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(onSubmissionStateChange).toHaveBeenLastCalledWith(false));
    expect(onSubmissionStateChange.mock.calls[0]).toEqual([true]);
  });

  it("signals onSubmissionStateChange(false) even when the headless dispatch rejects", async () => {
    seedValidContract();
    mockDispatchHeadless.mockRejectedValue(new Error("timeout of 180000ms exceeded"));
    const onSubmissionStateChange = jest.fn();

    renderWithProviders(
      <ContractCreationForm
        activeStep={CONTRACT_INFO_STEP_INDEX}
        onActiveStepChange={jest.fn()}
        onSubmissionStateChange={onSubmissionStateChange}
      />,
    );

    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    expect(onSubmissionStateChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(onSubmissionStateChange).toHaveBeenLastCalledWith(false));
  });
});
