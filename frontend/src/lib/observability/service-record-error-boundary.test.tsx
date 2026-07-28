import { render, screen } from "@testing-library/react";

import { ServiceRecordErrorBoundary } from "./service-record-error-boundary";

const captureServiceRecordRenderError = jest.fn();

jest.mock("./capture-api-error", () => ({
  captureServiceRecordRenderError: (error: Error) => captureServiceRecordRenderError(error),
}));

function BrokenServiceRecord(): never {
  throw new Error("render failed");
}

describe("ServiceRecordErrorBoundary", () => {
  it("captures a service-record render error exactly once and shows a retry action", () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ServiceRecordErrorBoundary>
        <BrokenServiceRecord />
      </ServiceRecordErrorBoundary>,
    );

    expect(captureServiceRecordRenderError).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("제공기록지 화면");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
