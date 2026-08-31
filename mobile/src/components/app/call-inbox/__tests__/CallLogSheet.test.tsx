import { render, screen } from "@testing-library/react";

import { CallLogSheet } from "../CallLogSheet";
import { NEUTRAL_SPEAKER } from "@/lib/call-inbox/types";

// --------------------------------------------------------------------------
// Hook mocks
// --------------------------------------------------------------------------

const mockUseCallRecord = jest.fn();

jest.mock("@/hooks/useCallInbox", () => ({
  useCallRecord: (...args: unknown[]) => mockUseCallRecord(...args),
}));

// --------------------------------------------------------------------------
// Shared fixture
// --------------------------------------------------------------------------

const baseRecord = {
  id: "rec-1",
  category: "NEW_CONSULTATION" as const,
  processingStatus: "EXTRACTED" as const,
  callerName: "김서연",
  callerPhone: "01048217763",
  fileName: "통화 녹음 김서연.m4a",
  recordedAt: "2026-06-10T05:02:11.000Z",
  createdAt: "2026-06-10T05:02:11.000Z",
  matchedClient: null,
  draft: null,
  summaryLine: null,
  transcript: [
    { speaker: "아이미래로", text: "네, 아이미래로입니다." },
    { speaker: "산모", text: "7월 15일이 예정일이에요" },
  ],
  summary: null,
  driveFileId: "drive-1",
  driveUrl: "https://drive.google.com/file/d/drive-1/view",
  failureReason: null,
};

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("CallLogSheet — transcript speaker rendering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders known staff and customer roles on their expected sides (regression)", () => {
    mockUseCallRecord.mockReturnValue({ data: baseRecord, isLoading: false });
    render(<CallLogSheet recordId="rec-1" />);

    const staffTurn = screen.getByText("네, 아이미래로입니다.");
    expect(staffTurn.className).toMatch(/self-start/);
    expect(staffTurn.className).toMatch(/bg-gray-200/);

    const customerTurn = screen.getByText("7월 15일이 예정일이에요");
    expect(customerTurn.className).toMatch(/self-end/);
    expect(customerTurn.className).toMatch(/bg-blue-100/);
  });

  it("renders a neutral-speaker (화자) transcript as unattributed, not customer-side", () => {
    mockUseCallRecord.mockReturnValue({
      data: {
        ...baseRecord,
        transcript: [{ speaker: NEUTRAL_SPEAKER, text: "30분을 넘긴 장기 상담 내용입니다" }],
      },
      isLoading: false,
    });
    render(<CallLogSheet recordId="rec-1" />);

    const turn = screen.getByText("30분을 넘긴 장기 상담 내용입니다");
    expect(turn.className).toMatch(/self-center/);
    expect(turn.className).not.toMatch(/self-start/);
    expect(turn.className).not.toMatch(/self-end/);
    expect(turn.className).not.toMatch(/bg-gray-200/);
    expect(turn.className).not.toMatch(/bg-blue-100/);
  });

  it("falls back unknown and empty speakers to unattributed, never to the customer side", () => {
    mockUseCallRecord.mockReturnValue({
      data: {
        ...baseRecord,
        transcript: [
          { speaker: "화자 1", text: "알 수 없는 화자 발화입니다" },
          { speaker: "", text: "빈 화자 발화입니다" },
        ],
      },
      isLoading: false,
    });
    render(<CallLogSheet recordId="rec-1" />);

    for (const text of ["알 수 없는 화자 발화입니다", "빈 화자 발화입니다"]) {
      const turn = screen.getByText(text);
      expect(turn.className).toMatch(/self-center/);
      expect(turn.className).not.toMatch(/self-start/);
      expect(turn.className).not.toMatch(/self-end/);
    }
  });
});
