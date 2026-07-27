import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import {
  calculateRenderDpr,
  ContractPdfViewer,
} from "../contract-pdf-viewer";
import { ContractPdfViewerPlaceholder } from "../contract-pdf-viewer-placeholder";

interface MockPdfDocumentProps {
  children: ReactNode;
  className?: string;
  "data-slot"?: string;
  error: ReactNode;
  file: string;
  onLoadSuccess?: (result: {
    numPages: number;
    getPage: (pageNumber: number) => Promise<{
      getViewport: (options: { scale: number }) => {
        width: number;
        height: number;
      };
    }>;
  }) => void;
}

interface MockPdfPageProps {
  error?: ReactNode;
  loading?: ReactNode;
  pageNumber: number;
  width: number;
  devicePixelRatio: number;
  onRenderSuccess?: () => void;
}

const mockPdfState = {
  numPages: 3,
  pageSizes: [
    { width: 595, height: 842 },
    { width: 595, height: 842 },
    { width: 595, height: 842 },
  ],
  shouldError: false,
};
const mockPageRenderCallbacks = new Map<number, () => void>();

jest.mock("@/lib/pdf-config", () => ({}));

jest.mock("react-pdf", () => {
  const React = jest.requireActual<typeof import("react")>("react");

  return {
    Document: ({
      children,
      className,
      "data-slot": dataSlot,
      error,
      file,
      onLoadSuccess,
    }: MockPdfDocumentProps) => {
      React.useEffect(() => {
        if (!mockPdfState.shouldError) {
          onLoadSuccess?.({
            numPages: mockPdfState.numPages,
            getPage: async (pageNumber) => {
              const size =
                mockPdfState.pageSizes[pageNumber - 1] ??
                mockPdfState.pageSizes[0];
              if (!size) {
                throw new Error("Missing mocked PDF page size");
              }
              return {
                getViewport: () => size,
              };
            },
          });
        }
      }, [file, onLoadSuccess]);

      if (mockPdfState.shouldError) {
        return <>{error}</>;
      }

      return (
        <div
          className={className}
          data-slot={dataSlot}
          data-testid="pdf-document"
        >
          {children}
        </div>
      );
    },
    Page: ({
      error,
      loading,
      pageNumber,
      width,
      devicePixelRatio,
      onRenderSuccess,
    }: MockPdfPageProps) => {
      React.useEffect(() => {
        if (onRenderSuccess) {
          mockPageRenderCallbacks.set(pageNumber, onRenderSuccess);
        }
        return () => {
          mockPageRenderCallbacks.delete(pageNumber);
        };
      }, [onRenderSuccess, pageNumber]);

      return (
        <div
          data-testid={`pdf-page-${pageNumber}`}
          data-width={width}
          data-render-dpr={devicePixelRatio}
          data-loading-copy={typeof loading === "string" ? loading : undefined}
          data-error-copy={typeof error === "string" ? error : undefined}
        >
          {loading}
          Page {pageNumber}
        </div>
      );
    },
  };
});

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  private observedElement: Element | null = null;

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  observe(element: Element) {
    this.observedElement = element;
    this.resize(320);
  }

  unobserve() {}

  disconnect() {
    this.observedElement = null;
  }

  resize(width: number) {
    if (!this.observedElement) {
      return;
    }

    Object.defineProperty(this.observedElement, "clientWidth", {
      configurable: true,
      value: width,
    });
    this.callback(
      [{ target: this.observedElement, contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
}

const originalResizeObserver = global.ResizeObserver;
const originalRequestAnimationFrame = global.requestAnimationFrame;
const originalCancelAnimationFrame = global.cancelAnimationFrame;

beforeAll(() => {
  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof requestAnimationFrame;
  global.cancelAnimationFrame = jest.fn();
});

beforeEach(() => {
  mockPdfState.numPages = 3;
  mockPdfState.pageSizes = [
    { width: 595, height: 842 },
    { width: 595, height: 842 },
    { width: 595, height: 842 },
  ];
  mockPdfState.shouldError = false;
  mockPageRenderCallbacks.clear();
  ResizeObserverMock.instances = [];
});

afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
  global.requestAnimationFrame = originalRequestAnimationFrame;
  global.cancelAnimationFrame = originalCancelAnimationFrame;
});

function renderViewer(fileUrl = "/contract.pdf") {
  return render(
    <ContractPdfViewer
      className="contract-preview-frame"
      data-component="mobile_contracts_detail-sheet_stack_detail-page_content_pdf-preview_frame"
      fileUrl={fileUrl}
      fallbackHref="/contract-download.pdf"
      title="테스트 계약서 PDF 미리보기"
    />
  );
}

function touch(identifier: number, clientX: number, clientY: number) {
  return { identifier, clientX, clientY };
}

function dispatchTouchMove(viewport: Element, touches: ReturnType<typeof touch>[]) {
  const event = new Event("touchmove", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "touches", { value: touches });
  act(() => {
    viewport.dispatchEvent(event);
  });
  return event;
}

function dispatchTouchCancel(
  viewport: Element,
  changedTouches: ReturnType<typeof touch>[]
) {
  const event = new Event("touchcancel", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "changedTouches", { value: changedTouches });
  act(() => {
    viewport.dispatchEvent(event);
  });
}

describe("calculateRenderDpr", () => {
  it("caps rendering at the device DPR", () => {
    expect(
      calculateRenderDpr({
        baseWidth: 320,
        pageCount: 1,
        maxPageAspectRatio: 1.5,
        totalPageAspectRatio: 1.5,
        devicePixelRatio: 2,
      })
    ).toBe(2);
  });

  it("clamps rendering to the per-page pixel budget", () => {
    expect(
      calculateRenderDpr({
        baseWidth: 1_500,
        pageCount: 1,
        maxPageAspectRatio: 1.5,
        totalPageAspectRatio: 1.5,
        devicePixelRatio: 3,
      })
    ).toBeCloseTo(Math.sqrt(4_000_000 / (1_500 * 1_500 * 1.5)));
  });

  it("clamps rendering to the whole-document pixel budget", () => {
    expect(
      calculateRenderDpr({
        baseWidth: 1_000,
        pageCount: 20,
        maxPageAspectRatio: 1.5,
        totalPageAspectRatio: 30,
        devicePixelRatio: 3,
      })
    ).toBeCloseTo(Math.sqrt(24_000_000 / (1_000 * 1_000 * 30)));
  });

  it("never renders below the minimum DPR", () => {
    expect(
      calculateRenderDpr({
        baseWidth: 2_000,
        pageCount: 100,
        maxPageAspectRatio: 2,
        totalPageAspectRatio: 200,
        devicePixelRatio: 3,
      })
    ).toBe(0.75);
  });
});

describe("ContractPdfViewer", () => {
  it("renders every page reported by the PDF document", async () => {
    mockPdfState.numPages = 4;

    renderViewer();

    expect(await screen.findByTestId("pdf-page-1")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^pdf-page-/)).toHaveLength(4);
    expect(screen.getByTestId("pdf-page-4")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-document")).toHaveClass(
      "contract-pdf-document"
    );
    expect(screen.getByTestId("pdf-document")).toHaveAttribute(
      "data-slot",
      "contract-pdf-document"
    );
  });

  it("updates the fixed base page width when its container width changes", async () => {
    renderViewer();

    expect(await screen.findByTestId("pdf-page-1")).toHaveAttribute("data-width", "320");

    act(() => {
      ResizeObserverMock.instances[0]?.resize(468);
    });

    await waitFor(() => {
      expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-width", "468");
    });
  });

  it("resets zoom and scroll when the measured base width changes", async () => {
    renderViewer();

    const page = await screen.findByTestId("pdf-page-1");
    const viewport = page.closest(".contract-pdf-viewport");
    const pages = page.closest(".contract-pdf-pages");
    if (!(viewport instanceof HTMLElement) || !pages) {
      throw new Error("PDF gesture surfaces were not rendered");
    }

    viewport.scrollLeft = 45;
    viewport.scrollTop = 110;
    fireEvent.touchStart(viewport, {
      touches: [touch(1, 0, 0), touch(2, 100, 0)],
    });
    dispatchTouchMove(viewport, [touch(1, 0, 0), touch(2, 200, 0)]);
    expect(pages).toHaveStyle({ transform: "scale(2)" });

    act(() => {
      ResizeObserverMock.instances[0]?.resize(468);
    });

    await waitFor(() => {
      expect(pages).toHaveStyle({ transform: "scale(1)" });
      expect(viewport.scrollLeft).toBe(0);
      expect(viewport.scrollTop).toBe(0);
    });
  });

  it("shows an error message and safe fallback link when the PDF fails to load", () => {
    mockPdfState.shouldError = true;

    renderViewer();

    expect(screen.getByText("PDF 미리보기를 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "새 탭에서 열기" })).toHaveAttribute(
      "href",
      "/contract-download.pdf"
    );
    expect(screen.getByRole("link", { name: "새 탭에서 열기" })).toHaveAttribute(
      "rel",
      "noopener noreferrer"
    );
  });

  it("zooms continuously without changing the canvas width", async () => {
    renderViewer();

    const page = await screen.findByTestId("pdf-page-1");
    const viewport = page.closest(".contract-pdf-viewport");
    const pages = page.closest(".contract-pdf-pages");
    const sizer = page.closest(".contract-pdf-sizer");
    if (!viewport || !pages || !sizer) {
      throw new Error("PDF gesture surfaces were not rendered");
    }

    fireEvent.touchStart(viewport, {
      touches: [touch(1, 0, 0), touch(2, 100, 0)],
    });
    const pinchMove = dispatchTouchMove(viewport, [
      touch(1, 0, 0),
      touch(2, 500, 0),
    ]);

    expect(pinchMove.defaultPrevented).toBe(true);
    expect(pages).toHaveStyle({ transform: "scale(4)" });
    expect(sizer).toHaveStyle({ width: "1280px" });
    expect(page).toHaveAttribute("data-width", "320");
  });

  it("anchors scroll offsets to the pinch midpoint while zoom changes", async () => {
    renderViewer();

    const page = await screen.findByTestId("pdf-page-1");
    const viewport = page.closest(".contract-pdf-viewport");
    if (!(viewport instanceof HTMLElement)) {
      throw new Error("PDF viewport was not rendered");
    }
    viewport.scrollLeft = 40;
    viewport.scrollTop = 120;
    jest.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 320,
      bottom: 640,
      width: 320,
      height: 640,
      toJSON: () => ({}),
    });

    fireEvent.touchStart(viewport, {
      touches: [touch(1, 100, 100), touch(2, 200, 100)],
    });
    dispatchTouchMove(viewport, [
      touch(1, 50, 100),
      touch(2, 250, 100),
    ]);

    expect(viewport.scrollLeft).toBe(230);
    expect(viewport.scrollTop).toBe(340);
  });

  it("pans with the moving pinch midpoint even when zoom is unchanged", async () => {
    renderViewer();

    const page = await screen.findByTestId("pdf-page-1");
    const viewport = page.closest(".contract-pdf-viewport");
    if (!(viewport instanceof HTMLElement)) {
      throw new Error("PDF viewport was not rendered");
    }
    viewport.scrollLeft = 100;
    viewport.scrollTop = 120;
    jest.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 320,
      bottom: 640,
      width: 320,
      height: 640,
      toJSON: () => ({}),
    });

    fireEvent.touchStart(viewport, {
      touches: [touch(1, 100, 100), touch(2, 200, 100)],
    });
    dispatchTouchMove(viewport, [
      touch(1, 150, 120),
      touch(2, 250, 120),
    ]);

    expect(viewport.scrollLeft).toBe(50);
    expect(viewport.scrollTop).toBe(100);
  });

  it("resets pages and zoom when fileUrl changes", async () => {
    const { rerender } = renderViewer();
    const page = await screen.findByTestId("pdf-page-1");
    const viewport = page.closest(".contract-pdf-viewport");
    const pages = page.closest(".contract-pdf-pages");
    if (!viewport || !pages) {
      throw new Error("PDF gesture surfaces were not rendered");
    }

    fireEvent.touchStart(viewport, {
      touches: [touch(1, 0, 0), touch(2, 100, 0)],
    });
    dispatchTouchMove(viewport, [touch(1, 0, 0), touch(2, 200, 0)]);
    expect(pages).toHaveStyle({ transform: "scale(2)" });

    mockPdfState.numPages = 1;
    rerender(
      <ContractPdfViewer
        key="/replacement.pdf"
        className="contract-preview-frame"
        data-component="mobile_contracts_detail-sheet_stack_detail-page_content_pdf-preview_frame"
        fileUrl="/replacement.pdf"
        fallbackHref="/contract-download.pdf"
        title="테스트 계약서 PDF 미리보기"
      />
    );

    await waitFor(() => {
      expect(screen.getAllByTestId(/^pdf-page-/)).toHaveLength(1);
      expect(screen.getByTestId("pdf-page-1").closest(".contract-pdf-pages")).toHaveStyle({
        transform: "scale(1)",
      });
    });
  });

  it("reverts zoom and scroll when a pinch is cancelled", async () => {
    renderViewer();

    const page = await screen.findByTestId("pdf-page-1");
    const viewport = page.closest(".contract-pdf-viewport");
    const pages = page.closest(".contract-pdf-pages");
    if (!(viewport instanceof HTMLElement) || !pages) {
      throw new Error("PDF gesture surfaces were not rendered");
    }
    viewport.scrollLeft = 30;
    viewport.scrollTop = 70;

    fireEvent.touchStart(viewport, {
      touches: [touch(1, 0, 0), touch(2, 100, 0)],
    });
    dispatchTouchMove(viewport, [touch(1, 0, 0), touch(2, 200, 0)]);
    dispatchTouchCancel(viewport, [touch(1, 0, 0)]);

    expect(pages).toHaveStyle({ transform: "scale(1)" });
    expect(viewport.scrollLeft).toBe(30);
    expect(viewport.scrollTop).toBe(70);
  });

  it("ignores touchcancel for a touch outside the tracked pinch pair", async () => {
    renderViewer();

    const page = await screen.findByTestId("pdf-page-1");
    const viewport = page.closest(".contract-pdf-viewport");
    const pages = page.closest(".contract-pdf-pages");
    if (!(viewport instanceof HTMLElement) || !pages) {
      throw new Error("PDF gesture surfaces were not rendered");
    }

    fireEvent.touchStart(viewport, {
      touches: [touch(1, 0, 0), touch(2, 100, 0)],
    });
    dispatchTouchMove(viewport, [touch(1, 0, 0), touch(2, 200, 0)]);
    dispatchTouchCancel(viewport, [touch(3, 500, 500)]);

    expect(pages).toHaveStyle({ transform: "scale(2)" });
  });

  it("tracks the same touch identifiers when a third finger is present", async () => {
    renderViewer();

    const page = await screen.findByTestId("pdf-page-1");
    const viewport = page.closest(".contract-pdf-viewport");
    const pages = page.closest(".contract-pdf-pages");
    if (!viewport || !pages) {
      throw new Error("PDF gesture surfaces were not rendered");
    }

    fireEvent.touchStart(viewport, {
      touches: [touch(1, 0, 0), touch(2, 100, 0), touch(3, 900, 0)],
    });
    dispatchTouchMove(viewport, [
      touch(3, 900, 0),
      touch(2, 200, 0),
      touch(1, 0, 0),
    ]);
    expect(pages).toHaveStyle({ transform: "scale(2)" });

    const brokenPairMove = dispatchTouchMove(viewport, [
      touch(3, 900, 0),
      touch(2, 250, 0),
    ]);
    expect(brokenPairMove.defaultPrevented).toBe(false);
    expect(pages).toHaveStyle({ transform: "scale(2)" });
  });

  it("preserves native scrolling for a one-finger touch", async () => {
    renderViewer();

    const page = await screen.findByTestId("pdf-page-1");
    const viewport = page.closest(".contract-pdf-viewport");
    if (!viewport) {
      throw new Error("PDF viewport was not rendered");
    }

    fireEvent.touchStart(viewport, { touches: [touch(1, 10, 10)] });
    const move = dispatchTouchMove(viewport, [touch(1, 20, 20)]);

    expect(move.defaultPrevented).toBe(false);
  });

  it("measures clientWidth once when ResizeObserver is unavailable", async () => {
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth"
    );
    global.ResizeObserver = undefined as unknown as typeof ResizeObserver;
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.classList.contains("contract-pdf-viewer") ? 360 : 0;
      },
    });

    try {
      renderViewer();
      expect(await screen.findByTestId("pdf-page-1")).toHaveAttribute(
        "data-width",
        "360"
      );
    } finally {
      global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
      if (clientWidthDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientWidth",
          clientWidthDescriptor
        );
      }
    }
  });

  it("uses ctrl+wheel zoom without blocking a normal wheel", async () => {
    renderViewer();

    const page = await screen.findByTestId("pdf-page-1");
    const viewport = page.closest(".contract-pdf-viewport");
    const pages = page.closest(".contract-pdf-pages");
    if (!viewport || !pages) {
      throw new Error("PDF gesture surfaces were not rendered");
    }

    const normalWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
    });
    viewport.dispatchEvent(normalWheel);
    expect(normalWheel.defaultPrevented).toBe(false);

    const zoomWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      clientX: 160,
      clientY: 320,
      deltaY: -100,
    });
    act(() => {
      viewport.dispatchEvent(zoomWheel);
    });
    expect(zoomWheel.defaultPrevented).toBe(true);
    expect(pages).not.toHaveStyle({ transform: "scale(1)" });
    expect(page).toHaveAttribute("data-width", "320");
  });

  it("keeps estimated sizer height until every page renders, then uses measured content height", async () => {
    renderViewer();

    const page = await screen.findByTestId("pdf-page-1");
    const pages = page.closest(".contract-pdf-pages");
    const sizer = page.closest(".contract-pdf-sizer");
    if (
      !(pages instanceof HTMLElement) ||
      !(sizer instanceof HTMLElement)
    ) {
      throw new Error("PDF sizing surfaces were not rendered");
    }
    const expectedEstimatedHeight =
      320 * (842 / 595) * 3 + 16 * 2 + 40;
    expect(sizer).toHaveStyle({ width: "320px" });
    expect(Number.parseFloat(sizer.style.height)).toBeCloseTo(
      expectedEstimatedHeight
    );

    Object.defineProperty(pages, "scrollHeight", {
      configurable: true,
      value: 1_600,
    });
    act(() => {
      mockPageRenderCallbacks.get(1)?.();
    });
    expect(Number.parseFloat(sizer.style.height)).toBeCloseTo(
      expectedEstimatedHeight
    );

    act(() => {
      mockPageRenderCallbacks.get(2)?.();
      mockPageRenderCallbacks.get(3)?.();
    });
    await waitFor(() => {
      expect(sizer).toHaveStyle({ height: "1600px" });
    });
  });

  it("shows a labelled spinner while each PDF page renders, with Korean error copy", async () => {
    renderViewer();

    const pages = await screen.findAllByTestId(/^pdf-page-/);
    for (const page of pages) {
      const status = within(page).getByRole("status", {
        name: "PDF 페이지를 불러오는 중입니다",
      });
      expect(status.querySelector('[data-slot="spinner"]')).not.toBeNull();
      expect(page).toHaveAttribute(
        "data-error-copy",
        "PDF 페이지를 불러오지 못했습니다."
      );
    }
  });

  it("uses the supplied placeholder class and the viewer aria-label", () => {
    render(
      <ContractPdfViewerPlaceholder
        className="contract-preview-frame"
        data-component="mobile_contracts_detail-sheet_stack_detail-page_content_pdf-preview_frame"
        aria-label="계약서 PDF 미리보기"
      />
    );

    const placeholder = screen.getByRole("status");
    expect(placeholder).toHaveClass(
      "contract-pdf-viewer",
      "contract-preview-frame"
    );
    expect(placeholder).toHaveAttribute(
      "aria-label",
      "계약서 PDF 미리보기"
    );
  });
});
