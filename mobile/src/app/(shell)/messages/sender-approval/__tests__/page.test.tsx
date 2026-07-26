import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import MessageSenderApprovalPage from "../page";
import { settingsApi } from "@/services/api";

const mockReplace = jest.fn();
const mockToast = jest.fn();

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: {
      branchName: "인천점",
    },
  }),
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => null,
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getMessageSenderApproval: jest.fn(),
    requestMessageSenderApproval: jest.fn(),
  },
}));

const mockGetMessageSenderApproval = settingsApi.getMessageSenderApproval as jest.Mock;
const mockRequestMessageSenderApproval = settingsApi.requestMessageSenderApproval as jest.Mock;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MessageSenderApprovalPage />
    </QueryClientProvider>,
  );
}

describe("MessageSenderApprovalPage", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockToast.mockClear();
    mockRequestMessageSenderApproval.mockReset();
    mockGetMessageSenderApproval.mockResolvedValue({
      approvalStatus: "not_requested",
      isApproved: false,
      canRequest: true,
      requestedAt: null,
      approvedAt: null,
    });
    mockRequestMessageSenderApproval.mockResolvedValue({
      approvalStatus: "pending",
      isApproved: false,
      canRequest: true,
      requestedAt: "2026-06-05T00:00:00.000Z",
      approvedAt: null,
    });
  });

  it("shows the settings section navigation without a back button", () => {
    const { container } = renderPage();
    const listCard = container.querySelector('[data-component="mobile_messages_sender-approval_page_screen_content_scroll_list-card"]');

    expect(screen.getByRole("button", { name: "설정" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("메시지 설정")).toHaveClass("list-title-text");
    expect(listCard).toContainElement(
      container.querySelector('[data-component="mobile_messages_sender-approval_page_screen_content_scroll_list-card_body"]'),
    );
    expect(screen.queryByRole("button", { name: "메시지 목록으로 돌아가기" }))
      .not.toBeInTheDocument();
  });

  it("shows a completion toast and routes to /all after agreeing and submitting", async () => {
    renderPage();

    const termsCheckbox = screen.getByLabelText(/알리고 문자 서비스 이용약관/);

    await waitFor(() => {
      expect(termsCheckbox).not.toBeDisabled();
    });

    fireEvent.click(termsCheckbox);
    fireEvent.click(screen.getByLabelText(/개인정보를 제3자에게 제공/));
    fireEvent.click(screen.getByLabelText(/사전 등록된 번호만 사용할 수 있음/));
    fireEvent.click(screen.getByRole("button", { name: /신청하기/ }));

    await waitFor(() => {
      expect(mockRequestMessageSenderApproval).toHaveBeenCalled();
    });
    expect(mockToast).toHaveBeenCalledWith({ description: "신청이 완료되었습니다." });
    expect(mockReplace).toHaveBeenCalledWith("/all");
  });

  it("blocks the sender approval form with a pending approval modal", async () => {
    mockGetMessageSenderApproval.mockResolvedValue({
      approvalStatus: "pending",
      isApproved: false,
      canRequest: true,
      requestedAt: "2026-06-05T00:00:00.000Z",
      approvedAt: null,
    });

    renderPage();

    expect(await screen.findByText("메시지 발송 신청 승인 대기중 입니다.")).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "확인" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "신청하기" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "확인" }));

    expect(mockReplace).toHaveBeenCalledWith("/all");
  });
});
