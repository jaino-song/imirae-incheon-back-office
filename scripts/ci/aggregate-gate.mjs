import { readFile } from "node:fs/promises";

const DEFAULT_API_URL = "https://api.github.com";
const SUCCESS = "success";

// These are the live repository-side gates. The backend verify workflow owns
// the migration drift guard, and its workflow run also includes auth-e2e.
// Path-scoped gates are selected from the changed files so an intentionally
// filtered workflow is not treated as missing on an unrelated PR.
export const COMPONENT_GATES = Object.freeze([
    {
        workflow: "Backend CI",
        jobs: [
            "backend · type-check · lint · test",
            "auth e2e · postgres · valkey · mailpit",
        ],
        always: true,
    },
    {
        workflow: "Frontend CI",
        jobs: ["frontend · type-check · lint · test · build"],
        always: true,
    },
    {
        workflow: "Mobile CI",
        jobs: [
            "type-check · lint · test · build",
            "playwright e2e (advisory · real backend)",
        ],
        always: true,
    },
    {
        workflow: "Frontend Playwright Auth Lifecycle",
        jobs: ["frontend auth lifecycle · real backend"],
        always: true,
    },
    {
        workflow: "Security Review",
        jobs: ["security-review · osv lockfile scan / osv-scan"],
        always: true,
    },
    {
        workflow: "Backend Full Flow CI",
        jobs: ["backend full flow e2e · local stubs"],
        paths: [
            "backend/**",
            "packages/shared/**",
            "package.json",
            "pnpm-lock.yaml",
            "pnpm-workspace.yaml",
            "scripts/ci/**",
            ".github/workflows/backend-full-flow-ci.yml",
        ],
    },
    {
        workflow: "Mobile Unit CI",
        jobs: ["mobile unit tests"],
        paths: [
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
        ],
    },
    {
        workflow: "Shared Contracts CI",
        jobs: ["shared contracts · type-check · test"],
        paths: [
            "packages/shared/**",
            "frontend/**",
            "mobile/**",
            "backend/**",
            "package.json",
            "pnpm-lock.yaml",
            "pnpm-workspace.yaml",
            "scripts/ci/**",
            ".github/workflows/shared-contracts-ci.yml",
        ],
    },
    // These names describe the native workflows that exist under
    // native/.github/workflows. GitHub only executes workflows under the
    // repository-root .github/workflows directory, so a native change fails
    // closed until those workflows are promoted to live root workflows.
    {
        workflow: "Native Android CI",
        jobs: ["Android CI", "SCA Scan"],
        paths: ["native/**"],
    },
    {
        workflow: "Native iOS CI",
        jobs: ["iOS CI", "SCA Scan"],
        paths: ["native/**"],
    },
]);

function escapeRegExp(value) {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegExp(pattern) {
    let expression = "^";
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index];
        if (character === "*" && pattern[index + 1] === "*") {
            expression += ".*";
            index += 1;
        } else if (character === "*") {
            expression += "[^/]*";
        } else if (character === "?") {
            expression += "[^/]";
        } else {
            expression += escapeRegExp(character);
        }
    }
    return new RegExp(`${expression}$`);
}

export function gateAppliesToFiles(gate, changedFiles) {
    if (gate.always) {
        return true;
    }
    if (!Array.isArray(changedFiles)) {
        throw new Error(`changed-file inventory is required before evaluating ${gate.workflow}`);
    }
    return changedFiles.some((file) => gate.paths.some((pattern) => globToRegExp(pattern).test(file)));
}

export function requiredGatesForFiles(changedFiles) {
    return COMPONENT_GATES.filter((gate) => gateAppliesToFiles(gate, changedFiles));
}

function runSortKey(run) {
    return [
        run.run_number ?? 0,
        run.run_attempt ?? 0,
        Date.parse(run.updated_at ?? run.created_at ?? "") || 0,
        run.id ?? 0,
    ];
}

function compareRuns(left, right) {
    const leftKey = runSortKey(left);
    const rightKey = runSortKey(right);
    for (let index = 0; index < leftKey.length; index += 1) {
        if (leftKey[index] !== rightKey[index]) {
            return leftKey[index] - rightKey[index];
        }
    }
    return 0;
}

export function selectLatestWorkflowRun(runs, workflow, headSha, event) {
    return runs
        .filter((run) => run.name === workflow && run.head_sha === headSha && run.event === event)
        .sort(compareRuns)
        .at(-1);
}

export function evaluateGateRuns(gates, runsByWorkflow) {
    const failures = [];

    for (const gate of gates) {
        const run = runsByWorkflow.get(gate.workflow);
        if (!run) {
            failures.push(`${gate.workflow}: missing workflow run`);
            continue;
        }

        if (run.status !== "completed") {
            failures.push(`${gate.workflow}: workflow is ${run.status ?? "unknown"}`);
            continue;
        }
        if (run.conclusion !== SUCCESS) {
            failures.push(`${gate.workflow}: workflow conclusion is ${run.conclusion ?? "unknown"}`);
            continue;
        }

        for (const expectedJob of gate.jobs) {
            const matchingJobs = (run.jobs ?? []).filter((job) => job.name === expectedJob);
            if (matchingJobs.length === 0) {
                failures.push(`${gate.workflow}: ${expectedJob}: missing job`);
                continue;
            }

            for (const job of matchingJobs) {
                if (job.status !== "completed") {
                    failures.push(`${gate.workflow}: ${expectedJob}: job is ${job.status ?? "unknown"}`);
                } else if (job.conclusion !== SUCCESS) {
                    failures.push(`${gate.workflow}: ${expectedJob}: job conclusion is ${job.conclusion ?? "unknown"}`);
                }
            }
        }
    }

    if (failures.length > 0) {
        throw new Error(failures.join("; "));
    }

    return { ok: true, gates: gates.map((gate) => gate.workflow) };
}

