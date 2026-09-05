import {
  RECEIPT_LINK_REASON_MESSAGES,
  RECEIPT_LINK_SEND_FALLBACK_MESSAGE,
  describeReceiptLinkError,
} from "../receipt-link";

function errorWithData(data: unknown) {
  return { response: { data } };
}

describe("RECEIPT_LINK_REASON_MESSAGES", () => {
  it("declares exactly the seven backend reason codes, no more, no less", () => {
    expect(Object.keys(RECEIPT_LINK_REASON_MESSAGES).sort()).toEqual(
      [
        "not_voucher_client",
        "missing_birthday",
        "no_contract_document",
        "document_not_linked",
        "document_not_found",
        "pdf_unavailable",
        "missing_phone",
      ].sort(),
    );
  });

  it("uses the literal Korean copy for missing_phone", () => {
    expect(RECEIPT_LINK_REASON_MESSAGES.missing_phone).toBe(
      "산모 연락처가 없거나 형식이 올바르지 않습니다.",
    );
  });
});

describe("describeReceiptLinkError", () => {
  it("prefers the mapped reason message over a server message", () => {
    const error = errorWithData({
      reason: "missing_phone",
      message: "이 메시지는 무시되어야 합니다",
    });
    expect(describeReceiptLinkError(error)).toBe(RECEIPT_LINK_REASON_MESSAGES.missing_phone);
  });

  it("falls back to the server message for an unmapped reason (the real 403 sender-approval body)", () => {
    const error = errorWithData({ message: "메시지 발송 권한 승인이 필요합니다." });
    expect(describeReceiptLinkError(error)).toBe("메시지 발송 권한 승인이 필요합니다.");
  });

  it("falls back to the generic message when neither reason nor message is present", () => {
    expect(describeReceiptLinkError(errorWithData({}))).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
    expect(describeReceiptLinkError(new Error("network down"))).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
    expect(describeReceiptLinkError(undefined)).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
  });

  it("falls back to the generic message when message is a non-string (class-validator array body)", () => {
    const error = errorWithData({ message: ["documentId should not be empty"] });
    expect(describeReceiptLinkError(error)).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
  });

  it("never resolves a prototype-key reason (e.g. toString) to a function", () => {
    const error = errorWithData({ reason: "toString" });
    const result = describeReceiptLinkError(error);
    expect(typeof result).toBe("string");
    expect(result).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
  });

  it("still prefers a server message over the fallback when the prototype-key reason has no server message", () => {
    const error = errorWithData({ reason: "constructor", message: "제출 정보가 올바르지 않습니다" });
    expect(describeReceiptLinkError(error)).toBe("제출 정보가 올바르지 않습니다");
  });
});
