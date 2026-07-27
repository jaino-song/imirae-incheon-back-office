import { render } from "@testing-library/react";

import { FunnelBars } from "./FunnelBars";

describe("FunnelBars", () => {
  it("does not render a colored cap for a zero-value step", () => {
    const { container } = render(
      <FunnelBars
        dataComponent="desktop_stats_tests_funnel"
        steps={[
          {
            step: 1,
            event: "pricing_viewed",
            label: "가격 페이지 진입",
            count: 0,
            pct: 0,
            dropFromPrevPct: 0,
          },
        ]}
      />,
    );

    expect(container.querySelector('[style="width: 0%;"]')).toBeInTheDocument();
  });
});
