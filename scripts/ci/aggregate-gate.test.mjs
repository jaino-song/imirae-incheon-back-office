import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const WORKFLOW_PATH = resolve(WORKSPACE_ROOT, ".github/workflows/ci-aggregate-gate.yml");

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBootstrapSource(workflow) {
    const sourceStart = workflow.indexOf("node --input-type=module <<'AGGREGATE_BOOTSTRAP'");
    const sourceEndMatch = workflow.slice(sourceStart).match(/\n\s*AGGREGATE_BOOTSTRAP\s*$/m);
    const sourceEnd = sourceEndMatch ? sourceStart + sourceEndMatch.index : -1;
    assert.ok(sourceStart >= 0, "the bootstrap evaluator must be embedded in the workflow");
    assert.ok(sourceEnd > sourceStart, "the bootstrap evaluator heredoc must be closed");

    return workflow
        .slice(workflow.indexOf("\n", sourceStart) + 1, sourceEnd)
        .replace(/^ {12}/gm, "");
}

async function runBootstrapSource(source, payload, fixture, eventName = "pull_request") {
    const directory = await mkdtemp(join(tmpdir(), "aggregate-bootstrap-"));
    const eventPath = join(directory, "event.json");
    await writeFile(eventPath, JSON.stringify(payload));

    const fetchStub = `
const fixture = JSON.parse(process.env.BOOTSTRAP_FIXTURE);
globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/repos/owner/repository/pulls/7/files") {
        return { ok: true, status: 200, text: async () => JSON.stringify(fixture.files) };
    }
    if (url.pathname.includes("/compare/")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ files: fixture.files }) };
    }
    if (url.pathname === "/repos/owner/repository/actions/runs") {
        return { ok: true, status: 200, text: async () => JSON.stringify({ workflow_runs: fixture.runs }) };
    }
    const runId = Number(url.pathname.match(/actions\\/runs\\/(\\d+)\\/jobs/)?.[1]);
    const run = fixture.runs.find((candidate) => candidate.id === runId);
    if (!run) {
        return { ok: false, status: 404, text: async () => "not found" };
    }
    return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ jobs: run.jobs }),
    };
};
`;

    try {
        return spawnSync(process.execPath, ["--input-type=module"], {
            input: `${fetchStub}\n${source}`,
            encoding: "utf8",
            env: {
                ...process.env,
                BOOTSTRAP_FIXTURE: JSON.stringify(fixture),
                GITHUB_API_URL: "https://api.github.test",
                GITHUB_EVENT_NAME: eventName,
                GITHUB_EVENT_PATH: eventPath,
                GITHUB_REPOSITORY: "owner/repository",
                GITHUB_TOKEN: "read-only-test-token",
            },
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

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
    assert.match(workflow, /node scripts\/ci\/aggregate-gate\.mjs/);
    for (const gate of COMPONENT_GATES) {
        assert.match(workflow, new RegExp(`^      - ${gate.workflow.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`, "m"));
    }
});

test("aggregate CI has a one-time fail-closed bootstrap when the trusted evaluator is not on the base", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");
    const bootstrapSource = extractBootstrapSource(workflow);

    assert.match(
        workflow,
        /if \[\[ -f scripts\/ci\/aggregate-gate\.mjs \]\]; then[\s\S]*?node scripts\/ci\/aggregate-gate\.mjs[\s\S]*?elif \[\[ \"\$GITHUB_EVENT_NAME\" == \"pull_request\" \|\| \"\$GITHUB_EVENT_NAME\" == \"merge_group\" \]\]; then/,
        "the trusted evaluator must win whenever it exists, with bootstrap limited to PR/merge-group introduction",
    );
    assert.match(
        workflow,
        /else[\s\S]*?Trusted aggregate evaluator is missing from the default branch[\s\S]*?exit 1/,
        "all other missing-evaluator cases must fail closed",
    );
    assert.match(bootstrapSource, /scripts\/ci\/aggregate-gate\.mjs/);
    assert.match(bootstrapSource, /status === \"added\"/);
    assert.match(bootstrapSource, /status !== \"completed\"/);
    assert.match(bootstrapSource, /conclusion !== SUCCESS/);
    assert.match(bootstrapSource, /missing workflow run/);
    assert.match(bootstrapSource, /missing job/);
    assert.match(bootstrapSource, /GITHUB_TOKEN/);

    for (const gate of (await import("./aggregate-gate.mjs")).COMPONENT_GATES) {
        assert.match(
            bootstrapSource,
            new RegExp(`workflow: ${escapeRegExp(JSON.stringify(gate.workflow))}`),
            `bootstrap must retain the ${gate.workflow} workflow gate`,
        );
        if (gate.always) {
            assert.match(
                bootstrapSource,
                new RegExp(`workflow: ${escapeRegExp(JSON.stringify(gate.workflow))}[\\s\\S]*?always: true`),
                `${gate.workflow} must remain an always-on gate`,
            );
        }
        for (const job of gate.jobs) {
            assert.match(
                bootstrapSource,
                new RegExp(escapeRegExp(JSON.stringify(job))),
                `bootstrap must retain the ${gate.workflow}/${job} job gate`,
            );
        }
        for (const path of gate.paths ?? []) {
            assert.match(
                bootstrapSource,
                new RegExp(escapeRegExp(JSON.stringify(path))),
                `bootstrap must retain the ${gate.workflow} path selector`,
            );
        }
    }

    assert.doesNotMatch(bootstrapSource, /secrets\./, "bootstrap must not consume repository secrets");
    assert.doesNotMatch(bootstrapSource, /child_process|exec\(|spawn\(/, "bootstrap must not execute repository code");
    assert.doesNotMatch(bootstrapSource, /git\s+(?:fetch|show|checkout)/, "bootstrap must not fetch or execute PR files");
    assert.doesNotMatch(bootstrapSource, /GITHUB_ENV|GITHUB_OUTPUT/, "bootstrap must not write workflow state");
});

test("aggregate bootstrap evaluates same-SHA jobs and fails in-progress runs", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");
    const bootstrapSource = extractBootstrapSource(workflow);
    const { COMPONENT_GATES } = await import("./aggregate-gate.mjs");
    const changedFiles = [{ filename: "scripts/ci/aggregate-gate.mjs", status: "added" }];
    const selectedGates = COMPONENT_GATES.filter((gate) => (
        gate.always || gate.paths?.some((pattern) => pattern === "scripts/ci/**")
    ));
    const runs = selectedGates.map((gate, index) => ({
        id: 700 + index,
        name: gate.workflow,
        head_sha: "bootstrap-sha",
        event: "pull_request",
        run_number: index + 1,
        run_attempt: 1,
        status: "completed",
        conclusion: "success",
        jobs: gate.jobs.map((name) => ({ name, status: "completed", conclusion: "success" })),
    }));
    const payload = { pull_request: { number: 7, head: { sha: "bootstrap-sha" } } };

    const passed = await runBootstrapSource(bootstrapSource, payload, { files: changedFiles, runs });
    assert.equal(passed.status, 0, passed.stderr || passed.stdout);

    const inProgressRuns = runs.map((run, index) => index === 0 ? { ...run, status: "in_progress" } : run);
    const failed = await runBootstrapSource(bootstrapSource, payload, { files: changedFiles, runs: inProgressRuns });
    assert.notEqual(failed.status, 0, "in-progress component runs must fail closed");
    assert.match(failed.stderr, /workflow is in_progress/);

    const mergeRuns = runs.map((run) => ({ ...run, event: "merge_group" }));
    const mergePayload = { merge_group: { head_sha: "bootstrap-sha", base_sha: "base-sha" } };
    const mergePassed = await runBootstrapSource(
        bootstrapSource,
        mergePayload,
        { files: changedFiles, runs: mergeRuns },
        "merge_group",
    );
    assert.equal(mergePassed.status, 0, mergePassed.stderr || mergePassed.stdout);
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

test("native workflow definition changes select only their matching native gate", async () => {
    const { requiredGatesForFiles } = await import("./aggregate-gate.mjs");

    const androidGateNames = requiredGatesForFiles([".github/workflows/native-android.yml"])
        .map((gate) => gate.workflow);
    assert.ok(androidGateNames.includes("Native Android CI"));
    assert.ok(!androidGateNames.includes("Native iOS CI"));

    const iosGateNames = requiredGatesForFiles([".github/workflows/native-ios.yml"])
        .map((gate) => gate.workflow);
    assert.ok(iosGateNames.includes("Native iOS CI"));
    assert.ok(!iosGateNames.includes("Native Android CI"));

    const bothGateNames = requiredGatesForFiles([
        ".github/workflows/native-android.yml",
        ".github/workflows/native-ios.yml",
    ]).map((gate) => gate.workflow);
    assert.ok(bothGateNames.includes("Native Android CI"));
    assert.ok(bothGateNames.includes("Native iOS CI"));
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
