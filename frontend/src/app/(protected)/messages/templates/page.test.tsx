import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import TemplatesPage from "./page";

const mockDeleteMutateAsync = jest.fn();
const mockToast = jest.fn();

jest.mock("@/features/message-templates/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({
    data: [
      {
        id: "template-1",
        name: "검수 템플릿",
        content: "안녕하세요",
        variables: [],
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
    ],
    isLoading: false,
  }),
  useDeleteMessageTemplate: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
  }),
}));

jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplate: () => ({
    data: {
      id: "template-1",
      name: "검수 템플릿",
      content: "안녕하세요",
      variables: [],
    },
    isLoading: false,
  }),
  useUpdateMessageTemplate: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/components/app/v3", () => ({
  AnimatedSlotList: ({
    items,
    onSlotClick,
    render: renderItem,
  }: {
    items: Array<{ id: string }>;
    onSlotClick: (item: { id: string }) => void;
    render: (props: { item: { id: string }; isLoading: boolean }) => React.ReactNode;
  }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onSlotClick(item)}>
          {renderItem({ item, isLoading: false })}
        </button>
      ))}
    </div>
  ),
  AnimatedSlotListItemContent: ({ title }: { title: string }) => <span>{title}</span>,
  DetailEmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  DetailPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  HeaderActionButton: ({ label }: { label: string }) => <span>{label}</span>,
  ListEmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  ListPanel: ({
    children,
    headerActions,
  }: {
    children: React.ReactNode;
    headerActions?: React.ReactNode;
  }) => (
    <div>
      {headerActions}
      {children}
    </div>
  ),
  SplitLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/app/ui/TwoButtonModal", () => ({
  TwoButtonModal: ({
    open,
    title,
    approvalLabel,
    onApprove,
  }: {
    open: boolean;
    title: React.ReactNode;
    approvalLabel: React.ReactNode;
    onApprove: () => void;
  }) =>
    open ? (
      <div role="alertdialog">
        <h2>{title}</h2>
        <button type="button" onClick={onApprove}>
          {approvalLabel}
        </button>
      </div>
    ) : null,
}));

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div />,
}));

describe("TemplatesPage deletion", () => {
  beforeEach(() => {
    mockDeleteMutateAsync.mockReset();
    mockToast.mockReset();
    mockDeleteMutateAsync.mockResolvedValue(undefined);
  });

  function confirmDelete() {
    fireEvent.click(screen.getByRole("button", { name: "검수 템플릿" }));
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));

    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByText("지점 템플릿을 삭제하시겠습니까?"),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
  }

  it("renders delete action, confirms deletion, and clears the selected template", async () => {
    render(<TemplatesPage />);

    confirmDelete();

    expect(mockDeleteMutateAsync).toHaveBeenCalledWith("template-1");
    await waitFor(() =>
      expect(
        screen.getByText("지점 템플릿을 선택하면 상세 정보가 표시됩니다."),
      ).toBeInTheDocument(),
    );
  });

  // The optimistic removal unmounts the detail panel mid-flight. Awaiting the
  // mutation keeps the failure path alive; mutate's per-call callbacks would be
  // dropped with the observer and the user would never learn the delete failed.
  it("still reports failure after the optimistic removal unmounts the detail panel", async () => {
    mockDeleteMutateAsync.mockRejectedValue(new Error("boom"));
    render(<TemplatesPage />);

    confirmDelete();

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          description: "지점 템플릿을 삭제하지 못했어요",
        }),
      ),
    );
  });
});
