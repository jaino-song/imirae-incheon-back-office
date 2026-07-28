import { render, screen } from "@testing-library/react";

import { ServiceRecordErrorBoundary } from "./service-record-error-boundary";

const captureServiceRecordError = jest.fn();

jest.mock("./capture-service-record-error", () => ({
  captureServiceRecordError: (...args: unknown[]) => captureServiceRecordError(...args),
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

    expect(captureServiceRecordError).toHaveBeenCalledTimes(1);
    expect(captureServiceRecordError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: "render", method: "RENDER" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("제공기록지 화면");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
