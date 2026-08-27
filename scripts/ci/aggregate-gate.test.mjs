import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

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

test("advisory mobile E2E signal never blocks the required aggregate", async () => {
    const { COMPONENT_GATES, evaluateGateRuns } = await import("./aggregate-gate.mjs");
    const mobileGate = COMPONENT_GATES.find((gate) => gate.workflow === "Mobile CI");
    assert.ok(mobileGate, "Mobile CI must remain a required aggregate workflow");
    assert.deepEqual(mobileGate.jobs, ["type-check · lint · test · build"]);

    const requiredJob = { name: "type-check · lint · test · build", status: "completed", conclusion: "success" };
    const advisoryJob = "playwright e2e (advisory · real backend)";
    for (const advisoryState of [
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "failure" },
        { status: "completed", conclusion: "skipped" },
        { status: "in_progress", conclusion: null },
    ]) {
        assert.doesNotThrow(() => evaluateGateRuns(
            [mobileGate],
            new Map([[
                "Mobile CI",
                {
                    status: "completed",
                    conclusion: "success",
                    jobs: [requiredJob, { name: advisoryJob, ...advisoryState }],
                },
            ]]),
        ));
    }

    assert.doesNotThrow(() => evaluateGateRuns(
        [mobileGate],
        new Map([[
            "Mobile CI",
            { status: "completed", conclusion: "success", jobs: [requiredJob] },
        ]]),
    ));

    assert.throws(() => evaluateGateRuns(
        [mobileGate],
        new Map([[
            "Mobile CI",
            {
                status: "completed",
                conclusion: "success",
                jobs: [{ ...requiredJob, conclusion: "failure" }, { name: advisoryJob, status: "completed", conclusion: "success" }],
            },
        ]]),
    ), /type-check · lint · test · build.*failure/i);

    const mobileWorkflow = await readFile(resolve(WORKSPACE_ROOT, ".github/workflows/mobile-ci.yml"), "utf8");
    assert.match(mobileWorkflow, /name: playwright e2e \(advisory · real backend\)/);
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

test("aggregate runner fails closed on malformed or capped merge-group file inventories", async () => {
    const { runAggregate } = await import("./aggregate-gate.mjs");
    const cases = [
        { label: "null files", files: null, pattern: /file inventory array/i },
        { label: "object files", files: {}, pattern: /file inventory array/i },
        { label: "string files", files: "not-an-array", pattern: /file inventory array/i },
        { label: "invalid file entry", files: [{}], pattern: /invalid file entry/i },
        {
            label: "exact compare cap",
            files: Array.from({ length: 300 }, (_, index) => ({ filename: `file-${index}` })),
            pattern: /may be truncated at 300 files/i,
        },
        {
            label: "over compare cap",
            files: Array.from({ length: 301 }, (_, index) => ({ filename: `file-${index}` })),
            pattern: /may be truncated at 300 files/i,
        },
    ];

    for (const testCase of cases) {
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
                return { ok: true, status: 200, text: async () => JSON.stringify({ files: testCase.files }) };
            }
            throw new Error(`unexpected request for ${testCase.label}: ${requestUrl}`);
        };

        try {
            await assert.rejects(
                () => runAggregate({
                    eventName: "workflow_run",
                    payload: { workflow_run: { event: "merge_group", head_sha: "merge-sha", pull_requests: [] } },
                    repository: "owner/repository",
                    token: "test-token",
                }),
                testCase.pattern,
                testCase.label,
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
});
