"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import { Document as PdfDocument, Page } from "react-pdf";
import { Download, Eye, Printer, X } from "lucide-react";
import "@/lib/pdf-config";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { HwpDocumentPreview } from "./hwp-document-preview";

export type PreviewKind = "pdf" | "image" | "hwp" | "unsupported";

export interface PreviewMetaItem {
  label: string;
  value: ReactNode;
  className?: string;
}

interface SharedDocumentPreviewDialogProps {
  "data-component": string;
  open: boolean;
  onClose: () => void;
  title: string;
  badges?: ReactNode[];
  srDescription?: string;
  metaItems: PreviewMetaItem[];
  metaAction?: ReactNode;
  metaExtra?: ReactNode;
  previewKind: PreviewKind;
  previewUrl: string;
  downloadUrl?: string;
  downloadFileName?: string;
  receiptDownloadUrl?: string;
  receiptDownloadFileName?: string;
  imageAlt?: string;
  overlayLabel?: string;
  unsupportedMessage?: ReactNode;
  previewKey?: string;
  contentClassName?: string;
  footerAction?: ReactNode;
}

const DEFAULT_ZOOM_PERCENT = 100;
const MIN_ZOOM_PERCENT = 60;
const MAX_ZOOM_PERCENT = 300;
const ZOOM_STEP = 1;
const PINCH_WHEEL_DELTA_PER_STEP = 1;
const WHEEL_DELTA_LINE_MODE = 1;
const WHEEL_DELTA_PAGE_MODE = 2;

interface PointerPosition {
  x: number;
  y: number;
}

type PreviewAvailabilityStatus = "idle" | "checking" | "ready" | "missing" | "error";
type ImageLoadStatus = "loading" | "loaded" | "error";

interface ZoomViewportAnchor {
  x: number;
  y: number;
}

function clampZoomPercent(value: number): number {
  return Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, value));
}

function normalizeWheelDeltaY(event: Pick<WheelEvent, "deltaMode" | "deltaY">): number {
  if (event.deltaMode === WHEEL_DELTA_LINE_MODE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WHEEL_DELTA_PAGE_MODE) {
    return event.deltaY * 100;
  }
  return event.deltaY;
}

// Set NEXT_PUBLIC_DEBUG_PINCH=1 in .env.local to log every pinch wheel event.
function describeTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) {
    return String(target);
  }

  const dataComponent = target.getAttribute("data-component");
  const id = target.id ? `#${target.id}` : "";
  const className =
    typeof target.className === "string"
      ? `.${target.className
          .split(/\s+/)
          .slice(0, 3)
          .filter(Boolean)
          .join(".")}`
      : "";

  return `${target.tagName.toLowerCase()}${id}${dataComponent ? `[data-component="${dataComponent}"]` : ""}${className}`;
}

function logGestureEvent(
  event: WheelEvent,
  scope: string,
  phase: "pre" | "post-prevent",
  zoomPercent?: number
): void {
  if (process.env.NEXT_PUBLIC_DEBUG_PINCH !== "1") {
    return;
  }

  if (phase === "pre") {
    const path = event.composedPath().slice(0, 8).map(describeTarget);
    console.info("[pinch:pre]", {
      cancelable: event.cancelable,
      defaultPrevented: event.defaultPrevented,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      clientX: event.clientX,
      clientY: event.clientY,
      target: describeTarget(event.target),
      scope,
      zoomPercent,
      path: path.join(" > "),
    });
    return;
  }

  console.info("[pinch:post-prevent]", {
    cancelable: event.cancelable,
    defaultPrevented: event.defaultPrevented,
  });
}

