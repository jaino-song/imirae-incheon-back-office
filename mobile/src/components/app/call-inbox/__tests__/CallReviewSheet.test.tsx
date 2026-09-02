import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CallReviewSheet } from "../CallReviewSheet";
import { transcriptTurnId } from "../TranscriptView";
import { NEUTRAL_SPEAKER } from "@/lib/call-inbox/types";

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

  describe("input rules", () => {
    // The extraction returns bare digits; the reviewer sees, and types, the
    // punctuated form. The three ISO dates are typed rather than picked, so
    // they are text inputs — birthday is YYMMDD and stays untouched.
    const rawDetail = {
      ...baseDetail,
      proposals: [
        { field: "phone", value: "01012345678", evidence: "발신 번호", confidence: "high" as const },
        { field: "dueDate", value: "20260715", evidence: "예정일", confidence: "high" as const },
        { field: "birthday", value: "990315", evidence: "생년월일", confidence: "high" as const },
      ],
    };

    it("punctuates the phone number and the ISO dates it was handed", () => {
      mockUseClientDraft.mockReturnValue({ data: rawDetail, isLoading: false });
      render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

      expect(screen.getByRole("textbox", { name: /연락처/i })).toHaveValue("010-1234-5678");
      expect(screen.getByLabelText(/출산예정일/i)).toHaveValue("2026-07-15");
      // YYMMDD, not ISO — left exactly as extracted.
      expect(screen.getByLabelText(/생년월일/i)).toHaveValue("990315");
    });

    it("takes dates from the keyboard instead of a native picker", () => {
      render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

      for (const label of [/출산예정일/i, /시작일/i, /종료일/i]) {
        expect(screen.getByLabelText(label)).toHaveAttribute("type", "text");
      }
    });

    it("inserts the dashes as a date is typed", async () => {
      const user = userEvent.setup();
      render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

      const endDate = screen.getByLabelText(/종료일/i);
      await user.type(endDate, "20261231");
      expect(endDate).toHaveValue("2026-12-31");
    });

    it("inserts the dashes as a phone number is typed", async () => {
      const user = userEvent.setup();
      render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

      const phone = screen.getByRole("textbox", { name: /연락처/i });
      await user.clear(phone);
      await user.type(phone, "01099998888");
      expect(phone).toHaveValue("010-9999-8888");
    });

    it("keeps 출산일 separate from 출산예정일", async () => {
      // A "아기 낳았어요" call fills in the actual delivery date; the due date
      // it replaces stays put. They are different columns on the client.
      mockUseClientDraft.mockReturnValue({
        data: {
          ...baseDetail,
          proposals: [
            { field: "dueDate", value: "20260915", evidence: "예정일", confidence: "high" as const },
            { field: "birthDate", value: "20260805", evidence: "지난주에 낳았어요", confidence: "high" as const },
          ],
        },
        isLoading: false,
      });
      render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

      expect(screen.getByLabelText(/출산일/i)).toHaveValue("2026-08-05");
      expect(screen.getByLabelText(/출산예정일/i)).toHaveValue("2026-09-15");
    });

    it("sends 출산일 through on confirm", async () => {
      const user = userEvent.setup();
      render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

      await user.type(screen.getByLabelText(/출산일/i), "20260806");
      await user.click(screen.getByRole("button", { name: "고객 등록" }));

      expect(mockConfirmMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.objectContaining({ birthDate: "2026-08-06" }),
        }),
      );
    });

    it("names the service fields the way the registration wizard does", () => {
      render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

      expect(screen.getByText("서비스 기간")).toBeInTheDocument();
      expect(screen.getByText("조리원 이용")).toBeInTheDocument();
      expect(screen.getByText("바우처 고객")).toBeInTheDocument();
      expect(screen.getByText("유축기 대여")).toBeInTheDocument();
    });
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

// --------------------------------------------------------------------------
// Role-less transcripts (design spec §4.3 — diarization unavailable past the
// 30-minute limit). None of these utterances carry a known role; the renderer
// must fall back to unattributed instead of guessing a staff/customer side,
// and evidence citations must still resolve because they match on text, not role.
// --------------------------------------------------------------------------

describe("CallReviewSheet — role-less transcript", () => {
  const roleLessDetail = {
    ...baseDetail,
    proposals: [
      { field: "name", value: "김서연", evidence: "김서연이라고 해요", confidence: "high" as const },
    ],
    callRecord: {
      ...baseDetail.callRecord,
      transcript: [
        { speaker: NEUTRAL_SPEAKER, text: "안녕하세요 문의드립니다" },
        { speaker: NEUTRAL_SPEAKER, text: "김서연이라고 해요" },
        { speaker: "화자 3", text: "네 확인해드릴게요" },
        { speaker: "", text: "감사합니다" },
      ],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseClientDraft.mockReturnValue({ data: roleLessDetail, isLoading: false });
    mockConfirmMutateAsync.mockResolvedValue({ clientId: 42 });
  });

  it("renders every role-less utterance as unattributed — no staff/customer side or color", () => {
    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    for (const text of [
      "안녕하세요 문의드립니다",
      "김서연이라고 해요",
      "네 확인해드릴게요",
      "감사합니다",
    ]) {
      const turn = screen.getByText(text);
      expect(turn.className).toMatch(/self-center/);
      expect(turn.className).not.toMatch(/self-start/);
      expect(turn.className).not.toMatch(/self-end/);
      expect(turn.className).not.toMatch(/bg-gray-200/);
      expect(turn.className).not.toMatch(/bg-blue-100/);
    }
  });

  it("resolves an evidence citation to the right utterance and scrolls to it, even though no speaker carries a role", async () => {
    const user = userEvent.setup();
    render(<CallReviewSheet draftId="draft-1" onClose={jest.fn()} />);

    const chip = screen.getByRole("button", { name: /김서연이라고 해요/ });
    await user.click(chip);

    // "김서연이라고 해요" is the second turn (index 1) in roleLessDetail's transcript.
    const highlightedTurn = document.getElementById(transcriptTurnId(1));
    expect(highlightedTurn?.className).toMatch(/ring-2 ring-amber-400/);

    // Neighboring role-less turns are untouched.
    expect(document.getElementById(transcriptTurnId(0))?.className).not.toMatch(/ring-2/);
    expect(document.getElementById(transcriptTurnId(2))?.className).not.toMatch(/ring-2/);
  });
});
