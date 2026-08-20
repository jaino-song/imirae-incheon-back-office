import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./file-storage-screen"), "utf8");

describe("mobile file preview source", () => {
  it("renders the real authenticated PDF URL instead of invented document content", () => {
    expect(source).toContain("<iframe");
    expect(source).toContain("src={url}");
    expect(source).not.toContain("제1조 (문서 개요)");
    expect(source).not.toContain('doc.uploadedBy || "송진호"');
    expect(source).not.toContain("확인 완료");
  });

  it("uses the document's source category label when the local category list cannot resolve it", () => {
    expect(source).toContain("doc.categoryLabel && !map.has(doc.categoryId)");
    expect(source).toContain("map.set(doc.categoryId, doc.categoryLabel)");
  });
});
