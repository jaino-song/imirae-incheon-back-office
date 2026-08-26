import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const WORKFLOW_PATH = resolve(WORKSPACE_ROOT, ".github/workflows/ci-aggregate-gate.yml");

test("aggregate CI workflow has stable PR and merge-queue triggers and read-only API access", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");
    const { COMPONENT_GATES } = await import("./aggregate-gate.mjs");

    assert.match(workflow, /^name: CI Aggregate Gate$/m);
    assert.match(workflow, /^  pull_request:$/m);
    assert.match(workflow, /^  merge_group:$/m);
    assert.match(workflow, /^  workflow_run:$/m);
    assert.match(workflow, /    types: \[completed\]/);
    assert.match(workflow, /^permissions:\n  actions: read\n  checks: read\n  contents: read\n  pull-requests: read/m);
    assert.match(workflow, /^concurrency:\n  group: ci-aggregate-/m);
    assert.match(workflow, /cancel-in-progress: true/);
    assert.match(workflow, /if: >-\n\s+github\.event_name != 'workflow_run'/);
    assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40} # v[0-9.]+/);
    assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
    assert.match(workflow, /persist-credentials: false/);
    assert.doesNotMatch(workflow, /secrets\./, "the aggregate must not consume repository secrets");
    assert.doesNotMatch(workflow, /continue-on-error:/, "the aggregate must remain a truthful gate");
    assert.match(workflow, /run: node scripts\/ci\/aggregate-gate\.mjs/);
    for (const gate of COMPONENT_GATES) {
        assert.match(workflow, new RegExp(`^      - ${gate.workflow.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`, "m"));
    }
});

test("aggregate evaluator rejects missing and non-success component jobs", async () => {
    const { evaluateGateRuns } = await import("./aggregate-gate.mjs");
    const gates = [
        { workflow: "Backend CI", jobs: ["backend verify"] },
        { workflow: "Frontend CI", jobs: ["frontend verify"] },
    ];

    assert.throws(
        () => evaluateGateRuns(gates, new Map()),
        /Backend CI.*missing/i,
    );

    assert.throws(
        () => evaluateGateRuns(
            gates,
            new Map([
                ["Backend CI", { status: "completed", conclusion: "success", jobs: [] }],
                ["Frontend CI", { status: "completed", conclusion: "success", jobs: [{ name: "frontend verify", status: "completed", conclusion: "skipped" }] }],
            ]),
        ),
        /Backend CI.*backend verify.*missing|Frontend CI.*skipped/i,
    );
});

test("aggregate evaluator accepts only completed-success jobs and selects all changed-surface gates", async () => {
    const { COMPONENT_GATES, evaluateGateRuns, requiredGatesForFiles } = await import("./aggregate-gate.mjs");
    const changedFiles = ["backend/application/usecases/example.ts", "frontend/src/app/page.tsx", "native/androidApp/src/main/AndroidManifest.xml"];
    const selected = requiredGatesForFiles(changedFiles);
    const selectedNames = selected.map((gate) => gate.workflow);

    assert.ok(selectedNames.includes("Backend CI"));
    assert.ok(selectedNames.includes("Frontend CI"));
    assert.ok(selectedNames.includes("Backend Full Flow CI"));
    assert.ok(selectedNames.includes("Shared Contracts CI"));
    assert.ok(selectedNames.includes("Native Android CI"));
    assert.ok(selectedNames.includes("Native iOS CI"));
    assert.ok(COMPONENT_GATES.length >= selected.length);

    const runs = new Map(selected.map((gate) => [gate.workflow, {
        status: "completed",
        conclusion: "success",
        jobs: gate.jobs.map((name) => ({ name, status: "completed", conclusion: "success" })),
    }]));
    assert.deepEqual(evaluateGateRuns(selected, runs).ok, true);
});

test("required merge-queue child workflows are mounted without path filters", async () => {
    const requiredFiles = [
        "backend-ci.yml",
        "backend-full-flow-ci.yml",
        "frontend-ci.yml",
        "mobile-ci.yml",
        "mobile-unit-ci.yml",
        "playwright.yml",
        "security.yml",
        "shared-contracts-ci.yml",
        "native-android.yml",
        "native-ios.yml",
    ];
    for (const fileName of requiredFiles) {
        const workflow = await readFile(resolve(WORKSPACE_ROOT, ".github/workflows", fileName), "utf8");
        assert.match(workflow, /^  merge_group:\s*$/m, `${fileName} must report a merge-queue run`);
    }

    const mobileWorkflow = await readFile(resolve(WORKSPACE_ROOT, ".github/workflows/mobile-ci.yml"), "utf8");
    assert.match(mobileWorkflow, /github\.event_name == 'merge_group'/, "mobile E2E must run for merge-queue checks");
});

