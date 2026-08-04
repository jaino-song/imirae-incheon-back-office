import { fireEvent, render, screen } from "@testing-library/react";

import { FormRequestPart } from "./FormRequestPart";

describe("FormRequestPart", () => {
    const dataComponent = "desktop_chat_tests_agent-part-registry_form-request";

    it("passes numeric YYMMDD metadata to desktop inputs without changing ownership", () => {
        render(
            <FormRequestPart
                data-component={dataComponent}
                formId="employee-create"
                title="직원 등록"
                fields={[
                    { name: "birthday", label: "생년월일", type: "text", inputMode: "numeric", placeholder: "YYMMDD", maxLength: 6 },
                    { name: "notes", label: "메모", type: "textarea", placeholder: "간단한 메모", maxLength: 120 },
                ]}
            />,
        );

        const birthday = screen.getByRole("textbox", { name: "생년월일" });
        expect(birthday).toHaveAttribute("type", "text");
        expect(birthday).toHaveAttribute("inputmode", "numeric");
        expect(birthday).toHaveAttribute("placeholder", "YYMMDD");
        expect(birthday).toHaveAttribute("maxlength", "6");
        expect(birthday).toHaveAttribute("data-component", `${dataComponent}_field_control`);

        const notes = screen.getByRole("textbox", { name: "메모" });
        expect(notes).toHaveAttribute("placeholder", "간단한 메모");
        expect(notes).toHaveAttribute("maxlength", "120");
        expect(notes).toHaveAttribute("data-component", `${dataComponent}_field_control`);

        const form = screen.getByRole("heading", { name: "직원 등록" }).closest("form");
        expect(form).toHaveAttribute("data-component", dataComponent);
        expect(form).toHaveAttribute("data-source-component", "FormRequestPart");
    });

    it("keeps safe defaults when optional field metadata is absent", () => {
        render(
            <FormRequestPart
                data-component={dataComponent}
                formId="profile"
                title="프로필"
                fields={[{ name: "name", label: "이름", type: "text" }]}
            />,
        );

        const input = screen.getByRole("textbox", { name: "이름" });
        expect(input).toHaveAttribute("placeholder", "이름");
        expect(input).not.toHaveAttribute("inputmode");
        expect(input).not.toHaveAttribute("maxlength");
    });

    it("keeps a cleared optional number empty and omits it from the submitted payload", () => {
        const onSubmit = jest.fn();
        render(
            <FormRequestPart
                data-component={dataComponent}
                formId="profile"
                title="프로필"
                fields={[{ name: "count", label: "횟수", type: "number" }]}
                onSubmit={onSubmit}
            />,
        );

        const count = screen.getByRole("spinbutton", { name: "횟수" });
        const form = screen.getByRole("heading", { name: "프로필" }).closest("form");
        fireEvent.change(count, { target: { value: "3" } });
        expect(count).toHaveValue(3);
        fireEvent.submit(form!);
        expect(onSubmit).toHaveBeenNthCalledWith(1, "profile", { count: 3 });

        fireEvent.change(count, { target: { value: "" } });
        expect((count as HTMLInputElement).value).toBe("");
        fireEvent.submit(form!);
        expect(onSubmit).toHaveBeenNthCalledWith(2, "profile", {});
    });

    it("keeps a required number invalid after clearing instead of submitting zero", () => {
        const onSubmit = jest.fn();
        render(
            <FormRequestPart
                data-component={dataComponent}
                formId="profile"
                title="프로필"
                fields={[{ name: "count", label: "횟수", type: "number", required: true }]}
                onSubmit={onSubmit}
            />,
        );

        const count = screen.getByRole("spinbutton", { name: "횟수" });
        const form = screen.getByRole("heading", { name: "프로필" }).closest("form");
        fireEvent.change(count, { target: { value: "3" } });
        fireEvent.submit(form!);
        expect(onSubmit).toHaveBeenCalledWith("profile", { count: 3 });

        fireEvent.change(count, { target: { value: "" } });
        expect(count).toBeInvalid();
        fireEvent.submit(form!);
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("disables and guards submission while the agent turn is busy", () => {
        const onSubmit = jest.fn();
        render(
            <FormRequestPart
                data-component={dataComponent}
                formId="profile"
                title="프로필"
                fields={[{ name: "name", label: "이름", type: "text" }]}
                isBusy
                onSubmit={onSubmit}
            />,
        );

        const form = screen.getByRole("heading", { name: "프로필" }).closest("form");
        expect(form).toHaveAttribute("aria-busy", "true");
        expect(screen.getByRole("button", { name: "입력 제출" })).toBeDisabled();

        fireEvent.submit(form!);

        expect(onSubmit).not.toHaveBeenCalled();
    });
});
