import { fireEvent, render, screen } from "@testing-library/react";

import { useClientAlerts } from "@/hooks/useClientAlerts";
import { useMarkAsRead, useNotifications } from "@/hooks/usePushNotification";

import { SidebarNotifications } from "../SidebarNotifications";

jest.mock("@/hooks/useClientAlerts", () => ({
  useClientAlerts: jest.fn(),
}));

jest.mock("@/hooks/usePushNotification", () => ({
  useMarkAsRead: jest.fn(),
  useNotifications: jest.fn(),
}));

jest.mock("@/components/app/v3/useScrollActivity", () => ({
  useScrollActivity: () => ({
    isScrollActive: false,
    handleScroll: jest.fn(),
  }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const mockedUseClientAlerts = jest.mocked(useClientAlerts);
const mockedUseMarkAsRead = jest.mocked(useMarkAsRead);
const mockedUseNotifications = jest.mocked(useNotifications);

describe("SidebarNotifications loading state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseMarkAsRead.mockReturnValue({ mutate: jest.fn() } as unknown as ReturnType<typeof useMarkAsRead>);
  });

  it("renders notification skeletons instead of the empty state while queries are loading", () => {
    mockedUseClientAlerts.mockReturnValue({ data: [], isLoading: true } as unknown as ReturnType<typeof useClientAlerts>);
    mockedUseNotifications.mockReturnValue({ data: [], isLoading: true } as unknown as ReturnType<typeof useNotifications>);

    const { rerender } = render(<SidebarNotifications />);
    fireEvent.click(screen.getByRole("button", { name: "알림 열기" }));

    expect(screen.queryByText("새 알림이 없습니다")).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-component="desktop_chrome_sidebar_notifications-modal_item"]')).toHaveLength(6);

    mockedUseClientAlerts.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useClientAlerts>);
    mockedUseNotifications.mockReturnValue({
      data: [{
        id: 1,
        title: "계약 알림",
        body: "확인이 필요합니다.",
        data: {},
        sentAt: "2026-08-02T00:00:00.000Z",
        readAt: null,
        isRead: false,
      }],
      isLoading: false,
    } as unknown as ReturnType<typeof useNotifications>);
    rerender(<SidebarNotifications />);

    expect(screen.getByText("계약 알림")).toBeInTheDocument();
  });

  it("wraps a specific notification body without overlapping its time label", () => {
    mockedUseClientAlerts.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useClientAlerts>);
    mockedUseNotifications.mockReturnValue({
      data: [{
        id: 2,
        title: "메시지 전송 실패",
        body: "강하은 관리사님에게 보낸 제공기록지 메시지 전송이 실패했습니다.",
        data: { type: "daily-summary-item", url: "/messages" },
        sentAt: "2026-08-19T00:00:00.000Z",
        readAt: null,
        isRead: false,
      }],
      isLoading: false,
    } as unknown as ReturnType<typeof useNotifications>);

    render(<SidebarNotifications />);
    fireEvent.click(screen.getByRole("button", { name: "알림 열기" }));

    const item = document.querySelector<HTMLElement>(
      '[data-component="desktop_chrome_sidebar_notifications-modal_item"]',
    );
    const subtitle = document.querySelector<HTMLElement>(
      '[data-component="desktop_chrome_sidebar_notifications-modal_item-content-subtitle"] > span',
    );
    const time = document.querySelector<HTMLElement>(
      '[data-component="desktop_chrome_sidebar_notifications-modal_item_time"]',
    );

    expect(item).toHaveClass("h-auto", "min-h-[calc(94px*var(--glint-ui-scale,1))]");
    expect(subtitle).toHaveClass("whitespace-normal", "break-words");
    expect(subtitle).not.toHaveClass("truncate");
    expect(time).not.toHaveClass("absolute");
  });
});
