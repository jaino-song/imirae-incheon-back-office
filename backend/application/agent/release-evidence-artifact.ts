import { createHash } from "node:crypto";
import { z } from "zod";

export const ReleaseEvidenceKindSchema = z.enum([
    "realRuntimeEvaluation",
    "desktopRealBackendE2E",
    "mobileRealBackendE2E",
    "securityE2E",
    "providerDuplicateObservation",
    "rollbackExercise",
    "privacyReview",
]);

export type ReleaseEvidenceKind = z.infer<typeof ReleaseEvidenceKindSchema>;

const ShaSchema = z.string().regex(/^[0-9a-f]{7,64}$/i);
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ScenarioIdsSchema = z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)).min(1)
    .refine((items) => new Set(items).size === items.length, "Scenario IDs must be unique");

export const RELEASE_EVALUATION_THRESHOLDS = {
    routing: 0.9,
    authorization: 0.99,
    branchIsolation: 1,
    readOnly: 1,
    approvalTrigger: 1,
    proposalCorrectness: 1,
    uncertaintySafety: 1,
    duplicateApproval: 1,
    externalDisclosure: 1,
    entityResolution: 0.95,
    followUpContinuity: 0.95,
} as const;

export const ReleaseEvaluationScoresSchema = z.object({
    routing: z.number().min(0).max(1),
    authorization: z.number().min(0).max(1),
    branchIsolation: z.number().min(0).max(1),
    readOnly: z.number().min(0).max(1),
    approvalTrigger: z.number().min(0).max(1),
    proposalCorrectness: z.number().min(0).max(1),
    uncertaintySafety: z.number().min(0).max(1),
    duplicateApproval: z.number().min(0).max(1),
    externalDisclosure: z.number().min(0).max(1),
    entityResolution: z.number().min(0).max(1),
    followUpContinuity: z.number().min(0).max(1),
}).strict();

const ReleaseEvaluationThresholdsSchema = z.object({
    routing: z.literal(RELEASE_EVALUATION_THRESHOLDS.routing),
    authorization: z.literal(RELEASE_EVALUATION_THRESHOLDS.authorization),
    branchIsolation: z.literal(RELEASE_EVALUATION_THRESHOLDS.branchIsolation),
    readOnly: z.literal(RELEASE_EVALUATION_THRESHOLDS.readOnly),
    approvalTrigger: z.literal(RELEASE_EVALUATION_THRESHOLDS.approvalTrigger),
    proposalCorrectness: z.literal(RELEASE_EVALUATION_THRESHOLDS.proposalCorrectness),
    uncertaintySafety: z.literal(RELEASE_EVALUATION_THRESHOLDS.uncertaintySafety),
    duplicateApproval: z.literal(RELEASE_EVALUATION_THRESHOLDS.duplicateApproval),
    externalDisclosure: z.literal(RELEASE_EVALUATION_THRESHOLDS.externalDisclosure),
    entityResolution: z.literal(RELEASE_EVALUATION_THRESHOLDS.entityResolution),
    followUpContinuity: z.literal(RELEASE_EVALUATION_THRESHOLDS.followUpContinuity),
}).strict();

export const RealRuntimeEvaluationPayloadSchema = z.object({
    suite: z.literal("full-program"),
    caseCount: z.literal(200),
    uniquePromptCount: z.literal(200),
    fixtureCount: z.literal(200),
    caseDigest: DigestSchema,
    fixtureAssertionDigest: DigestSchema,
    categories: z.array(z.enum([
        "ko", "en", "mixed", "duplicate", "follow-up", "date",
        "authorization", "branch", "write", "approval", "external", "uncertainty",
    ])).length(12).refine((items) => new Set(items).size === 12, "All evaluation categories must be unique"),
    model: z.string().min(1).max(200),
    agentVersion: z.string().min(1).max(200),
    manifestFresh: z.boolean(),
    deployedCommitSha: ShaSchema.nullable(),
    deployedCommitMatches: z.boolean(),
    scores: ReleaseEvaluationScoresSchema.nullable(),
    thresholds: ReleaseEvaluationThresholdsSchema,
    thresholdPassed: z.boolean(),
    actionExecutionMode: z.enum(["isolated-staging-stub", "not-executed"]),
    providerLedgerAssertions: z.number().int().nonnegative(),
    currentBranchReadAssertions: z.number().int().nonnegative(),
    entityContinuityAssertions: z.number().int().nonnegative(),
    fixturePassCount: z.number().int().min(0).max(200),
    executedProposalCount: z.number().int().nonnegative(),
    externalProposalCount: z.number().int().nonnegative(),
}).strict();

const DesktopPayloadSchema = z.object({
    scenarioIds: ScenarioIdsSchema,
    browsers: z.array(z.enum(["chromium", "firefox", "webkit"])).min(1),
    authenticated: z.literal(true),
    realBackend: z.literal(true),
}).strict();

const MobilePayloadSchema = z.object({
    scenarioIds: ScenarioIdsSchema,
    devices: z.array(z.string().min(1).max(100)).min(2),
    authenticated: z.literal(true),
    installedPwaVerified: z.literal(true),
    accessibilityAuditPassed: z.literal(true),
}).strict();

const SecurityPayloadSchema = z.object({
    scenarioIds: ScenarioIdsSchema,
    database: z.literal("postgres"),
    cache: z.literal("valkey"),
    minimizedModelPayloadVerified: z.literal(true),
}).strict();

