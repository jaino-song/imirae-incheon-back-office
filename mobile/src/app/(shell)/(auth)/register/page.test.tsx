import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { authApi } from "@/services/api";

import RegisterPage from "./page";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/services/api", () => ({
  authApi: {
    checkEmailExists: jest.fn(),
    register: jest.fn(),
  },
}));

const mockCheckEmailExists = jest.mocked(authApi.checkEmailExists);

describe("RegisterPage", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockCheckEmailExists.mockReset();
    mockCheckEmailExists.mockResolvedValue({ exists: false, linkable: false });
  });

  it("advances to the profile step when the account fields are valid", async () => {
    const user = userEvent.setup();

    render(<RegisterPage />);

    await user.type(screen.getByLabelText("이메일"), "new.user@example.com");
    await user.type(screen.getByLabelText("이름"), "테스트");
    await user.type(screen.getByLabelText("비밀번호"), "Password1!");
    await user.type(screen.getByLabelText("비밀번호 확인"), "Password1!");

    await waitFor(() => {
      expect(mockCheckEmailExists).toHaveBeenCalledWith("new.user@example.com");
    });

    await user.click(screen.getByRole("button", { name: "다음" }));

    expect(await screen.findByLabelText("전화번호")).toBeInTheDocument();
  });
});
