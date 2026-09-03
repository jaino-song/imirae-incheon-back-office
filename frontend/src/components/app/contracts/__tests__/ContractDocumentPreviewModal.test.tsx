import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ContractDocumentPreviewModal } from "../ContractDocumentPreviewModal";

interface MockPdfDocumentProps {
  children: ReactNode;
  onLoadSuccess?: ({ numPages }: { numPages: number }) => void;
}

interface MockPdfPageProps {
  pageNumber: number;
}

jest.mock("@/services/api", () => ({
  eformsignApi: { getDocumentReceiptDownloadUrl: (id: string) => `/api/receipt/${id}` },
}));

jest.mock("@/lib/pdf-config", () => ({}));

jest.mock("react-pdf", () => {
  const React = jest.requireActual<typeof import("react")>("react");

  return {
    Document: ({ children, onLoadSuccess }: MockPdfDocumentProps) => {
      React.useEffect(() => {
        onLoadSuccess?.({ numPages: 1 });
      }, [onLoadSuccess]);

      return <div data-testid="pdf-document">{children}</div>;
    },
    Page: ({ pageNumber }: MockPdfPageProps) => <div data-testid={`pdf-page-${pageNumber}`}>Page {pageNumber}</div>,
  };
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const originalFetch = global.fetch;

beforeAll(() => {
  global.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
  })) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

const document = {
  id: "doc-1",
  document_name: "산후관리 계약서",
  document_number: "C-1",
  created_date: 1756800000000,
  template: { name: "계약서" },
} as never;

describe("ContractDocumentPreviewModal receipt send action", () => {
  it("renders the send button inside the footer file-actions group, next to receipt-download, and calls the handler", async () => {
    const onSendReceiptLink = jest.fn();
    const { baseElement } = render(
      <ContractDocumentPreviewModal
        data-component="desktop_contracts_preview"
        document={document}
        open
        onClose={() => {}}
        canDownloadReceipt
        onSendReceiptLink={onSendReceiptLink}
        // The `_footer_file-actions` wrapper only renders alongside a review action
        // (see shared-document-preview-dialog.tsx) — include one so this test can
        // scope its assertions to that exact container, per the review-action side.
        onReviewConfirm={() => {}}
      />,
    );

    await screen.findByTestId("pdf-document");

    const fileActions = baseElement.querySelector(
      '[data-component="desktop_contracts_preview_footer_file-actions"]',
    );
    expect(fileActions).not.toBeNull();
    if (!fileActions) throw new Error("footer file-actions group not rendered");

    const scoped = within(fileActions as HTMLElement);
    expect(
      scoped.getByRole("button", { name: "영수증" }),
    ).toHaveAttribute("data-component", "desktop_contracts_preview_footer_file-actions_receipt-download");

    const button = scoped.getByRole("button", { name: "영수증 문자 발송" });
    expect(button).toHaveAttribute("data-component", "desktop_contracts_preview_footer_file-actions_receipt-send");
    fireEvent.click(button);
    expect(onSendReceiptLink).toHaveBeenCalledTimes(1);
  });

  it("hides the button without a handler and disables it while sending", async () => {
    const { rerender } = render(
      <ContractDocumentPreviewModal data-component="desktop_contracts_preview" document={document} open onClose={() => {}} />,
    );
    await screen.findByTestId("pdf-document");
    expect(screen.queryByRole("button", { name: "영수증 문자 발송" })).toBeNull();

    rerender(
      <ContractDocumentPreviewModal
        data-component="desktop_contracts_preview"
        document={document}
        open
        onClose={() => {}}
        onSendReceiptLink={() => {}}
        isSendingReceiptLink
      />,
    );

    expect(screen.getByRole("button", { name: /영수증 문자 발송/ })).toBeDisabled();
  });
});
