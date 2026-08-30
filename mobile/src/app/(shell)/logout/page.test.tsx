import { render, waitFor } from "@testing-library/react";

import LogoutPage from "./page";
import { logout } from "./actions";
import { resetAuthorityState } from "@/lib/auth/authority-state";

const originalLocation = window.location;
const mockLocationReplace = jest.fn();

jest.mock("./actions", () => ({
  logout: jest.fn(),
}));

jest.mock("@/lib/auth/authority-state", () => ({
  resetAuthorityState: jest.fn().mockResolvedValue(undefined),
}));

const mockedLogout = jest.mocked(logout);
const mockedResetAuthorityState = jest.mocked(resetAuthorityState);

describe("mobile logout authority boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedResetAuthorityState.mockResolvedValue(undefined);
    mockedLogout.mockResolvedValue({ success: false, error: "server logout unavailable" });
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, replace: mockLocationReplace },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it("resets local authority state before logout even when server logout fails", async () => {
    render(<LogoutPage />);

    await waitFor(() => expect(mockedLogout).toHaveBeenCalledTimes(1));
    expect(mockedResetAuthorityState).toHaveBeenCalledTimes(1);
    expect(mockedResetAuthorityState.mock.invocationCallOrder[0]).toBeLessThan(
      mockedLogout.mock.invocationCallOrder[0],
    );
  });
});
