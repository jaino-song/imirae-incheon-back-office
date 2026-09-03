import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("mobile contracts action lifecycle", () => {
  it("locks document deletion through the required cache refresh", () => {
    expect(source).toContain("const [isDeletingDocument, setIsDeletingDocument] = useState(false)");
    expect(source).toContain(
      "const isDeleteDocumentBusy = isDeletingDocument || deleteDocument.isPending",
    );
    expect(source).toContain("if (!deleteTargetDoc || isDeleteDocumentBusy) return");
    expect(source).toContain("loading={isDeleteDocumentBusy}");
    expect(source).toContain("setIsDeletingDocument(false)");
  });

  it("keeps finalization busy through success progress and iframe handoff", () => {
    expect(source).toContain("const closeStaffIframe = useCallback(() =>");
    expect(source).toContain("let keepFinalizeSubmittingUntilIframeCloses = false");
    expect(source).toContain("keepFinalizeSubmittingUntilIframeCloses = true");
    expect(source).toContain("if (!keepFinalizeSubmittingUntilIframeCloses)");
    expect(source).toContain("setIsFinalizeSubmitting(false)");
  });

  it("does not open the iframe when finalization needs a manual status check", () => {
    expect(source).toContain("let transportOutcomeUnknown = false");
    expect(source).toContain("transportOutcomeUnknown = true");
    expect(source).toContain(
      "shouldOpenFinalizeIframe(fallbackHint, transportOutcomeUnknown)",
    );
  });

  it("wires the receipt-link send action through a busy confirm modal", () => {
    expect(source).toContain("setIsSendingReceiptLink(true)");
    expect(source).toContain("disabled: isSendingReceiptLink");
    expect(source).toContain(
      "mobile_contracts_detail-sheet_stack_detail-page_actions_receipt-send",
    );
    expect(source).toContain(
      "mobile_contracts_detail-sheet_stack_detail-page_dialogs_receipt-send-confirm",
    );
    expect(source).toContain(
      "`${result.clientName} 산모님께 1분 내 발송됩니다. 링크는 30일간 유효합니다.`",
    );
  });

  // Textual pin, not a render test (see audit brief F2): the trigger's onClick only
  // opens the confirm modal — it must never call eformsignApi.sendReceiptLink or the
  // handleSendReceiptLink mutation itself. Mutant that must fail: the action's onClick
  // becoming a no-op (or calling the mutation directly, skipping the confirm modal).
  it("pins the receipt-send trigger to opening the confirm modal, and the modal's approve action to the send mutation", () => {
    expect(source).toContain("onClick: () => setIsReceiptSendConfirmOpen(true)");
    expect(source).toContain("onApprove={handleSendReceiptLink}");
    expect(source).toContain(
      "const handleSendReceiptLink = async () => {\n    setIsSendingReceiptLink(true);",
    );
    expect(source).toContain("const result = await eformsignApi.sendReceiptLink(doc.id);");
  });

  it("blanks the shared UNKNOWN_CUSTOMER_NAME placeholder before building the receipt-send confirm copy (F6)", () => {
    expect(source).toContain(
      "const receiptSendCustomerName =\n    resolvedCustomerName === UNKNOWN_CUSTOMER_NAME ? \"\" : resolvedCustomerName;",
    );
    expect(source).toContain(
      "description={`${receiptSendCustomerName ? `${receiptSendCustomerName} 산모님께 ` : \"\"}본인부담금 영수증 링크가 담긴 문자를 1분 내 발송합니다.",
    );
  });
});
