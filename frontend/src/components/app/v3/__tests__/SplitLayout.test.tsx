import { render } from "@testing-library/react";
import { SplitLayout } from "../SplitLayout";

describe("SplitLayout", () => {
  it("animates each panel once when it mounts", () => {
    const { container } = render(
      <SplitLayout data-component="desktop_v3_tests_split-layout" hasSelection>
        <div>목록</div>
        <div key="selected-detail">상세</div>
      </SplitLayout>,
    );

    expect(container.querySelector('[data-slot="split-layout"]')).not.toHaveClass("animate-v3-slide-up");
    expect(container.querySelector('[data-panel="list"]')).toHaveClass("animate-v3-slide-up");
    expect(container.querySelector('[data-panel="detail"]')).toHaveClass("animate-v3-slide-up");
  });

  it("keeps detail panel mount animation independent from selection state", () => {
    const { container } = render(
      <SplitLayout data-component="desktop_v3_tests_split-layout-2" hasSelection={false}>
        <div>목록</div>
        <div>빈 상태</div>
      </SplitLayout>,
    );

    expect(container.querySelector('[data-panel="detail"]')).toHaveClass("animate-v3-slide-up");
  });

  it("keeps extra children inside the detail panel in two-column mode", () => {
    const { container } = render(
      <SplitLayout data-component="desktop_v3_tests_split-layout-3" hasSelection>
        <div data-testid="list-panel-child">목록</div>
        <div data-testid="retained-hidden-child">유지 중인 숨김 세션</div>
        <div data-testid="selected-detail-child">상세</div>
      </SplitLayout>,
    );

    const panels = container.querySelectorAll('[data-slot="split-layout-panel"]');

    expect(panels).toHaveLength(2);
    expect(panels[0]).toHaveAttribute("data-panel", "list");
    expect(panels[1]).toHaveAttribute("data-panel", "detail");
    expect(panels[0].querySelector('[data-testid="list-panel-child"]')).toBeInTheDocument();
    expect(panels[1].querySelector('[data-testid="retained-hidden-child"]')).toBeInTheDocument();
    expect(panels[1].querySelector('[data-testid="selected-detail-child"]')).toBeInTheDocument();
  });
});
