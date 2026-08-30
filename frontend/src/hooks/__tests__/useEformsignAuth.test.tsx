import { renderHook, waitFor } from "@testing-library/react";

import { eformsignApi } from "@/services/api";
import { useEformsignAuth } from "../useEformsignAuth";

jest.mock("@/services/api", () => ({
  eformsignApi: {
    authenticate: jest.fn(),
    getAuthStatus: jest.fn(),
  },
}));

jest.mock("@/lib/safe-storage", () => ({
  safeStorageGetItem: jest.fn(() => null),
  safeStorageRemoveItem: jest.fn(),
  safeStorageSetItem: jest.fn(),
}));

const mockAuthenticate = eformsignApi.authenticate as jest.MockedFunction<
  typeof eformsignApi.authenticate
>;
const mockGetAuthStatus = eformsignApi.getAuthStatus as jest.MockedFunction<
  typeof eformsignApi.getAuthStatus
>;

describe("useEformsignAuth", () => {
  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockGetAuthStatus.mockReset();
  });

  it("allows local document reads with only the app session", async () => {
    mockGetAuthStatus.mockResolvedValue({
      hasAppAuthToken: true,
      providerSession: "server-only",
    });

    const { result } = renderHook(() =>
      useEformsignAuth({
        requireAccessToken: false,
        syncOnWindowFocus: false,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(true);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
