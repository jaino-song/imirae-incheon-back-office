import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { MessagesPermissionGuard } from "../MessagesPermissionGuard";
import { settingsApi } from "@/services/api";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockPathname = "/messages/new";

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getMessageSenderApproval: jest.fn(),
  },
}));

const mockGetMessageSenderApproval = settingsApi.getMessageSenderApproval as jest.Mock;

function renderGuard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MessagesPermissionGuard>
        <div data-component="messages-route-child" data-testid="messages-route-child">
          child
        </div>
      </MessagesPermissionGuard>
    </QueryClientProvider>,
  );
}

describe("MessagesPermissionGuard", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
    mockPathname = "/messages/templates";
    mockGetMessageSenderApproval.mockReset();
    mockGetMessageSenderApproval.mockResolvedValue({
      approvalStatus: "not_requested",
      isApproved: false,
      canRequest: true,
      requestedAt: null,
      approvedAt: null,
    });
  });

  it("shows the approval modal for /messages child routes without message permission", async () => {
    mockPathname = "/messages/templates";

    renderGuard();

    expect(await screen.findByText("메시지 전송 권한이 필요합니다.")).toBeInTheDocument();
    expect(screen.getByText("문자 발신번호 승인 신청을 완료해야 메시지를 발송할 수 있습니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "신청하기" }));

    expect(mockPush).toHaveBeenCalledWith("/messages/settings");
  });

  it("hides the protected message page while checking sender approval", async () => {
    const pendingApproval = {
      approvalStatus: "not_requested" as const,
      isApproved: false,
      canRequest: true,
      requestedAt: null,
      approvedAt: null,
    };
    let resolveApproval: (value: typeof pendingApproval) => void = () => undefined;
    mockGetMessageSenderApproval.mockReturnValue(
      new Promise<typeof pendingApproval>((resolve) => {
        resolveApproval = resolve;
      }),
    );

    renderGuard();

    expect(await screen.findByRole("status")).toHaveTextContent("메시지 권한 확인 중...");
    expect(screen.queryByTestId("messages-route-child")).not.toBeInTheDocument();

    resolveApproval(pendingApproval);

    expect(await screen.findByText("메시지 전송 권한이 필요합니다.")).toBeInTheDocument();
    expect(screen.getByTestId("messages-route-child")).toBeInTheDocument();
  });

  it("allows /messages/new without approval and keeps the approval modal closed", async () => {
    mockPathname = "/messages/new";

    renderGuard();

    expect(await screen.findByTestId("messages-route-child")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetMessageSenderApproval).toHaveBeenCalled();
    });
    expect(screen.queryByText("메시지 전송 권한이 필요합니다.")).not.toBeInTheDocument();
  });

  it("routes to /all when the approval modal cancel button is clicked", async () => {
    renderGuard();

    expect(await screen.findByText("메시지 전송 권한이 필요합니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(mockReplace).toHaveBeenCalledWith("/all");
  });

  it("keeps the approval modal open when the backdrop is clicked", async () => {
    renderGuard();

    expect(await screen.findByText("메시지 전송 권한이 필요합니다.")).toBeInTheDocument();

    const backdrop = document.querySelector(
      '[data-component="mobile_messages_sender-approval-modal_overlay"]',
    );
    expect(backdrop).toBeInTheDocument();

    fireEvent.pointerDown(backdrop as Element);
    fireEvent.click(backdrop as Element);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText("메시지 전송 권한이 필요합니다.")).toBeInTheDocument();
  });

  it("shows the permission-only modal when the account cannot request message approval", async () => {
    mockGetMessageSenderApproval.mockResolvedValue({
      approvalStatus: "not_requested",
      isApproved: false,
      canRequest: false,
      requestedAt: null,
      approvedAt: null,
    });

    renderGuard();

    expect(await screen.findByText("지점장 또는 매니저 권한이 필요합니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(mockReplace).toHaveBeenCalledWith("/all");
  });

  it("shows a confirm-only pending modal when message approval is waiting", async () => {
    mockGetMessageSenderApproval.mockResolvedValue({
      approvalStatus: "pending",
      isApproved: false,
      canRequest: true,
      requestedAt: "2026-06-05T00:00:00.000Z",
      approvedAt: null,
    });

    renderGuard();

    expect(await screen.findByText("메시지 발송 신청 승인 대기중 입니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확인" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "신청하기" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(mockReplace).toHaveBeenCalledWith("/all");
  });

  it.each(["/messages/settings", "/messages/sender-approval"])(
    "does not block the settings route %s",
    async (pathname) => {
      mockPathname = pathname;

      renderGuard();

      expect(screen.getByTestId("messages-route-child")).toBeInTheDocument();

      await waitFor(() => {
        expect(mockGetMessageSenderApproval).not.toHaveBeenCalled();
      });
      expect(
        screen.queryByText("메시지 전송 권한이 필요합니다."),
      ).not.toBeInTheDocument();
    },
  );

  it.each(["/messages/scheduled", "/messages/history"])(
    "allows the read-only route %s before sender approval",
    async (pathname) => {
      mockPathname = pathname;

      renderGuard();

      expect(screen.getByTestId("messages-route-child")).toBeInTheDocument();
      await waitFor(() => {
        expect(mockGetMessageSenderApproval).not.toHaveBeenCalled();
      });
      expect(screen.queryByText("메시지 전송 권한이 필요합니다.")).not.toBeInTheDocument();
    },
  );
});
