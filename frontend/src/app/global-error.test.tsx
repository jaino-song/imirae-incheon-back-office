import { fireEvent, render, screen } from "@testing-library/react";

import GlobalErrorPage from "./global-error";

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
}));

jest.mock("next/error", () => ({
  __esModule: true,
  default: () => <p>문제를 불러오지 못했습니다.</p>,
}));

describe("global error boundary", () => {
  it("offers an accessible retry action without exposing the error details", () => {
    const reset = jest.fn();

    render(
      <GlobalErrorPage error={new Error("secret global detail")} reset={reset} />,
    );

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-component",
      "desktop_global-error_recovery",
    );
    const retry = screen.getByRole("button", { name: "다시 시도" });
    expect(retry).toHaveAttribute("data-component", "desktop_global-error_recovery_retry");
    expect(retry).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
    expect(screen.queryByText("secret global detail")).not.toBeInTheDocument();

    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(reset).toHaveBeenCalledTimes(2);
  });
});
