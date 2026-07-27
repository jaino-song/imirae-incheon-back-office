"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Document as PdfDocument, Page } from "react-pdf";

import { Spinner } from "@/components/ui/spinner";

import "@/lib/pdf-config";
import { cn } from "@/lib/utils";

interface ContractPdfViewerProps {
  fileUrl: string;
  title: string;
  fallbackHref: string;
  className?: string;
  "data-component": string;
}

interface PdfLoadSuccess {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getViewport: (options: { scale: number }) => {
      width: number;
      height: number;
    };
  }>;
}

interface GesturePoint {
  x: number;
  y: number;
}

interface PinchGesture {
  touchIdentifiers: readonly [number, number];
  startDistance: number;
  startFocus: GesturePoint;
  startZoom: number;
  startScrollLeft: number;
  startScrollTop: number;
}

interface PendingScroll {
  left: number;
  top: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const MAX_RENDER_DPR = 3;
const MIN_RENDER_DPR = 0.75;
// Used only until pdf.js exposes real page viewports. A 2:1 fallback is
// intentionally conservative for unusually tall or rotated documents.
const FALLBACK_PAGE_ASPECT_RATIO = 2;
const PAGE_PIXEL_BUDGET = 4_000_000;
const DOCUMENT_PIXEL_BUDGET = 24_000_000;
const PAGE_GAP_PX = 16;
const PAGE_VERTICAL_PADDING_PX = 40;
const WHEEL_ZOOM_SENSITIVITY = 0.002;

interface CalculateRenderDprOptions {
  baseWidth: number;
  pageCount: number;
  maxPageAspectRatio: number;
  totalPageAspectRatio: number;
  devicePixelRatio?: number;
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function getTouchByIdentifier(touches: TouchList, identifier: number): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index];
    if (touch?.identifier === identifier) {
      return touch;
    }
  }

  return null;
}

function getGesturePoint(firstTouch: Touch, secondTouch: Touch): GesturePoint {
  return {
    x: (firstTouch.clientX + secondTouch.clientX) / 2,
    y: (firstTouch.clientY + secondTouch.clientY) / 2,
  };
}

function getTouchDistance(firstTouch: Touch, secondTouch: Touch): number {
  return Math.hypot(
    secondTouch.clientX - firstTouch.clientX,
    secondTouch.clientY - firstTouch.clientY
  );
}

export function calculateRenderDpr({
  baseWidth,
  pageCount,
  maxPageAspectRatio,
  totalPageAspectRatio,
  devicePixelRatio,
}: CalculateRenderDprOptions): number {
  if (baseWidth <= 0) {
    return MIN_RENDER_DPR;
  }

  const resolvedDeviceDpr =
    devicePixelRatio ??
    (typeof window === "undefined"
      ? MIN_RENDER_DPR
      : window.devicePixelRatio ?? MIN_RENDER_DPR);
  const deviceDpr = Math.min(resolvedDeviceDpr, MAX_RENDER_DPR);
  const pagePixelsAtDprOne =
    baseWidth * baseWidth * Math.max(maxPageAspectRatio, 1);
  const resolvedTotalPageAspectRatio =
    totalPageAspectRatio > 0
      ? totalPageAspectRatio
      : Math.max(pageCount, 1) * FALLBACK_PAGE_ASPECT_RATIO;
  const documentPixelsAtDprOne =
    baseWidth * baseWidth * resolvedTotalPageAspectRatio;
  const pageBudgetDpr = Math.sqrt(PAGE_PIXEL_BUDGET / pagePixelsAtDprOne);
  const documentBudgetDpr = Math.sqrt(
    DOCUMENT_PIXEL_BUDGET / documentPixelsAtDprOne
  );

  return Math.max(
    MIN_RENDER_DPR,
    Math.min(deviceDpr, pageBudgetDpr, documentBudgetDpr)
  );
}

