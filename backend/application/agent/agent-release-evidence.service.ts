import { Injectable } from "@nestjs/common";
import { readFileSync } from "node:fs";

import { parseReleaseEvidenceArtifact, RELEASE_EVALUATION_THRESHOLDS } from "./release-evidence-artifact";

function releaseCommitSha(): string | null {
    return ["AGENT_RELEASE_COMMIT_SHA", "RAILWAY_GIT_COMMIT_SHA", "GITHUB_SHA"]
        .map((name) => process.env[name]?.trim())
        .find((value): value is string => Boolean(value && /^[0-9a-f]{7,64}$/i.test(value))) ?? null;
}

@Injectable()
export class AgentReleaseEvidenceService {
    evaluation(agentVersion: string, model: string) {
        const path = process.env["AGENT_EVAL_ARTIFACT_PATH"]?.trim();
        if (!path) return { status: "missing" as const, reason: "AGENT_EVAL_ARTIFACT_PATH is not configured" };
        const commitSha = releaseCommitSha();
        if (!commitSha) return { status: "unbound" as const, reason: "The running release commit is unavailable" };
        try {
            const artifact = parseReleaseEvidenceArtifact(readFileSync(path, "utf8"), {
                kind: "realRuntimeEvaluation",
                commitSha,
            });
            const payload = artifact.payload;
            const scores = payload.scores;
            const thresholdPassed = Boolean(scores) && Object.entries(RELEASE_EVALUATION_THRESHOLDS).every(([key, threshold]) => (
                scores?.[key as keyof typeof RELEASE_EVALUATION_THRESHOLDS] !== undefined
                && scores[key as keyof typeof RELEASE_EVALUATION_THRESHOLDS]! >= threshold
            ));
            const valid = artifact.mode === "real-runtime-model"
                && payload.caseCount === 200
                && payload.uniquePromptCount === 200
                && payload.fixtureCount === 200
                && payload.agentVersion === agentVersion
                && (payload.model === model || payload.model === "server-configured")
                && payload.manifestFresh
                && payload.deployedCommitMatches
                && payload.providerLedgerAssertions > 0
                && payload.currentBranchReadAssertions > 0
                && payload.entityContinuityAssertions > 0
                && payload.fixturePassCount === 200
                && thresholdPassed;
            return {
                status: valid ? "passed" as const : "stale-or-failed" as const,
                commitSha: artifact.commitSha,
                evaluatedAt: artifact.createdAt,
                expiresAt: artifact.expiresAt,
                digest: artifact.digest,
                caseCount: payload.caseCount,
                thresholdPassed,
            };
        } catch {
            return { status: "invalid" as const, reason: "Evaluation evidence is invalid, stale, tampered, or bound to another commit" };
        }
    }
}
