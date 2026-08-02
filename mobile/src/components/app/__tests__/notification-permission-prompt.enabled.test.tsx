import { act, fireEvent, render, screen } from "@testing-library/react";

import { NotificationPermissionPrompt } from "../notification-permission-prompt";

const mockUsePathname = jest.fn();

jest.mock("@/lib/notification-config", () => ({
  PWA_NOTIFICATIONS_ENABLED: true,
}));

jest.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

describe("NotificationPermissionPrompt when enabled", () => {
  const originalNotification = window.Notification;
  const dismissedAtStorageKey =
    "babyjamjam-mobile:notification-prompt-dismissed-at";
  const dismissalTtlMs = 7 * 24 * 60 * 60 * 1000;
  const now = new Date("2026-07-27T00:00:00.000Z").getTime();

  beforeEach(() => {
    jest.useFakeTimers({ now });
    mockUsePathname.mockReturnValue("/dashboard");
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: jest.fn(),
      },
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    jest.useRealTimers();
    jest.restoreAllMocks();
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: originalNotification,
    });
  });

  function renderPrompt() {
    render(<NotificationPermissionPrompt />);
    act(() => {
      jest.runOnlyPendingTimers();
    });
  }

  it("stores the dismissal timestamp when dismissed", () => {
    renderPrompt();

    fireEvent.click(screen.getByRole("button", { name: "나중에" }));

    expect(window.localStorage.getItem(dismissedAtStorageKey)).toBe(
      String(now),
    );
  });

  it("stays hidden when dismissed within seven days", () => {
    window.localStorage.setItem(
      dismissedAtStorageKey,
      String(now - dismissalTtlMs + 1),
    );

    renderPrompt();

    expect(
      screen.queryByText("알림을 허용하시겠습니까?"),
    ).not.toBeInTheDocument();
  });

  it("shows again seven days after dismissal", () => {
    window.localStorage.setItem(
      dismissedAtStorageKey,
      String(now - dismissalTtlMs),
    );

    renderPrompt();

    expect(
      screen.getByText("알림을 허용하시겠습니까?"),
    ).toBeInTheDocument();
  });

  it("stores a dismissal timestamp when the native prompt remains default", async () => {
    const requestPermission = jest.fn().mockResolvedValue("default");
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission,
      },
    });
    renderPrompt();

    fireEvent.click(screen.getByRole("button", { name: "허용" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(dismissedAtStorageKey)).toBe(String(now));
    expect(
      screen.queryByText("알림을 허용하시겠습니까?"),
    ).not.toBeInTheDocument();
  });

  it.each(["granted", "denied"])(
    "removes a stale dismissal when permission becomes %s",
    (permission) => {
      window.localStorage.setItem(dismissedAtStorageKey, "123");
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: {
          permission,
          requestPermission: jest.fn(),
        },
      });

      renderPrompt();

      expect(window.localStorage.getItem(dismissedAtStorageKey)).toBeNull();
    },
  );
});
