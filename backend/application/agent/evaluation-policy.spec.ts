import { AGENT_EVAL_CASES } from "../../../evals/agent/cases";
import {
    evaluateApprovalEvidence,
    hasRequiredMutationExecutionEvidence,
    matchesEvaluationMutationPolicy,
    requiredProviderLedgerAssertionCount,
} from "../../../evals/agent/evaluation-policy";

describe("agent evaluation approval policy", () => {
    it("accepts one form-only clarification without requiring execution evidence", () => {
        expect(evaluateApprovalEvidence({
            expectedApproval: true,
            allowClarification: true,
            formRequests: 1,
            proposalCount: 0,
            correctProposalCount: 0,
        })).toEqual({
            accepted: true,
            acceptedClarification: true,
            shouldExecuteProposal: false,
        });
    });

    it("rejects an invented proposal for an underspecified fixture", () => {
        expect(evaluateApprovalEvidence({
            expectedApproval: true,
            allowClarification: true,
            formRequests: 0,
            proposalCount: 1,
            correctProposalCount: 1,
        }).accepted).toBe(false);
    });

    it("requires non-vacuous internal and external proposal execution coverage", () => {
        expect(hasRequiredMutationExecutionEvidence({ executedProposalCount: 0, externalProposalCount: 0 })).toBe(false);
        expect(hasRequiredMutationExecutionEvidence({ executedProposalCount: 1, externalProposalCount: 0 })).toBe(false);
        expect(hasRequiredMutationExecutionEvidence({ executedProposalCount: 2, externalProposalCount: 1 })).toBe(true);
    });

    it("keeps evaluator and cutover provider evidence cardinality aligned", () => {
        const requiredAssertions = requiredProviderLedgerAssertionCount(AGENT_EVAL_CASES);
        const generatedEvidence = {
            providerLedgerAssertions: requiredAssertions,
            executedProposalCount: 2,
            externalProposalCount: 1,
        };

        expect(requiredAssertions).toBe(2);
        expect(matchesEvaluationMutationPolicy(generatedEvidence, AGENT_EVAL_CASES)).toBe(true);
        expect(matchesEvaluationMutationPolicy({ ...generatedEvidence, providerLedgerAssertions: 12 }, AGENT_EVAL_CASES)).toBe(false);
        expect(matchesEvaluationMutationPolicy({ ...generatedEvidence, externalProposalCount: 0 }, AGENT_EVAL_CASES)).toBe(false);
    });
});
