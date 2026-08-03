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
    cases: ReadonlyArray<{ requiresProviderLedger: boolean; allowClarification: boolean }>,
): number {
    // One additional assertion proves reconciliation of the pre-seeded
    // uncertain action without another provider call.
    return cases.filter((item) => item.requiresProviderLedger && !item.allowClarification).length + 1;
}

export function matchesEvaluationMutationPolicy(
    evidence: { providerLedgerAssertions: number; executedProposalCount: number; externalProposalCount: number },
    cases: ReadonlyArray<{ requiresProviderLedger: boolean; allowClarification: boolean }>,
): boolean {
    return evidence.providerLedgerAssertions === requiredProviderLedgerAssertionCount(cases)
        && hasRequiredMutationExecutionEvidence(evidence);
}
