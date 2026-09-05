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

  it("redacts the receipt-link token from URLs", () => {
    expect(sanitizeSentryUrl("/receipt/efr_SECRET")).toBe("/receipt/[Filtered]");
    expect(sanitizeSentryUrl("/api/receipt/efr_SECRET/status")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("/api/receipt/efr_SECRET/image")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("https://mobile.example.com/api/receipt/efr_SECRET/image")).toBe(
      "https://mobile.example.com/api/receipt/[Filtered]/image",
    );
  });

  // M3: the BFF's own server-side axios call to the backend uses the /receipt-links/<token>/…
  // shape (not /api/receipt/<token>/…), which the original pattern left unredacted.
  it("redacts the receipt-link token from the server-side /receipt-links/<token>/… axios URL shape (M3)", () => {
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/verify")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/status")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/image")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/access")).not.toContain("efr_SECRET");
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/verify")).toBe("/receipt-links/[Filtered]/verify");
    expect(sanitizeSentryUrl("/receipt-links/efr_SECRET/access")).toBe("/receipt-links/[Filtered]/access");
    // Existing cases still pass unchanged.
    expect(sanitizeSentryUrl("/receipt/efr_SECRET")).toBe("/receipt/[Filtered]");
    expect(sanitizeSentryUrl("/api/receipt/efr_SECRET/status")).not.toContain("efr_SECRET");
    // The admin's token-free "send" route must stay legible for debugging — it carries no
    // token in the URL (documentId travels in the request body).
    expect(sanitizeSentryUrl("/api/receipt-links/send")).toBe("/api/receipt-links/send");
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
