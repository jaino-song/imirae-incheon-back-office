import { render } from "@testing-library/react";

import { ContractsListItem } from "../ContractsListItem";
import type { EformsignDocument } from "@/lib/eformsign/types";

function documentFixture(): EformsignDocument {
  return {
    id: "doc-1",
    document_number: "C-0001",
    template: { id: "template-1", name: "산모 서비스 계약서" },
    document_name: "산모신생아건강관리서비스 계약서",
    creator: { recipient_type: "01", id: "creator", name: "인천 아이미래로" },
    created_date: 0,
    last_editor: { recipient_type: "01", id: "editor", name: "인천 아이미래로" },
    updated_date: 0,
    current_status: {
      status_type: "060",
      status_doc_type: "",
      status_doc_detail: "",
      step_type: "05",
      step_index: "2",
      step_name: "이용자",
      step_recipients: [],
      step_group: 0,
      expired_date: 0,
      _expired: false,
    },
    fields: [],
    next_status: [],
    previous_status: [],
    histories: [],
    recipients: [],
    detail_template_info: [],
  };
}

function title(container: HTMLElement): Element | null {
  return container.querySelector('[data-component="desktop_contracts_tests_list-item_title"]');
}

function subtitle(container: HTMLElement): Element | null {
  return container.querySelector('[data-component="desktop_contracts_tests_list-item_subtitle"]');
}

describe("ContractsListItem", () => {
  it.each([
    ["pending", "서명 대기", "bg-v3-dim-white", "text-v3-text-muted"],
    ["signed", "서명 완료", "bg-v3-primary-light", "text-v3-primary"],
    ["review", "검토 필요", "bg-v3-orange-light", "text-v3-orange"],
    ["completed", "계약 완료", "bg-v3-green-light", "text-v3-green"],
    ["expired", "기간 만료", "bg-v3-burgundy-light", "text-v3-burgundy"],
  ] as const)(
    "matches the avatar tone to the %s status badge",
    (displayStatus, statusLabel, avatarBackgroundClass, avatarIconClass) => {
      const document = {
        ...documentFixture(),
        display_status: displayStatus,
      };
      const { container } = render(
        <ContractsListItem
          data-component="desktop_contracts_tests_list-item"
          document={document}
          customerName="송진호"
          isLoading={false}
        />,
      );

      expect(container.querySelector('[data-component="desktop_contracts_tests_list-item_status"]')).toHaveTextContent(statusLabel);
      const avatar = container.querySelector('[data-component="desktop_contracts_tests_list-item_icon"]');
      expect(avatar).toHaveClass(avatarBackgroundClass);
      expect(avatar?.querySelector("svg")).toHaveClass(avatarIconClass);
    },
  );

  it.each([null, "", "   ", "-"])(
    "shows 이름 없음 when the recipient name is unresolved (%p)",
    (customerName) => {
      const { container } = render(
        <ContractsListItem
          data-component="desktop_contracts_tests_list-item"
          document={documentFixture()}
          customerName={customerName}
          isLoading={false}
        />,
      );

      expect(title(container)).toHaveTextContent("이름 없음");
      expect(title(container)).toHaveClass("italic", "text-v3-text-muted");
    },
  );

  it("keeps an API-derived recipient name", () => {
    const { container } = render(
      <ContractsListItem
        data-component="desktop_contracts_tests_list-item"
        document={documentFixture()}
        customerName="  송진호  "
        isLoading={false}
      />,
    );

    expect(title(container)).toHaveTextContent("송진호");
    expect(title(container)).not.toHaveClass("italic", "text-v3-text-muted");
  });

  it("uses the supplied subtitle label instead of the stored document name", () => {
    const { container } = render(
      <ContractsListItem
        data-component="desktop_contracts_tests_list-item"
        document={documentFixture()}
        customerName="송진호"
        subtitle="제공기록지"
        isLoading={false}
      />,
    );

    expect(subtitle(container)).toHaveTextContent("제공기록지");
    expect(subtitle(container)).not.toHaveTextContent("산모신생아건강관리서비스 계약서");
  });
});