export function ContractPdfViewer({
  fileUrl,
  title,
  fallbackHref,
  className,
  "data-component": dataComponent,
}: ContractPdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const pinchGestureRef = useRef<PinchGesture | null>(null);
  const zoomRef = useRef(MIN_ZOOM);
  const previousBaseWidthRef = useRef(0);
  const renderedPagesRef = useRef(new Set<number>());
  const documentLoadIdRef = useRef(0);
  const pendingScrollRef = useRef<PendingScroll | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [baseWidth, setBaseWidth] = useState(0);
  const [pageAspectRatios, setPageAspectRatios] = useState<number[]>([]);
  const [contentHeight, setContentHeight] = useState(0);
  const [renderedPageCount, setRenderedPageCount] = useState(0);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const pageAspectRatioSummary = useMemo(() => {
    const hasEveryPageRatio =
      numPages > 0 && pageAspectRatios.length === numPages;
    const ratios = hasEveryPageRatio
      ? pageAspectRatios
      : Array.from(
          { length: Math.max(numPages, 1) },
          () => FALLBACK_PAGE_ASPECT_RATIO
        );

    return {
      max: Math.max(...ratios),
      total: ratios.reduce((sum, ratio) => sum + ratio, 0),
    };
  }, [numPages, pageAspectRatios]);
  const renderDpr = useMemo(
    () =>
      calculateRenderDpr({
        baseWidth,
        pageCount: numPages,
        maxPageAspectRatio: pageAspectRatioSummary.max,
        totalPageAspectRatio: pageAspectRatioSummary.total,
      }),
    [baseWidth, numPages, pageAspectRatioSummary]
  );
  const estimatedContentHeight =
    numPages > 0
      ? baseWidth * pageAspectRatioSummary.total +
        PAGE_GAP_PX * Math.max(numPages - 1, 0) +
        PAGE_VERTICAL_PADDING_PX
      : 0;
  const hasMeasuredEveryPage =
    numPages > 0 && renderedPageCount >= numPages && contentHeight > 0;
  const baseContentHeight = hasMeasuredEveryPage
    ? contentHeight
    : estimatedContentHeight;

  const measureContent = useCallback((pageNumber: number) => {
    const pages = pagesRef.current;
    if (pages) {
      setContentHeight(pages.scrollHeight);
    }
    if (!renderedPagesRef.current.has(pageNumber)) {
      renderedPagesRef.current.add(pageNumber);
      setRenderedPageCount(renderedPagesRef.current.size);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  const scheduleScroll = useCallback((left: number, top: number) => {
    pendingScrollRef.current = { left, top };
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const pendingScroll = pendingScrollRef.current;
      if (viewport && pendingScroll) {
        viewport.scrollLeft = pendingScroll.left;
        viewport.scrollTop = pendingScroll.top;
      }
      pendingScrollRef.current = null;
      scrollFrameRef.current = null;
    });
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateBaseWidth = () => {
      const nextBaseWidth = container.clientWidth;
      const previousBaseWidth = previousBaseWidthRef.current;
      previousBaseWidthRef.current = nextBaseWidth;

      if (
        previousBaseWidth > 0 &&
        previousBaseWidth !== nextBaseWidth
      ) {
        renderedPagesRef.current.clear();
        setRenderedPageCount(0);
        setContentHeight(0);
        pinchGestureRef.current = null;
        zoomRef.current = MIN_ZOOM;
        setZoom(MIN_ZOOM);
        scheduleScroll(0, 0);
      }

      setBaseWidth(nextBaseWidth);
    };

    updateBaseWidth();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateBaseWidth);
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [scheduleScroll]);

  const applyZoom = useCallback(
    (nextZoomValue: number, focus: GesturePoint) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const previousZoom = zoomRef.current;
      const nextZoom = clampZoom(nextZoomValue);
      if (nextZoom === previousZoom) {
        return;
      }

      const previousScroll = pendingScrollRef.current ?? {
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      const zoomRatio = nextZoom / previousZoom;
      const nextScrollLeft =
        (previousScroll.left + focus.x) * zoomRatio - focus.x;
      const nextScrollTop =
        (previousScroll.top + focus.y) * zoomRatio - focus.y;

      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      scheduleScroll(nextScrollLeft, nextScrollTop);
    },
    [scheduleScroll]
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const getViewportPoint = (clientPoint: GesturePoint): GesturePoint => {
      const bounds = viewport.getBoundingClientRect();
      return {
        x: clientPoint.x - bounds.left,
        y: clientPoint.y - bounds.top,
      };
    };

    const finishPinch = () => {
      pinchGestureRef.current = null;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (pinchGestureRef.current || event.touches.length < 2) {
        return;
      }

      const firstTouch = event.touches[0];
      const secondTouch = event.touches[1];
      if (!firstTouch || !secondTouch) {
        return;
      }

      const startDistance = getTouchDistance(firstTouch, secondTouch);
      if (startDistance <= 0) {
        return;
      }

      pinchGestureRef.current = {
        touchIdentifiers: [firstTouch.identifier, secondTouch.identifier],
        startDistance,
        startFocus: getViewportPoint(
          getGesturePoint(firstTouch, secondTouch)
        ),
        startZoom: zoomRef.current,
        startScrollLeft: viewport.scrollLeft,
        startScrollTop: viewport.scrollTop,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const gesture = pinchGestureRef.current;
      if (!gesture) {
        return;
      }

      const firstTouch = getTouchByIdentifier(
        event.touches,
        gesture.touchIdentifiers[0]
      );
      const secondTouch = getTouchByIdentifier(
        event.touches,
        gesture.touchIdentifiers[1]
      );
      if (!firstTouch || !secondTouch) {
        finishPinch();
        return;
      }

      const distance = getTouchDistance(firstTouch, secondTouch);
      if (distance <= 0) {
        return;
      }

      event.preventDefault();
      const nextZoom = clampZoom(
        gesture.startZoom * (distance / gesture.startDistance)
      );
      const currentFocus = getViewportPoint(
        getGesturePoint(firstTouch, secondTouch)
      );
      const zoomRatio = nextZoom / gesture.startZoom;

      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      scheduleScroll(
        (gesture.startScrollLeft + gesture.startFocus.x) * zoomRatio -
          currentFocus.x,
        (gesture.startScrollTop + gesture.startFocus.y) * zoomRatio -
          currentFocus.y
      );
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = pinchGestureRef.current;
      if (!gesture) {
        return;
      }

      const hasFirstTouch = getTouchByIdentifier(
        event.touches,
        gesture.touchIdentifiers[0]
      );
      const hasSecondTouch = getTouchByIdentifier(
        event.touches,
        gesture.touchIdentifiers[1]
      );
      if (!hasFirstTouch || !hasSecondTouch) {
        finishPinch();
      }
    };

    const handleTouchCancel = (event: TouchEvent) => {
      const gesture = pinchGestureRef.current;
      if (!gesture) {
        return;
      }
      const cancelledTrackedTouch = gesture.touchIdentifiers.some(
        (identifier) =>
          getTouchByIdentifier(event.changedTouches, identifier) !== null
      );
      if (!cancelledTrackedTouch) {
        return;
      }

      zoomRef.current = gesture.startZoom;
      setZoom(gesture.startZoom);
      scheduleScroll(gesture.startScrollLeft, gesture.startScrollTop);
      finishPinch();
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const focus = getViewportPoint({ x: event.clientX, y: event.clientY });
      const nextZoom = zoomRef.current * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
      applyZoom(nextZoom, focus);
    };

    viewport.addEventListener("touchstart", handleTouchStart);
    viewport.addEventListener("touchmove", handleTouchMove, { passive: false });
    viewport.addEventListener("touchend", handleTouchEnd);
    viewport.addEventListener("touchcancel", handleTouchCancel);
    viewport.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      viewport.removeEventListener("touchstart", handleTouchStart);
      viewport.removeEventListener("touchmove", handleTouchMove);
      viewport.removeEventListener("touchend", handleTouchEnd);
      viewport.removeEventListener("touchcancel", handleTouchCancel);
      viewport.removeEventListener("wheel", handleWheel);
    };
  }, [applyZoom, scheduleScroll]);

  const handleLoadSuccess = useCallback((pdf: PdfLoadSuccess) => {
    const loadId = documentLoadIdRef.current + 1;
    documentLoadIdRef.current = loadId;
    renderedPagesRef.current.clear();
    setNumPages(pdf.numPages);
    setPageAspectRatios([]);
    setRenderedPageCount(0);
    setContentHeight(0);

    void Promise.all(
      Array.from({ length: pdf.numPages }, async (_, index) => {
        const page = await pdf.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        return viewport.width > 0
          ? viewport.height / viewport.width
          : FALLBACK_PAGE_ASPECT_RATIO;
      })
    )
      .then((ratios) => {
        if (documentLoadIdRef.current === loadId) {
          setPageAspectRatios(ratios);
        }
      })
      .catch(() => {
        // Keep the conservative fallback when page metadata is unavailable.
      });
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("contract-pdf-viewer", className)}
      data-component={dataComponent}
      data-slot="contract-pdf-viewer"
      data-source-component="ContractPdfViewer"
    >
      <div
        ref={viewportRef}
        className="contract-pdf-viewport"
        data-slot="contract-pdf-viewport"
        aria-label={title}
        role="region"
        tabIndex={0}
      >
        <PdfDocument
          className="contract-pdf-document"
          data-slot="contract-pdf-document"
          file={fileUrl}
          loading={
            <div
              className="contract-pdf-status"
              data-slot="contract-pdf-status"
              role="status"
              aria-label="PDF를 불러오는 중입니다"
            >
              <Spinner size="lg" className="contract-pdf-spinner" />
            </div>
          }
          error={
            <div
              className="contract-pdf-status contract-pdf-status-error"
              data-slot="contract-pdf-status"
              role="alert"
            >
              <span>PDF 미리보기를 불러오지 못했습니다.</span>
              <a href={fallbackHref} target="_blank" rel="noopener noreferrer">
                새 탭에서 열기
              </a>
            </div>
          }
          onLoadSuccess={handleLoadSuccess}
        >
          <div
            className="contract-pdf-sizer"
            data-slot="contract-pdf-sizer"
            style={{
              width: baseWidth * zoom,
              height: baseContentHeight * zoom,
            }}
          >
            <div
              ref={pagesRef}
              className="contract-pdf-pages"
              data-slot="contract-pdf-pages"
              style={{
                width: baseWidth,
                transform: `scale(${zoom})`,
              }}
            >
              {baseWidth > 0
                ? Array.from({ length: numPages }, (_, index) => (
                    <div
                      className="contract-pdf-page"
                      data-slot="contract-pdf-page"
                      key={`${fileUrl}-page-${index + 1}`}
                    >
                      <Page
                        pageNumber={index + 1}
                        width={baseWidth}
                        devicePixelRatio={renderDpr}
                        loading={
                          <div
                            className="contract-pdf-status"
                            data-slot="contract-pdf-status"
                            role="status"
                            aria-label="PDF 페이지를 불러오는 중입니다"
                          >
                            <Spinner size="lg" className="contract-pdf-spinner" />
                          </div>
                        }
                        error="PDF 페이지를 불러오지 못했습니다."
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        onRenderSuccess={() => measureContent(index + 1)}
                      />
                    </div>
                  ))
                : null}
            </div>
          </div>
        </PdfDocument>
      </div>
    </div>
  );
}
