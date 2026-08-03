import { fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";

import { AgentPartRegistry } from "./AgentPartRegistry";

describe("AgentPartRegistry", () => {
    it("renders structured entity choices through safe design-system buttons", () => {
        const onEntitySelect = jest.fn();
        const message = {
            id: "assistant-1",
            role: "assistant",
            parts: [{
                type: "data-entity-choice",
                data: { entityType: "employees", prompt: "선택", choices: [{ id: "1", label: "홍길동" }, { id: "2", label: "김영희" }] },
            }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry message={message} onEntitySelect={onEntitySelect} />);
        expect(screen.getByRole("button", { name: "홍길동" })).toBeInTheDocument();
        expect(screen.getByRole("group", { name: "선택" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "홍길동" }));
        expect(onEntitySelect).toHaveBeenCalledWith("1", "employees");
    });

    it("falls back safely for unknown parts instead of interpreting HTML", () => {
        const message = {
            id: "assistant-2",
            role: "assistant",
            parts: [{ type: "data-new-renderer", data: { html: "<script>bad()</script>" } }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry message={message} />);
        expect(screen.getByText(/새 형식/)).toBeInTheDocument();
        expect(screen.queryByText("bad()")).not.toBeInTheDocument();
    });

    it("keeps navigation parts on internal routes", () => {
        const message = {
            id: "assistant-3",
            role: "assistant",
            parts: [{ type: "data-navigation", data: { href: "https://untrusted.example", label: "열기" } }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry message={message} />);
        expect(screen.queryByRole("link", { name: "열기" })).not.toBeInTheDocument();
        expect(screen.getByText(/새 형식/)).toBeInTheDocument();
    });

    it("renders AI SDK tool results as escaped, bounded JSON", () => {
        const message = {
            id: "assistant-4",
            role: "assistant",
            parts: [{ type: "tool-clients_search", state: "output-available", output: { kind: "entity", entity: { id: 1, name: "홍길동" } } }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry message={message} />);
        expect(screen.getByText("clients.search 결과")).toBeInTheDocument();
        expect(screen.getByText(/홍길동/)).toBeInTheDocument();
    });

    it("does not turn action-result URLs into external or javascript links", () => {
        const message = {
            id: "assistant-5",
            role: "assistant",
            parts: [{ type: "data-action-result", data: { actionId: "a-1", status: "succeeded", summary: "완료", href: "javascript:alert(1)" } }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry message={message} />);
        expect(screen.queryByRole("link", { name: "결과 열기" })).not.toBeInTheDocument();
    });
});
