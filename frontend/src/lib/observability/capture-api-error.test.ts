const mockScope = {
  setLevel: jest.fn(),
  setTag: jest.fn(),
  setContext: jest.fn(),
  setFingerprint: jest.fn(),
};
const mockCaptureException = jest.fn();
const mockFlush = jest.fn().mockResolvedValue(true);

jest.mock("@sentry/nextjs", () => ({
  withScope: (callback: (scope: typeof mockScope) => void) => callback(mockScope),
  captureException: (error: unknown) => mockCaptureException(error),
  flush: (timeout: number) => mockFlush(timeout),
}));

import {
  captureAndFlushApiError,
  captureApiError,
} from "./capture-api-error";

function createAxiosError(options: {
  status?: number;
  code?: string;
  method?: string;
  url?: string;
  data?: unknown;
}): Error {
  return Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    code: options.code,
    config: {
      method: options.method ?? "get",
      url: options.url ?? "/clients?phone=01012345678",
      data: options.data,
    },
    response: options.status ? { status: options.status } : undefined,
    toJSON: () => ({}),
  });
}

describe("captureApiError", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlush.mockResolvedValue(true);
  });

  it("ignores expected client errors and cancelled requests", () => {
    captureApiError(createAxiosError({ status: 409 }));
    captureApiError(createAxiosError({ code: "ERR_CANCELED" }));

    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("ignores server errors outside the service-record feature", () => {
    const error = createAxiosError({
      status: 503,
      method: "post",
      url: "/messages/send?phone=01012345678",
    });

    captureApiError(error);

    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("reports a service-record server error once with sanitized endpoint context", () => {
    const error = createAxiosError({
      status: 503,
      method: "post",
      url: "/admin/service-records/schedules/51/send-link?phone=01012345678",
    });

    captureApiError(error);
    captureApiError(error);

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockScope.setLevel).toHaveBeenCalledWith("error");
    expect(mockScope.setTag).toHaveBeenCalledWith("feature", "service-records");
    expect(mockScope.setContext).toHaveBeenCalledWith("api", {
      method: "POST",
      path: "/admin/service-records/schedules/[Filtered]/send-link",
      operation: "public-link",
      status: 503,
      code: null,
      runtime: "browser",
    });
    expect(mockScope.setTag).toHaveBeenCalledWith("app", "frontend");
    expect(mockScope.setTag).toHaveBeenCalledWith("operation", "public-link");
    expect(mockScope.setTag).toHaveBeenCalledWith("status_code", "503");
    expect(mockScope.setFingerprint).toHaveBeenCalledWith([
      "api-error",
      "POST",
      "/admin/service-records/schedules/[Filtered]/send-link",
      "503",
    ]);
  });

  it("reports a network failure as a warning", () => {
    captureApiError(createAxiosError({
      code: "ERR_NETWORK",
      url: "/admin/service-records/client/7",
    }));

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockScope.setLevel).toHaveBeenCalledWith("warning");
  });

  it("flushes captured proxy failures before the serverless response finishes", async () => {
    await captureAndFlushApiError(createAxiosError({
      code: "ERR_NETWORK",
      url: "/admin/service-records/client/7",
    }));
    await captureAndFlushApiError(createAxiosError({
      status: 401,
      url: "/admin/service-records/client/7",
    }));

    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockFlush).toHaveBeenCalledWith(2_000);
  });

  it("does not replace the proxy failure when Sentry flush fails", async () => {
    mockFlush.mockRejectedValueOnce(new Error("Sentry unavailable"));

    await expect(captureAndFlushApiError(createAxiosError({
      code: "ERR_NETWORK",
      url: "/admin/service-records/client/7",
    }))).resolves.toBeUndefined();
  });

  it("does not pass a prepared feedback bearer token to Sentry", () => {
    const error = createAxiosError({
      status: 503,
      method: "post",
      url: "/admin/service-records/schedules/51/send-link",
      data: JSON.stringify({ preparedLinkToken: "efl_sensitive_value" }),
    });

    captureApiError(error);

    const capturedError = mockCaptureException.mock.calls[0]?.[0] as Error & {
      config?: unknown;
    };
    expect(capturedError).not.toBe(error);
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError.config).toBeUndefined();
    expect(capturedError.message).not.toContain("efl_sensitive_value");
  });
});
