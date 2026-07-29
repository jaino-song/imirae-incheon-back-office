import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ListLoadMoreButton, ListLoadMoreSentinel } from "../primitives";

const BUTTON_DATA_COMPONENT = "mobile_test_load-more_button";
const SENTINEL_DATA_COMPONENT = "mobile_test_load-sentinel";

describe("ListLoadMoreButton", () => {
    it("offers the tap affordance and loads more when idle", async () => {
        const onLoadMore = jest.fn();
        render(
            <ListLoadMoreButton data-component={BUTTON_DATA_COMPONENT} onLoadMore={onLoadMore} />,
        );

        const button = screen.getByRole("button", { name: "더 많은 항목 불러오기" });
        expect(button).toHaveTextContent("탭하여 더보기");
        expect(button.querySelector('[data-slot="spinner"]')).toBeNull();

        await userEvent.click(button);
        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it("swaps in a spinner and stops accepting taps while the next page loads", async () => {
        const onLoadMore = jest.fn();
        render(
            <ListLoadMoreButton
                data-component={BUTTON_DATA_COMPONENT}
                onLoadMore={onLoadMore}
                isLoading
            />,
        );

        const button = screen.getByRole("button", { name: "더 많은 항목 불러오기" });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("aria-busy", "true");
        expect(button).not.toHaveTextContent("탭하여 더보기");
        expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();

        // A disabled button swallows the click, so the page cannot be fetched twice.
        await userEvent.click(button);
        expect(onLoadMore).not.toHaveBeenCalled();
    });
});

describe("ListLoadMoreSentinel", () => {
    it("stays invisible while idle so it only acts as a scroll trigger", () => {
        const ref = createRef<HTMLDivElement>();
        const { container } = render(
            <ListLoadMoreSentinel data-component={SENTINEL_DATA_COMPONENT} sentinelRef={ref} />,
        );

        expect(screen.queryByRole("status")).toBeNull();
        expect(container.querySelector('[data-slot="spinner"]')).toBeNull();
        expect(ref.current).not.toBeNull();
    });

    it("announces the fetch and keeps the same node, so the observer stays attached", () => {
        const ref = createRef<HTMLDivElement>();
        const { rerender } = render(
            <ListLoadMoreSentinel data-component={SENTINEL_DATA_COMPONENT} sentinelRef={ref} />,
        );
        const idleNode = ref.current;

        rerender(
            <ListLoadMoreSentinel
                data-component={SENTINEL_DATA_COMPONENT}
                sentinelRef={ref}
                isLoading
            />,
        );

        const status = screen.getByRole("status", { name: "더 많은 항목 불러오는 중" });
        expect(status.querySelector('[data-slot="spinner"]')).not.toBeNull();

        // useListInfiniteScroll does not list isFetchingNextPage among its effect
        // dependencies, so it never re-observes. If React swapped the DOM node here the
        // IntersectionObserver would be left watching a detached element and infinite
        // scroll would stop working entirely after the first auto-load.
        expect(ref.current).toBe(idleNode);
        expect(status).toBe(idleNode);
    });
});