export function SharedDocumentPreviewDialog({
  "data-component": dataComponent,
  open,
  onClose,
  title,
  badges = [],
  srDescription,
  metaItems,
  metaAction,
  metaExtra,
  previewKind,
  previewUrl,
  downloadUrl,
  downloadFileName,
  receiptDownloadUrl,
  receiptDownloadFileName,
  imageAlt,
  overlayLabel,
  unsupportedMessage = "Preview not available for this file type",
  previewKey,
  contentClassName,
  footerAction,
}: SharedDocumentPreviewDialogProps) {
  const previewDialogContentRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLDivElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const pinchWheelRemainderRef = useRef(0);
  const lastPointerPositionRef = useRef<PointerPosition | null>(null);
  const pendingZoomAnchorRef = useRef<ZoomViewportAnchor | null>(null);
  const [zoomPercent, setZoomPercent] = useState(DEFAULT_ZOOM_PERCENT);
  const [numPages, setNumPages] = useState(0);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [imageLoadStatus, setImageLoadStatus] = useState<ImageLoadStatus>("loading");
  const isPdf = previewKind === "pdf";
  const isImage = previewKind === "image";
  const isHwp = previewKind === "hwp";
  const isZoomablePreview = isPdf || isImage || isHwp;
  const [previewAvailabilityStatus, setPreviewAvailabilityStatus] =
    useState<PreviewAvailabilityStatus>("idle");
  const zoomScale = zoomPercent / 100;
  const pageWidth = Math.max(previewWidth, 320) * zoomScale;
  const zoomPercentRef = useRef(DEFAULT_ZOOM_PERCENT);
  const isPreviewReady = !isZoomablePreview || previewAvailabilityStatus === "ready";

  const setZoomPercentPreservingAnchor = useCallback(
    (getNextZoomPercent: (currentZoomPercent: number) => number) => {
      const viewport = previewViewportRef.current;
      if (viewport && viewport.scrollWidth > 0 && viewport.scrollHeight > 0) {
        pendingZoomAnchorRef.current = {
          x: (viewport.scrollLeft + viewport.clientWidth / 2) / viewport.scrollWidth,
          y: (viewport.scrollTop + viewport.clientHeight / 2) / viewport.scrollHeight,
        };
      }

      setZoomPercent((currentZoomPercent) =>
        clampZoomPercent(getNextZoomPercent(currentZoomPercent))
      );
    },
    []
  );

  const applyPinchZoomDelta = useCallback((event: Pick<WheelEvent, "deltaMode" | "deltaY">) => {
    pinchWheelRemainderRef.current += normalizeWheelDeltaY(event);
    const steps = Math.trunc(pinchWheelRemainderRef.current / PINCH_WHEEL_DELTA_PER_STEP);
    if (steps === 0) {
      return;
    }

    pinchWheelRemainderRef.current -= steps * PINCH_WHEEL_DELTA_PER_STEP;
    setZoomPercentPreservingAnchor(
      (currentZoomPercent) => currentZoomPercent - steps * ZOOM_STEP
    );
  }, [setZoomPercentPreservingAnchor]);

  const getNodeAtPointerPosition = (pointerPosition: PointerPosition | null): Node | null => {
    if (!pointerPosition) {
      return null;
    }

    const elementAtPointer = document.elementFromPoint(pointerPosition.x, pointerPosition.y);
    return elementAtPointer instanceof Node ? elementAtPointer : null;
  };

  useLayoutEffect(() => {
    const node = previewViewportRef.current;
    if (
      !open ||
      !isZoomablePreview ||
      !isPreviewReady ||
      !node ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const updatePreviewWidth = () => {
      setPreviewWidth(Math.max(node.clientWidth - 48, 320));
    };

    updatePreviewWidth();
    const observer = new ResizeObserver(updatePreviewWidth);

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [isPreviewReady, isZoomablePreview, open]);

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    const viewport = previewViewportRef.current;
    if (!anchor || !viewport) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const nextViewport = previewViewportRef.current;
      if (!nextViewport) {
        return;
      }

      nextViewport.scrollLeft =
        anchor.x * nextViewport.scrollWidth - nextViewport.clientWidth / 2;
      nextViewport.scrollTop =
        anchor.y * nextViewport.scrollHeight - nextViewport.clientHeight / 2;
      pendingZoomAnchorRef.current = null;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [zoomPercent]);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (isActive) {
        setImageLoadStatus("loading");
      }
    });

    return () => {
      isActive = false;
    };
  }, [isImage, open, previewUrl]);

  useEffect(() => {
    let isActive = true;
    const setPreviewAvailabilityStatusSoon = (status: PreviewAvailabilityStatus) => {
      queueMicrotask(() => {
        if (isActive) {
          setPreviewAvailabilityStatus(status);
        }
      });
    };
    const resetNumPagesSoon = () => {
      queueMicrotask(() => {
        if (isActive) {
          setNumPages(0);
        }
      });
    };

    if (!open || !isZoomablePreview) {
      setPreviewAvailabilityStatusSoon("idle");
      return () => {
        isActive = false;
      };
    }

    const controller = new AbortController();
    const signal = controller.signal;
    setPreviewAvailabilityStatusSoon("checking");
    resetNumPagesSoon();

    void fetch(previewUrl, {
      method: "HEAD",
      credentials: "include",
      cache: "no-store",
      signal,
    })
      .then((response) => {
        if (signal.aborted) {
          return;
        }

        if (response.status === 404) {
          setPreviewAvailabilityStatus("missing");
          return;
        }

        if (!response.ok) {
          setPreviewAvailabilityStatus("error");
          return;
        }

        setPreviewAvailabilityStatus("ready");
      })
      .catch((error: unknown) => {
        if (signal.aborted) {
          return;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setPreviewAvailabilityStatus("error");
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [isZoomablePreview, open, previewUrl]);

  useEffect(() => {
    zoomPercentRef.current = zoomPercent;
  }, [zoomPercent]);

  useEffect(() => {
    if (!open) {
      return;
    }
    type PinchScope = "preview" | "dialog" | "outside" | "ambiguous";

    let frameId = 0;
    let controller: AbortController | null = null;

    const attachPinchListeners = () => {
      const dialogNode = previewDialogContentRef.current;
      if (!dialogNode) {
        frameId = window.requestAnimationFrame(attachPinchListeners);
        return;
      }

      // Clear stale pointer coordinates so the first weak pinch after reopen is safely treated as ambiguous.
      lastPointerPositionRef.current = null;

      const updateLastPointerPosition = (event: PointerEvent | MouseEvent) => {
        lastPointerPositionRef.current = {
          x: event.clientX,
          y: event.clientY,
        };
      };

      const resolvePinchScope = (event: WheelEvent): PinchScope => {
        const previewCanvasNode = previewCanvasRef.current;
        const eventPath = event.composedPath();

        if (previewCanvasNode && eventPath.includes(previewCanvasNode)) {
          return "preview";
        }
        if (eventPath.includes(dialogNode)) {
          return "dialog";
        }

        const eventTarget = event.target instanceof Node ? event.target : null;
        if (eventTarget && previewCanvasNode?.contains(eventTarget)) {
          return "preview";
        }
        if (eventTarget && dialogNode.contains(eventTarget)) {
          return "dialog";
        }

        const hasRealCoords =
          (event.clientX !== 0 || event.clientY !== 0) &&
          Number.isFinite(event.clientX) &&
          Number.isFinite(event.clientY);
        const point = hasRealCoords
          ? { x: event.clientX, y: event.clientY }
          : lastPointerPositionRef.current;
        const hit = getNodeAtPointerPosition(point);

        if (previewCanvasNode && hit && previewCanvasNode.contains(hit)) {
          return "preview";
        }
        if (hit && dialogNode.contains(hit)) {
          return "dialog";
        }
        if (hit) {
          return "outside";
        }

        return "ambiguous";
      };

      const handledWheelEvents = new WeakSet<WheelEvent>();

      const handlePinchWheel = (event: WheelEvent) => {
        if (!event.ctrlKey || handledWheelEvents.has(event)) {
          return;
        }

        const scope = resolvePinchScope(event);
        if (scope === "outside") {
          return;
        }

        handledWheelEvents.add(event);

        logGestureEvent(event, scope, "pre", zoomPercentRef.current);

        if (event.cancelable) {
          event.preventDefault();
          logGestureEvent(event, scope, "post-prevent");
        }

        if (scope === "preview" && isZoomablePreview) {
          applyPinchZoomDelta(event);
        }
      };

      controller = new AbortController();
      const blockingWheel: AddEventListenerOptions = { passive: false, capture: true, signal: controller.signal };
      const passivePointer: AddEventListenerOptions = { passive: true, capture: true, signal: controller.signal };

      window.addEventListener("wheel", handlePinchWheel, blockingWheel);
      document.addEventListener("wheel", handlePinchWheel, blockingWheel);
      dialogNode.addEventListener("wheel", handlePinchWheel, blockingWheel);
      previewCanvasRef.current?.addEventListener("wheel", handlePinchWheel, blockingWheel);

      document.addEventListener("pointermove", updateLastPointerPosition, passivePointer);
      document.addEventListener("pointerover", updateLastPointerPosition, passivePointer);
      document.addEventListener("mousemove", updateLastPointerPosition, passivePointer);
      document.addEventListener("mouseover", updateLastPointerPosition, passivePointer);
    };

    attachPinchListeners();

    return () => {
      window.cancelAnimationFrame(frameId);
      controller?.abort();
    };
  }, [applyPinchZoomDelta, isZoomablePreview, open]);

  const handleClose = () => {
    setZoomPercent(DEFAULT_ZOOM_PERCENT);
    pinchWheelRemainderRef.current = 0;
    pendingZoomAnchorRef.current = null;
    setNumPages(0);
    setImageLoadStatus("loading");
    setPreviewAvailabilityStatus("idle");
    onClose();
  };

  const handlePrint = () => {
    const iframe = window.document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = previewUrl;
    iframe.addEventListener("load", () => {
      const printWindow = iframe.contentWindow;
      if (!printWindow) {
        iframe.remove();
        return;
      }

      const cleanupPrintFrame = () => {
        printWindow.removeEventListener("afterprint", cleanupPrintFrame);
        iframe.remove();
      };

      printWindow.addEventListener("afterprint", cleanupPrintFrame, { once: true });

      try {
        printWindow.print();
      } catch (error) {
        cleanupPrintFrame();
        console.error("Failed to print preview", error);
      }
    }, { once: true });
    window.document.body.appendChild(iframe);
  };

  const triggerDownload = (url: string, fileName?: string) => {
    const link = window.document.createElement("a");
    link.href = url;
    if (fileName) {
      link.download = fileName;
    }
    link.target = "_blank";
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
  };

  const handleDownload = () => {
    if (!downloadUrl) {
      return;
    }
    triggerDownload(downloadUrl, downloadFileName);
  };

  const renderPreviewAvailabilityMessage = () => {
    const isChecking =
      previewAvailabilityStatus === "idle" || previewAvailabilityStatus === "checking";
    const message =
      previewAvailabilityStatus === "missing"
        ? "원본 파일을 찾을 수 없습니다. 파일을 다시 업로드해 주세요."
        : previewAvailabilityStatus === "error"
          ? "미리보기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
          : "미리보기 파일을 확인하는 중입니다";

    return (
      <div className="flex h-full flex-1 items-center justify-center px-6" aria-live="polite">
        <div
          className={cn(
            "flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-medium shadow-sm",
            previewAvailabilityStatus === "missing" || previewAvailabilityStatus === "error"
              ? "text-v3-burgundy"
              : "text-v3-text"
          )}
        >
          {isChecking && <Spinner size="sm" className="text-v3-primary" />}
          {message}
        </div>
      </div>
    );
  };

  const fileActionButtons = [
    !isHwp ? (
      <Button
        key="print"
        variant="positive-outline"
        size="sm"
        onClick={handlePrint}
        disabled={isZoomablePreview && !isPreviewReady}
        className="min-w-[88px] border-v3-primary"
      >
        <Printer className="mr-2 h-4 w-4" />
        인쇄
      </Button>
    ) : null,
    receiptDownloadUrl ? (
      <Button
        key="receipt"
        variant="positive-outline"
        size="sm"
        data-component={`${dataComponent}_footer_file-actions_receipt-download`}
        onClick={() => triggerDownload(receiptDownloadUrl, receiptDownloadFileName)}
        className="min-w-[88px] border-v3-primary"
      >
        <Download className="mr-2 h-4 w-4" />
        영수증
      </Button>
    ) : null,
    downloadUrl ? (
      <Button
        key="download"
        size="sm"
        onClick={handleDownload}
        disabled={isZoomablePreview && !isPreviewReady}
        className="min-w-[88px] hover:translate-y-0 hover:shadow-[0_4px_24px_hsla(214,50%,20%,0.06)]"
      >
        <Download className="mr-2 h-4 w-4" />
        다운로드
      </Button>
    ) : null,
  ];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent
        ref={previewDialogContentRef}
        data-component={dataComponent}
        className={cn("!flex h-[90vh] max-h-[90vh] max-w-4xl flex-col !overflow-hidden p-0", contentClassName)}
        showCloseButton={false}
      >
        <DialogHeader
          data-component={`${dataComponent}_header`}
          className="flex-row items-start justify-between border-b border-border px-6 py-4"
        >
          <div>
            <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
            {badges.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {badges.map((badge, index) => (
                  <Fragment key={`preview-badge-${index}`}>{badge}</Fragment>
                ))}
              </div>
            )}
            {srDescription && <DialogDescription className="sr-only">{srDescription}</DialogDescription>}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="미리보기 닫기"
            onClick={handleClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div
            data-component={`${dataComponent}_meta`}
            className="border-b border-border bg-muted/30 px-6 py-4"
          >
            <div className="mb-2 flex flex-wrap gap-6">
              {metaItems.map((item, index) => (
                <div key={`preview-meta-${index}`} className={item.className}>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <div className="mt-0.5 text-sm">{item.value}</div>
                </div>
              ))}
              {metaAction && <div className="ml-auto self-center">{metaAction}</div>}
            </div>
            {metaExtra}
          </div>

          <div
            data-component={`${dataComponent}_canvas`}
            ref={previewCanvasRef}
            className="relative flex min-h-[400px] flex-1 flex-col overflow-hidden bg-muted/50"
          >
            {isZoomablePreview && !isPreviewReady && renderPreviewAvailabilityMessage()}

            {isPdf && isPreviewReady && (
              <div ref={previewViewportRef} className="h-full overflow-auto px-6 pb-24 pt-6">
                <PdfDocument
                  key={previewKey}
                  file={previewUrl}
                  loading={
                    <div className="flex min-h-full items-center justify-center">
                      <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-medium text-v3-text shadow-sm">
                        <Spinner size="sm" className="text-v3-primary" />
                        PDF를 불러오는 중입니다
                      </div>
                    </div>
                  }
                  error={
                    <div className="flex min-h-full items-center justify-center">
                      <div className="rounded-2xl bg-white px-5 py-4 text-sm font-medium text-v3-burgundy shadow-sm">
                        PDF 미리보기를 불러오지 못했습니다.
                      </div>
                    </div>
                  }
                  onLoadSuccess={({ numPages: nextNumPages }) => setNumPages(nextNumPages)}
                >
                  <div className="flex min-h-full flex-col items-center gap-6">
                    {Array.from({ length: numPages }, (_, index) => (
                      <div
                        key={`${previewKey ?? title}-page-${index + 1}`}
                        className="overflow-hidden rounded-[20px] bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
                      >
                        <Page
                          pageNumber={index + 1}
                          width={pageWidth}
                          renderAnnotationLayer={false}
                          renderTextLayer={false}
                        />
                      </div>
                    ))}
                  </div>
                </PdfDocument>
              </div>
            )}

            {isImage && isPreviewReady && (
              <div ref={previewViewportRef} className="h-full w-full overflow-auto px-6 pb-24 pt-6">
                <div className="flex min-h-full min-w-full items-center justify-center">
                  {imageLoadStatus !== "error" ? (
                    <Image
                      src={previewUrl}
                      alt={imageAlt ?? title}
                      width={1600}
                      height={1600}
                      unoptimized
                      onLoad={() => setImageLoadStatus("loaded")}
                      onError={() => setImageLoadStatus("error")}
                      className="h-auto max-w-none object-contain"
                      style={{ width: `${pageWidth}px` }}
                    />
                  ) : null}
                </div>
              </div>
            )}

            {isImage && isPreviewReady && imageLoadStatus === "loading" ? (
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center px-6"
                aria-live="polite"
              >
                <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-medium text-v3-text shadow-sm">
                  <Spinner size="sm" className="text-v3-primary" />
                  이미지를 불러오는 중입니다
                </div>
              </div>
            ) : null}

            {isImage && isPreviewReady && imageLoadStatus === "error" ? (
              <div className="absolute inset-0 flex items-center justify-center px-6" role="alert">
                <div className="rounded-2xl bg-white px-5 py-4 text-sm font-medium text-v3-burgundy shadow-sm">
                  이미지 미리보기를 불러오지 못했습니다.
                </div>
              </div>
            ) : null}

            {isHwp && isPreviewReady && (
              <div ref={previewViewportRef} className="h-full overflow-auto px-6 pb-24 pt-6">
                <HwpDocumentPreview
                  key={previewKey}
                  previewUrl={previewUrl}
                  previewKey={previewKey}
                  title={title}
                  pageWidth={pageWidth}
                />
              </div>
            )}

            {!isPdf && !isImage && !isHwp && (
              <div className="flex h-full items-center justify-center">
                <div className="text-muted-foreground">{unsupportedMessage}</div>
              </div>
            )}

            {overlayLabel && (
              <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-v3-text-muted shadow-sm">
                <Eye className="h-3.5 w-3.5" />
                {overlayLabel}
              </div>
            )}

            {isZoomablePreview && isPreviewReady && (
              <div className="absolute bottom-4 right-4 z-10 flex items-center gap-3 rounded-[18px] border border-border bg-white/95 px-4 py-3 opacity-70 shadow-[0_16px_40px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-opacity hover:opacity-100 focus-within:opacity-100">
                <div className="min-w-[3rem] text-right text-xs font-semibold text-v3-text-muted">
                  확대
                </div>
                <input
                  type="range"
                  min={MIN_ZOOM_PERCENT}
                  max={MAX_ZOOM_PERCENT}
                  step={ZOOM_STEP}
                  value={zoomPercent}
                  onChange={(event) => {
                    const nextZoomPercent = Number(event.target.value);
                    setZoomPercentPreservingAnchor(() => nextZoomPercent);
                  }}
                  className="h-2 w-32 cursor-pointer accent-[hsl(214,100%,34%)]"
                  aria-label={`${isPdf ? "PDF" : isHwp ? "한글 문서" : "이미지"} 미리보기 확대/축소`}
                />
                <div className="min-w-[3.5rem] rounded-full bg-v3-dim-white px-2.5 py-1 text-center text-xs font-semibold text-v3-dark">
                  {zoomPercent}%
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter
          data-component={`${dataComponent}_footer`}
          className={cn(
            "border-t border-border px-6 py-4",
            footerAction ? "sm:justify-between" : "justify-end",
          )}
        >
          {footerAction ? (
            <>
              <div
                data-component={`${dataComponent}_footer_file-actions`}
                className="flex flex-wrap items-center gap-2"
              >
                {fileActionButtons}
              </div>
              <div
                data-component={`${dataComponent}_footer_review-action`}
                className="ml-auto flex items-center"
              >
                {footerAction}
              </div>
            </>
          ) : (
            fileActionButtons
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
