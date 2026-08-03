import { mergeRuleOrder } from "./rule-order";

describe("mergeRuleOrder", () => {
    it("should preserve stale positions and append newly displayed ids", () => {
        expect(
            mergeRuleOrder(
                ["stale-first", "rule-one", "stale-middle", "rule-two"],
                ["rule-two", "rule-one", "rule-new"],
            ),
        ).toEqual([
            "stale-first",
            "rule-two",
            "stale-middle",
            "rule-one",
            "rule-new",
        ]);
    });

    it("should return the displayed order when the saved order is empty", () => {
        expect(mergeRuleOrder([], ["rule-two", "rule-one"])).toEqual([
            "rule-two",
            "rule-one",
        ]);
    });

    it("should retain an inactive hidden id while reordering the displayed ids around it", () => {
        expect(
            mergeRuleOrder(
                ["rule-one", "rule-two", "rule-inactive", "rule-four"],
                ["rule-one", "rule-four", "rule-two"],
            ),
        ).toEqual(["rule-one", "rule-four", "rule-inactive", "rule-two"]);
    });
});
