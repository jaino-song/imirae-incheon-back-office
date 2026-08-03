import { REQUIRED_EXTERNAL_EXECUTION_CAPABILITIES } from "./cases";

export interface ApprovalEvidenceInput {
    expectedApproval: boolean;
    allowClarification: boolean;
    formRequests: number;
    proposalCount: number;
    correctProposalCount: number;
}

export interface ApprovalEvidence {
    accepted: boolean;
    acceptedClarification: boolean;
    shouldExecuteProposal: boolean;
}

export interface ExternalFixtureCase {
    requiresProviderLedger: boolean;
    allowClarification: boolean;
    externalFixtureCapability?: string;
}

export interface ExternalFixtureCoverage {
    required: readonly string[];
    observed: string[];
    missing: string[];
    unexpected: string[];
    duplicates: string[];
    complete: boolean;
}

/**
 * Compare the committed concrete external fixtures with the required
 * inventory. This is deliberately fail-closed: missing, unexpected, or
 * duplicate capability fixtures all invalidate the evaluation contract.
 */
export function evaluateExternalFixtureCoverage(cases: ReadonlyArray<ExternalFixtureCase>): ExternalFixtureCoverage {
    const observed = cases
        .flatMap((item) => item.externalFixtureCapability ? [item.externalFixtureCapability] : [])
        .sort();
    const required = [...REQUIRED_EXTERNAL_EXECUTION_CAPABILITIES];
    const observedCounts = new Map<string, number>();
    for (const capability of observed) observedCounts.set(capability, (observedCounts.get(capability) ?? 0) + 1);
    const requiredSet = new Set<string>(required);
    const observedSet = new Set(observed);
    const missing = required.filter((capability) => !observedSet.has(capability));
    const unexpected = [...observedSet].filter((capability) => !requiredSet.has(capability)).sort();
    const duplicates = [...observedCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([capability]) => capability)
        .sort();
    return {
        required,
        observed,
        missing,
        unexpected,
        duplicates,
        complete: missing.length === 0 && unexpected.length === 0 && duplicates.length === 0
            && observed.length === required.length,
    };
}

export function evaluateApprovalEvidence(input: ApprovalEvidenceInput): ApprovalEvidence {
    if (!input.expectedApproval) {
        return { accepted: true, acceptedClarification: false, shouldExecuteProposal: false };
    }
    const acceptedClarification = input.allowClarification
        && input.formRequests === 1
        && input.proposalCount === 0;
    const exactProposal = !input.allowClarification
        && input.correctProposalCount === 1
        && input.proposalCount === 1;
    return {
        accepted: acceptedClarification || exactProposal,
        acceptedClarification,
        shouldExecuteProposal: exactProposal,
    };
}

export function hasRequiredMutationExecutionEvidence(input: {
    executedProposalCount: number;
    externalProposalCount: number;
}): boolean {
    return input.executedProposalCount > 0 && input.externalProposalCount > 0;
}

export function requiredProviderLedgerAssertionCount(
    cases: ReadonlyArray<ExternalFixtureCase>,
): number {
    const coverage = evaluateExternalFixtureCoverage(cases);
    // One assertion per concrete capability proves action-bound, exactly-one
    // provider execution. One additional assertion proves reconciliation of
    // the pre-seeded uncertain action without another provider call.
    return coverage.complete ? coverage.required.length + 1 : 0;
}

export function matchesEvaluationMutationPolicy(
    evidence: { providerLedgerAssertions: number; executedProposalCount: number; externalProposalCount: number },
    cases: ReadonlyArray<ExternalFixtureCase>,
): boolean {
    const coverage = evaluateExternalFixtureCoverage(cases);
    const requiredExternalExecutionCount = coverage.required.length;
    return coverage.complete
        && evidence.providerLedgerAssertions === requiredProviderLedgerAssertionCount(cases)
        && evidence.externalProposalCount === requiredExternalExecutionCount
        && evidence.executedProposalCount >= requiredExternalExecutionCount
        && hasRequiredMutationExecutionEvidence(evidence);
}
