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
});
