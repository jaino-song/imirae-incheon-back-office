import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

async function readWorkflow(fileName) {
    return readFile(resolve(WORKSPACE_ROOT, ".github/workflows", fileName), "utf8");
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
