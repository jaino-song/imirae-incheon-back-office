import fs from "node:fs";

const source = fs.readFileSync(require.resolve("./ContractCreationForm"), "utf8");

describe("ContractCreationForm compensation flows", () => {
  it("should show the conflict error and stop before document creation when automatic registration is off", () => {
    expect(source).toContain('error.response?.status !== 409');
    expect(source).toContain('throw new Error(getApiErrorMessage(error, "고객 자동 등록에 실패했습니다."))');
    expect(source.indexOf('throw new Error(getApiErrorMessage(error, "고객 자동 등록에 실패했습니다."))'))
      .toBeLessThan(source.indexOf("eformsignApi.authenticate"));
  });

  it("should request approval and retry with reuseExistingClient for a phone conflict", () => {
    expect(source).toContain('requestConfirmation("이미 같은 전화번호의 고객이 있습니다. 기존 고객으로 계약을 진행할까요?")');
    expect(source).toContain("reuseExistingClient: true");
    expect(source).toContain('dataComponent="desktop_contracts_creation_confirmation"');
  });

  it("should adopt a remotely created document without opening the iframe after local persistence fails", () => {
    const branch = source.slice(
      source.indexOf('headless.reason === "local_persist_failed"'),
      source.indexOf('headless.reason === "remote_unconfirmed"'),
    );
    expect(branch).toContain("eformsignApi.adoptDocument");
    expect(branch).not.toContain("openDocument(");
  });

  it("should not report adoption success while the local mirror is incomplete", () => {
    const branch = source.slice(
      source.indexOf('headless.reason === "local_persist_failed"'),
      source.indexOf('headless.reason === "remote_unconfirmed"'),
    );
    expect(branch).toContain('adopted.warnings?.includes("mirror_sync_failed")');
    expect(branch).toContain("전자문서와 PDF 동기화가 완료되지 않았습니다.");
    expect(branch).toContain("markCreationProgressFailed()");
    expect(branch.indexOf('adopted.warnings?.includes("mirror_sync_failed")'))
      .toBeLessThan(branch.indexOf("setIsCreationSuccessOpen(true)"));
  });

  it("should request approval and retry duplicate pending documents with force true", () => {
    const branch = source.slice(
      source.indexOf('headless.reason === "duplicate_pending_document"'),
      source.indexOf('console.warn(\n            "[contract-creation] headless dispatch returned ok=false"'),
    );
    expect(branch).toContain('requestConfirmation("최근 생성된 진행 중 문서가 있습니다. 그래도 새로 생성하시겠습니까?")');
    expect(branch).toContain("progressId, true");
  });
});
