import { prioritizeRecentBranch } from "./branch-order";

describe("prioritizeRecentBranch", () => {
  const branches = [
    { id: "branch-a", name: "가 지점" },
    { id: "branch-b", name: "나 지점" },
    { id: "branch-c", name: "다 지점" },
  ];

  it("should move the most recently accessed branch to the front while preserving the remaining order", () => {
    expect(prioritizeRecentBranch(branches, "branch-c")).toEqual([
      branches[2],
      branches[0],
      branches[1],
    ]);
  });

  it("should preserve the original order when the recent branch is unavailable", () => {
    expect(prioritizeRecentBranch(branches, "branch-missing")).toEqual(branches);
  });
});
