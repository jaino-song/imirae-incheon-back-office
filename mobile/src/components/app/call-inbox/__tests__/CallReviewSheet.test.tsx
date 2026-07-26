import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CallReviewSheet } from "../CallReviewSheet";

// scrollIntoView is not implemented in jsdom
beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

// --------------------------------------------------------------------------
// Hook mocks
// --------------------------------------------------------------------------

const mockConfirmMutateAsync = jest.fn();
const mockDiscardMutateAsync = jest.fn();
const mockPatchMutate = jest.fn();
const mockUseClientDraft = jest.fn();

jest.mock("@/hooks/useCallInbox", () => ({
  useClientDraft: (...args: unknown[]) => mockUseClientDraft(...args),
  useConfirmDraft: () => ({
    mutateAsync: mockConfirmMutateAsync,
    isPending: false,
  }),
  useDiscardDraft: () => ({
    mutateAsync: mockDiscardMutateAsync,
    isPending: false,
  }),
  usePatchDraft: () => ({
    mutate: mockPatchMutate,
    mutateAsync: jest.fn(),
    isPending: false,
  }),
  // Unused by CallReviewSheet but keep the module consistent
  useClientDrafts: jest.fn(),
  useCallRecords: jest.fn(),
  usePendingDraftCount: jest.fn(),
  useCallRecord: jest.fn(),
}));

jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: () => <div data-testid="client-autocomplete-stub" />,
}));

// toast is a side-effect only; mock to suppress DOM noise
jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}));

// --------------------------------------------------------------------------
// Shared fixture
// --------------------------------------------------------------------------

const baseDetail = {
  id: "draft-1",
  type: "NEW_CLIENT" as const,
  status: "PENDING" as const,
  clientId: null,
  callRecordId: "rec-1",
  requestSummary: "산후도우미 신규 문의",
  extractionMeta: { model: "gemini-2.5-flash", promptVersion: "v1" },
  proposals: [
    { field: "name", value: "김서연", evidence: "김서연이요", confidence: "high" as const },
    {
      field: "dueDate",
      value: "2026-07-15",
      evidence: "7월 15일이 예정일이에요",
      confidence: "high" as const,
    },
    {
      field: "address",
      value: "인천 부평구",
      evidence: "부평구청 근처 살아요",
      confidence: "low" as const,
    },
  ],
  callRecord: {
    id: "rec-1",
    driveFileId: "drive-1",
    fileName: "통화 녹음 김서연.m4a",
    recordedAt: "2026-06-10T05:02:11.000Z",
    createdAt: "2026-06-10T05:02:11.000Z",
    transcript: [
      { speaker: "아이미래로", text: "네, 아이미래로입니다." },
      { speaker: "산모", text: "7월 15일이 예정일이에요" },
    ],
    summary: null,
    category: "NEW_CONSULTATION" as const,
    callerName: "김서연",
    callerPhone: "01048217763",
    matchedClient: null,
  },
  client: null,
  reviewedBy: null,
  reviewedAt: null,
  discardReason: null,
  createdAt: "2026-06-10T05:10:00.000Z",
};

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("CallReviewSheet — NEW_CLIENT PENDING", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseClientDraft.mockReturnValue({ data: baseDetail, isLoading: false });
    mockConfirmMutateAsync.mockResolvedValue({ clientId: 42 });
  });

  it("pre-fills form inputs from proposals and seeds phone from callerPhone", () => {
    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    // name input filled from proposals
    const nameInput = screen.getByRole("textbox", { name: /산모명/i });
    expect(nameInput).toHaveValue("김서연");

    // dueDate input filled from proposals
    const dueDateInput = screen.getByLabelText(/출산예정일/i);
    expect(dueDateInput).toHaveValue("2026-07-15");

    // phone seeded from callerPhone (formatPhoneNumber converts raw to 010-4821-7763)
    const phoneInput = screen.getByRole("textbox", { name: /연락처/i });
    expect(phoneInput).toHaveValue("010-4821-7763");
  });

  it("renders evidence chips for proposals that have evidence", () => {
    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    // dueDate evidence text rendered in EvidenceChip (also appears in transcript turn,
    // so we scope to the chip's data-component attribute)
    const chips = document.querySelectorAll("[data-component='mobile_call-inbox_detail-sheet_stack_detail-page_review_evidence-chip']");
    const chipTexts = Array.from(chips).map((el) => el.textContent ?? "");
    expect(chipTexts.some((t) => t.includes("7월 15일이 예정일이에요"))).toBe(true);
  });

  it("marks the low-confidence address field with amber border class", () => {
    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    const addressInput = screen.getByLabelText(/주소/i);
    // Low-confidence inputs receive border-amber-400 className
    expect(addressInput.className).toMatch(/amber/);
  });

  it("calls confirmDraft.mutateAsync with name and suppressGreetingSms:false on 고객 등록", async () => {
    const user = userEvent.setup();
    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    const confirmBtn = screen.getByRole("button", { name: /고객 등록/i });
    await user.click(confirmBtn);

    expect(mockConfirmMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({ name: "김서연" }),
        suppressGreetingSms: false,
      }),
    );
  });
});

