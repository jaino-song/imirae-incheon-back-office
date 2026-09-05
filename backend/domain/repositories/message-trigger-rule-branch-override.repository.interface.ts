export interface MessageTriggerRuleBranchOverride {
    branchId: string;
    ruleId: string;
    isActive: boolean;
}

export interface IMessageTriggerRuleBranchOverrideRepository {
    findOne(branchId: string, ruleId: string): Promise<MessageTriggerRuleBranchOverride | null>;
    findAllByBranch(branchId: string): Promise<MessageTriggerRuleBranchOverride[]>;
    upsert(branchId: string, ruleId: string, isActive: boolean): Promise<MessageTriggerRuleBranchOverride>;
    cancelJobsForBranchRule(branchId: string, ruleId: string, cancelReason: string, retryReason: string): Promise<void>;
}

export const MESSAGE_TRIGGER_RULE_BRANCH_OVERRIDE_REPOSITORY = "MESSAGE_TRIGGER_RULE_BRANCH_OVERRIDE_REPOSITORY";
