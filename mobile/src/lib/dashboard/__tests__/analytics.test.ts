import {
  deriveDashboardAnalyticsFromClients,
  isContractIncompleteNearServiceStart,
  isServiceStartingWithinWeek,
  type DashboardAnalyticsClient,
} from "@/lib/dashboard/analytics";

const NOW = new Date("2026-06-10T12:00:00+09:00");

function client(overrides: Partial<DashboardAnalyticsClient> = {}): DashboardAnalyticsClient {
  return {
    serviceStatus: "waiting",
    startDate: "2026-06-10T00:00:00+09:00",
    eDocId: null,
    documentStatus: null,
    ...overrides,
  };
}

describe("isContractIncompleteNearServiceStart", () => {
  it("counts incomplete contracts within seven days before or after service start", () => {
    expect(
      isContractIncompleteNearServiceStart(
        client({ startDate: "2026-06-03T00:00:00+09:00" }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isContractIncompleteNearServiceStart(
        client({
          startDate: "2026-06-17T23:59:00+09:00",
          eDocId: "doc-1",
          documentStatus: "opened",
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("excludes completed contracts, ended services, and dates outside the window", () => {
    expect(
      isContractIncompleteNearServiceStart(
        client({ startDate: "2026-06-10T00:00:00+09:00", documentStatus: "completed" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isContractIncompleteNearServiceStart(
        client({ startDate: "2026-06-10T00:00:00+09:00", serviceStatus: "terminated" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isContractIncompleteNearServiceStart(
        client({ startDate: "2026-06-18T00:00:00+09:00" }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("isServiceStartingWithinWeek", () => {
  it("counts service starts from today through seven days later", () => {
    expect(
      isServiceStartingWithinWeek(
        client({ startDate: "2026-06-10T00:00:00+09:00" }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isServiceStartingWithinWeek(
        client({ startDate: "2026-06-17T23:59:00+09:00" }),
        NOW,
      ),
    ).toBe(true);
  });

  it("excludes past starts, dates outside the window, and ended services", () => {
    expect(
      isServiceStartingWithinWeek(
        client({ startDate: "2026-06-09T23:59:00+09:00" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isServiceStartingWithinWeek(
        client({ startDate: "2026-06-18T00:00:00+09:00" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isServiceStartingWithinWeek(
        client({ startDate: "2026-06-10T00:00:00+09:00", serviceStatus: "terminated" }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("deriveDashboardAnalyticsFromClients", () => {
  it("derives contract attention count from service-start window and incomplete status", () => {
    const analytics = deriveDashboardAnalyticsFromClients(
      [
        client({ startDate: "2026-06-03T00:00:00+09:00" }),
        client({
          startDate: "2026-06-17T23:59:00+09:00",
          eDocId: "doc-1",
          documentStatus: "opened",
        }),
        client({ startDate: "2026-06-18T00:00:00+09:00" }),
        client({ startDate: "2026-06-10T00:00:00+09:00", documentStatus: "completed" }),
        client({ startDate: "2026-06-10T00:00:00+09:00", serviceStatus: "completed" }),
      ],
      NOW,
    );

    expect(analytics.contractsNotSent).toBe(2);
  });

  it("only counts pending-signature contracts once the review window opens", () => {
    const base = { eDocId: "doc-1", documentStatus: "opened" as const };
    const analytics = deriveDashboardAnalyticsFromClients(
      [
        // Ends far in the future → review window closed → not counted.
        client({ ...base, endDate: "2099-12-31" }),
        // Already past its end date → counted.
        client({ ...base, endDate: "2026-06-01" }),
        // No end date → window treated as open (server parity) → counted.
        client({ ...base }),
        // Completed docs are never counted regardless of dates.
        client({ ...base, documentStatus: "completed", endDate: "2026-06-01" }),
      ],
      NOW,
    );

    expect(analytics.contractsPendingSignature).toBe(0);
  });

  it("derives weekly upcoming starts from service-start window", () => {
    const analytics = deriveDashboardAnalyticsFromClients(
      [
        client({ startDate: "2026-06-09T23:59:00+09:00" }),
        client({ startDate: "2026-06-10T00:00:00+09:00" }),
        client({ startDate: "2026-06-17T23:59:00+09:00" }),
        client({ startDate: "2026-06-18T00:00:00+09:00" }),
        client({ startDate: "2026-06-12T00:00:00+09:00", serviceStatus: "completed" }),
      ],
      NOW,
    );

    expect(analytics.upcomingThisMonth).toBe(2);
  });
});

describe("KST anchoring (server-timezone independence)", () => {
  // 2026-06-05T20:00:00Z = 2026-06-06 05:00 KST. The KST ±7d contract window
  // is [2026-05-30 00:00 KST, 2026-06-13 23:59:59.999 KST], i.e.
  // [2026-05-29T15:00:00Z, 2026-06-13T14:59:59.999Z]. A server-local
  // UTC-anchored window would start/end 9 hours later — these cases fail
  // under local-TZ day math on a UTC runner.
  const utcEveningNow = new Date("2026-06-05T20:00:00Z");

  it("opens the contract window at KST midnight, not UTC midnight", () => {
    expect(
      isContractIncompleteNearServiceStart(
        client({ startDate: "2026-05-29T20:00:00Z" }),
        utcEveningNow,
      ),
    ).toBe(true);
  });

  it("closes the contract window at KST end-of-day, not UTC end-of-day", () => {
    expect(
      isContractIncompleteNearServiceStart(
        client({ startDate: "2026-06-13T18:00:00Z" }),
        utcEveningNow,
      ),
    ).toBe(false);
  });

  it("buckets next-month starts by KST calendar month", () => {
    // 2026-06-30T16:00:00Z = 2026-07-01 01:00 KST: next month in KST,
    // still June under UTC bucketing.
    const analytics = deriveDashboardAnalyticsFromClients(
      [client({ startDate: "2026-06-30T16:00:00Z" })],
      utcEveningNow,
    );

    expect(analytics.upcomingNextMonth).toBe(1);
  });
});
