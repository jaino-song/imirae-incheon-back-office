"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
  TransitionEvent,
} from "react";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";

import styles from "./sliding-card.module.css";

const SLIDING_CARD_SOURCE_COMPONENT = "SlidingCard";
const DETAIL_CACHE_CLEAR_FALLBACK_MS = 450;
const SWIPE_EDGE_WIDTH_PX = 28;
const SWIPE_CLAIM_DISTANCE_PX = 8;
const SWIPE_COMMIT_DISTANCE_RATIO = 0.35;
const SWIPE_COMMIT_VELOCITY_PX_PER_MS = 0.5;
const SWIPE_VELOCITY_RECENCY_MS = 100;
const SWIPE_CLICK_SUPPRESSION_MS = 500;
const SWIPE_COMMIT_STYLE_FALLBACK_MS = 600;

interface GestureState {
  pointerId: number | null;
  startX: number;
  startY: number;
  claimed: boolean;
  lastX: number;
  lastT: number;
  prevX: number;
  prevT: number;
  width: number;
  candidate: boolean;
}

interface CachedDetail {
  detailKey: string;
  detail: ReactNode;
}

export interface SlidingCardProps {
  "data-component": string;
  open: boolean;
  onBack: () => void;
  backLabel: string;
  detailKey: string | null;
  list: ReactNode;
  detail: ReactNode;
  detailHeaderTrailing?: ReactNode;
}

