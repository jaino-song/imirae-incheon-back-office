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
  captureAndFlushServiceRecordError,
  captureServiceRecordError,
  captureServiceRecordResponseError,
} from "./capture-service-record-error";

function createAxiosError(options: {
  status?: number;
  code?: string;
  method?: string;
  url?: string;
}): Error {
  return Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    code: options.code,
    config: {
      method: options.method ?? "get",
      url: options.url ?? "/dashboard",
    },
    response: options.status ? { status: options.status } : undefined,
    toJSON: () => ({}),
  });
}

describe("captureServiceRecordError", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlush.mockResolvedValue(true);
  });

  it("ignores expected client errors and unrelated API paths", () => {
    captureServiceRecordError(createAxiosError({
      status: 409,
      url: "/service-record/context",
    }));
    captureServiceRecordError(createAxiosError({
      status: 503,
      url: "/dashboard",
    }));

    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("captures unexpected service-record API failures without the access token", () => {
    captureServiceRecordError(createAxiosError({
      status: 503,
      method: "post",
      url: "/service-record/efl_secret/sessions/1/submit",
    }));

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockScope.setTag).toHaveBeenCalledWith("feature", "service-records");
    expect(mockScope.setContext).toHaveBeenCalledWith("serviceRecord", {
      operation: "submit-session",
      method: "POST",
      path: "/service-record/[Filtered]/sessions/[Filtered]/submit",
      status: 503,
      code: null,
      runtime: "browser",
    });
    expect(mockScope.setTag).toHaveBeenCalledWith("operation", "submit-session");
  });

  it("captures resolved 5xx responses but ignores resolved 4xx responses", () => {
    captureServiceRecordResponseError(
      { status: 503 },
      {
        operation: "context",
        method: "GET",
        path: "/api/service-record/[Filtered]/context",
      },
    );
    captureServiceRecordResponseError(
      { status: 401 },
      {
        operation: "verify",
        method: "POST",
        path: "/api/service-record/[Filtered]/verify",
      },
    );

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockScope.setTag).toHaveBeenCalledWith("status_code", "503");
    expect(mockScope.setTag).toHaveBeenCalledWith("operation", "context");
  });

  it("flushes captured proxy failures before the serverless response finishes", async () => {
    await captureAndFlushServiceRecordError(createAxiosError({
      code: "ERR_NETWORK",
      url: "/service-record/context",
    }));
    await captureAndFlushServiceRecordError(createAxiosError({
      status: 401,
      url: "/service-record/context",
    }));

    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockFlush).toHaveBeenCalledWith(2_000);
  });

  it("does not replace the proxy failure when Sentry flush fails", async () => {
    mockFlush.mockRejectedValueOnce(new Error("Sentry unavailable"));

    await expect(captureAndFlushServiceRecordError(createAxiosError({
      code: "ERR_NETWORK",
      url: "/service-record/context",
    }))).resolves.toBeUndefined();
  });
});
