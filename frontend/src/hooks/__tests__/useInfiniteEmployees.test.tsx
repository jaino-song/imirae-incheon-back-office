import { renderHook } from "@testing-library/react";

import { useEmployees } from "@/hooks/useEmployees";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: jest.fn(),
}));

const mockedUseEmployees = jest.mocked(useEmployees);

describe("useInfiniteEmployees query state forwarding", () => {
  it("preserves query failure and refetch state for the page", () => {
    const refetch = jest.fn();

    mockedUseEmployees.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useEmployees>);

    const { result } = renderHook(() => useInfiniteEmployees());

    expect(result.current.isError).toBe(true);
    expect(result.current.refetch).toBe(refetch);
  });
});
