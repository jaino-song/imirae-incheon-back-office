import fs from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { api } from "@/lib/api/client";
import { eformsignApi } from "@/services/api";
import type { EformsignDocument } from "@/lib/eformsign/types";

import { ContractDetail } from "./page";

const source = fs.readFileSync(require.resolve("./page"), "utf8");

describe("ContractsPage provider summaries", () => {
  it("joins repeated provider names and renders only populated provider cards", () => {
    expect(source).toContain("const provider1Names =");
    expect(source).toContain('const provider1Name = provider1Names.join(", ")');
    expect(source).toContain('value: provider1Name || "–"');
    expect(source).toContain("const providers =");
    expect(source).toContain(".filter((provider) => provider.name || provider.contact)");
    expect(source).toContain('providers.length === 1 ? "제공인력"');
  });

  it("derives the contract end date through split and full-field aliases", () => {
    expect(source).toContain("formatIsoDateInput(\n    extractFieldDate(detailedDocument");
    expect(source).toContain('full: ["계약 종료일", "계약종료일", "endDate", "contractEndDate"]');
  });
});

describe("ContractsPage server-side search", () => {
  // A guard against reintroduction, not a behaviour test. Filtering the server's
  // pages client-side is what left hasNextPage describing the UNfiltered table,
  // so the list kept pulling pages that were filtered away and never stopped.
  // What the search actually sends is covered for real in
  // src/hooks/__tests__/useInfiniteContracts.search.test.tsx, which drives the
  // hook and asserts on the request; those tests fail when the fix is reverted.
  //
  // Asserting on source text cannot tell working code from a plausible string,
  // so this file deliberately keeps only the absence check: it survives
  // renames and formatting, and there is no way to satisfy it while still
  // filtering.
  it("no longer filters the server's pages client-side", () => {
    expect(source).not.toContain("matchesDocumentSearch");
  });
});

describe("ContractsPage infinite-scroll presentation", () => {
  it("does not append placeholder rows while fetching the next page", () => {
    expect(source).not.toContain("fetchingMoreCount");
  });
});

describe("ContractsPage maternity template whitelist", () => {
  // A guard against reintroduction, not a behaviour test. The maternity list once
  // showed every non-제공기록지 document in the eformsign account — including
  // unrelated templates (e.g. 근로계약서) — because the section's filter was a
  // blacklist. It was later whitelisted by client-side template arithmetic, which
  // mobile never picked up and the two surfaces diverged. The decision now lives
  // in the backend (EformsignTemplateScopeService resolves the branch's
  // area_template registry from section=maternity), so the page must only name
  // the section; computing template lists here would silently drift from mobile
  // again.
  it("names the section and lets the server resolve the template filter", () => {
    expect(source).toContain("section: contractsSection");
    expect(source).not.toContain("buildContractTemplateFilter(");
    expect(source).not.toContain("maternityTemplateIds");
  });
});

describe("ContractsPage headless finalization fallback", () => {
  it("does not reopen the reviewer iframe when the backend verdict is unknown", () => {
    expect(source).toContain("let transportOutcomeUnknown = false");
    expect(source).toContain("transportOutcomeUnknown = true");
    expect(source).toContain("if (manualCheckRequired || transportOutcomeUnknown)");
    expect(source).not.toContain("headless finalize threw, falling back to iframe");
  });
});

// ---------------------------------------------------------------------------
// F2: behavioral coverage of the manual receipt-send interaction (trigger ->
// confirm dialog -> mutation), rendering ContractDetail directly rather than
// the full ContractsPage list/search tree. Mutants this guards against:
//   - ReceiptSendConfirmDialog's onConfirm wired to a no-op
//   - the "영수증 문자 발송" trigger calling sendReceiptLink.mutate() directly,
//     bypassing the confirm dialog
// ---------------------------------------------------------------------------
interface MockPdfDocumentProps {
  children: ReactNode;
  onLoadSuccess?: (info: { numPages: number }) => void;
}
interface MockPdfPageProps {
  pageNumber: number;
}

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

function receiptDetailDocumentFixture(): EformsignDocument {
  return {
    id: "doc-1",
    document_number: "C-0001",
    template: { id: "template-1", name: "산모 서비스 계약서" },
    document_name: "산모신생아건강관리서비스 계약서",
    creator: { recipient_type: "01", id: "creator", name: "인천 아이미래로" },
    created_date: 1756800000000,
    last_editor: { recipient_type: "01", id: "editor", name: "인천 아이미래로" },
    updated_date: 1756800000000,
    // status_type "003" (doc_complete) resolves to the "completed" category, which
    // always shows the single unconditional "문서 보기" trigger (never the
    // 검토 필요 review-action branch) — keeps this test's render surface minimal.
    current_status: {
      status_type: "003",
      status_doc_type: "",
      status_doc_detail: "",
      step_type: "05",
      step_index: "2",
      step_name: "이용자",
      step_recipients: [],
      step_group: 0,
      expired_date: 0,
      _expired: false,
    },
    fields: [],
    next_status: [],
    previous_status: [],
    histories: [],
    recipients: [],
    detail_template_info: [],
  } as unknown as EformsignDocument;
}

