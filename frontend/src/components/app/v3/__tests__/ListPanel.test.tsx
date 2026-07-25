import { fireEvent, render, screen } from "@testing-library/react";
import { ListEmptyState } from "../ListEmptyState";
import { ListPanel } from "../ListPanel";

describe("ListPanel", () => {
  it("renders overlay through the root list-panel overlay layer", () => {
    const { container } = render(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel"
        title="목록"
        subtitle="설명"
        overlay={
          <ListEmptyState
            name="list-panel-empty"
            message="항목이 없습니다."
            className="flex-none min-h-0"
          />
        }
      >
        {null}
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-overlay"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="list-panel-empty"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="list-empty-state-copy"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="list-panel-empty-copy"]')).not.toBeInTheDocument();
    expect(screen.getByText("항목이 없습니다.")).toBeInTheDocument();
  });

  it("renders emptyState through the overlay layer while keeping content mounted", () => {
    const { container } = render(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-2"
        title="목록"
        emptyState={<ListEmptyState message="항목이 없습니다." />}
      >
        <div data-testid="list-panel-content-child">본문</div>
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-overlay"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="list-panel-empty-state"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="list-panel-content"]')).toBeInTheDocument();
    expect(screen.getByTestId("list-panel-content-child")).toBeInTheDocument();
    expect(screen.getByText("항목이 없습니다.")).toBeInTheDocument();
  });

  it("waits for loading to finish before rendering the empty state", () => {
    const emptyState = <ListEmptyState message="항목이 없습니다." />;
    const content = <div data-testid="list-panel-content-child">본문</div>;
    const { container, rerender } = render(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-3" title="목록" emptyState={emptyState} isLoading>
        {content}
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-overlay"]')).not.toBeInTheDocument();
    expect(screen.getByTestId("list-panel-content-child")).toBeInTheDocument();
    expect(screen.queryByText("항목이 없습니다.")).not.toBeInTheDocument();

    rerender(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-4" title="목록" emptyState={emptyState} isContentLoading>
        {content}
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-overlay"]')).not.toBeInTheDocument();
    expect(screen.queryByText("항목이 없습니다.")).not.toBeInTheDocument();

    rerender(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-5" title="목록" emptyState={emptyState}>
        {content}
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-overlay"]')).toBeInTheDocument();
    expect(screen.getByText("항목이 없습니다.")).toBeInTheDocument();
  });

  it("keeps inline tabs scrollable while search expands as an overlay", () => {
    const { container } = render(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-6"
        title="고객 목록"
        tabs={[
          { label: "전체", value: "all" },
          { label: "대기", value: "waiting" },
          { label: "교체 요청", value: "replacement_requested" },
          { label: "진행중", value: "active" },
          { label: "완료", value: "completed" },
          { label: "중단", value: "terminated" },
        ]}
        activeTab="all"
        searchValue=""
        onSearchChange={jest.fn()}
      >
        {null}
      </ListPanel>,
    );

    expect(container.querySelector('[data-slot="list-panel-controls"]')).toHaveClass(
      "[container-type:inline-size]",
    );
    expect(container.querySelector('[data-slot="list-panel-tab-scroll"]')).toHaveClass(
      "min-w-0",
      "flex-1",
      "overflow-x-auto",
    );
    expect(container.querySelector('[data-component="expandable-search"]')).toHaveClass(
      "h-[calc(40px*var(--glint-ui-scale,1))]",
      "w-[calc(32px*var(--glint-ui-scale,1))]",
      "overflow-visible",
    );
    expect(container.querySelector('[data-component="expandable-search-overlay"]')).toHaveClass(
      "absolute",
      "right-0",
      "h-[calc(40px*var(--glint-ui-scale,1))]",
      "expandable-search-overlay-surface",
    );

    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));

    expect(screen.getByRole("textbox", { name: "검색어" })).toHaveAttribute(
      "placeholder",
      "검색…",
    );
    expect(container.querySelector('[data-component="expandable-search-overlay"]')).toHaveClass(
      "bg-[linear-gradient(to_right,rgb(255_255_255_/_0)_0%,rgb(255_255_255)_10%,rgb(255_255_255)_100%)]",
    );
    expect(container.querySelector('[data-component="expandable-search-overlay"]')).not.toHaveClass("shadow-v3");
    expect(container.querySelector('[data-component="expandable-search-overlay"]')).toHaveStyle({
      width: "7rem",
    });
    expect(screen.getByRole("button", { name: "검색 닫기" })).toHaveClass(
      "transition-transform",
      "duration-200",
    );
    expect(container.querySelector('input[type="text"]')).toHaveClass(
      "flex-1",
      "border-0",
      "expandable-search-overlay-input",
    );
  });

  it("exposes the active filter state when a tab group label is provided", () => {
    const onTabChange = jest.fn();

    render(
      <ListPanel data-component="desktop_v3_tests_split-layout_list-panel-7"
        title="최근 현황"
        tabs={[
          { label: "전체", value: "all" },
          { label: "조치 필요", value: "action-required" },
        ]}
        activeTab="all"
        onTabChange={onTabChange}
        tabsAriaLabel="최근 현황 필터"
      >
        {null}
      </ListPanel>,
    );

    expect(screen.getByRole("group", { name: "최근 현황 필터" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "조치 필요" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "조치 필요" }));
    expect(onTabChange).toHaveBeenCalledWith("action-required");
  });
});
