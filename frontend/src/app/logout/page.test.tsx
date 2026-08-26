import { render, waitFor } from "@testing-library/react";

import LogoutPage from "./page";
import { logout } from "./actions";
import { resetAuthorityState } from "@/lib/auth/authority-state";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("./actions", () => ({
  logout: jest.fn(),
}));

jest.mock("@/lib/auth/authority-state", () => ({
  resetAuthorityState: jest.fn().mockResolvedValue(undefined),
}));

const mockedLogout = jest.mocked(logout);
const mockedResetAuthorityState = jest.mocked(resetAuthorityState);

describe("desktop logout authority boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedResetAuthorityState.mockResolvedValue(undefined);
    mockedLogout.mockResolvedValue({ success: false, error: "server logout unavailable" });
  });

  it("resets local authority state before logout even when server logout fails", async () => {
    render(<LogoutPage />);

    await waitFor(() => expect(mockedLogout).toHaveBeenCalled());
    expect(mockedResetAuthorityState).toHaveBeenCalled();
    expect(mockedResetAuthorityState.mock.invocationCallOrder[0]).toBeLessThan(
      mockedLogout.mock.invocationCallOrder[0],
    );
  });
});