export function SlidingCard({
  "data-component": dataComponent,
  open,
  onBack,
  backLabel,
  detailKey,
  list,
  detail,
  detailHeaderTrailing,
}: SlidingCardProps): ReactElement {
  const detailBodyRef = useRef<HTMLDivElement>(null);
  const detailPaneRef = useRef<HTMLDivElement>(null);
  const listPaneRef = useRef<HTMLDivElement>(null);
  const listDimRef = useRef<HTMLDivElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const gestureRef = useRef<GestureState>({
    pointerId: null,
    startX: 0,
    startY: 0,
    claimed: false,
    lastX: 0,
    lastT: 0,
    prevX: 0,
    prevT: 0,
    width: 0,
    candidate: false,
  });
  const suppressClickRef = useRef<number | null>(null);
  const lastListFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const previousOpenRef = useRef(false);
  const cachedDetailRef = useRef<CachedDetail | null>(null);
  const cacheClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const gestureResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const [cachedDetail, setCachedDetail] = useState<CachedDetail | null>(() =>
    open && detailKey !== null && detail !== null
      ? { detailKey, detail }
      : null,
  );

  const clearCacheTimeout = useCallback(() => {
    if (cacheClearTimeoutRef.current === null) {
      return;
    }

    clearTimeout(cacheClearTimeoutRef.current);
    cacheClearTimeoutRef.current = null;
  }, []);

  const clearCachedDetail = useCallback(() => {
    cachedDetailRef.current = null;
    setCachedDetail(null);
  }, []);

  const clearGestureStyles = useCallback(() => {
    detailPaneRef.current?.style.removeProperty("transform");
    listPaneRef.current?.style.removeProperty("transform");
    listDimRef.current?.style.removeProperty("opacity");
  }, []);

  const clearGestureResetTimeout = useCallback(() => {
    if (gestureResetTimeoutRef.current === null) {
      return;
    }

    clearTimeout(gestureResetTimeoutRef.current);
    gestureResetTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    cachedDetailRef.current = cachedDetail;
  }, [cachedDetail]);

  useEffect(() => {
    if (detailKey === null) {
      return;
    }

    const detailBody = detailBodyRef.current;
    if (typeof detailBody?.scrollTo === "function") {
      detailBody.scrollTo(0, 0);
    }
  }, [detailKey]);

  useEffect(() => {
    const wasOpen = previousOpenRef.current;

    if (!wasOpen && open) {
      restoreFocusRef.current = lastListFocusRef.current;
      // preventScroll: 슬라이드 중인 pane 안 요소에 focus가 가면 브라우저가
      // overflow:hidden stage를 강제 스크롤해 전환이 점프/튕김으로 보인다.
      backButtonRef.current?.focus({ preventScroll: true });
    } else if (wasOpen && !open) {
      const elementToRestore = restoreFocusRef.current;
      if (elementToRestore?.isConnected) {
        elementToRestore.focus({ preventScroll: true });
      }
      restoreFocusRef.current = null;
    }

    previousOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    clearCacheTimeout();

    if (!open && cachedDetail !== null) {
      cacheClearTimeoutRef.current = setTimeout(() => {
        cacheClearTimeoutRef.current = null;
        clearCachedDetail();
      }, DETAIL_CACHE_CLEAR_FALLBACK_MS);
    }

    return clearCacheTimeout;
  }, [cachedDetail, clearCachedDetail, clearCacheTimeout, open]);

  useEffect(() => {
    if (!open) {
      clearGestureResetTimeout();
      clearGestureStyles();
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- Closing navigation owns committed gesture cleanup. */
      setIsDragging(false);
    }

    return clearGestureResetTimeout;
  }, [clearGestureResetTimeout, clearGestureStyles, open]);

  const handleDetailTransitionEnd = (
    event: TransitionEvent<HTMLDivElement>,
  ) => {
    if (
      open ||
      event.target !== detailPaneRef.current ||
      event.propertyName !== "transform"
    ) {
      return;
    }

    clearCacheTimeout();
    clearCachedDetail();
  };

  const handleDetailPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    suppressClickRef.current = null;

    if (gestureResetTimeoutRef.current !== null) {
      clearGestureResetTimeout();
      clearGestureStyles();
      setIsDragging(false);
    }

    if (!open || !event.isPrimary || event.pointerType === "mouse") {
      return;
    }

    const pane = detailPaneRef.current;
    if (pane === null) {
      return;
    }

    const rect = pane.getBoundingClientRect();
    const scale =
      parseFloat(
        getComputedStyle(pane).getPropertyValue("--glint-ui-scale"),
      ) || 1;
    const edge = SWIPE_EDGE_WIDTH_PX * scale;

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      claimed: false,
      lastX: event.clientX,
      lastT: event.timeStamp,
      prevX: event.clientX,
      prevT: event.timeStamp,
      width: rect.width,
      candidate: event.clientX - rect.left <= edge,
    };
  };

  const handleDetailPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const gesture = gestureRef.current;
    if (!gesture.candidate || gesture.pointerId !== event.pointerId) {
      return;
    }

    const rawDx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (
      !gesture.claimed &&
      rawDx > SWIPE_CLAIM_DISTANCE_PX &&
      Math.abs(rawDx) > Math.abs(dy)
    ) {
      gesture.claimed = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setIsDragging(true);
    }

    if (!gesture.claimed || gesture.width <= 0) {
      return;
    }

    const dx = Math.min(Math.max(rawDx, 0), gesture.width);
    const progress = dx / gesture.width;

    if (detailPaneRef.current !== null) {
      detailPaneRef.current.style.transform = `translateX(${dx}px)`;
    }
    if (listPaneRef.current !== null) {
      listPaneRef.current.style.transform = `translateX(${-30 + progress * 30}%)`;
    }
    if (listDimRef.current !== null) {
      listDimRef.current.style.opacity = String(1 - progress);
    }

    gesture.prevX = gesture.lastX;
    gesture.prevT = gesture.lastT;
    gesture.lastX = event.clientX;
    gesture.lastT = event.timeStamp;
  };

  const finishDetailGesture = (
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ) => {
    const gesture = gestureRef.current;
    if (gesture.pointerId !== event.pointerId) {
      return;
    }

    gestureRef.current = {
      ...gesture,
      pointerId: null,
      claimed: false,
      candidate: false,
    };

    if (!gesture.claimed) {
      return;
    }

    const dx = Math.min(
      Math.max(event.clientX - gesture.startX, 0),
      gesture.width,
    );
    const velocitySampleDuration = gesture.lastT - gesture.prevT;
    const velocity =
      velocitySampleDuration > 0
        ? (gesture.lastX - gesture.prevX) / velocitySampleDuration
        : 0;
    const hasRecentVelocitySample =
      event.timeStamp - gesture.lastT < SWIPE_VELOCITY_RECENCY_MS;
    const shouldCommit =
      !cancelled &&
      (dx > SWIPE_COMMIT_DISTANCE_RATIO * gesture.width ||
        (hasRecentVelocitySample &&
          velocity > SWIPE_COMMIT_VELOCITY_PX_PER_MS));

    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (shouldCommit) {
      suppressClickRef.current = Date.now();
      onBack();
      gestureResetTimeoutRef.current = setTimeout(() => {
        gestureResetTimeoutRef.current = null;
        clearGestureStyles();
        setIsDragging(false);
      }, SWIPE_COMMIT_STYLE_FALLBACK_MS);
      return;
    }

    clearGestureStyles();
    setIsDragging(false);
  };

  if (
    open &&
    detailKey !== null &&
    detail !== null &&
    (cachedDetail?.detailKey !== detailKey || cachedDetail.detail !== detail)
  ) {
    setCachedDetail({ detailKey, detail });
  }

  const renderedDetail = open ? detail : cachedDetail?.detail;

  return (
    <div
      data-component={dataComponent}
      data-slot="sliding-card"
      data-source-component={SLIDING_CARD_SOURCE_COMPONENT}
      className={styles.slidingCard}
    >
      <div
        data-component={`${dataComponent}_stage`}
        data-slot="stage"
        className={styles.stage}
      >
        <div
          ref={listPaneRef}
          data-component={`${dataComponent}_stage_list-pane`}
          data-slot="list-pane"
          aria-hidden={open}
          inert={open || undefined}
          className={cn(
            styles.listPane,
            open && styles.listPaneOpen,
            isDragging && styles.dragging,
          )}
          onFocusCapture={(event) => {
            if (event.target instanceof HTMLElement) {
              lastListFocusRef.current = event.target;
            }
          }}
        >
          {list}
          <div
            ref={listDimRef}
            data-slot="list-dim"
            aria-hidden="true"
            className={cn(
              styles.listDim,
              open && styles.listDimOpen,
              isDragging && styles.dragging,
            )}
          />
        </div>

        <div
          ref={detailPaneRef}
          data-component={`${dataComponent}_stage_detail-pane`}
          data-slot="detail-pane"
          aria-hidden={!open}
          inert={!open || undefined}
          className={cn(
            styles.detailPane,
            open && styles.detailPaneOpen,
            isDragging && styles.dragging,
          )}
          onClickCapture={(event) => {
            const committedAt = suppressClickRef.current;
            suppressClickRef.current = null;
            if (committedAt === null) {
              return;
            }

            if (Date.now() - committedAt >= SWIPE_CLICK_SUPPRESSION_MS) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerCancel={(event) => finishDetailGesture(event, true)}
          onPointerDown={handleDetailPointerDown}
          onPointerMove={handleDetailPointerMove}
          onPointerUp={(event) => finishDetailGesture(event, false)}
          onTransitionEnd={handleDetailTransitionEnd}
        >
          <div
            data-component={`${dataComponent}_stage_detail-pane_header`}
            data-slot="detail-pane-header"
            className={styles.detailHeader}
          >
            <button
              ref={backButtonRef}
              type="button"
              aria-label={`${backLabel} 목록으로 돌아가기`}
              data-component={`${dataComponent}_stage_detail-pane_header_back`}
              data-slot="detail-pane-header-back"
              className={styles.backButton}
              onClick={onBack}
            >
              <ChevronLeft
                aria-hidden="true"
                data-slot="detail-pane-header-back-icon"
                className={styles.backIcon}
              />
              {backLabel}
            </button>
            {detailHeaderTrailing != null ? (
              <div
                data-slot="detail-pane-header-trailing"
                className={styles.detailHeaderTrailing}
              >
                {detailHeaderTrailing}
              </div>
            ) : null}
          </div>

          <div
            ref={detailBodyRef}
            data-component={`${dataComponent}_stage_detail-pane_body`}
            data-slot="detail-pane-body"
            className={styles.detailBody}
          >
            {renderedDetail}
          </div>
        </div>
      </div>
    </div>
  );
}
