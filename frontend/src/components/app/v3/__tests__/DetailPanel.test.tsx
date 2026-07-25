import { fireEvent, render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { DetailTabs } from "../DetailTabs";
import { DetailEmptyState } from "../DetailEmptyState";
import { DetailPanel } from "../DetailPanel";
import { SplitLayoutContext } from "../SplitLayoutContext";

describe("DetailPanel", () => {
  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it("renders semantic header and footer without nesting a main landmark", () => {
    const { container } = render(
      <DetailPanel data-component="desktop_v3_tests_split-layout_detail-panel" title="상세" footer={<button type="button">저장</button>}>
        본문
      </DetailPanel>,
    );

    expect(container.querySelector('header[data-slot="detail-panel-header"]')).toBeInTheDocument();
    expect(container.querySelector('main[data-slot="detail-panel-main"]')).not.toBeInTheDocument();
    expect(container.querySelector('div[data-slot="detail-panel-main"]')).toBeInTheDocument();
    expect(container.querySelector('footer[data-slot="detail-panel-footer"]')).toBeInTheDocument();
  });

  it("keeps the bottom spacer below the scroll region without overlaying content", () => {
    const { container } = render(<DetailPanel data-component="desktop_v3_tests_split-layout_detail-panel-2" title="상세">본문</DetailPanel>);

    const main = container.querySelector('[data-slot="detail-panel-main"]');
    const scrollContent = container.querySelector('[data-slot="detail-panel-scroll-content"]');
    const spacer = container.querySelector('[data-slot="detail-panel-bottom-spacer"]');

    expect(main).toBeInTheDocument();
    expect(main).toHaveClass("flex-col");
    expect(main).toHaveClass("glint-ui-scale-scope");
    expect(scrollContent).toHaveClass("flex-1");
    expect(spacer).toBeInTheDocument();
    expect(spacer?.parentElement).toBe(main);
    expect(spacer?.previousElementSibling).toBe(scrollContent);
    expect(spacer).toHaveClass("shrink-0");
    expect(spacer).not.toHaveClass("absolute");
  });

  it("remounts and animates the main region when the main animation key changes", () => {
    const { container, rerender } = render(
      <DetailPanel data-component="desktop_v3_tests_split-layout_detail-panel-3" title="상세" mainAnimationKey="step-1">
        1단계
      </DetailPanel>,
    );
    const firstMain = container.querySelector('[data-slot="detail-panel-main"]');

    expect(firstMain).toHaveClass("animate-v3-slide-up");

    rerender(
      <DetailPanel data-component="desktop_v3_tests_split-layout_detail-panel-4" title="상세" mainAnimationKey="step-2">
        2단계
      </DetailPanel>,
    );

    const secondMain = container.querySelector('[data-slot="detail-panel-main"]');
    expect(secondMain).toHaveClass("animate-v3-slide-up");
    expect(secondMain).not.toBe(firstMain);
  });

  it("does not remount or animate the main region in compact split layout", () => {
    const goToList = jest.fn();
    const renderCompactPanel = (animationKey: string, content: string) => (
      <SplitLayoutContext.Provider value={{ goToList, isMobile: true }}>
        <DetailPanel data-component="desktop_v3_tests_split-layout_detail-panel-5" title="상세" mainAnimationKey={animationKey}>
          {content}
        </DetailPanel>
      </SplitLayoutContext.Provider>
    );
    const { container, rerender } = render(renderCompactPanel("step-1", "1단계"));
    const firstMain = container.querySelector('[data-slot="detail-panel-main"]');

    expect(firstMain).not.toHaveClass("animate-v3-slide-up");

    rerender(renderCompactPanel("step-2", "2단계"));

    const secondMain = container.querySelector('[data-slot="detail-panel-main"]');
    expect(secondMain).not.toHaveClass("animate-v3-slide-up");
    expect(secondMain).toBe(firstMain);
  });

  it("renders emptyState through the root overlay layer", () => {
    const { container } = render(
      <DetailPanel data-component="desktop_v3_tests_split-layout_detail-panel-6"
        title="상세"
        emptyState={
          <DetailEmptyState
            name="detail-panel-empty"
            icon={Users}
            message="항목을 선택하면 상세 정보가 표시됩니다."
            className="flex-none min-h-0"
          />
        }
      >
        {null}
      </DetailPanel>,
    );

    expect(container.querySelector('[data-slot="detail-panel-overlay"]')).toBeInTheDocument();
    expect(screen.getByText("항목을 선택하면 상세 정보가 표시됩니다.")).toBeInTheDocument();
    expect(container.querySelector('[data-component="detail-panel-empty"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="list-empty-state-copy"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="detail-panel-empty-copy"]')).not.toBeInTheDocument();
  });

  it("returns to the list from the compact back button", () => {
    const goToList = jest.fn();

    render(
      <SplitLayoutContext.Provider value={{ goToList, isMobile: true }}>
        <DetailPanel data-component="desktop_v3_tests_split-layout_detail-panel-7" title="상세" compactBackLabel="고객 목록으로 돌아가기">{null}</DetailPanel>
      </SplitLayoutContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "고객 목록으로 돌아가기" }));

    expect(goToList).toHaveBeenCalledTimes(1);
  });

  it("renders the optional stepper on the right side of the structured header", () => {
    render(
      <DetailPanel data-component="desktop_v3_tests_split-layout_detail-panel-8"
        title="전자계약서 작성"
        subtitle="고객에게 전자계약서를 발송합니다"
        stepper={<div data-testid="detail-panel-stepper">1 / 5</div>}
      >
        {null}
      </DetailPanel>,
    );

    expect(screen.getByTestId("detail-panel-stepper")).toBeInTheDocument();
    expect(screen.getByText("전자계약서 작성")).toBeInTheDocument();
  });

  it("keeps the panel mounted while loading and skeletonizes only text chrome", () => {
    const onTabChange = jest.fn();
    const { container } = render(
      <DetailPanel data-component="desktop_v3_tests_split-layout_detail-panel-9"
        isLoading
        title="전자계약서 작성"
        subtitle="고객에게 전자계약서를 발송합니다"
        tabs={
          <DetailTabs
            tabs={[
              { key: "details", label: "상세" },
              { key: "preview", label: "미리보기" },
            ]}
            activeTab="details"
            onTabChange={onTabChange}
          />
        }
      >
        <div data-testid="detail-loaded-body">본문</div>
      </DetailPanel>,
    );

    expect(container.querySelector('[data-slot="detail-panel"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_v3_tests_split-layout_detail-panel-9_header_title-group_title-row_title-skeleton"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="desktop_v3_tests_split-layout_detail-panel-9_header_title-group_subtitle-skeleton"]')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-component="detail-tabs-text-skeleton"]')).toHaveLength(2);
    expect(container.querySelector('[data-slot="detail-panel-scroll-content"]')).toBeEmptyDOMElement();
    expect(screen.queryByTestId("detail-loaded-body")).not.toBeInTheDocument();

    fireEvent.click(container.querySelector('[data-component="detail-tabs-button"]') as HTMLElement);
    expect(onTabChange).not.toHaveBeenCalled();
  });
});
