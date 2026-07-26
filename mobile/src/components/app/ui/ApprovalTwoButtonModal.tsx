"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "ApprovalTwoButtonModal";
interface ApprovalTwoButtonModalProps {
  "data-component": string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
  cancelLabel?: ReactNode;
  approvalLabel: ReactNode;
  pendingLabel?: ReactNode;
  onApprove: () => void | Promise<void>;
  isPending?: boolean;
  approvalDisabled?: boolean;
  approvalVariant?: "positive" | "destructive";
  isDescriptionVisuallyHidden?: boolean;
  size?: "compact" | "detail";
}

export function ApprovalTwoButtonModal({
  "data-component": dataComponent,
  open,
  onOpenChange,
  title,
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
}: ApprovalTwoButtonModalProps) {
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return;
    onOpenChange(nextOpen);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-component={sub("overlay")}
          className="fixed inset-0 z-[250] bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        />
        <DialogPrimitive.Content
          data-component={dataComponent}
          data-source-component={SOURCE_COMPONENT}
          onOpenAutoFocus={(event) => {
            if (size === "detail") event.preventDefault();
          }}
          className={cn(
            "fixed left-1/2 top-1/2 z-[251] flex w-[calc(min(100vw,390px)-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[24px] border-0 bg-v3-dim-white p-5 shadow-[0_20px_60px_hsla(214,50%,20%,0.18)] outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            size === "compact" && "min-h-[176px] max-w-[358px]",
            size === "detail" && "max-h-[calc(100dvh-2rem)] max-w-[358px]",
          )}
        >
          <div
            data-component={sub("header")}
            className={cn(
              "flex flex-col justify-center gap-1 text-left",
              size === "compact" && "flex-1",
            )}
          >
            <DialogPrimitive.Title
              data-component={sub("title")}
              className="text-left text-[calc(16px*var(--v3-ui-scale,1))] font-bold leading-[calc(24px*var(--v3-ui-scale,1))] text-v3-dark"
            >
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description
              data-component={sub("description")}
              className={cn(
                "mt-0 text-[calc(14px*var(--v3-ui-scale,1))] leading-[calc(20px*var(--v3-ui-scale,1))] text-v3-text-muted",
                isDescriptionVisuallyHidden && "sr-only",
              )}
            >
              {description}
            </DialogPrimitive.Description>
          </div>

          {children ? (
            <div
              data-component={sub("body")}
              className={cn("min-h-0", size === "detail" && "overflow-y-auto")}
            >
              {children}
            </div>
          ) : null}

          <div data-component={sub("footer")} className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="v3-outline"
              size="sm"
              className="h-11 w-1/2 text-sm"
              data-component={sub("cancel")}
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={approvalVariant === "destructive" ? "destructive" : "v3"}
              size="sm"
              className="h-11 w-1/2 rounded-full text-sm"
              data-component={sub("approve")}
              disabled={isPending || approvalDisabled}
              aria-busy={isPending || undefined}
              onClick={() => void onApprove()}
            >
              {isPending ? (pendingLabel ?? approvalLabel) : approvalLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
