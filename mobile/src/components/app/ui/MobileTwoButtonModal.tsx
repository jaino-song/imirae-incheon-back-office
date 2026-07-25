"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";

const SOURCE_COMPONENT = "MobileTwoButtonModal";

interface MobileTwoButtonModalProps {
  "data-component"?: string;
  open: boolean;
  title: string;
  description?: string;
  cancelLabel: string;
  confirmLabel: string;
  confirmVariant?: ButtonProps["variant"];
  actionOrder?: "confirm-cancel" | "cancel-confirm";
  loading?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

// 모바일 상세 시트(z-70, 내부 z-100) 위에 떠야 하므로 공유 Dialog(z-50) 대신 자체 z-[200] 오버레이로 구성한다.
// 폭은 390px 모바일 프레임에 맞춰 캡 (공유 DialogContent의 데스크탑용 sm:max-w-lg/vw 기본값 회피).
export function MobileTwoButtonModal({
  "data-component": dataComponent,
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  confirmVariant = "destructive",
  actionOrder = "confirm-cancel",
  loading = false,
  confirmDisabled = false,
  children,
  onOpenChange,
  onCancel,
  onConfirm,
}: MobileTwoButtonModalProps) {
  const legacyBase = "mobile-two-button-modal";
  const rootDataComponent = dataComponent ?? legacyBase;
  const sub = (suffix: string) =>
    dataComponent ? `${dataComponent}_${suffix}` : `${legacyBase}-${suffix}`;
  const confirmButton = (
    <Button
      data-component={sub("confirm-button")}
      variant={confirmVariant}
      onClick={() => void onConfirm()}
      disabled={loading || confirmDisabled}
      className="flex-1"
    >
      {confirmLabel}
    </Button>
  );
  const cancelButton = (
    <Button
      data-component={sub("cancel-button")}
      variant="outline"
      onClick={onCancel}
      disabled={loading}
      className="flex-1"
    >
      {cancelLabel}
    </Button>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-component={sub("overlay")}
          className="fixed inset-0 z-[200] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        />
        <DialogPrimitive.Content
          data-component={rootDataComponent}
          data-source-component={SOURCE_COMPONENT}
          aria-busy={loading}
          className="fixed top-1/2 left-1/2 z-[201] grid w-[calc(100vw-2.5rem)] max-w-[340px] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-2xl border bg-background p-5 shadow-lg outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
        >
          <div
            className="flex flex-col gap-1 text-left"
            data-component={sub("header")}
            data-testid="mobile-two-button-modal-header"
          >
            <DialogPrimitive.Title
              data-component={sub("title")}
              className="text-center text-base font-bold text-v3-dark"
            >
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description
              data-component={sub("description")}
              className="text-sm leading-5 text-v3-text-muted"
            >
              {description}
            </DialogPrimitive.Description>
          </div>
          {children}
          <div className="mt-2 flex gap-2" data-component={sub("actions")}>
            {actionOrder === "cancel-confirm" ? (
              <>
                {cancelButton}
                {confirmButton}
              </>
            ) : (
              <>
                {confirmButton}
                {cancelButton}
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