test("aggregate evaluator selects the latest run and refuses stale green results", async () => {
    const { selectLatestWorkflowRun, evaluateGateRuns } = await import("./aggregate-gate.mjs");
    const runs = [
        { id: 1, name: "Backend CI", head_sha: "abc", event: "pull_request", run_number: 10, run_attempt: 1, status: "completed", conclusion: "success" },
        { id: 2, name: "Backend CI", head_sha: "abc", event: "pull_request", run_number: 11, run_attempt: 1, status: "completed", conclusion: "failure" },
    ];
    const latest = selectLatestWorkflowRun(runs, "Backend CI", "abc", "pull_request");
    assert.equal(latest.id, 2);
    assert.throws(
        () => evaluateGateRuns([{ workflow: "Backend CI", jobs: ["backend verify"] }], new Map([["Backend CI", { ...latest, jobs: [] }]])),
        /workflow conclusion is failure/i,
    );
});

test("aggregate runner joins the PR file inventory to same-SHA workflow and job results", async () => {
    const { COMPONENT_GATES, runAggregate } = await import("./aggregate-gate.mjs");
    const changedFiles = ["backend/application/usecases/example.ts", "frontend/src/app/page.tsx"];
    const selectedGates = COMPONENT_GATES.filter((gate) => gate.always || gate.paths?.some((pattern) => pattern === "backend/**" || pattern === "frontend/**"));
    const runs = selectedGates.map((gate, index) => ({
        id: 100 + index,
        name: gate.workflow,
        head_sha: "sha-under-test",
        event: "pull_request",
        run_number: index + 1,
        run_attempt: 1,
        status: "completed",
        conclusion: "success",
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const requestUrl = String(url);
        if (requestUrl.includes("/pulls/42/files")) {
            return { ok: true, status: 200, text: async () => JSON.stringify(changedFiles.map((filename) => ({ filename }))) };
        }
        if (requestUrl.includes("/actions/runs?head_sha=")) {
            return { ok: true, status: 200, text: async () => JSON.stringify({ workflow_runs: runs }) };
        }
        const runId = Number(requestUrl.match(/actions\/runs\/(\d+)\/jobs/)?.[1]);
        const run = runs.find((candidate) => candidate.id === runId);
        assert.ok(run, `unexpected jobs request: ${requestUrl}`);
        const gate = selectedGates.find((candidate) => candidate.workflow === run.name);
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ jobs: gate.jobs.map((name) => ({ name, status: "completed", conclusion: "success" })) }),
        };
    };

    try {
        assert.deepEqual(
            (await runAggregate({
                eventName: "pull_request",
                payload: { pull_request: { number: 42, head: { sha: "sha-under-test" } } },
                repository: "owner/repository",
                token: "test-token",
            })).ok,
            true,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("aggregate runner resolves merge-group files from the synthetic commit when PR links are absent", async () => {
    const { COMPONENT_GATES, runAggregate } = await import("./aggregate-gate.mjs");
    const selectedGates = COMPONENT_GATES.filter((gate) => gate.always);
    const runs = selectedGates.map((gate, index) => ({
        id: 200 + index,
        name: gate.workflow,
        head_sha: "merge-sha",
        event: "merge_group",
        run_number: index + 1,
        run_attempt: 1,
        status: "completed",
        conclusion: "success",
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const requestUrl = String(url);
        if (requestUrl.includes("/commits/merge-sha/pulls")) {
            return { ok: true, status: 200, text: async () => "[]" };
        }
        if (requestUrl.endsWith("/commits/merge-sha")) {
            return { ok: true, status: 200, text: async () => JSON.stringify({ parents: [{ sha: "merge-base" }] }) };
        }
        if (requestUrl.includes("/compare/merge-base...merge-sha")) {
            return { ok: true, status: 200, text: async () => JSON.stringify({ files: [{ filename: "docs/README.md" }] }) };
        }
        if (requestUrl.includes("/actions/runs?head_sha=")) {
            return { ok: true, status: 200, text: async () => JSON.stringify({ workflow_runs: runs }) };
        }
        const runId = Number(requestUrl.match(/actions\/runs\/(\d+)\/jobs/)?.[1]);
        const run = runs.find((candidate) => candidate.id === runId);
        assert.ok(run, `unexpected jobs request: ${requestUrl}`);
        const gate = selectedGates.find((candidate) => candidate.workflow === run.name);
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ jobs: gate.jobs.map((name) => ({ name, status: "completed", conclusion: "success" })) }),
        };
    };

    try {
        assert.deepEqual(
            (await runAggregate({
                eventName: "workflow_run",
                payload: { workflow_run: { event: "merge_group", head_sha: "merge-sha", pull_requests: [] } },
                repository: "owner/repository",
                token: "test-token",
            })).ok,
            true,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});
