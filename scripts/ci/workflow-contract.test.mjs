import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

async function readWorkflow(fileName) {
    return readFile(resolve(WORKSPACE_ROOT, ".github/workflows", fileName), "utf8");
}

async function workflowFiles() {
    const names = await readdir(resolve(WORKSPACE_ROOT, ".github/workflows"));
    return names.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml")).sort();
}

function externalActionReferences(workflow, fileName) {
    return workflow.split("\n").flatMap((line, index) => {
        const match = line.match(/^\s*(?:-\s+)?uses:\s+([^\s#]+)(?:\s+#\s*(.*))?$/);
        if (!match || match[1].startsWith("./")) {
            return [];
        }

        return [{ fileName, line: index + 1, reference: match[1], comment: match[2]?.trim() ?? "" }];
    });
}

function externalServiceImages(workflow, fileName) {
    return workflow.split("\n").flatMap((line, index) => {
        const match = line.match(/^\s*image:\s+([^\s#]+)(?:\s+#\s*(.*))?$/);
        if (!match || match[1].startsWith("./")) {
            return [];
        }

        return [{ fileName, line: index + 1, reference: match[1], comment: match[2]?.trim() ?? "" }];
    });
}

function jobBlock(workflow, jobId, fileName) {
    const lines = workflow.split("\n");
    const start = lines.findIndex((line) => line === `  ${jobId}:`);
    assert.notEqual(start, -1, `${fileName} must define the ${jobId} job`);

    const end = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:/.test(line));
    return lines.slice(start, end === -1 ? lines.length : end);
}

function stepBlocks(job, jobId, fileName) {
    const stepsStart = job.findIndex((line) => line === "    steps:");
    assert.notEqual(stepsStart, -1, `${fileName} ${jobId} must define steps`);

    const steps = [];
    let current = null;
    for (const line of job.slice(stepsStart + 1)) {
        if (/^      - /.test(line)) {
            if (current) {
                steps.push(current);
            }
            current = [line];
            continue;
        }

        if (current) {
            current.push(line);
        }
    }

    if (current) {
        steps.push(current);
    }

    assert.ok(steps.length > 0, `${fileName} ${jobId} must contain steps`);
    return steps;
}

function stepName(step) {
    const namedStep = step[0].match(/^      - name: (.+)$/);
    return namedStep ? namedStep[1] : "unnamed step";
}

function secretNames(step) {
    return [...step.join("\n").matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]);
}

function stepHasSecretEnv(step, key, expression) {
    const expectedLine = "          " + key + ": ${{ " + expression + " }}";
    return step.includes(expectedLine);
}

function assertNoJobLevelEnvWithSecrets(workflow, jobId, fileName) {
    const job = jobBlock(workflow, jobId, fileName);
    const jobEnvStart = job.findIndex((line) => line === "    env:");
    if (jobEnvStart === -1) {
        return;
    }

    const jobEnv = job.slice(jobEnvStart + 1).filter((line) => /^      [A-Z0-9_]+:/.test(line));
    assert.equal(jobEnv.filter((line) => /secrets\./.test(line)).length, 0, `${fileName} ${jobId} must not expose database secrets at job scope`);
}

function assertNoWorkflowLevelEnvWithSecrets(workflow, fileName) {
    const lines = workflow.split("\n");
    const envStart = lines.findIndex((line) => line === "env:");
    if (envStart === -1) {
        return;
    }

    const envEnd = lines.findIndex((line, index) => index > envStart && line !== "" && !line.startsWith(" "));
    const envBlock = lines.slice(envStart, envEnd === -1 ? lines.length : envEnd).join("\n");
    assert.doesNotMatch(envBlock, /secrets\./, `${fileName} must not expose database secrets at workflow scope`);
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

test("mobile pull-request E2E uses only a run-scoped dummy JWT", async () => {
    const fileName = "mobile-ci.yml";
    const workflow = await readWorkflow(fileName);
    const job = jobBlock(workflow, "e2e", fileName);
    const jobText = job.join("\n");

    assert.match(jobText, /github\.event_name == 'pull_request'/);
    assert.match(
        jobText,
        /JWT_SECRET:\s+e2e-dummy-jwt-signing-key-at-least-32-\$\{\{\s*github\.run_id\s*\}\}/,
        `${fileName} pull-request E2E must use a per-run dummy JWT`,
    );
    assert.doesNotMatch(
        jobText,
        /secrets\.JWT_SECRET/,
        `${fileName} pull-request E2E must not expose the repository JWT secret`,
    );
});

test("backend pull requests and merge queues cannot receive the protected cutover manifest", async () => {
    const fileName = "backend-ci.yml";
    const workflow = await readWorkflow(fileName);
    const job = jobBlock(workflow, "verify", fileName);
    const steps = stepBlocks(job, "verify", fileName);
    const cutoverSteps = steps.filter((step) => step.join("\n").includes("agent:cutover:guard"));

    assert.equal(cutoverSteps.length, 2, `${fileName} must retain trusted and PR-safe cutover guard steps`);
    const manifestSecretSteps = steps.filter((step) => step.join("\n").includes("secrets.AGENT_CUTOVER_MANIFEST_JSON"));
    assert.equal(manifestSecretSteps.length, 1, `${fileName} must expose the protected manifest in exactly one trusted step`);
    const trustedCutoverStep = manifestSecretSteps[0];
    const untrustedCutoverStep = cutoverSteps.find((step) => !step.join("\n").includes("secrets.AGENT_CUTOVER_MANIFEST_JSON"));
    assert.ok(trustedCutoverStep, `${fileName} must retain a protected-evidence cutover guard`);
    assert.ok(untrustedCutoverStep, `${fileName} must retain a secret-free pull-request and merge-queue cutover guard`);
    assert.match(trustedCutoverStep.join("\n"), /if:\s+github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/);
    assert.match(untrustedCutoverStep.join("\n"), /if:\s+github\.event_name == 'pull_request' \|\| github\.event_name == 'merge_group'/);
    assert.match(trustedCutoverStep.join("\n"), /secrets\.AGENT_CUTOVER_MANIFEST_JSON/);
    assert.match(untrustedCutoverStep.join("\n"), /AGENT_RELEASE_CANDIDATE_SHA:\s+\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
    assert.doesNotMatch(untrustedCutoverStep.join("\n"), /secrets\./);
    assert.doesNotMatch(
        job.join("\n"),
        /^      [A-Z0-9_]+:.*secrets\.AGENT_CUTOVER_MANIFEST_JSON/m,
        `${fileName} must not expose the cutover manifest at job scope`,
    );
});

test("PR-controlled frontend and mobile lanes use explicit read-only permissions and no persisted checkout token", async () => {
    const lanes = [
        ["mobile-ci.yml", "verify"],
        ["frontend-ci.yml", "verify"],
        ["playwright.yml", "test"],
    ];

    for (const [fileName, jobId] of lanes) {
        const workflow = await readWorkflow(fileName);
        const job = jobBlock(workflow, jobId, fileName);
        const checkoutStep = stepBlocks(job, jobId, fileName).find((step) => step.some((line) => line.includes("actions/checkout@")));

        assert.match(workflow, /^permissions:\n  contents: read\n/m, `${fileName} must default the workflow token to read-only contents access`);
        assert.doesNotMatch(workflow, /^ {2,}[A-Za-z-]+: write$/m, `${fileName} must not grant a writable workflow token`);
        assert.ok(checkoutStep, `${fileName} ${jobId} must checkout the repository`);
        assert.match(checkoutStep.join("\n"), /persist-credentials: false/, `${fileName} ${jobId} checkout must not persist the workflow token`);
    }

    const mobileWorkflow = await readWorkflow("mobile-ci.yml");
    const verifyJob = jobBlock(mobileWorkflow, "verify", "mobile-ci.yml").join("\n");
    const e2eJob = jobBlock(mobileWorkflow, "e2e", "mobile-ci.yml");
    const e2eText = e2eJob.join("\n");

    assert.doesNotMatch(verifyJob, /pull-requests:\s+/, "mobile verify must not receive an unnecessary pull-requests token scope");
    assert.match(e2eText, /^    permissions:\n      contents: read\n      pull-requests: read$/m, "mobile E2E must scope PR file-list access to its own job");
    assert.match(e2eText, /repos\/\$\{\{ github\.repository \}\}\/pulls\/\$\{\{ github\.event\.pull_request\.number \}\}\/files/);
});

test("database failover validation has no OIDC token while deploy jobs retain OIDC", async () => {
    const fileName = "db-failover-infra.yml";
    const workflow = await readWorkflow(fileName);
    const validationJob = jobBlock(workflow, "validate-build-package", fileName).join("\n");

    assert.doesNotMatch(validationJob, /id-token:\s*write/);
    for (const environment of ["preview", "production"]) {
        const deployJob = jobBlock(workflow, `deploy-${environment}`, fileName).join("\n");
        assert.match(deployJob, /id-token:\s*write/, `${fileName} ${environment} deploy must retain OIDC`);
    }
});

test("AI capability impact report is read-only and publishes a job summary", async () => {
    const fileName = "ai-capability-impact.yml";
    const workflow = await readWorkflow(fileName);
    const job = jobBlock(workflow, "report", fileName);
    const jobText = job.join("\n");
    const steps = stepBlocks(job, "report", fileName);
    const checkoutStep = steps.find((step) => step.some((line) => line.includes("actions/checkout@")));
    const reportStep = steps.find((step) => step.some((line) => line.includes("impact-report.ts")));

    assert.match(workflow, /^permissions:\n  contents: read\n/m, `${fileName} must default the workflow token to read-only contents access`);
    assert.match(jobText, /^    permissions:\n      contents: read$/m, `${fileName} report must explicitly retain only read-only contents access`);
    assert.doesNotMatch(workflow, /pull-requests:\s+write/, `${fileName} must not grant a pull-requests write token`);
    assert.doesNotMatch(workflow, /^ {4,}(?:actions|checks|contents|deployments|id-token|issues|packages|pull-requests|security-events|statuses): write$/m, `${fileName} must not grant a writable job token`);
    assert.ok(checkoutStep, `${fileName} report must checkout the repository`);
    assert.match(checkoutStep.join("\n"), /persist-credentials: false/, `${fileName} checkout must not persist the workflow token`);
    assert.ok(reportStep, `${fileName} report must run the capability impact generator`);
    assert.match(reportStep.join("\n"), /GITHUB_STEP_SUMMARY/, `${fileName} must publish the Markdown report to the job summary`);
    assert.match(reportStep.join("\n"), /set -o pipefail/, `${fileName} must preserve report-generation failures through the summary pipe`);
    assert.doesNotMatch(reportStep.join("\n"), /GITHUB_OUTPUT/, `${fileName} must not stage report content for a privileged comment action`);
    assert.doesNotMatch(workflow, /sticky-pull-request-comment/, `${fileName} must not post PR comments from PR-controlled execution`);
    assert.doesNotMatch(workflow, /secrets\.GITHUB_TOKEN/, `${fileName} must not pass a write-capable token to PR-controlled steps`);
    assertUsesPinnedActions(workflow, fileName);
});

test("all external workflow actions and service images use immutable references with release labels", async () => {
    const files = await workflowFiles();
    const workflows = await Promise.all(files.map(async (fileName) => ({
        fileName,
        content: await readWorkflow(fileName),
    })));
    const actions = workflows.flatMap(({ fileName, content }) => externalActionReferences(content, fileName));
    const images = workflows.flatMap(({ fileName, content }) => externalServiceImages(content, fileName));

    assert.ok(actions.length > 0, "workflow inventory must contain external actions");
    for (const action of actions) {
        const atIndex = action.reference.lastIndexOf("@");
        assert.ok(atIndex > 0, `${action.fileName}:${action.line} action must pin a ref: ${action.reference}`);
        assert.match(action.reference.slice(atIndex + 1), /^[0-9a-f]{40}$/, `${action.fileName}:${action.line} action ref must be a full commit SHA`);
        assert.match(action.comment, /^v?[0-9]+(?:\.[0-9]+)+(?:[-+][A-Za-z0-9.-]+)?$/, `${action.fileName}:${action.line} action SHA must retain its human-readable release tag comment`);
    }

    assert.ok(images.length > 0, "workflow inventory must contain service images");
    for (const image of images) {
        assert.match(image.reference, /^[^@\s]+@sha256:[0-9a-f]{64}$/, `${image.fileName}:${image.line} service image must pin a full digest`);
        assert.match(image.comment, /^[A-Za-z0-9._/-]+:[A-Za-z0-9._-]+$/, `${image.fileName}:${image.line} image digest must retain its human-readable release tag comment`);
    }
});

test("database patch credentials are step-scoped and never reach setup or installation", async () => {
    const fileName = "database-patches.yml";
    const workflow = await readWorkflow(fileName);
    const jobs = [
        {
            id: "apply-dev",
            database: "secrets.DEV_DATABASE_URL || secrets.DEVELOPMENT_DATABASE_URL",
            direct: "secrets.DEV_DIRECT_URL || secrets.DEVELOPMENT_DIRECT_URL || secrets.DEV_DATABASE_URL || secrets.DEVELOPMENT_DATABASE_URL",
        },
        {
            id: "apply-preview",
            database: "secrets.PREVIEW_DATABASE_URL",
            direct: "secrets.PREVIEW_DIRECT_URL || secrets.PREVIEW_DATABASE_URL",
        },
        {
            id: "apply-production",
            database: "secrets.PRODUCTION_DATABASE_URL || secrets.PROD_DATABASE_URL",
            direct: "secrets.PRODUCTION_DIRECT_URL || secrets.PROD_DIRECT_URL || secrets.PRODUCTION_DATABASE_URL || secrets.PROD_DATABASE_URL",
        },
    ];

    assert.match(workflow, /^permissions:\n  contents: read\n/m, `${fileName} must default the workflow token to read-only contents access`);
    assertNoWorkflowLevelEnvWithSecrets(workflow, fileName);
    assert.doesNotMatch(workflow, /^  pull_request_target:/m, `${fileName} must not run privileged work from pull_request_target`);
    assert.doesNotMatch(workflow, /^  pull_request:/m, `${fileName} must not expose database jobs to untrusted pull requests`);
    assert.doesNotMatch(workflow, /^  [A-Za-z0-9_-]+: write$/m, `${fileName} must not grant a writable workflow token`);
    assert.doesNotMatch(workflow, /^ {4,}(?:actions|checks|contents|deployments|id-token|issues|packages|pull-requests|security-events|statuses): write$/m, `${fileName} must not grant writable token permissions to a job`);

    for (const jobDefinition of jobs) {
        assertNoJobLevelEnvWithSecrets(workflow, jobDefinition.id, fileName);
        const steps = stepBlocks(jobBlock(workflow, jobDefinition.id, fileName), jobDefinition.id, fileName);
        const databaseSteps = steps.filter((step) => /(?:prisma db execute|run-prisma-db-execute\.sh)/.test(step.join("\n")));
        assert.ok(databaseSteps.length > 0, `${fileName} ${jobDefinition.id} must contain database operation steps`);

        const expectedSecrets = new Set([
            jobDefinition.database.match(/secrets\.([A-Z0-9_]+)/g)?.map((name) => name.slice("secrets.".length)) ?? [],
            jobDefinition.direct.match(/secrets\.([A-Z0-9_]+)/g)?.map((name) => name.slice("secrets.".length)) ?? [],
        ].flat());

        const secretSteps = steps.filter((step) => secretNames(step).length > 0);
        const checkStep = steps.find((step) => stepName(step) === "Check database secrets");
        assert.ok(checkStep, `${fileName} ${jobDefinition.id} must check database secrets explicitly`);
        assert.ok(stepHasSecretEnv(checkStep, "DATABASE_URL", jobDefinition.database), `${fileName} ${jobDefinition.id} secret check must receive only its database URL expression`);
        assert.ok(stepHasSecretEnv(checkStep, "DIRECT_URL", jobDefinition.direct), `${fileName} ${jobDefinition.id} secret check must receive only its direct URL expression`);

        assert.equal(secretSteps.length, databaseSteps.length + 1, `${fileName} ${jobDefinition.id} must scope credentials to every database step and its check`);
        for (const step of secretSteps) {
            const names = secretNames(step);
            assert.ok(names.every((name) => expectedSecrets.has(name)), `${fileName} ${jobDefinition.id} ${stepName(step)} must not receive another environment's secret`);
            assert.ok(stepHasSecretEnv(step, "DATABASE_URL", jobDefinition.database), `${fileName} ${jobDefinition.id} ${stepName(step)} must receive DATABASE_URL at step scope`);
            assert.ok(stepHasSecretEnv(step, "DIRECT_URL", jobDefinition.direct), `${fileName} ${jobDefinition.id} ${stepName(step)} must receive DIRECT_URL at step scope`);
            assert.doesNotMatch(step.join("\n"), /pnpm install/, `${fileName} ${jobDefinition.id} ${stepName(step)} must not install dependencies with database credentials`);
        }

        for (const step of steps.filter((step) => /(?:actions\/checkout|Setup pnpm|Setup Node\.js|Install dependencies)/.test(stepName(step) + step.join("\n")))) {
            assert.equal(secretNames(step).length, 0, `${fileName} ${jobDefinition.id} ${stepName(step)} must not receive database credentials`);
        }

        const checkoutStep = steps.find((step) => step.some((line) => line.includes("actions/checkout@")));
        assert.ok(checkoutStep, `${fileName} ${jobDefinition.id} must checkout the repository`);
        assert.match(checkoutStep.join("\n"), /persist-credentials: false/, `${fileName} ${jobDefinition.id} checkout must not persist the workflow token`);
        assert.doesNotMatch(checkoutStep.join("\n"), /^\s+ref:/m, `${fileName} ${jobDefinition.id} must not checkout an attacker-controlled ref`);
    }
});
