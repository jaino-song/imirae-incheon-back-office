import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { callIngestTokenApi } from "@/services/api";

import { IssueCallIngestTokenDialog } from "./IssueCallIngestTokenDialog";

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

const mockedCreate = callIngestTokenApi.create as jest.Mock;

const PLAINTEXT_TOKEN = "cit_test-plaintext-token-value";

function renderDialog(onOpenChange: (open: boolean) => void = jest.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <IssueCallIngestTokenDialog
        open
        onOpenChange={onOpenChange}
        branchId="branch-1"
        onIssued={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

function storageHasToken(): boolean {
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      const value = key ? store.getItem(key) : null;
      if (value?.includes(PLAINTEXT_TOKEN)) return true;
    }
  }
  return false;
}

describe("IssueCallIngestTokenDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("shows the plaintext token exactly once after issuing, with the never-shown-again warning", async () => {
    mockedCreate.mockResolvedValue({
      id: "tok-1",
      branchId: "branch-1",
      label: "인천본점 n8n",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      token: PLAINTEXT_TOKEN,
    });

    renderDialog();

    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "인천본점 n8n" } });
    fireEvent.click(screen.getByRole("button", { name: "발급" }));

    expect(await screen.findByText(PLAINTEXT_TOKEN)).toBeInTheDocument();
    expect(screen.getByText("다시 표시되지 않습니다.")).toBeInTheDocument();
    expect(mockedCreate).toHaveBeenCalledWith("branch-1", "인천본점 n8n");
  });

  it("removes the plaintext from the DOM once the dialog is closed", async () => {
    mockedCreate.mockResolvedValue({
      id: "tok-1",
      branchId: "branch-1",
      label: "인천본점 n8n",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      token: PLAINTEXT_TOKEN,
    });
    const onOpenChange = jest.fn();

    const { rerender } = renderDialog(onOpenChange);

    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "인천본점 n8n" } });
    fireEvent.click(screen.getByRole("button", { name: "발급" }));
    expect(await screen.findByText(PLAINTEXT_TOKEN)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Simulate the parent honoring onOpenChange(false) by closing the dialog.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <IssueCallIngestTokenDialog
          open={false}
          onOpenChange={onOpenChange}
          branchId="branch-1"
          onIssued={jest.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByText(PLAINTEXT_TOKEN)).not.toBeInTheDocument();
  });

  it("never writes the plaintext token to localStorage or sessionStorage", async () => {
    mockedCreate.mockResolvedValue({
      id: "tok-1",
      branchId: "branch-1",
      label: "인천본점 n8n",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      token: PLAINTEXT_TOKEN,
    });

    renderDialog();

    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "인천본점 n8n" } });
    fireEvent.click(screen.getByRole("button", { name: "발급" }));
    expect(await screen.findByText(PLAINTEXT_TOKEN)).toBeInTheDocument();

    await waitFor(() => {
      expect(storageHasToken()).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(storageHasToken()).toBe(false);
  });
});
