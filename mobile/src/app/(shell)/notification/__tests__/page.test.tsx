import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import NotificationPage from "../page";

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
  useToast: () => ({ toast: jest.fn() }),
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
});
