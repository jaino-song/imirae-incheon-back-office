import { render, screen } from "@testing-library/react";
import { AnimatedSlotList } from "../AnimatedSlotList";

describe("AnimatedSlotList", () => {
  it("honors loadingCount for card skeleton slots", () => {
    const { container } = render(
      <AnimatedSlotList
        data-component="desktop_test_animated-slot-list"
        items={[]}
        isLoading
        itemDataComponent="desktop_test_animated-slot-list_item"
        itemVariant="card"
        loadingCount={3}
        render={() => null}
      />,
    );

    expect(
      container.querySelectorAll('[data-component="desktop_test_animated-slot-list_item"]'),
    ).toHaveLength(3);
  });

  it("announces the selected interactive item and renders a keyboard focus style", () => {
    render(
      <AnimatedSlotList
        data-component="desktop_test_animated-slot-list"
        items={[{ id: "client-1", name: "송규운" }]}
        isLoading={false}
        itemDataComponent="desktop_test_animated-slot-list_item"
        onSlotClick={jest.fn()}
        getSlotState={() => ({ isActive: true, isInteractive: true })}
        render={({ item }) => item?.name}
      />,
    );

    expect(screen.getByRole("button", { name: "송규운" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "송규운" })).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-v3-primary",
    );
  });

  it("keeps the pagination footer stable while fetching more items", () => {
    const renderList = (isFetchingMore: boolean) => (
      <AnimatedSlotList
        data-component="desktop_test_animated-slot-list"
        items={[
          { id: "item-1", name: "첫 번째" },
          { id: "item-2", name: "두 번째" },
        ]}
        isLoading={false}
        itemDataComponent="desktop_test_animated-slot-list_item"
        getItemKey={(item) => item.id}
        hasMore
        isFetchingMore={isFetchingMore}
        render={({ item }) => item?.name}
      />
    );

    const { container, rerender } = render(renderList(false));
    const footerBeforeFetch = container.querySelector('[data-slot="fetch-more"]');

    expect(footerBeforeFetch).toHaveClass("h-8");
    expect(
      container.querySelectorAll('[data-component="desktop_test_animated-slot-list_item"]'),
    ).toHaveLength(2);
    const indicatorBeforeFetch = container.querySelector(
      '[data-slot="fetching-more-indicator"]',
    );
    expect(indicatorBeforeFetch).toHaveAttribute("data-state", "idle");
    expect(indicatorBeforeFetch).toHaveClass("opacity-0", "delay-0");

    rerender(renderList(true));

    expect(container.querySelector('[data-slot="fetch-more"]')).toBe(footerBeforeFetch);
    expect(
      container.querySelectorAll('[data-component="desktop_test_animated-slot-list_item"]'),
    ).toHaveLength(2);
    const indicatorDuringFetch = container.querySelector(
      '[data-slot="fetching-more-indicator"]',
    );
    expect(indicatorDuringFetch).toBe(indicatorBeforeFetch);
    expect(indicatorDuringFetch).toHaveAttribute("data-state", "loading");
    expect(indicatorDuringFetch).toHaveClass("opacity-100", "delay-200");
  });
});