function requireEnvironment(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required`);
    }
    return value;
}

async function githubJson(path, token, apiUrl = process.env.GITHUB_API_URL || DEFAULT_API_URL) {
    const response = await fetch(`${apiUrl}${path}`, {
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    const body = await response.text();
    if (!response.ok) {
        throw new Error(`GitHub API ${response.status} for ${path}`);
    }
    try {
        return JSON.parse(body);
    } catch {
        throw new Error(`GitHub API returned invalid JSON for ${path}`);
    }
}

async function githubPaginated(path, token) {
    const entries = [];
    for (let page = 1; ; page += 1) {
        const separator = path.includes("?") ? "&" : "?";
        const result = await githubJson(`${path}${separator}per_page=100&page=${page}`, token);
        const pageEntries = Array.isArray(result) ? result : result.workflow_runs ?? result.jobs ?? [];
        entries.push(...pageEntries);
        if (pageEntries.length < 100) {
            return entries;
        }
    }
}

function pullRequestNumbers(payload, eventName) {
    const values = [];
    if (eventName === "pull_request" && payload.pull_request?.number) {
        values.push(payload.pull_request.number);
    }
    for (const source of [payload.workflow_run?.pull_requests, payload.merge_group?.pull_requests]) {
        for (const pullRequest of source ?? []) {
            if (pullRequest.number) {
                values.push(pullRequest.number);
            }
        }
    }
    return [...new Set(values)];
}

async function changedFilesForEvent({ eventName, payload, repository, headSha, token }) {
    const pullRequestIds = pullRequestNumbers(payload, eventName);
    if (pullRequestIds.length === 0 && headSha) {
        const associatedPullRequests = await githubJson(
            `/repos/${repository}/commits/${encodeURIComponent(headSha)}/pulls`,
            token,
        );
        for (const pullRequest of associatedPullRequests) {
            if (pullRequest.number) {
                pullRequestIds.push(pullRequest.number);
            }
        }
    }

    if (pullRequestIds.length > 0) {
        const files = new Set();
        for (const number of pullRequestIds) {
            const pullRequestFiles = await githubPaginated(
                `/repos/${repository}/pulls/${encodeURIComponent(number)}/files`,
                token,
            );
            for (const file of pullRequestFiles) {
                if (file.filename) {
                    files.add(file.filename);
                }
            }
        }
        return [...files];
    }

    if (eventName === "merge_group" && headSha) {
        let baseSha = payload.merge_group?.base_sha;
        if (!baseSha) {
            const commit = await githubJson(
                `/repos/${repository}/commits/${encodeURIComponent(headSha)}`,
                token,
            );
            baseSha = commit.parents?.[0]?.sha;
        }
        if (!baseSha) {
            throw new Error(`could not determine merge-group base for ${headSha}`);
        }
        const comparison = await githubJson(
            `/repos/${repository}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
            token,
        );
        return (comparison.files ?? []).map((file) => file.filename).filter(Boolean);
    }

    throw new Error(`could not determine changed files for ${eventName} at ${headSha}`);
}

function eventContext(eventName, payload) {
    if (eventName === "workflow_run") {
        const sourceEvent = payload.workflow_run?.event;
        if (sourceEvent !== "pull_request" && sourceEvent !== "merge_group") {
            return null;
        }
        return {
            event: sourceEvent,
            headSha: payload.workflow_run?.head_sha,
        };
    }
    if (eventName === "pull_request") {
        return {
            event: eventName,
            headSha: payload.pull_request?.head?.sha,
        };
    }
    if (eventName === "merge_group") {
        return {
            event: eventName,
            headSha: payload.merge_group?.head_sha || process.env.GITHUB_SHA,
        };
    }
    throw new Error(`unsupported aggregate event ${eventName}`);
}

export async function runAggregate({
    eventName = requireEnvironment("GITHUB_EVENT_NAME"),
    payload,
    repository = requireEnvironment("GITHUB_REPOSITORY"),
    token = requireEnvironment("GITHUB_TOKEN"),
} = {}) {
    const context = eventContext(eventName, payload);
    if (!context) {
        return { ok: true, skipped: true };
    }
    if (!context.headSha) {
        throw new Error(`head SHA is required for ${context.event}`);
    }

    const changedFiles = await changedFilesForEvent({
        eventName: context.event,
        payload,
        repository,
        headSha: context.headSha,
        token,
    });
    const gates = requiredGatesForFiles(changedFiles);
    const runs = await githubPaginated(
        `/repos/${repository}/actions/runs?head_sha=${encodeURIComponent(context.headSha)}`,
        token,
    );
    const runsByWorkflow = new Map();

    for (const gate of gates) {
        const run = selectLatestWorkflowRun(runs, gate.workflow, context.headSha, context.event);
        if (!run) {
            continue;
        }
        const jobs = await githubPaginated(`/repos/${repository}/actions/runs/${run.id}/jobs`, token);
        runsByWorkflow.set(gate.workflow, { ...run, jobs });
    }

    return evaluateGateRuns(gates, runsByWorkflow);
}

async function main() {
    const payload = JSON.parse(await readFile(requireEnvironment("GITHUB_EVENT_PATH"), "utf8"));
    const result = await runAggregate({ payload });
    if (result.skipped) {
        console.log("CI aggregate gate skipped non-PR workflow_run event");
        return;
    }
    console.log(`CI aggregate gate passed: ${result.gates.join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(`::error::CI aggregate gate failed: ${error.message}`);
        process.exitCode = 1;
    });
}
