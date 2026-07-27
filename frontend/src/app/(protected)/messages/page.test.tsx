import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("MessagesPage template type labels", () => {
  it("keeps branch template semantics when the selected detail is unavailable", () => {
    expect(source).toContain("const isBranchTemplate = userTemplateId !== null");
    expect(source).toContain('isBranchTemplate ? "지점 템플릿" : "기본 템플릿"');
    expect(source).toContain("지점 템플릿 · 정보를 불러오지 못했습니다.");
  });
});
