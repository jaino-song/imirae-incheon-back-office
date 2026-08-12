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
});
