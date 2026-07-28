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
});
