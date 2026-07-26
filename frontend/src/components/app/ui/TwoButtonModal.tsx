"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ApprovalModalSize = "compact" | "detail";
type ApprovalButtonVariant = "positive" | "destructive";

const SOURCE_COMPONENT = "TwoButtonModal";
const DEFAULT_DATA_COMPONENT = "desktop_v3_two-button-modal";

export interface TwoButtonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  titleAriaLabel?: string;
  description: ReactNode;
  children?: ReactNode;
  cancelLabel?: ReactNode;
  approvalLabel: ReactNode;
  pendingLabel?: ReactNode;
  onApprove: () => void;
  isPending?: boolean;
  approvalDisabled?: boolean;
  approvalVariant?: ApprovalButtonVariant;
  isDescriptionVisuallyHidden?: boolean;
  size?: ApprovalModalSize;
  "data-component"?: string;
  dataComponent?: string;
  headerDataComponent?: string;
  titleDataComponent?: string;
  descriptionDataComponent?: string;
  bodyDataComponent?: string;
  footerDataComponent?: string;
  cancelButtonDataComponent?: string;
  approvalButtonDataComponent?: string;
}

export function TwoButtonModal({
  open,
  onOpenChange,
  title,
  titleAriaLabel,
  description,
  children,
  cancelLabel = "취소",
  approvalLabel,
  pendingLabel,
  onApprove,
  isPending = false,
  approvalDisabled = false,
  approvalVariant = "positive",
  isDescriptionVisuallyHidden = true,
  size = "compact",
  "data-component": canonicalDataComponent,
  dataComponent: legacyDataComponent,
  headerDataComponent,
  titleDataComponent,
  descriptionDataComponent,
  bodyDataComponent,
  footerDataComponent,
  cancelButtonDataComponent,
  approvalButtonDataComponent,
}: TwoButtonModalProps) {
  const canonicalDataComponentBase = canonicalDataComponent || undefined;
  const dataComponent =
    canonicalDataComponentBase ?? legacyDataComponent ?? DEFAULT_DATA_COMPONENT;
  const sub = (suffix: string) =>
    canonicalDataComponentBase
      ? `${canonicalDataComponentBase}_${suffix}`
      : `${dataComponent}-${suffix}`;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-component={dataComponent}
        data-source-component={SOURCE_COMPONENT}
        className={cn(
          "flex flex-col",
          size === "compact" && "aspect-[5/3] sm:max-w-[300px]",
          size === "detail" && "min-h-0 sm:max-w-[420px]",
        )}
      >
        <DialogHeader
          data-component={headerDataComponent ?? sub("header")}
          className={cn(
            "gap-1 justify-center pb-0 text-left sm:text-left",
            size === "compact" && "flex-1",
          )}
        >
          <DialogTitle
            data-component={titleDataComponent ?? sub("title")}
            aria-label={titleAriaLabel}
            className="text-center text-[calc(16px*var(--v3-ui-scale,1))] leading-[calc(24px*var(--v3-ui-scale,1))]"
          >
            {title}
          </DialogTitle>
          <DialogDescription
            data-component={descriptionDataComponent ?? sub("description")}
            className={cn(
              "mt-0 text-[calc(14px*var(--v3-ui-scale,1))] leading-[calc(20px*var(--v3-ui-scale,1))] text-v3-text-muted",
              isDescriptionVisuallyHidden && "sr-only",
            )}
          >
            {description}
          </DialogDescription>
        </DialogHeader>

        {children ? (
          <div
            data-component={bodyDataComponent ?? sub("body")}
            className={cn("min-h-0", size === "detail" && "overflow-y-auto")}
          >
            {children}
          </div>
        ) : null}

        <DialogFooter
          data-component={footerDataComponent ?? sub("footer")}
          className="flex-row pt-0 sm:justify-stretch"
        >
          <Button
            type="button"
            variant="neutral"
            size="sm"
            className="w-1/2"
            data-component={cancelButtonDataComponent ?? sub("cancel")}
            disabled={isPending}
            onClick={() => handleOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={approvalVariant}
            size="sm"
            className="w-1/2"
            data-component={approvalButtonDataComponent ?? sub("approve")}
            disabled={isPending || approvalDisabled}
            aria-busy={isPending || undefined}
            onClick={onApprove}
          >
            {isPending ? (pendingLabel ?? approvalLabel) : approvalLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
