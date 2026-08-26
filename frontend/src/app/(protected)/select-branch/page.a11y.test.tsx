import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import SelectBranchPage from "./page";
import { getUserBranches, setCurrentBranch } from "./actions";
import { resetAuthorityState } from "@/lib/auth/authority-state";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockClear = jest.fn();

jest.mock("./actions", () => ({
  getUserBranches: jest.fn(),
  setCurrentBranch: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ clear: mockClear }),
}));

jest.mock("@/lib/auth/authority-state", () => ({
  resetAuthorityState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/components/auth/auth-panel", () => ({
  AuthPanel: ({
    children,
    title,
    subtitle,
  }: {
    children: ReactNode;
    title?: ReactNode;
    subtitle?: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </main>
  ),
}));

const mockedGetUserBranches = jest.mocked(getUserBranches);
const mockedSetCurrentBranch = jest.mocked(setCurrentBranch);
const mockedResetAuthorityState = jest.mocked(resetAuthorityState);

const branches = [
  {
    id: "branch-a",
    name: "강남점",
    slug: "gangnam",
    description: "서울 강남",
    role: "admin",
  },
  {
    id: "branch-b",
    name: "송도점",
    slug: "songdo",
    description: "인천 송도",
    role: "member",
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockedResetAuthorityState.mockResolvedValue(undefined);
  mockedGetUserBranches.mockResolvedValue({ success: true, branches });
  mockedSetCurrentBranch.mockResolvedValue({ success: true });
});

describe("SelectBranchPage branch action accessibility", () => {
  it("exposes every available branch as a named, focusable Button action", async () => {
    render(<SelectBranchPage />);

    const options = await screen.findAllByRole("button", { name: /지점 선택$/ });

    expect(options).toHaveLength(branches.length);
    for (const [index, option] of options.entries()) {
      expect(option).toHaveAttribute("data-component", "desktop_select-branch_list_card");
      expect(option).toHaveAttribute("type", "button");
      expect(option.tagName).toBe("BUTTON");
      expect(option).toHaveClass("focus-visible:ring-2");
      expect(option).toHaveClass("focus-visible:ring-ring");
      expect(option).toHaveAttribute("aria-label", `${branches[index].name} 지점 선택`);
      expect(option.tabIndex).toBe(0);

      option.focus();
      expect(document.activeElement).toBe(option);
    }
  });

  it("keeps pointer selection parity and prevents duplicate activation while pending", async () => {
    let resolveSelection: ((result: { success: boolean }) => void) | undefined;
    mockedSetCurrentBranch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSelection = resolve;
        }),
    );

    render(<SelectBranchPage />);

    const firstOption = await screen.findByRole("button", { name: "강남점 지점 선택" });
    const secondOption = screen.getByRole("button", { name: "송도점 지점 선택" });

    fireEvent.click(firstOption);

    await waitFor(() => expect(mockedResetAuthorityState).toHaveBeenCalledWith({ clear: mockClear }));
    await waitFor(() => expect(mockedSetCurrentBranch).toHaveBeenCalledWith("branch-a"));
    expect(mockedResetAuthorityState.mock.invocationCallOrder[0]).toBeLessThan(
      mockedSetCurrentBranch.mock.invocationCallOrder[0],
    );
    expect(mockedSetCurrentBranch).toHaveBeenCalledTimes(1);
    expect(firstOption).toBeDisabled();
    expect(secondOption).toBeDisabled();

    fireEvent.click(firstOption);
    expect(mockedSetCurrentBranch).toHaveBeenCalledTimes(1);

    resolveSelection?.({ success: true });
  });
});
