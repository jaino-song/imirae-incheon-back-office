import { render, screen } from "@testing-library/react";

import { AnimatedSlotListItemContent } from "@/components/app/v3/AnimatedSlotListItemContent";
import { StatusBadge } from "@/components/app/v3/StatusBadge";
import {
  getClientBadgeAvatarClassName,
  getClientBadges,
  getPrimaryClientBadge,
  prioritizeClientBadges,
} from "@/lib/client/badges";
import type { ClientBadge } from "@/lib/client/types";

describe("pre-booking client badge", () => {
  it("uses the neutral gray badge and avatar treatment", () => {
    render(<StatusBadge status="preBooking" />);

    expect(screen.getByText("예약 전")).toHaveClass("bg-status-neutral");
    expect(getClientBadgeAvatarClassName({
      key: "service_status",
      status: "preBooking",
      tone: "neutral",
    })).toContain("bg-status-neutral");
  });
});

describe("schedule-change badge priority", () => {
  const badges: ClientBadge[] = [
    {
      key: "contract_required",
      status: "terminated",
      label: "계약서 필요",
      tone: "danger",
      priority: 10,
    },
    {
      key: "service_status",
      status: "active",
      label: "진행중",
      tone: "primary",
      priority: 20,
    },
    {
      key: "care_center",
      status: "careCenter",
      label: "조리원 이용",
      tone: "primary",
      priority: 30,
    },
    {
      key: "breast_pump",
      status: "breastPump",
      label: "유축기 대여",
      tone: "primary",
      priority: 40,
    },
  ];

  const orderedBadges = prioritizeClientBadges(getClientBadges({
    badges,
    pendingScheduleChange: {
      id: "schedule-change-1",
      sessionIndex: 3,
      fromDate: "2026-07-20",
      toDate: "2026-07-21",
      oldEndDate: "2026-08-01",
      newEndDate: "2026-08-02",
    },
  }));

  it("places schedule change before contract required across client surfaces", () => {
    expect(orderedBadges.map((badge) => badge.label)).toEqual([
      "일정 변경",
      "계약서 필요",
      "조리원 이용",
      "유축기 대여",
    ]);
    expect(getPrimaryClientBadge(orderedBadges)?.label).toBe("일정 변경");
  });

  it("shows schedule change and folds contract required into the dashboard count", () => {
    render(
      <AnimatedSlotListItemContent
        dataComponent="desktop_dashboard_split-list-item-content"
        icon={<span>고객</span>}
        title="송진호"
        status={orderedBadges.map((badge) => (
          <StatusBadge
            key={badge.key}
            status={badge.status}
            label={badge.label}
          />
        ))}
      />,
    );

    expect(screen.getByText("일정 변경")).toBeInTheDocument();
    expect(screen.queryByText("계약서 필요")).not.toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
  });
});
