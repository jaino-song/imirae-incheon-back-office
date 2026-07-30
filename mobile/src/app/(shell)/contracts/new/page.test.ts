import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("mobile contract creation compensation flow", () => {
  it("does not navigate after adoption leaves the local mirror incomplete", () => {
    const branch = source.slice(
      source.indexOf('headless.reason === "local_persist_failed"'),
      source.indexOf('headless.reason === "remote_unconfirmed"'),
    );

    expect(branch).toContain('adopted.warnings?.includes("mirror_sync_failed")');
    expect(branch).toContain("전자문서와 PDF 동기화가 완료되지 않았습니다.");
    expect(branch).toContain("completed: false");
    expect(branch).toContain("failed: true");
    const warningBranch = branch.slice(
      branch.indexOf('adopted.warnings?.includes("mirror_sync_failed")'),
      branch.indexOf("return;", branch.indexOf('adopted.warnings?.includes("mirror_sync_failed")')),
    );
    expect(warningBranch).toContain(
      "queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.documents() })",
    );
    expect(branch.indexOf('adopted.warnings?.includes("mirror_sync_failed")'))
      .toBeLessThan(branch.indexOf('router.push("/contracts")'));
  });
});
