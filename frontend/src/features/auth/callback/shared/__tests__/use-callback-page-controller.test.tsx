import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";

import { useCallbackPageController } from "../use-callback-page-controller";
import { resetAuthorityState } from "@/lib/auth/authority-state";

const mockReplace = jest.fn();
const mockPush = jest.fn();

// Controlled per test so we can drive `searchParams.get("code" | "error")`.
let searchParamValues: Record<string, string | null> = {};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => (key in searchParamValues ? searchParamValues[key] : null),
  }),
}));

const exchangeTokenMock = jest.fn();
jest.mock("@/app/(auth)/callback/actions", () => ({
  exchangeToken: (code: string) => exchangeTokenMock(code),
}));

jest.mock("@/lib/auth/authority-state", () => ({
  resetAuthorityState: jest.fn().mockResolvedValue(undefined),
}));

const mockedResetAuthorityState = jest.mocked(resetAuthorityState);

// A probe so we can render the hook through `render(<StrictMode>...)`. Note:
// `renderHook(..., { wrapper: <StrictMode> })` does NOT double-invoke the hook's
// effect under React 19 — only `render()` inside a <StrictMode> element does,
// which is the condition this regression depends on.
function CallbackProbe() {
  const { error } = useCallbackPageController();
  return <>{error}</>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedResetAuthorityState.mockResolvedValue(undefined);
  searchParamValues = {};
});

describe("useCallbackPageController", () => {
  // Regression guard for the dev-only stuck "로그인 중..." spinner. React Strict Mode
  // runs the effect twice (setup -> cleanup -> setup). The fix must let the second
  // (live) run navigate, and the single-use code must still be exchanged exactly
  // once. Before the fix, a per-render ref guard made run #2 bail while run #1
  // dropped its result as cancelled, so the page never left the spinner.
  it("navigates to /dashboard under Strict Mode's double-invoked effect", async () => {
    searchParamValues = { error: null, code: "kakao-auth-code" };
    exchangeTokenMock.mockResolvedValue({ success: true, requiresBranchSelection: false });

    render(
      <StrictMode>
        <CallbackProbe />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });
    expect(mockedResetAuthorityState).toHaveBeenCalled();
    expect(exchangeTokenMock).toHaveBeenCalledTimes(1);
  });

  it("does not expose arbitrary callback error text", async () => {
    searchParamValues = { error: "provider stack trace", code: null };

    render(<CallbackProbe />);

    expect(await screen.findByText("로그인 중 오류가 발생했습니다.")).toBeInTheDocument();
    expect(screen.queryByText("provider stack trace")).not.toBeInTheDocument();
    expect(exchangeTokenMock).not.toHaveBeenCalled();
  });
});
