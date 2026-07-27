import { act, fireEvent, render, screen } from "@testing-library/react";
import { NotificationPermissionPrompt } from "../notification-permission-prompt";

describe("NotificationPermissionPrompt", () => {
  const originalNotification = window.Notification;
  const dismissedAtStorageKey =
    "babyjamjam-admin:notification-prompt-dismissed-at";
  const dismissalTtlMs = 7 * 24 * 60 * 60 * 1000;

  afterEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: originalNotification,
    });
  });

  it("clears the desktop quick-action rail and exposes a named dialog", async () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: jest.fn(),
      },
    });

    render(<NotificationPermissionPrompt />);

    const prompt = await screen.findByRole("dialog", { name: "알림을 허용하시겠습니까?" });
    expect(prompt).toHaveClass(
      "md:right-[calc(24px+72px*var(--glint-ui-scale,1))]",
    );

    fireEvent.click(screen.getByRole("button", { name: "알림 권한 안내 닫기" }));
    expect(prompt).not.toBeInTheDocument();
  });

  it("persists dismissal and stays hidden when remounted within seven days", async () => {
    const dismissedAt = new Date("2026-07-27T00:00:00.000Z").getTime();
    jest.spyOn(Date, "now").mockReturnValue(dismissedAt);
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: jest.fn(),
      },
    });

    const { unmount } = render(<NotificationPermissionPrompt />);
    await screen.findByRole("dialog", { name: "알림을 허용하시겠습니까?" });

    fireEvent.click(screen.getByRole("button", { name: "나중에" }));
    expect(window.localStorage.getItem(dismissedAtStorageKey)).toBe(
      String(dismissedAt),
    );

    unmount();
    render(<NotificationPermissionPrompt />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.queryByRole("dialog", { name: "알림을 허용하시겠습니까?" }),
    ).not.toBeInTheDocument();
  });

  it("shows again when the persisted dismissal is older than seven days", async () => {
    const now = new Date("2026-07-27T00:00:00.000Z").getTime();
    jest.spyOn(Date, "now").mockReturnValue(now);
    window.localStorage.setItem(
      dismissedAtStorageKey,
      String(now - dismissalTtlMs - 1),
    );
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: jest.fn(),
      },
    });

    render(<NotificationPermissionPrompt />);

    expect(
      await screen.findByRole("dialog", {
        name: "알림을 허용하시겠습니까?",
      }),
    ).toBeInTheDocument();
  });
});