describe("CallReviewSheet — CLIENT_UPDATE PENDING", () => {
  const updateDetail = {
    ...baseDetail,
    type: "CLIENT_UPDATE" as const,
    clientId: 7,
    client: { id: 7, name: "박지영", phone: "01099998888" },
    proposals: [
      {
        field: "startDate",
        value: "2026-07-20",
        currentValue: "2026-06-01",
        evidence: "7월 20일부터 시작하고 싶어요",
        confidence: "high" as const,
      },
      {
        field: "endDate",
        value: "2026-08-20",
        currentValue: null,
        evidence: "8월 20일까지요",
        confidence: "high" as const,
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseClientDraft.mockReturnValue({ data: updateDetail, isLoading: false });
    mockConfirmMutateAsync.mockResolvedValue({ clientId: 7 });
  });

  it("does NOT render Phase 2 notice", () => {
    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    expect(screen.queryByText(/Phase 2에서 제공/i)).not.toBeInTheDocument();
  });

  it("enables 변경 적용 button when client is linked and proposals exist", () => {
    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    const applyBtn = screen.getByRole("button", { name: /변경 적용/i });
    expect(applyBtn).not.toBeDisabled();
  });

  it("enables the 폐기 button for a pending CLIENT_UPDATE draft", () => {
    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    const discardBtn = screen.getByRole("button", { name: /^폐기$/i });
    expect(discardBtn).not.toBeDisabled();
  });

  it("calls confirmDraft with only included changes and excludes toggled-off row", async () => {
    const user = userEvent.setup();
    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    // Find the include toggles for each diff row — they are Switch components
    // with aria-label matching the field label
    const endDateToggle = screen.getByRole("switch", { name: /종료일 포함/i });
    await user.click(endDateToggle);

    const applyBtn = screen.getByRole("button", { name: /변경 적용/i });
    await user.click(applyBtn);

    expect(mockConfirmMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.not.objectContaining({ endDate: expect.anything() }),
      }),
    );
    expect(mockConfirmMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ startDate: "2026-07-20" }),
      }),
    );
  });

  it("disables 변경 적용 button when client is not linked", () => {
    mockUseClientDraft.mockReturnValue({
      data: { ...updateDetail, clientId: null, client: null },
      isLoading: false,
    });

    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    const applyBtn = screen.getByRole("button", { name: /변경 적용/i });
    expect(applyBtn).toBeDisabled();
  });
});

describe("CallReviewSheet — non-PENDING (CONFIRMED)", () => {
  const confirmedDetail = {
    ...baseDetail,
    status: "CONFIRMED" as const,
    reviewedBy: { name: "홍길동" },
    reviewedAt: "2026-06-10T06:00:00.000Z",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseClientDraft.mockReturnValue({ data: confirmedDetail, isLoading: false });
  });

  it("shows the read-only banner and hides action buttons", () => {
    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    // ReadOnlyBanner rendered with label "검토 완료"
    expect(
      screen.getByText(/검토 완료/, { selector: "[data-component='mobile_call-inbox_detail-sheet_stack_detail-page_review_readonly-banner']" }),
    ).toBeInTheDocument();

    // No action buttons (고객 등록 / 폐기) for a CONFIRMED draft
    expect(screen.queryByRole("button", { name: /고객 등록/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^폐기$/i })).not.toBeInTheDocument();
  });
});
