import { render, screen } from "@testing-library/react";

import { useGetAuthUser } from "@/hooks/useGetAuthUser";

import AllMenuPage from "./page";

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock("@/components/app/v3/ShortcutGrid", () => ({
  ShortcutGrid: () => <div data-component="test-shortcut-grid" />,
}));

const mockedUseGetAuthUser = jest.mocked(useGetAuthUser);

describe("AllMenuPage permission loading", () => {
  it("keeps the full menu in skeleton state until the user role is known", () => {
    mockedUseGetAuthUser.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useGetAuthUser>);

    const view = render(<AllMenuPage />);

    expect(screen.getByRole("status", { name: "메뉴 권한 확인 중" })).toBeInTheDocument();
    expect(screen.queryByText("관리자")).not.toBeInTheDocument();

    mockedUseGetAuthUser.mockReturnValue({
      data: {
        id: "owner-1",
        name: "오너",
        role: "owner",
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useGetAuthUser>);
    view.rerender(<AllMenuPage />);

    expect(screen.queryByRole("status", { name: "메뉴 권한 확인 중" })).not.toBeInTheDocument();
    expect(screen.getByText("관리자")).toBeInTheDocument();
  });
});
