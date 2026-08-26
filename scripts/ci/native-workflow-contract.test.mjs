import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const WORKFLOW_ROOT = resolve(WORKSPACE_ROOT, ".github/workflows");

async function readWorkflow(fileName) {
    return readFile(resolve(WORKFLOW_ROOT, fileName), "utf8");
}

function assertNativeTriggers(workflow, fileName) {
    assert.match(workflow, /^name: Native (?:Android|iOS) CI$/m, `${fileName} must have the aggregate gate name`);
    assert.match(workflow, /^  push:\n    branches: \[dev\][\s\S]*?      - ["']native\/\*\*["']/m, `${fileName} must run native changes pushed to dev`);
    assert.match(workflow, /^  pull_request:\n    branches: \[main, dev, preview\][\s\S]*?      - ["']native\/\*\*["']/m, `${fileName} must cover canonical PR branches and native paths`);
    assert.match(workflow, /^  merge_group:\n    types: \[checks_requested\]$/m, `${fileName} must run in merge queues without a path filter`);
    assert.match(workflow, /^permissions:\n  contents: read\n/m, `${fileName} must default to read-only repository access`);
    assert.doesNotMatch(workflow, /pull_request_target|continue-on-error:/, `${fileName} must not bypass untrusted-code or failure gates`);
    assert.doesNotMatch(workflow, /secrets\.|^[ ]{4,}[A-Za-z-]+: write$/m, `${fileName} must not introduce privileged native CI access`);
}

function assertPinnedActions(workflow, fileName) {
    const actionLines = workflow.split("\n").filter((line) => /\buses:\s+/.test(line));
    assert.ok(actionLines.length > 0, `${fileName} must use repository setup actions`);
    for (const line of actionLines) {
        assert.match(line, /@[0-9a-f]{40}\s+#\s+v[0-9]+(?:\.[0-9]+)+/, `${fileName} actions must use full immutable SHAs with release labels: ${line}`);
    }
}

test("native lanes are discoverable at the repository workflow root and old nested lanes are removed", async () => {
    await Promise.all([
        access(resolve(WORKFLOW_ROOT, "native-android.yml")),
        access(resolve(WORKFLOW_ROOT, "native-ios.yml")),
    ]);
    for (const nestedFile of ["native/.github/workflows/native-android.yml", "native/.github/workflows/native-ios.yml"]) {
        await assert.rejects(
            readFile(resolve(WORKSPACE_ROOT, nestedFile), "utf8"),
            (error) => error?.code === "ENOENT",
            `${nestedFile} must not remain as an unreachable duplicate lane`,
        );
    }
});

test("every repository-root workflow remains syntactically valid YAML", async () => {
    const names = (await readdir(WORKFLOW_ROOT)).filter((name) => /\.(?:yml|yaml)$/.test(name)).sort();
    const result = spawnSync(
        "ruby",
        ["-ryaml", "-e", "ARGV.each { |file| YAML.load_file(file) }", ...names.map((name) => resolve(WORKFLOW_ROOT, name))],
        { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout || "workflow YAML parsing failed");
});

test("native Android workflow has real shared and Android compile/test commands", async () => {
    const workflow = await readWorkflow("native-android.yml");
    assertNativeTriggers(workflow, "native-android.yml");
    assert.match(workflow, /^jobs:\n  android_ci:\n    name: Android CI$/m);
    assert.match(workflow, /native\/scripts\/setup-doc-freshness\.test\.sh/);
    assert.match(workflow, /:shared:compileAndroidMain/);
    assert.match(workflow, /:androidApp:test/);
    assert.match(workflow, /:androidApp:lint/);
    assert.match(workflow, /:androidApp:assembleDebug/);
    assert.match(workflow, /ANDROID_(?:HOME|SDK_ROOT)/);
    assert.match(workflow, /::error::[\s\S]*?\n[\s\S]*?exit 1/, "missing Android SDK metadata must fail the lane");
    assertPinnedActions(workflow, "native-android.yml");
    assert.match(workflow, /jobs:\n[\s\S]*?sca_scan:\n    name: SCA Scan/);
});

test("native iOS workflow has real shared framework and Xcode build/test commands", async () => {
    const workflow = await readWorkflow("native-ios.yml");
    assertNativeTriggers(workflow, "native-ios.yml");
    assert.match(workflow, /^jobs:\n  ios_ci:\n    name: iOS CI$/m);
    assert.match(workflow, /native\/scripts\/setup-doc-freshness\.test\.sh/);
    assert.match(workflow, /:shared:linkDebugFrameworkIosSimulatorArm64/);
    assert.match(workflow, /xcodebuild[\s\S]*\btest\b/);
    assert.match(workflow, /\.xcodeproj|\.xcworkspace/);
    assert.match(workflow, /::error::[\s\S]*?\n[\s\S]*?exit 1/, "missing iOS project metadata must fail the lane");
    assertPinnedActions(workflow, "native-ios.yml");
    assert.match(workflow, /jobs:\n[\s\S]*?sca_scan:\n    name: SCA Scan/);
});

test("native workflow names and jobs remain connected to the stable aggregate gate", async () => {
    const aggregate = await readWorkflow("ci-aggregate-gate.yml");
    const evaluator = await readFile(resolve(WORKSPACE_ROOT, "scripts/ci/aggregate-gate.mjs"), "utf8");
    for (const [workflow, job] of [["Native Android CI", "Android CI"], ["Native iOS CI", "iOS CI"]]) {
        assert.match(aggregate, new RegExp(`- ${workflow.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}`), `${workflow} must be observed by workflow_run`);
        assert.match(evaluator, new RegExp(`workflow: "${workflow}"[\\s\\S]*?jobs: \\["${job}", "SCA Scan"\\]`), `${workflow} must retain its exact aggregate job contract`);
    }
});
