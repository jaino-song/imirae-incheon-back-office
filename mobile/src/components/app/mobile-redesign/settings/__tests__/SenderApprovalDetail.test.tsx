import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { settingsApi } from "@/services/api";

import { SenderApprovalDetail } from "../SenderApprovalDetail";

const mockReplace = jest.fn();
const mockToast = jest.fn();

beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
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
  useGetAuthUser: () => ({ data: { branchName: "인천점" } }),
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => null,
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getMessageSenderApproval: jest.fn(),
    requestMessageSenderApproval: jest.fn(),
  },
}));

const mockedSettingsApi = jest.mocked(settingsApi);

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SenderApprovalDetail data-component="mobile_messages_settings_sender-approval-detail" />
    </QueryClientProvider>,
  );
}

describe("SenderApprovalDetail", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockToast.mockClear();
    mockedSettingsApi.getMessageSenderApproval.mockReset();
    mockedSettingsApi.requestMessageSenderApproval.mockReset();
    mockedSettingsApi.getMessageSenderApproval.mockResolvedValue({
      approvalStatus: "not_requested",
      isApproved: false,
      canRequest: true,
      requestedAt: null,
      approvedAt: null,
    });
    mockedSettingsApi.requestMessageSenderApproval.mockResolvedValue({
      approvalStatus: "pending",
      isApproved: false,
      canRequest: true,
      requestedAt: "2026-06-05T00:00:00.000Z",
      approvedAt: null,
    });
  });

  it("keeps submit disabled until all three agreements are checked", async () => {
    renderDetail();

    const checkboxes = await screen.findAllByRole("checkbox");
    const submitButton = screen.getByRole("button", { name: "신청하기" });

    expect(checkboxes).toHaveLength(3);
    expect(submitButton).toBeDisabled();
    await waitFor(() => {
      for (const checkbox of checkboxes) expect(checkbox).not.toBeDisabled();
    });

    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    expect(submitButton).toBeDisabled();

    fireEvent.click(checkboxes[2]);
    await waitFor(() => expect(submitButton).toBeEnabled());
  });

  it("shows the unified sender phone copy", async () => {
    renderDetail();

    expect(await screen.findByText("010-9641-1878")).toBeInTheDocument();
    expect(screen.getByText(/모든 메시지는 사전 등록된 대표 발신번호 010-9641-1878/)).toBeInTheDocument();
  });

  it("shows a permission alert when the account cannot request approval", async () => {
    mockedSettingsApi.getMessageSenderApproval.mockResolvedValue({
      approvalStatus: "not_requested",
      isApproved: false,
      canRequest: false,
      requestedAt: null,
      approvedAt: null,
    });

    renderDetail();

    expect(await screen.findByText(/현재 계정은 메시지 발송 기능 신청 권한이 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "신청하기" })).toBeDisabled();
  });

  it("shows the re-request label while approval is pending", async () => {
    mockedSettingsApi.getMessageSenderApproval.mockResolvedValue({
      approvalStatus: "pending",
      isApproved: false,
      canRequest: true,
      requestedAt: "2026-06-05T00:00:00.000Z",
      approvedAt: null,
    });

    renderDetail();

    expect(await screen.findByRole("button", { name: "다시 신청하기" })).toBeDisabled();
    expect(screen.getByText("승인 대기중")).toBeInTheDocument();
  });

  it("requests approval and routes to /all after a successful submit", async () => {
    renderDetail();

    const checkboxes = await screen.findAllByRole("checkbox");
    await waitFor(() => {
      for (const checkbox of checkboxes) expect(checkbox).not.toBeDisabled();
    });
    for (const checkbox of checkboxes) {
      fireEvent.click(checkbox);
    }
    const submitButton = screen.getByRole("button", { name: "신청하기" });
    await waitFor(() => expect(submitButton).toBeEnabled());
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockedSettingsApi.requestMessageSenderApproval).toHaveBeenCalledTimes(1);
    });
    expect(mockToast).toHaveBeenCalledWith({ description: "신청이 완료되었습니다." });
    expect(mockReplace).toHaveBeenCalledWith("/all");
  });
});