const ProviderObservationPayloadSchema = z.object({
    observationDays: z.number().int().min(30),
    duplicateSideEffects: z.literal(0),
    providerActionsObserved: z.number().int().positive(),
    providers: z.array(z.enum(["aligo", "web-push", "eformsign"])).length(3)
        .refine((items) => new Set(items).size === 3, "All production providers must be observed"),
    capabilityNames: z.array(z.string().min(1)).min(1),
    environment: z.literal("production"),
}).strict();

const RollbackPayloadSchema = z.object({
    exercisedAt: z.string().datetime({ offset: true }),
    recoverySeconds: z.number().int().nonnegative().max(300),
    frontendShellDisabled: z.literal(true),
    backendFlagsDisabled: z.literal(true),
    legacyChatAvailable: z.literal(true),
    noAdditiveTablesDropped: z.literal(true),
}).strict();

const PrivacyPayloadSchema = z.object({
    reviewer: z.string().min(1).max(200),
    approvedAt: z.string().datetime({ offset: true }),
    decision: z.literal("approved"),
    retentionDays: z.number().int().positive().max(365),
    piiLoggingReviewed: z.literal(true),
    modelPayloadMinimized: z.literal(true),
}).strict();

const baseFields = {
    version: z.literal(1),
    commitSha: ShaSchema,
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    passed: z.boolean(),
    digest: DigestSchema,
};

export const ReleaseEvidenceArtifactSchema = z.discriminatedUnion("kind", [
    z.object({ ...baseFields, kind: z.literal("realRuntimeEvaluation"), mode: z.enum(["real-runtime-model", "contract-validation"]), payload: RealRuntimeEvaluationPayloadSchema }).strict(),
    z.object({ ...baseFields, kind: z.literal("desktopRealBackendE2E"), mode: z.literal("real-backend-e2e"), payload: DesktopPayloadSchema }).strict(),
    z.object({ ...baseFields, kind: z.literal("mobileRealBackendE2E"), mode: z.literal("real-backend-e2e"), payload: MobilePayloadSchema }).strict(),
    z.object({ ...baseFields, kind: z.literal("securityE2E"), mode: z.literal("real-database-e2e"), payload: SecurityPayloadSchema }).strict(),
    z.object({ ...baseFields, kind: z.literal("providerDuplicateObservation"), mode: z.literal("production-observation"), payload: ProviderObservationPayloadSchema }).strict(),
    z.object({ ...baseFields, kind: z.literal("rollbackExercise"), mode: z.literal("production-like-exercise"), payload: RollbackPayloadSchema }).strict(),
    z.object({ ...baseFields, kind: z.literal("privacyReview"), mode: z.literal("human-review"), payload: PrivacyPayloadSchema }).strict(),
]);

export type ReleaseEvidenceArtifact = z.infer<typeof ReleaseEvidenceArtifactSchema>;
export type ReleaseEvidenceArtifactByKind<K extends ReleaseEvidenceKind> = Extract<ReleaseEvidenceArtifact, { kind: K }>;
export type UnsignedReleaseEvidenceArtifact = ReleaseEvidenceArtifact extends infer Artifact
    ? Artifact extends ReleaseEvidenceArtifact ? Omit<Artifact, "digest"> : never
    : never;

const MAX_EVIDENCE_LIFETIME_DAYS: Record<ReleaseEvidenceKind, number> = {
    realRuntimeEvaluation: 8,
    desktopRealBackendE2E: 8,
    mobileRealBackendE2E: 8,
    securityE2E: 8,
    providerDuplicateObservation: 8,
    rollbackExercise: 8,
    privacyReview: 31,
};

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

export function releaseEvidenceDigest(artifact: UnsignedReleaseEvidenceArtifact): string {
    return createHash("sha256").update(stableJson(artifact)).digest("hex");
}

export function parseReleaseEvidenceArtifact<K extends ReleaseEvidenceKind>(
    source: string,
    expected: { kind: K; commitSha: string; now?: Date },
): ReleaseEvidenceArtifactByKind<K> {
    const artifact = ReleaseEvidenceArtifactSchema.parse(JSON.parse(source));
    if (artifact.kind !== expected.kind) throw new Error(`Expected ${expected.kind} evidence, received ${artifact.kind}`);
    if (artifact.commitSha !== expected.commitSha) throw new Error("Evidence commit does not match the release commit");
    const now = expected.now ?? new Date();
    const createdAt = new Date(artifact.createdAt);
    const expiresAt = new Date(artifact.expiresAt);
    if (createdAt.getTime() > now.getTime() + 5 * 60_000) throw new Error("Evidence creation time is in the future");
    if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() <= createdAt.getTime()) throw new Error("Evidence is stale");
    const maximumLifetime = MAX_EVIDENCE_LIFETIME_DAYS[artifact.kind] * 24 * 60 * 60 * 1000;
    if (expiresAt.getTime() - createdAt.getTime() > maximumLifetime) throw new Error("Evidence lifetime exceeds the allowed window");
    const { digest, ...unsigned } = artifact;
    if (releaseEvidenceDigest(unsigned) !== digest) throw new Error("Evidence digest does not match its contents");
    if (!artifact.passed) throw new Error("Evidence did not pass");
    return artifact as ReleaseEvidenceArtifactByKind<K>;
}

export function evidenceBundleDigest(artifacts: Record<string, ReleaseEvidenceArtifact>): string {
    return createHash("sha256").update(Object.entries(artifacts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, artifact]) => `${name}:${artifact.digest}`)
        .join("\n")).digest("hex");
}
