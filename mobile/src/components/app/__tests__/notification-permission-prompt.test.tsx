import { render, screen } from "@testing-library/react";

import { NotificationPermissionPrompt } from "../notification-permission-prompt";

const mockUsePathname = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

describe("NotificationPermissionPrompt", () => {
  const originalNotification = window.Notification;

  beforeEach(() => {
    mockUsePathname.mockReturnValue("/dashboard");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: originalNotification,
    });
  });

  it("does not request or render browser permission UI while PWA notifications are disabled", () => {
    const requestPermission = jest.fn();
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission,
      },
    });

    render(<NotificationPermissionPrompt />);

    expect(screen.queryByText("알림을 허용하시겠습니까?")).not.toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
