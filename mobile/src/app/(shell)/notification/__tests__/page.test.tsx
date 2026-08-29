import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import NotificationPage from "../page";
import { settingsApi } from "@/services/api";

const mockToast = jest.fn();

jest.mock("@/lib/notification-config", () => ({
  NOTIFICATION_EMAIL_ENABLED: true,
  PWA_NOTIFICATIONS_ENABLED: false,
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: {
      id: "user-1",
      email: "owner@example.com",
      role: "owner",
    },
  }),
}));

jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({
    isSupported: true,
    isSubscribed: false,
    permission: "default",
    isLoading: false,
    error: null,
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/components/ui/toaster", () => ({
  Toaster: () => <div data-component="mobile_shell_toaster" />,
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => null,
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn().mockResolvedValue({ data: [] }),
    post: jest.fn().mockResolvedValue({ data: { sent: 0, failed: 0 } }),
  },
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getNotificationPreferences: jest.fn(),
    updateNotificationPreferences: jest.fn(),
  },
}));

const mockedSettingsApi = jest.mocked(settingsApi);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationPage />
    </QueryClientProvider>,
  );
}

describe("NotificationPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedSettingsApi.getNotificationPreferences.mockResolvedValue({
      emailNotificationsEnabled: true,
    });
    mockedSettingsApi.updateNotificationPreferences.mockResolvedValue({
      emailNotificationsEnabled: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders existing notification settings in the compact list card UI", async () => {
    const { container } = renderPage();

    const page = container.querySelector('[data-component="mobile_notification_settings"]');
    expect(page).toBeInTheDocument();
    expect(page).toHaveClass("messages-page");

    expect(screen.getByText("알림 설정")).toBeInTheDocument();
    expect(screen.getByText("수신 채널")).toBeInTheDocument();
    expect(screen.getByText("관리자")).toBeInTheDocument();

    const rows = container.querySelectorAll('[data-slot="notification-settings-row"]');
    expect(rows.length).toBeGreaterThanOrEqual(3);

    expect(within(rows[0] as HTMLElement).getByText("앱 알림")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("이메일 알림")).toBeInTheDocument();
    expect(screen.getByLabelText("앱 알림 설정")).toBeInTheDocument();
    expect(screen.getByLabelText("이메일 알림 설정")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "발송" })).toBeInTheDocument();
  });

  it("reflects the authoritative server preference instead of a stale local value", async () => {
    window.localStorage.setItem("settings:email-notifications:user-1", "false");
    mockedSettingsApi.getNotificationPreferences.mockResolvedValueOnce({
      emailNotificationsEnabled: true,
    });

    renderPage();

    const emailSwitch = await screen.findByRole("switch", { name: "이메일 알림 설정" });
    await waitFor(() => expect(emailSwitch).toHaveAttribute("aria-checked", "true"));

    expect(mockedSettingsApi.getNotificationPreferences).toHaveBeenCalledTimes(1);
  });

  it("keeps the email switch disabled while the server preference is loading", async () => {
    let resolvePreferences: (value: { emailNotificationsEnabled: boolean }) => void = () => undefined;
    mockedSettingsApi.getNotificationPreferences.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreferences = resolve;
      }),
    );

    renderPage();

    const emailSwitch = screen.getByRole("switch", { name: "이메일 알림 설정" });
    expect(emailSwitch).toBeDisabled();
    expect(screen.getByText("이메일 알림 설정을 불러오는 중입니다.")).toBeInTheDocument();

    resolvePreferences({ emailNotificationsEnabled: true });
    await waitFor(() => expect(emailSwitch).toHaveAttribute("aria-checked", "true"));
  });

  it("fails closed when the server preference cannot be loaded", async () => {
    mockedSettingsApi.getNotificationPreferences.mockRejectedValueOnce(new Error("load failed"));

    renderPage();

    const emailSwitch = await screen.findByRole("switch", { name: "이메일 알림 설정" });
    await waitFor(() => {
      expect(emailSwitch).toBeDisabled();
      expect(emailSwitch).toHaveAttribute("aria-checked", "false");
    });
    expect(screen.getByText("이메일 알림 설정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
    expect(mockedSettingsApi.updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("sends the requested boolean and keeps the saved response as the rendered state", async () => {
    mockedSettingsApi.getNotificationPreferences.mockResolvedValueOnce({
      emailNotificationsEnabled: true,
    });
    mockedSettingsApi.updateNotificationPreferences.mockResolvedValueOnce({
      emailNotificationsEnabled: false,
    });

    renderPage();

    const emailSwitch = await screen.findByRole("switch", { name: "이메일 알림 설정" });
    await waitFor(() => expect(emailSwitch).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(emailSwitch);

    await waitFor(() => {
      expect(mockedSettingsApi.updateNotificationPreferences.mock.calls[0]?.[0]).toBe(false);
      expect(emailSwitch).toHaveAttribute("aria-checked", "false");
    });
    expect(window.localStorage.getItem("settings:email-notifications:user-1")).toBeNull();
  });

  it("disables the switch while saving and preserves the previous value after a failed save", async () => {
    let rejectUpdate: (reason?: unknown) => void = () => undefined;
    mockedSettingsApi.updateNotificationPreferences.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );

    renderPage();

    const emailSwitch = await screen.findByRole("switch", { name: "이메일 알림 설정" });
    await waitFor(() => expect(emailSwitch).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(emailSwitch);

    await waitFor(() => expect(emailSwitch).toBeDisabled());
    rejectUpdate(new Error("save failed"));
    await waitFor(() => {
      expect(emailSwitch).toHaveAttribute("aria-checked", "true");
      expect(emailSwitch).not.toBeDisabled();
    });
    expect(screen.getByText("이메일 알림 설정을 저장하지 못했어요. 이전 설정을 유지합니다.")).toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith({
      title: "이메일 알림 설정을 저장하지 못했어요",
      description: "이전 설정을 유지합니다",
      variant: "destructive",
    });
  });
});
