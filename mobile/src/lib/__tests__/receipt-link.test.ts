import {
  RECEIPT_LINK_REASON_MESSAGES,
  RECEIPT_LINK_SEND_FALLBACK_MESSAGE,
  describeReceiptLinkError,
} from "@/lib/receipt-link";

// M4: pins the exact seven reason keys — copied from
// frontend/src/lib/__tests__/receipt-link.test.ts so the mobile twin can't silently drift
// out of sync with the desktop constant (same keys, same strings).
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
    const error = {
      response: { data: { reason: "missing_phone", message: "some other server message" } },
    };
    expect(describeReceiptLinkError(error)).toBe(RECEIPT_LINK_REASON_MESSAGES.missing_phone);
  });

  it("falls back to the server message when no reason is present (real 403 sender-approval body)", () => {
    const error = { response: { data: { message: "메시지 발송 권한 승인이 필요합니다." } } };
    expect(describeReceiptLinkError(error)).toBe("메시지 발송 권한 승인이 필요합니다.");
  });

  it("falls back to the server message when the reason has no mapped copy", () => {
    const error = { response: { data: { reason: "some_unmapped_reason", message: "server said no" } } };
    expect(describeReceiptLinkError(error)).toBe("server said no");
  });

  it("returns the fallback message when neither a mapped reason nor a server message is present", () => {
    expect(describeReceiptLinkError({})).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
    expect(describeReceiptLinkError(new Error("network down"))).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
    expect(describeReceiptLinkError({ response: { data: {} } })).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
  });

  it("keeps the missing_phone reason copy stable", () => {
    expect(RECEIPT_LINK_REASON_MESSAGES.missing_phone).toBe("산모 연락처가 없거나 형식이 올바르지 않습니다.");
  });

  it("does not resolve Object.prototype keys as reason messages", () => {
    const error = { response: { data: { reason: "constructor" } } };
    const result = describeReceiptLinkError(error);
    expect(typeof result).toBe("string");
    expect(result).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
  });

  it("does not resolve Object.prototype keys even when a server message is also absent", () => {
    const error = { response: { data: { reason: "toString" } } };
    const result = describeReceiptLinkError(error);
    expect(typeof result).toBe("string");
    expect(result).not.toEqual(expect.any(Function));
    expect(result).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
  });

  it("falls back to the generic message when the server message is an array (nest-style validation errors)", () => {
    const error = { response: { data: { message: ["birthday must be a string"] } } };
    expect(describeReceiptLinkError(error)).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
  });

  it("falls back to the generic message when the server message is an object", () => {
    const error = { response: { data: { message: { detail: "unexpected shape" } } } };
    expect(describeReceiptLinkError(error)).toBe(RECEIPT_LINK_SEND_FALLBACK_MESSAGE);
  });
});
