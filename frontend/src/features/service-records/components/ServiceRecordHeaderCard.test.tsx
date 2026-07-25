import { render, screen } from "@testing-library/react";

import { ServiceRecordHeaderCard } from "./ServiceRecordHeaderCard";

describe("ServiceRecordHeaderCard", () => {
  it("shows the same service basics used by the client service-record tab", () => {
    const { container } = render(
      <ServiceRecordHeaderCard
        data-component="desktop_test_service-records_header-card"
        header={{
          momName: "송진호",
          momBirth: "960414",
          babyName: "송송송",
          babyBirth: "260626",
          deliveryType: "자연분만",
          babyWeight: "2.6",
          createdAt: "2026-07-13T01:17:00.000Z",
          updatedAt: "2026-07-13T01:17:00.000Z",
        }}
        showStatusBadge={false}
      />,
    );

    expect(screen.getByText("서비스 기본정보")).toBeInTheDocument();
    expect(screen.getByText("산모 성명")).toBeInTheDocument();
    expect(screen.getByText("송진호")).toBeInTheDocument();
    expect(screen.getByText("1996.04.14")).toBeInTheDocument();
    expect(screen.getByText("송송송")).toBeInTheDocument();
    expect(screen.getByText("260626")).toBeInTheDocument();
    expect(screen.getByText("자연분만")).toBeInTheDocument();
    expect(screen.getByText("2.6kg")).toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-component="desktop_test_service-records_header-card"][data-source-component="ServiceRecordHeaderCard"]',
      ),
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-component="desktop_test_service-records_header-card_head_title-row_title"]',
      ),
    ).toHaveTextContent("서비스 기본정보");
  });
});
