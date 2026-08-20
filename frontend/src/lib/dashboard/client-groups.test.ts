import { getDashboardAttentionItems } from "./client-groups";

describe("getDashboardAttentionItems", () => {
  it("includes a client whose only attention state is a pending schedule change", () => {
    const client = {
      actionRequired: null,
      pendingScheduleChange: {
        id: "schedule-change-1",
        sessionIndex: 4,
        fromDate: "2026-08-20",
        toDate: "2026-08-21",
        oldEndDate: "2026-09-01",
        newEndDate: "2026-09-02",
      },
    };

    expect(getDashboardAttentionItems([client])).toEqual([{ client }]);
  });

  it("preserves the backend action reason when both attention states exist", () => {
    const client = {
      actionRequired: {
        reason: "발송 필요" as const,
        priority: 3 as const,
      },
      pendingScheduleChange: {
        id: "schedule-change-2",
        sessionIndex: 5,
        fromDate: "2026-08-21",
        toDate: "2026-08-22",
        oldEndDate: "2026-09-02",
        newEndDate: "2026-09-03",
      },
    };

    expect(getDashboardAttentionItems([client])).toEqual([{
      client,
      reason: "발송 필요",
      priority: 3,
    }]);
  });
});
