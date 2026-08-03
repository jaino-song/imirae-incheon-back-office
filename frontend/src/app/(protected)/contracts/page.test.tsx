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
