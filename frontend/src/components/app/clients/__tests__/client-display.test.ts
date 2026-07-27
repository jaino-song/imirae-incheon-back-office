import { getClientDisplayLabel } from "../client-display";

describe("getClientDisplayLabel", () => {
    it.each([
        ["A통합-1형", "A통합1형"],
        ["조리원", "산후조리원"],
        ["조리원 이용", "산후조리원"],
    ])("normalizes %s for display without changing source data", (source, expected) => {
        expect(getClientDisplayLabel(source)).toBe(expected);
        expect(source).not.toBe(expected);
    });

    it("preserves labels that do not need display normalization", () => {
        expect(getClientDisplayLabel("계약서 필요")).toBe("계약서 필요");
    });
});
