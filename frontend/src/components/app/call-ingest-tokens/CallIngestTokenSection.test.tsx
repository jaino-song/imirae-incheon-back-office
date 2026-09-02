import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { callIngestTokenApi } from "@/services/api";

import { CallIngestTokenSection } from "./CallIngestTokenSection";

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/services/api", () => ({
  callIngestTokenApi: {
    list: jest.fn(),
    create: jest.fn(),
    revoke: jest.fn(),
  },
}));

const mockedList = callIngestTokenApi.list as jest.Mock;
const mockedRevoke = callIngestTokenApi.revoke as jest.Mock;

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CallIngestTokenSection branchId="branch-1" />
    </QueryClientProvider>,
  );
}

describe("CallIngestTokenSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the token list with label, issue date, and status", async () => {
    mockedList.mockResolvedValue([
      { id: "tok-1", label: "인천본점 n8n", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "tok-2", label: "구 토큰", active: false, createdAt: "2026-02-02T00:00:00.000Z" },
    ]);

    renderSection();

    expect(await screen.findByText("인천본점 n8n")).toBeInTheDocument();
    expect(screen.getByText("구 토큰")).toBeInTheDocument();
    expect(screen.getByText("사용 중")).toBeInTheDocument();
    expect(screen.getByText("취소됨")).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledWith("branch-1");
  });

  it("shows an empty state when the branch has no tokens", async () => {
    mockedList.mockResolvedValue([]);

    renderSection();

    expect(await screen.findByText("발급된 토큰이 없습니다.")).toBeInTheDocument();
  });

  it("revoke confirm calls the API with the target token id", async () => {
    mockedList.mockResolvedValue([
      { id: "tok-1", label: "인천본점 n8n", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    mockedRevoke.mockResolvedValue(undefined);

    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "취소" }));

    const approveButton = await screen.findByRole("button", { name: "토큰 취소" });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(mockedRevoke).toHaveBeenCalledWith("tok-1");
    });
  });

  it("does not call revoke when the confirm dialog is dismissed", async () => {
    mockedList.mockResolvedValue([
      { id: "tok-1", label: "인천본점 n8n", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "취소" }));
    fireEvent.click(await screen.findByRole("button", { name: "닫기" }));

    expect(mockedRevoke).not.toHaveBeenCalled();
  });
});
