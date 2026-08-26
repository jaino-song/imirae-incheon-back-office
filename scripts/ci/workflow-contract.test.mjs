import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

async function readWorkflow(fileName) {
    return readFile(resolve(WORKSPACE_ROOT, ".github/workflows", fileName), "utf8");
}

function triggerBlock(workflow, trigger, fileName) {
    const match = workflow.match(new RegExp(`\\n  ${trigger}:[\\s\\S]*?(?=\\n  [A-Za-z][^\\n]*:|$)`));
    assert.ok(match, `${fileName} must define a ${trigger} trigger`);
    return match[0];
}

function assertHasPath(workflow, path, fileName) {
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const trigger of ["push", "pull_request"]) {
        assert.match(triggerBlock(workflow, trigger, fileName), new RegExp(`- '${escapedPath}'`), `${fileName} ${trigger} must select ${path}`);
    }
}

function assertUsesPinnedActions(workflow, fileName) {
    const actionLines = workflow.split("\n").filter((line) => line.includes(" uses:") || line.trimStart().startsWith("uses:"));
    assert.ok(actionLines.length > 0, `${fileName} must use setup actions`);
    for (const line of actionLines) {
        assert.match(line, /@[0-9a-f]{40}(?:\s|$)/, `${fileName} action must be pinned to a commit SHA: ${line}`);
    }
}

test("mobile unit gate selects source and configuration changes but not docs-only paths", async () => {
    const workflow = await readWorkflow("mobile-unit-ci.yml");

    for (const path of [
        "mobile/src/**",
        "mobile/tests/**",
        "mobile/scripts/**",
        "mobile/*.config.*",
        "mobile/*config*",
        "mobile/*.json",
        "mobile/package.json",
        "mobile/next-env.d.ts",
        "packages/shared/**",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "scripts/ci/**",
        ".github/workflows/mobile-unit-ci.yml",
    ]) {
        assertHasPath(workflow, path, "mobile-unit-ci.yml");
    }

    assert.match(workflow, /jobs:\n  mobile-unit:/);
    assert.match(workflow, /run: pnpm --filter \.\/mobile test/);
    assert.doesNotMatch(workflow, /- 'mobile\/\*\*'/, "a broad mobile glob would select docs-only changes");
    assert.doesNotMatch(workflow, /- 'mobile\/docs\/\*\*'/, "docs-only mobile changes must stay out of the unit gate");
    assert.doesNotMatch(workflow, /continue-on-error:/, "a skipped or failing unit gate must not be hidden");
    assertUsesPinnedActions(workflow, "mobile-unit-ci.yml");
});

test("shared contract gate covers the package and all three consumers", async () => {
    const workflow = await readWorkflow("shared-contracts-ci.yml");

    for (const path of [
        "packages/shared/**",
        "frontend/**",
        "mobile/**",
        "backend/**",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "scripts/ci/**",
        ".github/workflows/shared-contracts-ci.yml",
    ]) {
        assertHasPath(workflow, path, "shared-contracts-ci.yml");
    }

    assert.match(workflow, /jobs:\n  shared-contracts:/);
    assert.match(workflow, /run: pnpm --filter @babyjamjam\/shared run type-check/);
    assert.match(workflow, /run: pnpm --filter @babyjamjam\/shared test/);
    assert.doesNotMatch(workflow, /continue-on-error:/, "shared tests must remain a truthful gate");
    assertUsesPinnedActions(workflow, "shared-contracts-ci.yml");
});

test("full-flow gate invokes only the local stubbed harness with bounded runtime", async () => {
    const workflow = await readWorkflow("backend-full-flow-ci.yml");

    for (const path of [
        "backend/**",
        "packages/shared/**",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "scripts/ci/**",
        ".github/workflows/backend-full-flow-ci.yml",
    ]) {
        assertHasPath(workflow, path, "backend-full-flow-ci.yml");
    }

    assert.match(workflow, /jobs:\n  full-flow:/);
    assert.match(workflow, /timeout-minutes: 30/);
    assert.match(workflow, /run: pnpm --filter \.\/backend run e2e:full-flow/);
    assert.match(workflow, /E2E_VENDOR_STUBS:\s*['"]1['"]/);
    assert.match(workflow, /EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID:\s*tpl-test/);
    assert.match(workflow, /services:\n      postgres:/);
    assert.doesNotMatch(workflow, /secrets\./, "stubbed full-flow CI must not require provider secrets");
    assert.doesNotMatch(workflow, /continue-on-error:/, "full-flow failures must remain visible");
    assertUsesPinnedActions(workflow, "backend-full-flow-ci.yml");
});
