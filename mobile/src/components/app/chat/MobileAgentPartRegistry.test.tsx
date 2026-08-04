import { fireEvent, render, screen } from "@testing-library/react";

import { MobileAgentPartRegistry } from "./MobileAgentPartRegistry";

if (typeof globalThis.ResizeObserver === "undefined") {
    Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: class ResizeObserverMock {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    });
}

describe("MobileAgentPartRegistry", () => {
    it("preserves the entity domain when selecting a choice", () => {
        const onEntitySelect = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_entity-choice"
            part={{
                type: "data-entity-choice",
                data: {
                    entityType: "employees",
                    prompt: "직원 선택",
                    choices: [{ id: "employee-1", label: "김직원" }, { id: "employee-2", label: "이직원" }],
                },
            }}
            onEntitySelect={onEntitySelect}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        fireEvent.click(screen.getByRole("button", { name: "김직원" }));
        expect(onEntitySelect).toHaveBeenCalledWith("employee-1", "employees");
    });

    it("renders sanitized uncertain delivery details for operator recovery", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_action-result"
            part={{
                type: "data-action-result",
                data: {
                    actionId: "action-1",
                    status: "uncertain",
                    summary: "일부 구독에 전달되어 결과 확인이 필요합니다.",
                    result: { status: "partial", subscriptions: 3, delivered: 1, failed: 2, notificationId: 9 },
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        expect(screen.getByText("확인 필요")).toBeInTheDocument();
        expect(screen.getByText("처리 상세")).toBeInTheDocument();
        expect(screen.getByText(/"delivered": 1/)).toBeInTheDocument();
        expect(screen.getByText(/"failed": 2/)).toBeInTheDocument();
    });

    it("requires acknowledgement when a side-effect proposal carries a server token", () => {
        const onApproveAction = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_action-proposal"
            part={{
                type: "data-action-proposal",
                data: {
                    actionId: "action-reversible",
                    capability: "contracts.dispatch",
                    title: "계약서 생성 및 발송",
                    summary: "계약서를 생성하고 발송합니다.",
                    expiresAt: "2099-08-03T00:00:00.000Z",
                    expectedRevision: "revision-1",
                    risk: "external-side-effect",
                    changes: { clientId: 1 },
                    acknowledgementToken: "ack-token",
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={onApproveAction}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);
        const approve = screen.getByRole("button", { name: "승인하고 실행" });

        expect(approve).toBeDisabled();
        expect(screen.getByLabelText("승인 대기 작업")).toHaveAttribute(
            "data-component",
            "mobile_chat_tests_agent-part-registry_action-proposal",
        );
        fireEvent.click(screen.getByRole("checkbox"));
        expect(approve).toBeEnabled();
        fireEvent.click(approve);
        expect(onApproveAction).toHaveBeenCalledWith("action-reversible", "revision-1", "ack-token");
    });

    it("falls back safely for an unknown part", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_unknown"
            part={{ type: "data-new-renderer", data: { html: "<script>bad()</script>" } }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        expect(screen.getByText(/새 형식/)).toBeInTheDocument();
        expect(screen.queryByText("bad()")).not.toBeInTheDocument();
    });

    it("serializes untouched booleans as false and preserves non-boolean values", () => {
        const onSubmitForm = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_form"
            part={{
                type: "data-form",
                data: {
                    formId: "profile-form",
                    title: "프로필",
                    schemaVersion: "1",
                    fields: [
                        { name: "enabled", label: "사용", type: "boolean" },
                        { name: "name", label: "이름", type: "text" },
                        { name: "count", label: "횟수", type: "number" },
                    ],
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={onSubmitForm}
        />);

        const form = screen.getByText("프로필").closest("form");
        expect(form).toHaveAttribute("data-component", "mobile_chat_tests_agent-part-registry_form_form");
        expect(form).toHaveAttribute("data-slot", "form");
        expect(form).toHaveAttribute("data-source-component", "MobileAgentForm");
        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "Dana" } });
        fireEvent.change(screen.getByLabelText("횟수"), { target: { value: "3" } });
        fireEvent.submit(form!);

        expect(onSubmitForm).toHaveBeenCalledWith("profile-form", { enabled: false, name: "Dana", count: 3 });
    });

    it("keeps a cleared optional number empty and omits it from the submitted payload", () => {
        const onSubmitForm = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_form-number"
            part={{
                type: "data-form",
                data: {
                    formId: "profile-form",
                    title: "프로필",
                    schemaVersion: "1",
                    fields: [{ name: "count", label: "횟수", type: "number" }],
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={onSubmitForm}
        />);

        const count = screen.getByRole("spinbutton", { name: "횟수" });
        const form = screen.getByText("프로필").closest("form");
        fireEvent.change(count, { target: { value: "3" } });
        expect(count).toHaveValue(3);
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenNthCalledWith(1, "profile-form", { count: 3 });

        fireEvent.change(count, { target: { value: "" } });
        expect((count as HTMLInputElement).value).toBe("");
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenNthCalledWith(2, "profile-form", {});
    });

    it("keeps a required number invalid after clearing instead of submitting zero", () => {
        const onSubmitForm = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_form-required-number"
            part={{
                type: "data-form",
                data: {
                    formId: "profile-form",
                    title: "프로필",
                    schemaVersion: "1",
                    fields: [{ name: "count", label: "횟수", type: "number", required: true }],
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={onSubmitForm}
        />);

        const count = screen.getByRole("spinbutton", { name: "횟수" });
        const form = screen.getByText("프로필").closest("form");
        fireEvent.change(count, { target: { value: "3" } });
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenCalledWith("profile-form", { count: 3 });

        fireEvent.change(count, { target: { value: "" } });
        expect(count).toBeInvalid();
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenCalledTimes(1);
    });

    it("keeps touched boolean values true and then false", () => {
        const onSubmitForm = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_form-toggle"
            part={{
                type: "data-form",
                data: {
                    formId: "settings-form",
                    title: "설정",
                    schemaVersion: "1",
                    fields: [{ name: "enabled", label: "사용", type: "boolean" }],
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={onSubmitForm}
        />);

        const form = screen.getByText("설정").closest("form");
        const checkbox = screen.getByRole("checkbox", { name: "사용" });
        fireEvent.click(checkbox);
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenNthCalledWith(1, "settings-form", { enabled: true });

        fireEvent.click(checkbox);
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenNthCalledWith(2, "settings-form", { enabled: false });
    });

    it("passes numeric YYMMDD metadata to mobile inputs and keeps default behavior", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_birthday-form"
            part={{
                type: "data-form",
                data: {
                    formId: "employee-create",
                    title: "직원 등록",
                    schemaVersion: "1",
                    fields: [
                        { name: "birthday", label: "생년월일", type: "text", inputMode: "numeric", placeholder: "YYMMDD", maxLength: 6 },
                        { name: "name", label: "이름", type: "text" },
                    ],
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        const birthday = screen.getByRole("textbox", { name: "생년월일" });
        expect(birthday).toHaveAttribute("type", "text");
        expect(birthday).toHaveAttribute("inputmode", "numeric");
        expect(birthday).toHaveAttribute("placeholder", "YYMMDD");
        expect(birthday).toHaveAttribute("maxlength", "6");
        expect(birthday).toHaveAttribute("data-component", "mobile_chat_tests_agent-part-registry_birthday-form_form_field_control");

        const name = screen.getByRole("textbox", { name: "이름" });
        expect(name).toHaveAttribute("placeholder", "이름");
        expect(name).not.toHaveAttribute("inputmode");
        expect(name).not.toHaveAttribute("maxlength");
    });

    it("preserves distinct caller namespaces for forms and their descendants", () => {
        const firstBase = "mobile_chat_tests_agent-part-registry_message-a_part-0";
        const secondBase = "mobile_chat_tests_agent-part-registry_message-b_part-0";
        const part = {
            type: "data-form",
            data: {
                formId: "profile-form",
                title: "프로필",
                schemaVersion: "1",
                fields: [{ name: "enabled", label: "사용", type: "boolean" as const }],
            },
        };

        render(
            <>
                <MobileAgentPartRegistry
                    data-component={firstBase}
                    part={part}
                    onEntitySelect={jest.fn()}
                    onApproveAction={jest.fn()}
                    onRejectAction={jest.fn()}
                    onSubmitForm={jest.fn()}
                />
                <MobileAgentPartRegistry
                    data-component={secondBase}
                    part={part}
                    onEntitySelect={jest.fn()}
                    onApproveAction={jest.fn()}
                    onRejectAction={jest.fn()}
                    onSubmitForm={jest.fn()}
                />
            </>,
        );

        for (const base of [firstBase, secondBase]) {
            const form = screen.getByText("프로필", { selector: `[data-component="${base}_form_title"]` }).closest("form");
            expect(form).toHaveAttribute("data-component", `${base}_form`);
            expect(form).toHaveAttribute("data-slot", "form");
            expect(form).toHaveAttribute("data-source-component", "MobileAgentForm");
            expect(form?.querySelector(`[data-component="${base}_form_title"]`)).toBeInTheDocument();
            expect(form?.querySelector(`[data-component="${base}_form_field"]`)).toBeInTheDocument();
            expect(form?.querySelector(`[data-component="${base}_form_field_label"]`)).toBeInTheDocument();
            expect(form?.querySelector(`[data-component="${base}_form_field_control"]`)).toBeInTheDocument();
            expect(form?.querySelector(`[data-component="${base}_form_submit"]`)).toBeInTheDocument();
            expect(form?.querySelector('[data-component="mobile_chat_agent-form"]')).not.toBeInTheDocument();
        }
    });
});
