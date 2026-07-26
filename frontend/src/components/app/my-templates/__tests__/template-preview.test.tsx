import { render, screen } from "@testing-library/react";

import { TemplatePreview } from "../template-preview";

describe("TemplatePreview", () => {
    it("renders the shared auto fill message card with resolved variables", () => {
        const { container } = render(
            <TemplatePreview
                content={"Hello {{name}}\nTotal {{price}}"}
                variables={[
                    { key: "name", label: "Name", type: "text", required: true },
                    { key: "price", label: "Price", type: "number", required: true },
                ]}
            />
        );

        expect(container.querySelector('[data-component="desktop_messages_sections_generated-msg-panel"]')).toBeInTheDocument();
        expect(screen.getByRole("textbox")).toHaveValue("Hello [Name]\nTotal [Price]");
        expect(screen.getByText("{{name}}")).toBeInTheDocument();
        expect(screen.getByText("[Price]")).toBeInTheDocument();
    });
});
