/* eslint-disable @next/next/no-img-element */

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ContractDocumentPreviewModal } from "@/components/app/contracts/ContractDocumentPreviewModal";
import DocumentPreviewModal from "../document-preview-modal";
import { getDownloadFileName, getFileFormatLabel, getPreviewKind } from "../document-preview-utils";
import type { Document } from "@/hooks/use-documents";
import type { DocumentCategory } from "@/hooks/use-document-categories";
import type { EformsignDocument } from "@/lib/eformsign/types";

interface MockPdfDocumentProps {
  children: ReactNode;
  onLoadSuccess?: ({ numPages }: { numPages: number }) => void;
}

interface MockPdfPageProps {
  pageNumber: number;
  width: number;
}

type MockNextImageProps = ComponentPropsWithoutRef<"img"> & {
  unoptimized?: boolean;
};

const mockRhwpInit = jest.fn(() => Promise.resolve({}));
const mockHwpFree = jest.fn();
const mockRenderPageSvg = jest.fn((pageNumber: number) => (
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140"><text>HWP page ${pageNumber + 1}</text></svg>`
));
const mockPageCount = jest.fn(() => 2);

jest.mock("@/lib/pdf-config", () => ({}));

jest.mock("@rhwp/core", () => ({
  __esModule: true,
  default: mockRhwpInit,
  HwpDocument: jest.fn().mockImplementation(() => ({
    free: mockHwpFree,
    pageCount: mockPageCount,
    renderPageSvg: mockRenderPageSvg,
  })),
}));

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: MockNextImageProps) => {
    const { unoptimized, alt, ...imgProps } = props;
    void unoptimized;

    return <img {...imgProps} alt={alt ?? ""} />;
  },
}));

jest.mock("react-pdf", () => {
  const React = jest.requireActual<typeof import("react")>("react");

  return {
    Document: ({ children, onLoadSuccess }: MockPdfDocumentProps) => {
      React.useEffect(() => {
        onLoadSuccess?.({ numPages: 2 });
      }, [onLoadSuccess]);

      return <div data-testid="pdf-document">{children}</div>;
    },
    Page: ({ pageNumber, width }: MockPdfPageProps) => (
      <div data-testid={`pdf-page-${pageNumber}`} data-width={width}>
        Page {pageNumber}
      </div>
    ),
  };
});

const categories: DocumentCategory[] = [
  {
    id: "contracts",
    value: "contracts",
    label: "계약서",
    color: "#1d4ed8",
    isCustom: false,
    createdAt: "2026-01-29T00:00:00.000Z",
  },
];

const baseDocument: Document = {
  id: "doc-1",
  name: "업무위탁계약서",
  description: "테스트 문서",
  categoryId: "contracts",
  tags: ["계약"],
  mimeType: "application/pdf",
  fileSize: 62361,
  storagePath: "/contracts/doc-1.pdf",
  uploadedBy: "tester",
  createdAt: "2026-01-29T00:00:00.000Z",
  updatedAt: "2026-01-29T00:00:00.000Z",
};

const contractDocument: EformsignDocument = {
  id: "service-record-1",
  document_number: "SR-2026-001",
  template: {
    id: "service-record-template",
    name: "서비스 제공기록지 단면",
  },
  document_name: "김고객 제공기록지",
  creator: {
    recipient_type: "01",
    name: "테스트 지점",
  },
  created_date: new Date("2026-07-13T00:00:00.000Z").getTime(),
  last_editor: {
    recipient_type: "01",
    name: "테스트 지점",
  },
  updated_date: new Date("2026-07-13T00:00:00.000Z").getTime(),
  current_status: {
    status_type: "002",
    status_doc_type: "검토",
    status_doc_detail: "제공기관 검토",
    step_type: "05",
    step_index: "2",
    step_name: "검토",
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
};

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let blobUrlIndex = 0;
const originalFetch = global.fetch;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const originalElementFromPoint = document.elementFromPoint;

beforeAll(() => {
  global.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn(() => {
      blobUrlIndex += 1;
      return `blob:mock-hwp-${blobUrlIndex}`;
    }),
  });

  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn(),
  });

  if (typeof document.elementFromPoint !== "function") {
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: jest.fn(() => null),
    });
  }
});

beforeEach(() => {
  blobUrlIndex = 0;
  jest.clearAllMocks();
});

afterAll(() => {
  global.fetch = originalFetch;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: originalCreateObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: originalRevokeObjectUrl,
  });

  if (typeof originalElementFromPoint === "function") {
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: originalElementFromPoint,
    });
    return;
  }

  Reflect.deleteProperty(document, "elementFromPoint");
});

