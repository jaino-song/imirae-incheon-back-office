import { fireEvent, render } from "@testing-library/react";

import { FilterPills } from "../primitives";

describe("FilterPills", () => {
  it("shows the right fade only while more pills remain offscreen", () => {
    const { container } = render(
      <FilterPills
        data-component="mobile_tests_filters"
        items={[
          { label: "전체", count: "12" },
          { label: "대기", count: "3" },
          { label: "완료", count: "9" },
        ]}
      />,
    );
    const row = container.querySelector(
      '[data-component="mobile_tests_filters"]',
    ) as HTMLDivElement;

    Object.defineProperties(row, {
      clientWidth: { configurable: true, value: 200 },
      scrollWidth: { configurable: true, value: 360 },
      scrollLeft: { configurable: true, value: 0 },
    });
    fireEvent.scroll(row);

    expect(row).toHaveClass("has-right-overflow");

    Object.defineProperty(row, "scrollLeft", { configurable: true, value: 160 });
    fireEvent.scroll(row);

    expect(row).not.toHaveClass("has-right-overflow");
  });
});
