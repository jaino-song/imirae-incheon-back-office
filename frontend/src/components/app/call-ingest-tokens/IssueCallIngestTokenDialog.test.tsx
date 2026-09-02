import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { callIngestTokenApi } from "@/services/api";

import { IssueCallIngestTokenDialog } from "./IssueCallIngestTokenDialog";

const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
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
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <IssueCallIngestTokenDialog
          open
          onOpenChange={onOpenChange}
          branchId="branch-1"
          onIssued={jest.fn()}
        />
      </QueryClientProvider>,
    ),
  };
}

/** The mutation cache is the other place the plaintext lives, besides component state. */
function mutationCacheHasToken(queryClient: QueryClient): boolean {
  return queryClient
    .getMutationCache()
    .getAll()
    .some((mutation) => JSON.stringify(mutation.state.data ?? null).includes(PLAINTEXT_TOKEN));
}

const ISSUED_TOKEN = {
  id: "tok-1",
  branchId: "branch-1",
  label: "인천본점 n8n",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  token: PLAINTEXT_TOKEN,
};

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

  // The dialog is rendered unconditionally by its parent, so its observer never
  // unmounts and React Query's gcTime never starts — without an explicit reset
  // the plaintext outlives the dialog inside the mutation cache.
  it("clears the plaintext from the mutation cache when the dialog closes", async () => {
    mockedCreate.mockResolvedValue(ISSUED_TOKEN);

    const { queryClient } = renderDialog();

    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "인천본점 n8n" } });
    fireEvent.click(screen.getByRole("button", { name: "발급" }));
    expect(await screen.findByText(PLAINTEXT_TOKEN)).toBeInTheDocument();

    // Positive control: the cache really does hold it while the dialog is open,
    // so the assertion after closing is about the reset and not about an
    // always-empty cache.
    expect(mutationCacheHasToken(queryClient)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => {
      expect(mutationCacheHasToken(queryClient)).toBe(false);
    });
  });

  // This is the one screen where the value is never shown again, so a copy that
  // fails silently loses the token outright.
  it("tells the user to copy manually when clipboard access is refused", async () => {
    mockedCreate.mockResolvedValue(ISSUED_TOKEN);
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error("denied")) },
    });

    renderDialog();

    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "인천본점 n8n" } });
    fireEvent.click(screen.getByRole("button", { name: "발급" }));
    expect(await screen.findByText(PLAINTEXT_TOKEN)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "토큰 복사" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          description: "복사에 실패했어요. 토큰을 직접 선택해 복사해 주세요",
        }),
      );
    });
    // The token stays on screen — the failure must not also dismiss it.
    expect(screen.getByText(PLAINTEXT_TOKEN)).toBeInTheDocument();
  });

  it("shows the copied confirmation when the clipboard accepts the token", async () => {
    mockedCreate.mockResolvedValue(ISSUED_TOKEN);
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderDialog();

    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "인천본점 n8n" } });
    fireEvent.click(screen.getByRole("button", { name: "발급" }));
    expect(await screen.findByText(PLAINTEXT_TOKEN)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "토큰 복사" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(PLAINTEXT_TOKEN);
    });
    expect(mockToast).not.toHaveBeenCalled();
  });
});
