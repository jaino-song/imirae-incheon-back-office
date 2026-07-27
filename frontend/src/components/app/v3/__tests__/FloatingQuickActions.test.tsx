import { render, screen } from "@testing-library/react";

import { FloatingQuickActions } from "../FloatingQuickActions";

describe("FloatingQuickActions", () => {
    it("uses the system purple palette for the price action", () => {
        render(
            <FloatingQuickActions data-component="desktop_shell_main_quick-actions" />,
        );

        const priceAction = screen.getByRole("link", { name: "가격표" });
        expect(priceAction.firstElementChild).toHaveClass("bg-v3-purple-light");
        expect(priceAction.querySelector("svg")).toHaveClass("text-v3-purple");
        expect(priceAction.querySelector("svg")).not.toHaveClass("text-v3-burgundy");
    });
});