describe("DocumentPreviewModal", () => {
  it("names the preview dialog actions", async () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={baseDocument}
        categories={categories}
        onEdit={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "미리보기 닫기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "문서 작업 더보기" })).toBeInTheDocument();
    await screen.findByTestId("pdf-page-1");
  });

  it("keeps the print frame mounted until the print preview closes", async () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={baseDocument}
        categories={categories}
      />
    );

    const printButton = await screen.findByRole("button", { name: "인쇄" });
    await waitFor(() => expect(printButton).toBeEnabled());

    jest.useFakeTimers();
    let printFrame: HTMLIFrameElement | null = null;

    try {
      fireEvent.click(printButton);

      printFrame = document.body.querySelector("iframe");
      expect(printFrame).not.toBeNull();
      if (!printFrame?.contentWindow) {
        throw new Error("print frame window not available");
      }

      const printWindow = printFrame.contentWindow;
      const printSpy = jest.spyOn(printWindow, "print").mockImplementation(() => undefined);

      fireEvent.load(printFrame);

      expect(printSpy).toHaveBeenCalledTimes(1);

      act(() => {
        jest.advanceTimersByTime(2_000);
      });

      expect(printFrame).toBeInTheDocument();

      act(() => {
        printWindow.dispatchEvent(new Event("afterprint"));
      });

      expect(printFrame).not.toBeInTheDocument();
    } finally {
      printFrame?.remove();
      jest.useRealTimers();
    }
  });

  it("renders a zoom slider for pdf previews and updates the page width", async () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={baseDocument}
        categories={categories}
      />
    );

    const slider = await screen.findByLabelText("PDF 미리보기 확대/축소");
    expect(slider).toHaveValue("100");
    expect(screen.getByText("100%")).toBeInTheDocument();

    await screen.findByTestId("pdf-page-1");
    expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-width", "320");

    fireEvent.change(slider, { target: { value: "150" } });

    await waitFor(() => {
      expect(screen.getByText("150%")).toBeInTheDocument();
      expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-width", "480");
    });
  });

  it("zooms when document-targeted pinch wheel hit-tests inside the canvas", async () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={baseDocument}
        categories={categories}
      />
    );

    await screen.findByTestId("pdf-page-1");
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    const previewPage = screen.getByTestId("pdf-page-1");
    const elementFromPointSpy = jest.spyOn(document, "elementFromPoint").mockReturnValue(previewPage as Element);

    try {
      const zoomIn = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: 100,
        clientY: 100,
        deltaY: -5,
      });
      act(() => {
        document.documentElement.dispatchEvent(zoomIn);
      });

      expect(zoomIn.defaultPrevented).toBe(true);
      expect(elementFromPointSpy).toHaveBeenCalledWith(100, 100);

      await waitFor(() => {
        expect(screen.getByLabelText("PDF 미리보기 확대/축소")).toHaveValue("105");
        expect(screen.getByText("105%")).toBeInTheDocument();
        expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-width", "336");
      });

      const zoomOut = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: 100,
        clientY: 100,
        deltaY: 5,
      });
      act(() => {
        document.documentElement.dispatchEvent(zoomOut);
      });

      expect(zoomOut.defaultPrevented).toBe(true);

      await waitFor(() => {
        expect(screen.getByLabelText("PDF 미리보기 확대/축소")).toHaveValue("100");
        expect(screen.getByText("100%")).toBeInTheDocument();
        expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-width", "320");
      });
    } finally {
      elementFromPointSpy.mockRestore();
    }
  });

  it("suppresses ambiguous first pinch wheel while dialog is open", async () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={baseDocument}
        categories={categories}
      />
    );

    await screen.findByTestId("pdf-page-1");
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

    const elementFromPointSpy = jest.spyOn(document, "elementFromPoint").mockReturnValue(null);

    try {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: 0,
        clientY: 0,
        deltaY: -40,
      });
      document.documentElement.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(elementFromPointSpy).not.toHaveBeenCalled();
      expect(screen.getByLabelText("PDF 미리보기 확대/축소")).toHaveValue("100");
    } finally {
      elementFromPointSpy.mockRestore();
    }
  });

  it("does not zoom when pinch wheel hit-tests inside dialog but outside canvas", async () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={baseDocument}
        categories={categories}
      />
    );

    await screen.findByTestId("pdf-page-1");
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

    const dialogContent = document.querySelector('[data-component="contracts-document-preview"]');
    expect(dialogContent).not.toBeNull();
    if (!dialogContent) throw new Error("dialog not rendered");

    const elementFromPointSpy = jest.spyOn(document, "elementFromPoint").mockReturnValue(dialogContent as Element);

    try {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: 50,
        clientY: 50,
        deltaY: -40,
      });
      document.documentElement.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(elementFromPointSpy).toHaveBeenCalledWith(50, 50);
      expect(screen.getByLabelText("PDF 미리보기 확대/축소")).toHaveValue("100");
    } finally {
      elementFromPointSpy.mockRestore();
    }
  });

  it("uses the same zoom slider pattern for image previews", async () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={{
          ...baseDocument,
          id: "img-1",
          name: "현장사진.jpg",
          mimeType: "image/jpeg",
        }}
        categories={categories}
      />
    );

    const slider = await screen.findByLabelText("이미지 미리보기 확대/축소");
    const image = await screen.findByAltText("현장사진.jpg");

    expect(slider).toHaveValue("100");
    expect(image).toHaveStyle({ transform: "scale(1)" });

    fireEvent.change(slider, { target: { value: "125" } });

    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(image).toHaveStyle({ transform: "scale(1.25)" });
  });

  it("renders a Hangul document preview from an HWP storage extension", async () => {
    render(
      <DocumentPreviewModal
        open={true}
        onClose={jest.fn()}
        doc={{
          ...baseDocument,
          id: "hwp-1",
          name: "산후도우미신청서",
          mimeType: "application/octet-stream",
          storagePath: "/documents/hwp-1.hwp",
        }}
        categories={categories}
      />
    );

    expect(screen.getByText("hwp")).toBeInTheDocument();

    const slider = await screen.findByLabelText("한글 문서 미리보기 확대/축소");
    expect(slider).toHaveValue("100");

    const firstHwpPage = await screen.findByTestId("hwp-page-1");
    expect(firstHwpPage).toBeInTheDocument();
    expect(firstHwpPage).not.toHaveClass("rounded-[20px]");
    expect(screen.getByAltText("산후도우미신청서 1페이지")).toHaveAttribute("src", "blob:mock-hwp-1");
    expect(screen.queryByText("인쇄")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockRhwpInit).toHaveBeenCalledWith({ module_or_path: "/vendor/rhwp/rhwp_bg.wasm" });
      expect(global.fetch).toHaveBeenCalledWith("/api/file-storage/files/hwp-1/download");
      expect(mockRenderPageSvg).toHaveBeenCalledTimes(2);
    });
  });

  it("detects Hangul preview and download extensions from stored paths", () => {
    const hwpDoc = {
      ...baseDocument,
      name: "신청서",
      mimeType: "application/octet-stream",
      storagePath: "/documents/source.hwp",
    };
    const hwpxDoc = {
      ...baseDocument,
      name: "신청서",
      mimeType: "application/octet-stream",
      storagePath: "/documents/source.hwpx",
    };

    expect(getPreviewKind(hwpDoc)).toBe("hwp");
    expect(getDownloadFileName(hwpDoc)).toBe("신청서.hwp");
    expect(getFileFormatLabel(hwpDoc)).toBe("hwp");
    expect(getPreviewKind(hwpxDoc)).toBe("hwp");
    expect(getDownloadFileName(hwpxDoc)).toBe("신청서.hwpx");
    expect(getFileFormatLabel(hwpxDoc)).toBe("hwpx");
  });
});

