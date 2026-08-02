"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode, TransitionEvent } from "react";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";

import styles from "./sliding-card.module.css";

const SLIDING_CARD_SOURCE_COMPONENT = "SlidingCard";
const DETAIL_CACHE_CLEAR_FALLBACK_MS = 450;

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
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const previousOpenRef = useRef(false);
  const cachedDetailRef = useRef<CachedDetail | null>(null);
  const cacheClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
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

  useEffect(() => {
    cachedDetailRef.current = cachedDetail;
  }, [cachedDetail]);

  useEffect(() => {
    const detailBody = detailBodyRef.current;
    if (typeof detailBody?.scrollTo === "function") {
      detailBody.scrollTo(0, 0);
    }
  }, [detailKey]);

  useEffect(() => {
    const wasOpen = previousOpenRef.current;

    if (!wasOpen && open) {
      restoreFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      backButtonRef.current?.focus();
    } else if (wasOpen && !open) {
      const elementToRestore = restoreFocusRef.current;
      if (elementToRestore?.isConnected) {
        elementToRestore.focus();
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
          data-component={`${dataComponent}_stage_list-pane`}
          data-slot="list-pane"
          aria-hidden={open}
          inert={open || undefined}
          className={cn(styles.listPane, open && styles.listPaneOpen)}
        >
          {list}
          <div
            data-slot="list-dim"
            aria-hidden="true"
            className={cn(styles.listDim, open && styles.listDimOpen)}
          />
        </div>

        <div
          ref={detailPaneRef}
          data-component={`${dataComponent}_stage_detail-pane`}
          data-slot="detail-pane"
          aria-hidden={!open}
          inert={!open || undefined}
          className={cn(styles.detailPane, open && styles.detailPaneOpen)}
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
