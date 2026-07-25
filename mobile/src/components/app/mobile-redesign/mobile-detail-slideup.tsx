"use client";

import { useId } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { MobileDetailStack } from "./detail-sheet";
import styles from "./mobile-detail-slideup.module.css";

const SLIDE_UP_CLOSE_ANIMATION_MS = 300;

type MobileDetailSlideUpAction = {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  dataComponent?: string;
  className?: string;
};

export function MobileDetailSlideUp({
  name,
  open,
  onClose,
  title,
  children,
  secondaryAction,
  primaryAction,
  closeLabel = "상세 닫기",
  closeDisabled,
  closeAnimationMs = SLIDE_UP_CLOSE_ANIMATION_MS,
}: {
  name: string;
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  secondaryAction?: MobileDetailSlideUpAction;
  primaryAction?: MobileDetailSlideUpAction;
  closeLabel?: string;
  closeDisabled?: boolean;
  closeAnimationMs?: number;
}) {
  const titleId = useId();
  const hasActions = Boolean(secondaryAction || primaryAction);

  return (
    <MobileDetailStack data-component="mobile_mobile-redesign_detail-sheet_stack"
      name={name}
      isOpen={open}
      onClose={onClose}
      list={null}
      sectionDataComponent={`${name}-shell`}
      sectionClassName={cn(styles.shell, open && styles.shellOpen)}
      sectionAriaHidden={!open}
      stackDataComponent={`mobile-${name}-stack`}
      stackClassName={styles.stack}
      listDataComponent={`mobile-${name}-list-page`}
      listClassName={styles.listStub}
      scrimDataComponent={`mobile-${name}-detail-scrim`}
      scrimClassName={styles.scrim}
      scrimDisabled={!open || closeDisabled}
      detailDataComponent={name}
      detailClassName={styles.detail}
      detailRole="dialog"
      detailAriaModal
      detailAriaLabelledBy={titleId}
      sheetHeaderDataComponent={`${name}-sheet-header`}
      sheetHeaderClassName={styles.sheetHeader}
      closeLabel={closeLabel}
      closeDisabled={closeDisabled}
    >
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key={`${name}-content`}
            className={cn("detail-body detail-column", styles.body)}
            data-component={`${name}-content`}
            exit={{ opacity: 0.999 }}
            transition={{ duration: closeAnimationMs / 1000 }}
          >
            <header className={styles.header} data-component={`${name}-header`}>
              <div className={styles.titleBlock}>
                <h2 id={titleId} className={styles.title}>{title}</h2>
              </div>
            </header>

            {children}

            {hasActions ? (
              <footer className={styles.footer} data-component={`${name}-actions`}>
                {secondaryAction ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    width="lg"
                    onClick={secondaryAction.onClick}
                    disabled={secondaryAction.disabled}
                    data-component={secondaryAction.dataComponent}
                    className={cn(styles.actionButton, styles.secondaryAction, secondaryAction.className)}
                  >
                    {secondaryAction.label}
                  </Button>
                ) : null}
                {primaryAction ? (
                  <Button
                    type="button"
                    variant="default"
                    size="md"
                    width="lg"
                    onClick={primaryAction.onClick}
                    disabled={primaryAction.disabled}
                    data-component={primaryAction.dataComponent}
                    className={cn(styles.actionButton, styles.primaryAction, primaryAction.className)}
                  >
                    {primaryAction.busy ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      primaryAction.label
                    )}
                  </Button>
                ) : null}
              </footer>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MobileDetailStack>
  );
}
