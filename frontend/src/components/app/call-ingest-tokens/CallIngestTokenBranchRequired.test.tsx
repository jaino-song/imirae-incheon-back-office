import { render, screen } from "@testing-library/react";

import { CallIngestTokenBranchRequired } from "./CallIngestTokenBranchRequired";

describe("CallIngestTokenBranchRequired", () => {
  it("names the section and tells the owner to select a branch first", () => {
    render(<CallIngestTokenBranchRequired />);

    expect(screen.getByRole("heading", { name: "통화 수집 토큰" })).toBeInTheDocument();
    expect(screen.getByText("토큰은 지점별로 발급됩니다. 상단에서 지점을 먼저 선택해 주세요.")).toBeInTheDocument();
  });

  it("offers no issue action — there is no branch to issue for", () => {
    render(<CallIngestTokenBranchRequired />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
