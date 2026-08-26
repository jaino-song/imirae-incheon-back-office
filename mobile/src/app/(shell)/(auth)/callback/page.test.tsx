import { render, screen, waitFor } from "@testing-library/react";

import AuthCallbackPage from "./page";
import { exchangeToken } from "./actions";
import { resetAuthorityState } from "@/lib/auth/authority-state";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("./actions", () => ({
  exchangeToken: jest.fn(),
}));

jest.mock("@/lib/auth/authority-state", () => ({
  resetAuthorityState: jest.fn().mockResolvedValue(undefined),
}));

const mockExchangeToken = jest.mocked(exchangeToken);
const mockResetAuthorityState = jest.mocked(resetAuthorityState);

describe("AuthCallbackPage", () => {
  const originalLocation = window.location;
  const mockLocationReplace = jest.fn();

  beforeEach(() => {
    mockPush.mockReset();
    mockReplace.mockReset();
    mockExchangeToken.mockReset();
    mockResetAuthorityState.mockReset();
    mockResetAuthorityState.mockResolvedValue(undefined);
    mockSearchParams = new URLSearchParams();

    mockLocationReplace.mockReset();
    // Success paths now navigate via a hard `window.location.replace` instead
    // of the router, so the real (unimplemented in jsdom) navigation is
    // swapped for a spy here and restored below.
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

  it("does not expose arbitrary backend OAuth error text", async () => {
    mockSearchParams = new URLSearchParams({
      error: "접근 가능한 지점이 없습니다. 관리자에게 문의해 주세요.",
    });

    render(<AuthCallbackPage />);

    expect(await screen.findByText("로그인 중 오류가 발생했습니다.")).toBeInTheDocument();
    await waitFor(() => expect(mockExchangeToken).not.toHaveBeenCalled());
  });

  it("routes Kakao onboarding responses to the mobile onboarding screen", async () => {
    mockSearchParams = new URLSearchParams({ code: "pending-signup-code" });
    mockExchangeToken.mockResolvedValue({
      success: true,
      onboardingRequired: true,
      onboardingRoute: "/kakao/onboarding",
    });

    render(<AuthCallbackPage />);

    await waitFor(() => expect(mockLocationReplace).toHaveBeenCalledWith("/kakao/onboarding"));
  });

  it("exchanges a valid authorization code and continues to the dashboard", async () => {
    mockSearchParams = new URLSearchParams({ code: "one-time-code" });
    mockExchangeToken.mockResolvedValue({ success: true });

    render(<AuthCallbackPage />);

    await waitFor(() => expect(mockExchangeToken).toHaveBeenCalledWith("one-time-code"));
    await waitFor(() => expect(mockLocationReplace).toHaveBeenCalledWith("/dashboard"));
    expect(mockResetAuthorityState).toHaveBeenCalled();
  });
});
