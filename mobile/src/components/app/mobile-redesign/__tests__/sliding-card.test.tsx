import { act, fireEvent, render, screen } from "@testing-library/react";

import { SlidingCard } from "../sliding-card";

const DATA_COMPONENT = "mobile_tests_settings_sliding-card";

describe("SlidingCard", () => {
  it("keeps the list pane available and the detail pane hidden when closed", () => {
    const { container } = render(
      <SlidingCard
        data-component={DATA_COMPONENT}
        open={false}
        onBack={jest.fn()}
        backLabel="설정"
        detailKey={null}
        list={<div>List content</div>}
        detail={null}
      />,
    );

    const listPane = container.querySelector(
      `[data-component="${DATA_COMPONENT}_stage_list-pane"]`,
    );
    const detailPane = container.querySelector(
      `[data-component="${DATA_COMPONENT}_stage_detail-pane"]`,
    );

    expect(listPane).not.toHaveAttribute("aria-hidden", "true");
    expect(listPane).not.toHaveAttribute("inert");
    expect(detailPane).toHaveAttribute("aria-hidden", "true");
    expect(detailPane).toHaveAttribute("inert");
  });

  it("hides the list pane and focuses the back button when open", () => {
    const { container } = render(
      <SlidingCard
        data-component={DATA_COMPONENT}
        open
        onBack={jest.fn()}
        backLabel="설정"
        detailKey="detail-a"
        list={<div>List content</div>}
        detail={<div>Detail content</div>}
      />,
    );

    const listPane = container.querySelector(
      `[data-component="${DATA_COMPONENT}_stage_list-pane"]`,
    );
    const detailPane = container.querySelector(
      `[data-component="${DATA_COMPONENT}_stage_detail-pane"]`,
    );
    const backButton = screen.getByRole("button", {
      name: "설정 목록으로 돌아가기",
    });

    expect(listPane).toHaveAttribute("aria-hidden", "true");
    expect(listPane).toHaveAttribute("inert");
    expect(detailPane).not.toHaveAttribute("aria-hidden", "true");
    expect(detailPane).not.toHaveAttribute("inert");
    expect(backButton).toHaveFocus();
  });

  it("calls onBack when the back button is clicked", () => {
    const onBack = jest.fn();
    render(
      <SlidingCard
        data-component={DATA_COMPONENT}
        open
        onBack={onBack}
        backLabel="설정"
        detailKey="detail-a"
        list={<div>List content</div>}
        detail={<div>Detail content</div>}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "설정 목록으로 돌아가기" }),
    );

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously active element when closed", () => {
    const props = {
      "data-component": DATA_COMPONENT,
      onBack: jest.fn(),
      backLabel: "설정",
      detailKey: "detail-a",
      list: <button type="button">Open detail</button>,
      detail: <div>Detail content</div>,
    };
    const { rerender } = render(<SlidingCard {...props} open={false} />);
    const opener = screen.getByRole("button", { name: "Open detail" });
    opener.focus();

    rerender(<SlidingCard {...props} open />);
    expect(
      screen.getByRole("button", { name: "설정 목록으로 돌아가기" }),
    ).toHaveFocus();

    rerender(<SlidingCard {...props} open={false} detailKey={null} detail={null} />);
    expect(opener).toHaveFocus();
  });

  it("keeps the last detail mounted until the closing transform ends", () => {
    const props = {
      "data-component": DATA_COMPONENT,
      onBack: jest.fn(),
      backLabel: "설정",
      list: <div>List content</div>,
    };
    const { container, rerender } = render(
      <SlidingCard
        {...props}
        open
        detailKey="detail-a"
        detail={<div>Detail A</div>}
      />,
    );

    rerender(
      <SlidingCard
        {...props}
        open={false}
        detailKey={null}
        detail={null}
      />,
    );

    expect(screen.getByText("Detail A")).toBeInTheDocument();

    const detailPane = container.querySelector(
      `[data-component="${DATA_COMPONENT}_stage_detail-pane"]`,
    );
    expect(detailPane).not.toBeNull();
    const transitionEndEvent = new Event("transitionend", {
      bubbles: true,
    });
    Object.defineProperty(transitionEndEvent, "propertyName", {
      value: "transform",
    });
    fireEvent(detailPane as Element, transitionEndEvent);

    expect(screen.queryByText("Detail A")).not.toBeInTheDocument();
  });

  it("clears the cached detail after the fallback timeout", () => {
    jest.useFakeTimers();

    try {
      const props = {
        "data-component": DATA_COMPONENT,
        onBack: jest.fn(),
        backLabel: "설정",
        list: <div>List content</div>,
      };
      const { rerender } = render(
        <SlidingCard
          {...props}
          open
          detailKey="detail-a"
          detail={<div>Detail A</div>}
        />,
      );

      rerender(
        <SlidingCard
          {...props}
          open={false}
          detailKey={null}
          detail={null}
        />,
      );
      expect(screen.getByText("Detail A")).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(450);
      });

      expect(screen.queryByText("Detail A")).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it("scrolls the detail body to the top when detailKey changes", () => {
    const originalScrollTo = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollTo",
    );
    const scrollTo = jest.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    try {
      const props = {
        "data-component": DATA_COMPONENT,
        open: true,
        onBack: jest.fn(),
        backLabel: "설정",
        list: <div>List content</div>,
      };
      const { rerender } = render(
        <SlidingCard
          {...props}
          detailKey="detail-a"
          detail={<div>Detail A</div>}
        />,
      );
      scrollTo.mockClear();

      rerender(
        <SlidingCard
          {...props}
          detailKey="detail-b"
          detail={<div>Detail B</div>}
        />,
      );

      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
    } finally {
      if (originalScrollTo) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollTo",
          originalScrollTo,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
      }
    }
  });

  it("exposes the source identity and the caller-derived component hierarchy", () => {
    const { container } = render(
      <SlidingCard
        data-component={DATA_COMPONENT}
        open
        onBack={jest.fn()}
        backLabel="설정"
        detailKey="detail-a"
        list={<div>List content</div>}
        detail={<div>Detail content</div>}
      />,
    );

    const root = container.querySelector(
      `[data-component="${DATA_COMPONENT}"]`,
    );
    expect(root).toHaveAttribute("data-source-component", "SlidingCard");

    [
      `${DATA_COMPONENT}_stage`,
      `${DATA_COMPONENT}_stage_list-pane`,
      `${DATA_COMPONENT}_stage_detail-pane`,
      `${DATA_COMPONENT}_stage_detail-pane_header`,
      `${DATA_COMPONENT}_stage_detail-pane_header_back`,
      `${DATA_COMPONENT}_stage_detail-pane_body`,
    ].forEach((componentName) => {
      expect(
        container.querySelector(`[data-component="${componentName}"]`),
      ).toBeInTheDocument();
    });
  });
});
