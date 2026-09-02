import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
    VariableChipEditor,
    docJSONToValue,
    textToInlineNodesJSON,
    valueToDocJSON,
    type VariableChipEditorHandle,
} from "../variable-chip-editor";

const VARIABLES = [
    { key: "name", label: "이름", type: "text" as const, required: true },
];

/** Waits for the ProseMirror contenteditable element to be mounted (useEditor with immediatelyRender: false creates it post-mount). */
async function getEditableElement(container: HTMLElement) {
    return waitFor(() => {
        const el = container.querySelector('[contenteditable="true"]');
        if (!el) throw new Error("editor not ready");
        return el as HTMLElement;
    });
}

describe("variable-chip-editor parse/serialize", () => {
    it("round-trips text, a known variable, newlines, and an unknown variable losslessly", () => {
        const original = "Hello {{name}}!\nLine two\n\nUnknown: {{foo}}";
        const doc = valueToDocJSON(original);
        const serialized = docJSONToValue(doc);
        expect(serialized).toBe(original);
    });

    it("round-trips an empty string", () => {
        expect(docJSONToValue(valueToDocJSON(""))).toBe("");
    });

    it("parses text containing {{key}} into text + variable nodes (the same parser handlePaste uses)", () => {
        const nodes = textToInlineNodesJSON("Hi {{name}}, bye");
        expect(nodes).toEqual([
            { type: "text", text: "Hi " },
            { type: "variable", attrs: { key: "name" } },
            { type: "text", text: ", bye" },
        ]);
    });
});

describe("VariableChipEditor", () => {
    it("emits {{key}} format via onChange after insertVariable is called through the ref", async () => {
        const handleChange = jest.fn();
        const ref = createRef<VariableChipEditorHandle>();

        const { container } = render(
            <VariableChipEditor ref={ref} value="" onChange={handleChange} variables={VARIABLES} />
        );

        await getEditableElement(container);

        fireEvent.focus(container.querySelector('[contenteditable="true"]') as HTMLElement);
        ref.current?.insertVariable("name");

        await waitFor(() => {
            expect(handleChange).toHaveBeenCalled();
        });
        const lastValue = handleChange.mock.calls.at(-1)?.[0] as string;
        expect(lastValue).toContain("{{name}}");
    });

    it("converts pasted plain text containing {{key}} into a chip via the real paste handler", async () => {
        const handleChange = jest.fn();

        const { container } = render(<VariableChipEditor value="" onChange={handleChange} variables={VARIABLES} />);

        const editable = await getEditableElement(container);

        fireEvent.paste(editable, {
            clipboardData: {
                getData: () => "Hi {{name}}",
            },
        });

        await waitFor(() => {
            expect(handleChange).toHaveBeenCalled();
        });
        expect(handleChange.mock.calls.at(-1)?.[0]).toBe("Hi {{name}}");
    });

    it("fires onVariableClick with the key when a chip is clicked", async () => {
        const handleChange = jest.fn();
        const handleVariableClick = jest.fn();

        const { container } = render(
            <VariableChipEditor
                value="Hi {{name}}"
                onChange={handleChange}
                variables={VARIABLES}
                onVariableClick={handleVariableClick}
            />
        );

        await getEditableElement(container);

        const chip = await waitFor(() => screen.getByText("이름"));
        fireEvent.click(chip);

        expect(handleVariableClick).toHaveBeenCalledWith("name");
    });
});
