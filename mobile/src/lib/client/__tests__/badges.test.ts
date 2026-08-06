import { getMobileClientBadges } from "../badges";

import type { Client } from "../types";

const BASE_CLIENT: Client = {
  id: 1,
  name: "테스트 고객",
  createdAt: null,
  updatedAt: null,
  birthday: null,
  dueDate: null,
  birthDate: null,
  address: null,
  phone: null,
  primaryEmployee: { id: 1, name: "김정인" },
  secondaryEmployee: null,
  type: "A통합1형",
  duration: 10,
  fullPrice: null,
  grant: null,
  actualPrice: null,
  startDate: "2026-07-01",
  endDate: "2026-07-10",
  careCenter: false,
  voucherClient: false,
  breastPump: true,
  serviceStatus: "active",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

describe("getMobileClientBadges", () => {
  it("uses frontend client badge priority and labels for mobile surfaces", () => {
    expect(getMobileClientBadges(BASE_CLIENT).map((badge) => badge.label)).toEqual([
      "계약서 필요",
      "진행중",
      "유축기 대여",
    ]);
  });

  it("does not synthesize dashboard-only action labels", () => {
    expect(getMobileClientBadges(BASE_CLIENT).map((badge) => badge.label)).not.toContain("발송 대기");
  });

  it("replaces the service status with the schedule-change badge while a request is pending", () => {
    const badges = getMobileClientBadges({
      ...BASE_CLIENT,
      pendingScheduleChange: {
        id: "request-1",
        sessionIndex: 3,
        fromDate: "2026-07-20",
        toDate: "2026-07-21",
        oldEndDate: "2026-07-31",
        newEndDate: "2026-08-01",
      },
    });

    expect(badges.find((badge) => badge.key === "service_status")).toEqual(
      expect.objectContaining({
        status: "scheduleChange",
        label: "일정 변경",
        tone: "burgundy",
      }),
    );
  });
});
