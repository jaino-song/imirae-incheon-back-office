import { render } from "@testing-library/react";

import { ClientLikeRow, ListCountSkeleton, ListRowsSkeleton } from "../primitives";

describe("mobile redesign list skeletons", () => {
  it("uses the provided data-component prefix for count and row skeletons", () => {
    const { container } = render(
      <>
        <ListCountSkeleton data-component="mobile_tests_list-skeletons_count" />
        <ListRowsSkeleton data-component="mobile_tests_list-skeletons_rows" rowCount={2} />
      </>
    );

    expect(container.querySelector('[data-component="mobile_tests_list-skeletons_count"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="mobile_tests_list-skeletons_rows"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-component="mobile_tests_list-skeletons_rows_row"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-component="mobile_tests_list-skeletons_rows_row_info"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-component="mobile_tests_list-skeletons_rows_row_right"]')).toHaveLength(2);
  });

  it("matches the shared list row structure", () => {
    const { container } = render(<ListRowsSkeleton data-component="mobile_tests_list-skeletons_rows" rowCount={1} />);
    const row = container.querySelector('[data-component="mobile_tests_list-skeletons_rows_row"]');
    const info = container.querySelector('[data-component="mobile_tests_list-skeletons_rows_row_info"]');
    const right = container.querySelector('[data-component="mobile_tests_list-skeletons_rows_row_right"]');

    expect(row).toHaveClass("list-item");
    expect(info).toHaveClass("list-info", "flex", "flex-col");
    expect(right).toHaveClass("list-right");
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
  });

  it("compacts multiple client row badges to the frontend status pattern", () => {
    const { container } = render(
      <ClientLikeRow
        data-component="mobile_tests_client-like-row_root"
        row={{
          name: "가나안덕",
          meta: "A통합1형 · 김정인",
          initial: "가",
          badge: "진행중",
          badgeTone: "primary",
          badges: [
            { label: "계약서 필요", tone: "burgundy" },
            { label: "유축기 대여", tone: "primary" },
            { label: "진행중", tone: "primary" },
          ],
          due: "서비스 종료 5 영업일 남음",
        }}
      />
    );

    const badgeGroup = container.querySelector<HTMLElement>('[data-component="mobile_tests_client-like-row_root_badges"]');
    const statusBadges = badgeGroup?.querySelectorAll('[data-component="mobile_tests_client-like-row_root_badges_primary"]');
    const more = container.querySelector('[data-component="mobile_tests_client-like-row_root_badges_more"]');
    const meta = container.querySelector(".list-meta");
    const right = container.querySelector<HTMLElement>(".list-right");

    expect(badgeGroup).toBeInTheDocument();
    expect(right).toContainElement(badgeGroup);
    expect(meta).toHaveTextContent("서비스 종료 5 영업일 남음");
    expect(statusBadges).toHaveLength(1);
    expect(statusBadges?.[0]).toHaveTextContent("계약서 필요");
    expect(more).toHaveTextContent("+2");
    expect(badgeGroup).not.toHaveTextContent("유축기 대여");
    expect(badgeGroup).not.toHaveTextContent("진행중");
  });
});
