import { fireEvent, render, screen } from "@testing-library/react";

import { ContractReviewActionButton } from "../ContractReviewActionButton";

describe("ContractReviewActionButton", () => {
  it("runs the service-record review action", () => {
    const onFinalize = jest.fn();
    const onPreview = jest.fn();

    render(
      <ContractReviewActionButton
        data-component="desktop_contracts_tests_review-action"
        action="preview"
        onFinalize={onFinalize}
        onPreview={onPreview}
      />,
    );

    const previewButton = screen.getByRole("button", { name: "검토하기" });
    expect(previewButton).toHaveAttribute("data-variant", "positive-outline");
    fireEvent.click(previewButton);

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onFinalize).not.toHaveBeenCalled();
  });

  it("keeps the contract finalization action for maternity contracts", () => {
    const onFinalize = jest.fn();
    const onPreview = jest.fn();

    render(
      <ContractReviewActionButton
        data-component="desktop_contracts_tests_review-action"
        action="finalize"
        onFinalize={onFinalize}
        onPreview={onPreview}
      />,
    );

    const finalizeButton = screen.getByRole("button", { name: "검토 완료 확인" });
    expect(finalizeButton).toHaveAttribute("data-variant", "positive");
    fireEvent.click(finalizeButton);

    expect(onFinalize).toHaveBeenCalledTimes(1);
    expect(onPreview).not.toHaveBeenCalled();
  });
});
