import { fireEvent, render, screen } from "@testing-library/react";

import GlobalError from "./global-error";

describe("mobile global error boundary", () => {
  it("keeps the existing ErrorFallback recovery action safe and user-facing", () => {
    const reset = jest.fn();

    render(
      <GlobalError error={new Error("secret mobile detail")} reset={reset} />,
    );

    expect(
      document.querySelector('[data-component="mobile_error_fallback_container"]'),
    ).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "다시 시도" });
    expect(retry).toHaveAttribute(
      "data-component",
      "mobile_error_fallback_container_card_retry",
    );
    expect(retry).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
    expect(screen.queryByText("secret mobile detail")).not.toBeInTheDocument();

    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(reset).toHaveBeenCalledTimes(2);
  });
});
