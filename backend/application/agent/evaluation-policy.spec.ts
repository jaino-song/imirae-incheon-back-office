import { AGENT_EVAL_CASES, REQUIRED_EXTERNAL_EXECUTION_CAPABILITIES } from "../../../evals/agent/cases";
import {
    evaluateExternalFixtureCoverage,
    evaluateExternalExecutionEvidence,
    evaluateApprovalEvidence,
    hasRequiredMutationExecutionEvidence,
    matchesEvaluationMutationPolicy,
    requiredProviderLedgerAssertionCount,
} from "../../../evals/agent/evaluation-policy";
import {
    validateEvaluationBaseUrl,
    validateEvaluationEndpoint,
    withEvaluationFetchPolicy,
} from "../../../evals/agent/network-policy";

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
            executedProposalCount: REQUIRED_EXTERNAL_EXECUTION_CAPABILITIES.length,
            externalProposalCount: REQUIRED_EXTERNAL_EXECUTION_CAPABILITIES.length,
        };

        expect(requiredAssertions).toBe(REQUIRED_EXTERNAL_EXECUTION_CAPABILITIES.length + 1);
        expect(evaluateExternalFixtureCoverage(AGENT_EVAL_CASES)).toMatchObject({
            complete: true,
            missing: [],
            unexpected: [],
            duplicates: [],
            observed: [...REQUIRED_EXTERNAL_EXECUTION_CAPABILITIES].sort(),
        });
        expect(matchesEvaluationMutationPolicy(generatedEvidence, AGENT_EVAL_CASES)).toBe(true);
        expect(matchesEvaluationMutationPolicy({ ...generatedEvidence, providerLedgerAssertions: requiredAssertions - 1 }, AGENT_EVAL_CASES)).toBe(false);
        expect(matchesEvaluationMutationPolicy({ ...generatedEvidence, externalProposalCount: REQUIRED_EXTERNAL_EXECUTION_CAPABILITIES.length - 1 }, AGENT_EVAL_CASES)).toBe(false);
        expect(matchesEvaluationMutationPolicy({ ...generatedEvidence, externalProposalCount: 0 }, AGENT_EVAL_CASES)).toBe(false);
    });

    it("fails closed when a required external fixture is missing, duplicated, or unexpected", () => {
        const fixtures = AGENT_EVAL_CASES.filter((item) => item.externalFixtureCapability);
        const withoutSms = fixtures.filter((item) => item.externalFixtureCapability !== "messages.sendSms");
        const duplicateSms = [...fixtures, fixtures.find((item) => item.externalFixtureCapability === "messages.sendSms")!];
        const unexpected = [...fixtures, {
            ...fixtures[0],
            externalFixtureCapability: "messages.unknown",
            requiresProviderLedger: true,
            allowClarification: false,
        }];

        expect(evaluateExternalFixtureCoverage(withoutSms)).toMatchObject({ complete: false, missing: ["messages.sendSms"] });
        expect(evaluateExternalFixtureCoverage(duplicateSms)).toMatchObject({ complete: false, duplicates: ["messages.sendSms"] });
        expect(evaluateExternalFixtureCoverage(unexpected)).toMatchObject({ complete: false, unexpected: ["messages.unknown"] });
    });

    it("requires every concrete external fixture to produce a proposal, approval, and terminal ledger assertion", () => {
        const fixtures = AGENT_EVAL_CASES.filter((item) => item.externalFixtureCapability);

        expect(fixtures).toHaveLength(REQUIRED_EXTERNAL_EXECUTION_CAPABILITIES.length);
        expect(fixtures.every((item) => item.allowClarification === false)).toBe(true);
        expect(fixtures.every((item) => item.expectedApproval === true)).toBe(true);
        expect(fixtures.every((item) => item.requiresProviderLedger === true)).toBe(true);
        expect(fixtures.every((item) => item.requiresTerminalExecution === true)).toBe(true);
        expect(fixtures.every((item) => item.requiresProviderDisclosure === true)).toBe(true);
        expect(new Set(fixtures.map((item) => item.externalFixtureCapability)).size).toBe(fixtures.length);
    });

    it("counts only confirmed succeeded actions in external execution coverage", () => {
        const terminalStatuses = ["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"] as const;
        for (const status of terminalStatuses) {
            const action = {
                id: "action-1",
                status,
                capability: "messages.sendSms",
                executionAttemptCount: 1,
                result: { providerId: "provider-1" },
            };
            const evidence = evaluateExternalExecutionEvidence({
                expectedActionId: "action-1",
                expectedCapability: "messages.sendSms",
                terminalAction: action,
                confirmedAction: action,
                providerCalls: 1,
            });

            expect(evidence.terminal).toBe(true);
            expect(evidence.actionEvidenceMatches).toBe(true);
            expect(evidence.fixturePassed).toBe(status === "succeeded");
        }
    });

    it("fails external execution evidence on identity, capability, attempt, result, or call-count drift", () => {
        const terminalAction = {
            id: "action-1",
            status: "succeeded",
            capability: "messages.sendSms",
            executionAttemptCount: 1,
            result: { providerId: "provider-1" },
        } as const;
        const cases = [
            { label: "terminal identity", terminalAction: { ...terminalAction, id: "action-2" } },
            { label: "confirmed capability", confirmedAction: { ...terminalAction, capability: "messages.scheduleSms" } },
            { label: "terminal attempt", terminalAction: { ...terminalAction, executionAttemptCount: 2 } },
            { label: "confirmed result", confirmedAction: { ...terminalAction, result: { providerId: "provider-2" } } },
            { label: "provider calls", providerCalls: 2 },
        ];

        for (const item of cases) {
            const evidence = evaluateExternalExecutionEvidence({
                expectedActionId: "action-1",
                expectedCapability: "messages.sendSms",
                terminalAction: item.terminalAction ?? terminalAction,
                confirmedAction: item.confirmedAction ?? terminalAction,
                providerCalls: item.providerCalls ?? 1,
            });
            expect(evidence.fixturePassed).toBe(false);
        }
    });

    it("requires the protected preview URL to use the exact HTTPS allowlisted origin", () => {
        expect(validateEvaluationBaseUrl(
            "https://preview.example.test/api",
            "https://preview.example.test",
        )).toBe("https://preview.example.test/api");
        expect(() => validateEvaluationBaseUrl("http://preview.example.test", "https://preview.example.test")).toThrow();
        expect(() => validateEvaluationBaseUrl("https://other.example.test", "https://preview.example.test")).toThrow();
        expect(() => validateEvaluationBaseUrl("https://user:password@preview.example.test", "https://preview.example.test")).toThrow();
        expect(() => validateEvaluationBaseUrl("https://preview.example.test", undefined)).toThrow();
        expect(() => validateEvaluationEndpoint("https://user:password@ledger.example.test", "ledger URL")).toThrow();
    });

    it("forces evaluation requests to reject redirects", () => {
        expect(withEvaluationFetchPolicy()).toEqual({ redirect: "error" });
        expect(withEvaluationFetchPolicy({ method: "POST" })).toEqual({ method: "POST", redirect: "error" });
        expect(() => withEvaluationFetchPolicy({ redirect: "follow" })).toThrow();
    });
});
