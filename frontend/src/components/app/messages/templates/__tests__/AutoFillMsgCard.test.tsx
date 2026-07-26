import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AutoFillMsgCard } from "../AutoFillMsgCard";

describe("AutoFillMsgCard", () => {
  it("renders the editable message card with metadata, variables, and copy action", () => {
    const handleCopy = jest.fn();
    const handleMessageChange = jest.fn();

    render(
      <AutoFillMsgCard
        title="생성 메시지"
        copyButtonText="복사"
        message={"안녕하세요\n반갑습니다"}
        handleCopy={handleCopy}
        onMessageChange={handleMessageChange}
        metaItems={[{ label: "템플릿 유형", value: "안내" }]}
        variableItems={[{ token: "{{name}}", label: "이름", value: "홍길동" }]}
      />,
    );

    const textbox = screen.getByRole("textbox", { name: "메시지 본문" });

    expect(screen.getByText("메시지 본문")).toHaveClass(
      "text-[calc(14.4px*var(--glint-ui-scale,1))]",
    );
    expect(textbox).toHaveValue("안녕하세요\n반갑습니다");
    expect(textbox).toHaveClass(
      "min-h-[calc(280px*var(--glint-ui-scale,1))]",
      "text-[calc(14.08px*var(--glint-ui-scale,1))]",
    );
    expect(screen.getByRole("button", { name: "복사" })).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(screen.getByText("템플릿 유형")).toBeInTheDocument();
    expect(screen.getByText("{{name}}")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "복사" }));
    expect(handleCopy).toHaveBeenCalledTimes(1);

    fireEvent.change(textbox, {
      target: { value: "수정된 메시지" },
    });
    expect(handleMessageChange).toHaveBeenCalledWith("수정된 메시지");
  });

  it("can render detail sections without the internal detail grid wrapper", () => {
    const { container } = render(
      <div data-testid="parent-grid">
        <AutoFillMsgCard
          title="생성 메시지"
          copyButtonText="복사"
          message="안녕하세요"
          handleCopy={jest.fn()}
          layout="flat"
        />
      </div>,
    );

    expect(
      container.querySelector('[data-component="desktop_messages_sections_generated-msg-panel_detail-grid"]'),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-component="desktop_messages_sections_generated-msg-detail-content"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-component="desktop_messages_sections_generated-msg-detail-side"]'),
    ).toBeInTheDocument();
  });

  it("can hide the metadata and variables side panel", () => {
    const { container } = render(
      <AutoFillMsgCard
        title="생성 메시지"
        copyButtonText="복사"
        message="안녕하세요"
        handleCopy={jest.fn()}
        showSide={false}
      />,
    );

    expect(
      container.querySelector('[data-component="desktop_messages_sections_generated-msg-detail-content"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-component="desktop_messages_sections_generated-msg-detail-side"]'),
    ).not.toBeInTheDocument();
  });

  it("shows the shared notification modal after copying when a success message is configured", async () => {
    const handleCopy = jest.fn().mockResolvedValue(undefined);

    render(
      <AutoFillMsgCard
        title="생성 메시지"
        copyButtonText="복사"
        copySuccessMessage="메시지가 복사되었습니다."
        message="안녕하세요"
        handleCopy={handleCopy}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "복사" }));

    const dialog = await screen.findByRole("dialog", { name: "메시지가 복사되었습니다." });
    expect(dialog).toHaveAttribute(
      "data-component",
      "desktop_messages_sections_copy-success-notification",
    );
    expect(handleCopy).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "메시지가 복사되었습니다." })).not.toBeInTheDocument();
    });
  });
});
