export function isRuleActiveForBranch(ruleIsActive: boolean, overrideIsActive?: boolean): boolean {
    return ruleIsActive && (overrideIsActive ?? true);
}
