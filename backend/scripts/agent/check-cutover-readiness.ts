import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import {
    evidenceBundleDigest,
    parseReleaseEvidenceArtifact,
    RELEASE_EVALUATION_THRESHOLDS,
    ReleaseEvidenceArtifactSchema,
    type ReleaseEvidenceArtifact,
    type ReleaseEvidenceKind,
} from "../../application/agent/release-evidence-artifact";
import {
    AGENT_EVAL_CASES,
    AGENT_EVAL_CASE_DIGEST,
    AGENT_EVAL_FIXTURE_ASSERTION_DIGEST,
} from "../../../evals/agent/cases";
import { matchesEvaluationMutationPolicy } from "../../../evals/agent/evaluation-policy";

const ShaSchema = z.string().regex(/^[0-9a-f]{7,64}$/i);
const SignoffSchema = z.object({
    reviewer: z.string().min(1),
    role: z.string().min(1),
    approvedAt: z.string().datetime({ offset: true }),
    commitSha: ShaSchema,
    evidenceBundleDigest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const GateSchema = z.object({
    version: z.literal(4),
    legacyRemovalAuthorized: z.boolean(),
    requiredObservationWindowDays: z.number().int().positive(),
    legacySentinels: z.array(z.string().min(1)),
}).strict();

/**
 * This manifest is supplied from a protected CI environment secret after the
 * candidate commit exists. Evidence and signoffs therefore bind to the commit
 * without creating an impossible SHA self-reference inside that commit.
 */
const CutoverManifestSchema = z.object({
    version: z.literal(1),
    releaseCommitSha: ShaSchema,
    observedStableDays: z.number().int().nonnegative(),
    releases: z.object({
        A: z.literal("complete"),
        B: z.literal("complete"),
        C: z.literal("complete"),
        D: z.literal("complete"),
    }).strict(),
    artifacts: z.object({
        realRuntimeEvaluation: ReleaseEvidenceArtifactSchema,
        desktopRealBackendE2E: ReleaseEvidenceArtifactSchema,
        mobileRealBackendE2E: ReleaseEvidenceArtifactSchema,
        securityE2E: ReleaseEvidenceArtifactSchema,
        providerDuplicateObservation: ReleaseEvidenceArtifactSchema,
        rollbackExercise: ReleaseEvidenceArtifactSchema,
        privacyReview: ReleaseEvidenceArtifactSchema,
    }).strict(),
    signoffs: z.object({
        engineering: SignoffSchema,
        security: SignoffSchema,
        privacy: SignoffSchema,
        product: SignoffSchema,
    }).strict(),
}).strict();

const REQUIRED_SCENARIOS = {
    desktopRealBackendE2E: [
        "send-stream-stop", "duplicate-entity-selection", "session-crud", "branch-switch",
        "session-restore", "responsive-layout", "keyboard-accessibility", "legacy-flag-disabled",
    ],
    mobileRealBackendE2E: [
        "structured-parts", "entity-selection", "approve-reject", "strong-acknowledgement",
        "uncertainty-recovery", "feedback", "session-deletion", "safe-area", "accessibility",
    ],
    securityE2E: [
        "cross-user-denial", "cross-branch-isolation", "expired-session", "invalid-session",
        "entity-memory-invalidation", "missing-principal", "rate-limiting",
        "minimized-model-payload", "prompt-injection-isolation",
    ],
};

function requireScenarios(actual: string[], required: string[], kind: string): void {
    const missing = required.filter((scenario) => !actual.includes(scenario));
    if (missing.length > 0) throw new Error(`D13 ${kind} evidence is missing scenarios: ${missing.join(", ")}`);
}

const backendRoot = resolve(__dirname, "../..");
const gate = GateSchema.parse(JSON.parse(readFileSync(resolve(backendRoot, "agent-cutover-gate.json"), "utf8")));
const missingSentinels = gate.legacySentinels.filter((path) => !existsSync(resolve(backendRoot, path)));
if (!gate.legacyRemovalAuthorized) {
    if (missingSentinels.length > 0) throw new Error(`Legacy agent surfaces were removed before D13 authorization: ${missingSentinels.join(", ")}`);
    console.log("D13 cutover gate: BLOCKED as designed; legacy surfaces remain protected");
    process.exit(0);
}

const manifestSource = process.env["AGENT_CUTOVER_MANIFEST_JSON"]?.trim();
if (!manifestSource) throw new Error("D13 requires a protected external AGENT_CUTOVER_MANIFEST_JSON");
const manifest = CutoverManifestSchema.parse(JSON.parse(manifestSource));
const expectedReleaseCommit = manifest.releaseCommitSha;
const candidateCommit = (process.env["AGENT_RELEASE_CANDIDATE_SHA"] ?? process.env["GITHUB_SHA"])?.trim();
if (!candidateCommit || candidateCommit !== expectedReleaseCommit) {
    throw new Error("D13 gate must run on the externally approved release commit");
}
if (manifest.observedStableDays < gate.requiredObservationWindowDays) {
    throw new Error(`D13 requires ${gate.requiredObservationWindowDays} stable days; only ${manifest.observedStableDays} recorded`);
}

const artifacts: Record<string, ReleaseEvidenceArtifact> = {};
for (const [kind, rawArtifact] of Object.entries(manifest.artifacts) as [ReleaseEvidenceKind, ReleaseEvidenceArtifact][]) {
    const artifact: ReleaseEvidenceArtifact = parseReleaseEvidenceArtifact<ReleaseEvidenceKind>(
        JSON.stringify(rawArtifact),
        { kind, commitSha: expectedReleaseCommit },
    );
    if (kind === "realRuntimeEvaluation") {
        if (artifact.kind !== kind || artifact.mode !== "real-runtime-model") throw new Error("D13 real-model evaluation used an invalid execution mode");
        const scoresPass = Object.entries(RELEASE_EVALUATION_THRESHOLDS).every(([metric, threshold]) => (
            artifact.payload.scores?.[metric as keyof typeof RELEASE_EVALUATION_THRESHOLDS] !== undefined
            && artifact.payload.scores[metric as keyof typeof RELEASE_EVALUATION_THRESHOLDS]! >= threshold
        ));
        const currentBranchAssertionCount = AGENT_EVAL_CASES.filter((item) => item.requiresCurrentBranchRead).length;
        const entityContinuityCount = AGENT_EVAL_CASES.filter((item) => item.requiresEntityContinuity).length;
        if (!scoresPass
            || artifact.payload.thresholdPassed !== true
            || artifact.payload.deployedCommitMatches !== true
            || artifact.payload.deployedCommitSha !== expectedReleaseCommit
            || artifact.payload.manifestFresh !== true
            || artifact.payload.caseCount !== AGENT_EVAL_CASES.length
            || artifact.payload.uniquePromptCount !== new Set(AGENT_EVAL_CASES.map((item) => item.prompt)).size
            || artifact.payload.fixtureCount !== AGENT_EVAL_CASES.length
            || artifact.payload.fixturePassCount !== AGENT_EVAL_CASES.length
            || artifact.payload.caseDigest !== AGENT_EVAL_CASE_DIGEST
            || artifact.payload.fixtureAssertionDigest !== AGENT_EVAL_FIXTURE_ASSERTION_DIGEST
            || !matchesEvaluationMutationPolicy(artifact.payload, AGENT_EVAL_CASES)
            || artifact.payload.currentBranchReadAssertions !== currentBranchAssertionCount
            || artifact.payload.entityContinuityAssertions !== entityContinuityCount) {
            throw new Error("D13 real-model evaluation did not prove every committed fixture and action assertion");
        }
    }
    if (kind === "providerDuplicateObservation") {
        if (artifact.kind !== kind
            || artifact.payload.observationDays < gate.requiredObservationWindowDays
            || artifact.payload.observationDays !== manifest.observedStableDays) {
            throw new Error("D13 provider observation does not prove a duplicate-free stable window");
        }
    }
    if (kind === "desktopRealBackendE2E") {
        if (artifact.kind !== kind) throw new Error("Desktop evidence kind mismatch");
        requireScenarios(artifact.payload.scenarioIds, REQUIRED_SCENARIOS.desktopRealBackendE2E, kind);
    }
    if (kind === "mobileRealBackendE2E") {
        if (artifact.kind !== kind) throw new Error("Mobile evidence kind mismatch");
        requireScenarios(artifact.payload.scenarioIds, REQUIRED_SCENARIOS.mobileRealBackendE2E, kind);
    }
    if (kind === "securityE2E") {
        if (artifact.kind !== kind) throw new Error("Security evidence kind mismatch");
        requireScenarios(artifact.payload.scenarioIds, REQUIRED_SCENARIOS.securityE2E, kind);
    }
    artifacts[kind] = artifact;
}

const bundleDigest = evidenceBundleDigest(artifacts);
for (const [name, signoff] of Object.entries(manifest.signoffs)) {
    if (signoff.commitSha !== expectedReleaseCommit || signoff.evidenceBundleDigest !== bundleDigest) {
        throw new Error(`D13 ${name} signoff is not bound to the current evidence bundle`);
    }
}

console.log("D13 cutover gate: ELIGIBLE. Legacy removal still requires a separate explicitly approved change.");
