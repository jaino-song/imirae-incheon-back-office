import {
  UNKNOWN_CUSTOMER_NAME,
  contractDisplayName,
  customerName,
  mergeDocumentForDisplayData,
  resolveDocumentCustomerName,
} from "@/lib/eformsign/display-name";
import type { EformsignDocument } from "@/lib/eformsign/types";

function documentFixture(overrides: Partial<EformsignDocument> = {}): EformsignDocument {
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
    ...overrides,
  };
}

describe("contract display names", () => {
  it("uses eformsign document fields as the customer name source", () => {
    const doc = documentFixture({
      fields: [{ id: "이용자 성명", value: "송진호" }],
    });

    expect(customerName(doc)).toBe("송진호");
  });

  it("does not use internal creator/editor names as customer names", () => {
    const doc = documentFixture();

    expect(customerName(doc)).toBe(UNKNOWN_CUSTOMER_NAME);
  });

  it("does not use recipients as customer name fallbacks", () => {
    const doc = documentFixture({
      current_status: {
        ...documentFixture().current_status,
        step_recipients: [{ recipient_type: "02", name: "현재 단계 수신자" }],
      },
      recipients: [{ recipient_type: "02", name: "과거 수신자" }],
    });

    expect(customerName(doc)).toBe(UNKNOWN_CUSTOMER_NAME);
  });

  it("does not use top-level document metadata as customer names", () => {
    const doc = documentFixture({
      clientName: "로컬 고객명",
      customerName: "로컬 고객명",
    } as Partial<EformsignDocument>);

    expect(customerName(doc)).toBe(UNKNOWN_CUSTOMER_NAME);
  });

  it("recovers customer name from detailed eformsign fields when list data is missing it", () => {
    const listDoc = documentFixture();
    const detailDoc = documentFixture({
      fields: [{ id: "이용자 성명", value: "송진호" }],
    });

    const merged = mergeDocumentForDisplayData(listDoc, detailDoc);

    expect(customerName(listDoc)).toBe(UNKNOWN_CUSTOMER_NAME);
    expect(contractDisplayName(merged)).toBe("송진호");
  });

  it("reads customer name from keyed field value maps returned by document detail APIs", () => {
    const doc = documentFixture({
      fields: [{ field_values: { "이용자 성명": "송진호" } }],
    });

    expect(customerName(doc)).toBe("송진호");
  });

  it("prefers the customer name embedded in the document over a stale client mapping", () => {
    const doc = documentFixture({
      fields: [{ id: "이용자 성명", value: "안현주" }],
    });

    expect(resolveDocumentCustomerName(doc, "인천 아이미래로")).toBe("안현주");
  });

  it("uses the client mapping only when the document has no customer name", () => {
    expect(resolveDocumentCustomerName(documentFixture(), " 송진호 ")).toBe("송진호");
  });
});
