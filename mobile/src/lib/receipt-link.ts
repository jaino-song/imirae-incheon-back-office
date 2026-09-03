export const RECEIPT_LINK_REASON_MESSAGES: Record<string, string> = {
  not_voucher_client: "바우처 이용 산모가 아니어서 영수증 안내를 보낼 수 없습니다.",
  missing_birthday: "산모 생년월일이 등록되지 않았습니다. 산모 정보를 먼저 수정해 주세요.",
  no_contract_document: "연결된 계약서를 찾지 못했습니다.",
  document_not_linked: "계약서에 연결된 산모가 없습니다.",
  document_not_found: "계약서를 찾지 못했습니다.",
  pdf_unavailable: "계약서 PDF를 아직 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.",
  missing_phone: "산모 연락처가 없거나 형식이 올바르지 않습니다.",
};

export const RECEIPT_LINK_SEND_FALLBACK_MESSAGE = "영수증 문자 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.";

export function describeReceiptLinkError(error: unknown): string {
  const reason = (error as { response?: { data?: { reason?: string; message?: string } } })?.response?.data
    ?.reason;
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  const mappedReasonMessage =
    reason && Object.prototype.hasOwnProperty.call(RECEIPT_LINK_REASON_MESSAGES, reason)
      ? RECEIPT_LINK_REASON_MESSAGES[reason]
      : undefined;
  return mappedReasonMessage || message || RECEIPT_LINK_SEND_FALLBACK_MESSAGE;
}
