import { matchesDocumentSearch } from "@/lib/eformsign/contract-search";
import type { EformsignDocument } from "@/lib/eformsign/types";

function documentFixture(fields: unknown[] = []): EformsignDocument {
  return {
    document_name: "산모 서비스 계약서",
    fields,
  } as EformsignDocument;
}

describe("contract document search", () => {
  it("matches the customer name displayed from the document when the local mapping is stale", () => {
    expect(
      matchesDocumentSearch(
        documentFixture([{ id: "이용자 성명", value: "안현주" }]),
        "안현주",
        "인천 아이미래로",
      ),
    ).toBe(true);
  });

  it("falls back to the local mapping when the document has no customer name", () => {
    expect(matchesDocumentSearch(documentFixture(), "송진호", " 송진호 ")).toBe(true);
  });
});