async function renderContractDetailAndOpenPreview() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const doc = receiptDetailDocumentFixture();

  render(
    <QueryClientProvider client={queryClient}>
      <ContractDetail data-component="desktop_contracts_detail" document={doc} />
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "문서 보기" }));
  await screen.findByTestId("pdf-document");

  const sendButton = document.body.querySelector(
    '[data-component="desktop_contracts_detail_dialogs_document-preview_footer_file-actions_receipt-send"]',
  ) as HTMLButtonElement | null;
  expect(sendButton).not.toBeNull();
  return { sendButton: sendButton as HTMLButtonElement };
}

describe("ContractDetail manual receipt-send interaction", () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    global.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    jest.spyOn(api, "get").mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.startsWith("/eformsign/documents/")) {
        return { data: receiptDetailDocumentFixture() };
      }
      return { data: [] };
    });
    jest.spyOn(api, "post").mockResolvedValue({ data: {} } as never);
    jest.spyOn(eformsignApi, "getDocument").mockResolvedValue(receiptDetailDocumentFixture() as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("clicking the trigger opens the confirm dialog without calling the send API", async () => {
    const sendReceiptLink = jest.spyOn(eformsignApi, "sendReceiptLink").mockResolvedValue({
      jobId: "job-1",
      scheduledFor: "2026-09-03T00:00:00.000Z",
      clientName: "김산모",
    } as never);

    const { sendButton } = await renderContractDetailAndOpenPreview();
    fireEvent.click(sendButton);

    expect(await screen.findByText("서비스 종료 안내 문자를 보낼까요?")).toBeInTheDocument();
    expect(sendReceiptLink).not.toHaveBeenCalled();
  });

  it("clicking the dialog's confirm button calls the send API exactly once with the selected document id", async () => {
    const sendReceiptLink = jest.spyOn(eformsignApi, "sendReceiptLink").mockResolvedValue({
      jobId: "job-1",
      scheduledFor: "2026-09-03T00:00:00.000Z",
      clientName: "김산모",
    } as never);

    const { sendButton } = await renderContractDetailAndOpenPreview();
    fireEvent.click(sendButton);
    await screen.findByText("서비스 종료 안내 문자를 보낼까요?");

    fireEvent.click(screen.getByRole("button", { name: "발송하기" }));

    await waitFor(() => expect(sendReceiptLink).toHaveBeenCalledTimes(1));
    expect(sendReceiptLink).toHaveBeenCalledWith("doc-1");
    // Let the mutation's onSuccess (closes the confirm dialog, fires a toast) settle
    // inside act() before the test ends, or React logs an act() warning.
    await waitFor(() =>
      expect(screen.queryByText("서비스 종료 안내 문자를 보낼까요?")).not.toBeInTheDocument(),
    );
  });

  it("disables the preview modal's trigger button while the send is pending", async () => {
    let resolveSend: (value: { jobId: string; scheduledFor: string; clientName: string }) => void = () => {};
    const pending = new Promise<{ jobId: string; scheduledFor: string; clientName: string }>((resolve) => {
      resolveSend = resolve;
    });
    jest.spyOn(eformsignApi, "sendReceiptLink").mockReturnValue(pending as never);

    const { sendButton } = await renderContractDetailAndOpenPreview();
    fireEvent.click(sendButton);
    await screen.findByText("서비스 종료 안내 문자를 보낼까요?");

    fireEvent.click(screen.getByRole("button", { name: "발송하기" }));

    await waitFor(() => expect(sendButton).toBeDisabled());

    resolveSend({ jobId: "job-1", scheduledFor: "2026-09-03T00:00:00.000Z", clientName: "김산모" });
    // Flush the mutation's onSuccess state updates inside act() before the test ends.
    await waitFor(() =>
      expect(screen.queryByText("서비스 종료 안내 문자를 보낼까요?")).not.toBeInTheDocument(),
    );
  });

  // F8: onSendReceiptLink must be undefined on the 제공기록지 preview surface
  // (reviewAction="preview") — ContractDocumentPreviewModal.test.tsx already pins
  // that the button doesn't render without a handler ("hides the button without a
  // handler and disables it while sending"); this pins the page-level wiring that
  // withholds the handler for that surface.
  it("does not offer the receipt-send button on the 제공기록지 preview surface (reviewAction=preview)", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const doc = receiptDetailDocumentFixture();

    render(
      <QueryClientProvider client={queryClient}>
        <ContractDetail data-component="desktop_contracts_detail" document={doc} reviewAction="preview" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "문서 보기" }));
    await screen.findByTestId("pdf-document");

    expect(screen.queryByRole("button", { name: "영수증 문자 발송" })).toBeNull();
  });
});
