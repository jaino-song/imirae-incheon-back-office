import {
  getSentryRuntimeOptions,
  sanitizeSentryUrl,
} from "./sentry-config";

describe("mobile service-record Sentry scope", () => {
  it("redacts the public service-record token from URLs", () => {
    expect(sanitizeSentryUrl("https://mobile.example.com/service-record/efl_secret")).toBe(
      "https://mobile.example.com/service-record/[Filtered]",
    );
    expect(sanitizeSentryUrl("/service-record/link/efl_secret/context")).toBe(
      "/service-record/link/[Filtered]/context",
    );
    expect(sanitizeSentryUrl("/api/service-record/efl_secret/sessions/1/submit")).toBe(
      "/api/service-record/[Filtered]/sessions/[Filtered]/submit",
    );
  });

  it("redacts service-record resource identifiers from URLs", () => {
    expect(sanitizeSentryUrl("/api/admin/service-records/client/77")).toBe(
      "/api/admin/service-records/client/[Filtered]",
    );
    expect(sanitizeSentryUrl("/admin/service-records/schedules/431/finalize")).toBe(
      "/admin/service-records/schedules/[Filtered]/finalize",
    );
    expect(
      sanitizeSentryUrl("/api/schedule-change-requests/schedules/431/apply"),
    ).toBe("/api/schedule-change-requests/schedules/[Filtered]/apply");
  });

  it("redacts UUID path segments from URLs", () => {
    expect(
      sanitizeSentryUrl(
        "/api/admin/service-records/client/123e4567-e89b-42d3-a456-426614174000",
      ),
    ).toBe("/api/admin/service-records/client/[Filtered]");
  });

  it("drops unrelated errors and keeps service-record route errors", () => {
    const options = getSentryRuntimeOptions();

    expect(options.beforeSend({ type: undefined, message: "dashboard failed" })).toBeNull();
    expect(
      options.beforeSend({
        type: undefined,
        user: { id: "user-1", email: "person@example.com" },
        request: {
          url: "https://mobile.example.com/api/service-record/efl_secret/context",
        },
      }),
    ).toMatchObject({
      user: undefined,
      request: {
        url: "https://mobile.example.com/api/service-record/[Filtered]/context",
      },
    });
  });

  it("samples only service-record traces", () => {
    const previousRate = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = "0.3";

    const options = getSentryRuntimeOptions();
    const inheritOrSampleWith = jest.fn((rate: number) => rate);

    expect(
      options.tracesSampler({
        name: "GET /service-record/[token]",
        inheritOrSampleWith,
      }),
    ).toBe(0.3);
    expect(
      options.tracesSampler({
        name: "GET /dashboard",
        inheritOrSampleWith,
      }),
    ).toBe(0);

    if (previousRate === undefined) {
      delete process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
    } else {
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = previousRate;
    }
  });
});
