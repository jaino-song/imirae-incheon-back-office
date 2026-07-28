import type { Event, Log } from "@sentry/nextjs";

import {
  getSentryEnvironment,
  getSentryRuntimeOptions,
  sanitizeSentryEvent,
  sanitizeSentryLog,
  sanitizeSentryText,
  sanitizeSentryUrl,
} from "./sentry-config";

describe("Sentry privacy filters", () => {
  it("redacts credentials and common PII from text", () => {
    const value = "Bearer secret-token user@example.com 010-1234-5678 password=hunter2";

    expect(sanitizeSentryText(value)).toBe(
      "Bearer [Filtered] [Email] [Phone] password=[Filtered]",
    );
  });

  it("removes query strings and fragments from URLs", () => {
    expect(sanitizeSentryUrl("https://example.com/clients/7?token=secret#details")).toBe(
      "https://example.com/clients/7",
    );
    expect(sanitizeSentryUrl("/contracts?clientId=7")).toBe("/contracts");
  });

  it("redacts service-record access tokens from URLs", () => {
    expect(sanitizeSentryUrl("https://mobile.example.com/service-record/efl_secret")).toBe(
      "https://mobile.example.com/service-record/[Filtered]",
    );
    expect(sanitizeSentryUrl("/service-record/link/efl_secret/context")).toBe(
      "/service-record/link/[Filtered]/context",
    );
    expect(sanitizeSentryUrl("/api/service-record/efl_secret/context")).toBe(
      "/api/service-record/[Filtered]/context",
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
      sanitizeSentryUrl("/api/schedule-change-requests/schedules/431/preview"),
    ).toBe("/api/schedule-change-requests/schedules/[Filtered]/preview");
    expect(sanitizeSentryUrl("/api/service-record/efl_secret/sessions/9/submit")).toBe(
      "/api/service-record/[Filtered]/sessions/[Filtered]/submit",
    );
  });

  it("redacts UUID path segments from URLs", () => {
    expect(
      sanitizeSentryUrl(
        "/api/admin/service-records/client/123e4567-e89b-42d3-a456-426614174000",
      ),
    ).toBe("/api/admin/service-records/client/[Filtered]");
  });

  it("removes user identity and request payloads", () => {
    const event: Event = {
      transaction: "GET /api/clients?phone=01012345678",
      user: {
        id: "user-1",
        email: "user@example.com",
        ip_address: "127.0.0.1",
      },
      request: {
        url: "https://example.com/api/clients?phone=01012345678",
        data: { phone: "010-1234-5678" },
        cookies: { session: "secret" },
        headers: {
          authorization: "Bearer secret",
          "user-agent": "test-agent",
        },
      },
      extra: {
        email: "user@example.com",
        operation: "client lookup",
      },
    };

    expect(sanitizeSentryEvent(event)).toMatchObject({
      transaction: "GET /api/clients",
      user: undefined,
      request: {
        url: "https://example.com/api/clients",
        data: undefined,
        cookies: undefined,
        headers: {
          authorization: "[Filtered]",
          "user-agent": "test-agent",
        },
      },
      extra: {
        email: "[Filtered]",
        operation: "client lookup",
      },
    });
  });

  it("redacts sensitive structured log attributes", () => {
    const log: Log = {
      level: "error",
      message: "Failed for user@example.com",
      attributes: {
        route: "/clients",
        phone: "010-1234-5678",
      },
    };

    expect(sanitizeSentryLog(log)).toMatchObject({
      message: "Failed for [Email]",
      attributes: {
        route: "/clients",
        phone: "[Filtered]",
      },
    });
  });
});

describe("service-record Sentry scope", () => {
  it("uses canonical environments and the production 10 percent trace default", () => {
    const previousEnvironment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
    const previousRate = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = "production";
    delete process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;

    const options = getSentryRuntimeOptions();
    expect(getSentryEnvironment()).toBe("production");
    expect(options.environment).toBe("production");
    expect(options.tracesSampler({
      name: "GET /service-record/[token]",
      inheritOrSampleWith: (rate: number) => rate,
    })).toBe(0.1);

    if (previousEnvironment === undefined) delete process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
    else process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = previousEnvironment;
    if (previousRate === undefined) delete process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
    else process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = previousRate;
  });

  it("drops unrelated errors and keeps tagged service-record errors", () => {
    const options = getSentryRuntimeOptions();

    expect(options.beforeSend({ type: undefined, message: "dashboard failed" })).toBeNull();
    expect(
      options.beforeSend({
        type: undefined,
        message: "service record failed",
        tags: { feature: "service-records" },
      }),
    ).toMatchObject({
      message: "Service-record error",
      tags: { feature: "service-records" },
    });
  });

  it("keeps service-record request errors and drops unrelated transactions", () => {
    const options = getSentryRuntimeOptions();

    expect(
      options.beforeSend({
        type: undefined,
        request: {
          url: "https://admin.example.com/api/admin/service-records/client/7",
        },
      }),
    ).toMatchObject({
      request: {
        url: "https://admin.example.com/api/admin/service-records/client/[Filtered]",
      },
    });
    expect(
      options.beforeSendTransaction({
        type: "transaction",
        transaction: "GET /dashboard",
      }),
    ).toBeNull();
  });

  it("samples only service-record traces", () => {
    const previousRate = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
    process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = "0.4";

    const options = getSentryRuntimeOptions();
    const inheritOrSampleWith = jest.fn((rate: number) => rate);

    expect(
      options.tracesSampler({
        name: "GET /api/admin/service-records/client/:id",
        inheritOrSampleWith,
      }),
    ).toBe(0.4);
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
