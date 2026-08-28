import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("ContractsPage provider summaries", () => {
  it("joins repeated provider names and renders only populated provider cards", () => {
    expect(source).toContain("const provider1Names =");
    expect(source).toContain('const provider1Name = provider1Names.join(", ")');
    expect(source).toContain('value: provider1Name || "–"');
    expect(source).toContain("const providers =");
    expect(source).toContain(".filter((provider) => provider.name || provider.contact)");
    expect(source).toContain('providers.length === 1 ? "제공인력"');
  });

  it("derives the contract end date through split and full-field aliases", () => {
    expect(source).toContain("formatIsoDateInput(\n    extractFieldDate(detailedDocument");
    expect(source).toContain('full: ["계약 종료일", "계약종료일", "endDate", "contractEndDate"]');
  });
});

describe("ContractsPage server-side search", () => {
  // A guard against reintroduction, not a behaviour test. Filtering the server's
  // pages client-side is what left hasNextPage describing the UNfiltered table,
  // so the list kept pulling pages that were filtered away and never stopped.
  // What the search actually sends is covered for real in
  // src/hooks/__tests__/useInfiniteContracts.search.test.tsx, which drives the
  // hook and asserts on the request; those tests fail when the fix is reverted.
  //
  // Asserting on source text cannot tell working code from a plausible string,
  // so this file deliberately keeps only the absence check: it survives
  // renames and formatting, and there is no way to satisfy it while still
  // filtering.
  it("no longer filters the server's pages client-side", () => {
    expect(source).not.toContain("matchesDocumentSearch");
  });
});

describe("ContractsPage infinite-scroll presentation", () => {
  it("does not append placeholder rows while fetching the next page", () => {
    expect(source).not.toContain("fetchingMoreCount");
  });
});

describe("ContractsPage maternity template whitelist", () => {
  // A guard against reintroduction, not a behaviour test. The maternity list once
  // showed every non-제공기록지 document in the eformsign account — including
  // unrelated templates (e.g. 근로계약서) — because the section's filter was a
  // blacklist. The whitelist decision now lives in
  // src/lib/eformsign/contract-template-filter.ts, which carries the real
  // behaviour tests; this only checks the page still delegates to it.
  it("derives the maternity list filter through the shared template filter builder", () => {
    expect(source).toContain("buildContractTemplateFilter(");
  });
});

describe("ContractsPage headless finalization fallback", () => {
  it("does not reopen the reviewer iframe when the backend verdict is unknown", () => {
    expect(source).toContain("let transportOutcomeUnknown = false");
    expect(source).toContain("transportOutcomeUnknown = true");
    expect(source).toContain("if (manualCheckRequired || transportOutcomeUnknown)");
    expect(source).not.toContain("headless finalize threw, falling back to iframe");
  });
});