describe("ContractDocumentPreviewModal", () => {
  it("places print and download on the left and review confirmation on the right", async () => {
    const onReviewConfirm = jest.fn();

    render(
      <ContractDocumentPreviewModal
        data-component="desktop_contracts_tests_document-preview"
        open={true}
        onClose={jest.fn()}
        document={contractDocument}
        customerName="김고객"
        onReviewConfirm={onReviewConfirm}
      />
    );

    await screen.findByTestId("pdf-page-1");

    const footer = document.querySelector(
      '[data-component="desktop_contracts_tests_document-preview_footer"]',
    );
    const fileActions = document.querySelector(
      '[data-component="desktop_contracts_tests_document-preview_footer_file-actions"]',
    );
    const reviewAction = document.querySelector(
      '[data-component="desktop_contracts_tests_document-preview_footer_review-action"]',
    );

    expect(footer).toHaveClass("sm:justify-between");
    expect(fileActions).not.toBeNull();
    expect(reviewAction).not.toBeNull();
    if (!fileActions || !reviewAction) throw new Error("preview footer actions not rendered");

    expect(within(fileActions as HTMLElement).getByRole("button", { name: "인쇄" })).toBeInTheDocument();
    expect(within(fileActions as HTMLElement).getByRole("button", { name: "다운로드" })).toBeInTheDocument();
    expect(reviewAction).toHaveClass("ml-auto");

    const confirmButton = within(reviewAction as HTMLElement).getByRole("button", { name: "확인" });
    expect(confirmButton).toHaveClass(
      "hover:translate-y-0",
      "hover:shadow-[0_4px_24px_hsla(214,50%,20%,0.06)]",
    );

    fireEvent.click(confirmButton);

    expect(onReviewConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables the review confirmation while automatic processing is pending", async () => {
    render(
      <ContractDocumentPreviewModal
        data-component="desktop_contracts_tests_document-preview"
        open={true}
        onClose={jest.fn()}
        document={contractDocument}
        customerName="김고객"
        onReviewConfirm={jest.fn()}
        isReviewConfirming={true}
      />
    );

    await screen.findByTestId("pdf-page-1");

    expect(screen.getByRole("button", { name: "확인 중..." })).toBeDisabled();
  });
});
