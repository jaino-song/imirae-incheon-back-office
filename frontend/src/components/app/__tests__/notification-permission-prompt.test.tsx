import { render, screen } from "@testing-library/react";

import { NotificationPermissionPrompt } from "../notification-permission-prompt";

describe("NotificationPermissionPrompt", () => {
  const originalNotification = window.Notification;

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

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
