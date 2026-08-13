import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const frontendRoot = path.resolve(__dirname, "..");
const readSource = (...segments: string[]) =>
  fs.readFileSync(path.join(frontendRoot, ...segments), "utf8");

test.describe("contract document jobs wiring", () => {
  test("keeps the queue flag opt-in and uses the exact public env name", () => {
    const source = readSource("src", "lib", "feature-flags.ts");

    expect(source).toContain('"eformsignDocumentJobs"');
    expect(source).toContain("process.env.NEXT_PUBLIC_FEATURE_EFORMSIGN_DOCUMENT_JOBS");
    expect(source).toContain("eformsignDocumentJobs: false");
  });

  test("preserves synchronous and manual creation paths when queue mode is off", () => {
    const source = readSource("src", "components", "app", "contracts", "ContractCreationForm.tsx");

    expect(source).toContain('mode !== "manual" && isFeatureEnabled("eformsignDocumentJobs")');
    expect(source).toContain("useEnqueueEformsignDocumentCreation");
    expect(source).toContain("requestKey: createHeadlessProgressId()");
    expect(source).toContain('toast({ description: "전자문서 작업을 시작했어요" })');
    expect(source).toContain("if (mode !== \"manual\")");
    expect(source).toContain("eformsignApi.generateDocument");
  });

  test("queues finalization only in async mode and closes the modal with a toast", () => {
    const source = readSource("src", "app", "(protected)", "contracts", "page.tsx");

    expect(source).toContain("useEnqueueEformsignDocumentFinalization");
    expect(source).toContain('if (documentJobsEnabled)');
    expect(source).toContain("requestKey: createFinalizeProgressId()");
    expect(source).toContain('return { kind: "queued" }');
    expect(source).toContain("setIsFinalizeOpen(false)");
    expect(source).toContain('toast({ description: "전자문서 작업을 시작했어요" })');
    expect(source).toContain("generateStaffDocument");
  });

  test("renders the processing tile last and passes active-only queue summary data", () => {
    const source = readSource("src", "app", "(protected)", "contracts", "page.tsx");
    const statsSource = readSource("src", "components", "app", "contracts", "ContractStatsBar.tsx");

    expect(source).toContain("<ContractStatsBar");
    expect(source).toContain("documentJobsQuery.summary");
    expect(statsSource).toContain('label="전자문서 처리중"');
    expect(statsSource).toContain("summary?.activeCount ?? 0");
    expect(statsSource).toContain("className=\"ms-auto max-lg:ms-0\"");
  });
});
