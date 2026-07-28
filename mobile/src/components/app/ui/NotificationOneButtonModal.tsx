"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "NotificationOneButtonModal";
interface NotificationOneButtonModalProps {
  "data-component": string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  buttonLabel?: ReactNode;
  buttonVariant?: "positive" | "destructive" | "neutral";
  onAcknowledge: () => void | Promise<void>;
  isDescriptionVisuallyHidden?: boolean;
}

export function NotificationOneButtonModal({
  "data-component": dataComponent,
  open,
  onOpenChange,
  title,
  description,
  buttonLabel = "확인",
  buttonVariant = "positive",
  onAcknowledge,
  isDescriptionVisuallyHidden = true,
}: NotificationOneButtonModalProps) {
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;
  const resolvedButtonVariant = buttonVariant === "positive"
    ? "v3"
    : buttonVariant === "neutral"
      ? "v3-outline"
      : "destructive";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-component={sub("overlay")}
          className="fixed inset-0 z-[250] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        />
        <DialogPrimitive.Content
          data-component={dataComponent}
          data-source-component={SOURCE_COMPONENT}
          className="fixed left-1/2 top-1/2 z-[251] flex aspect-[5/3] max-h-[80vh] w-[calc(100vw-2.5rem)] max-w-[300px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-[28px] border-0 bg-v3-dim-white p-4 shadow-[0_20px_60px_hsla(214,50%,20%,0.15)] outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
        >
          <div
            data-component={sub("header")}
            className="flex flex-1 flex-col items-center justify-center gap-2 text-center"
          >
            <DialogPrimitive.Title
              data-component={sub("title")}
              className="text-[0.875rem] font-bold leading-5 text-v3-dark"
            >
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description
              data-component={sub("description")}
              className={cn(
                "text-[0.75rem] leading-5 text-v3-text-muted",
                isDescriptionVisuallyHidden && "sr-only",
              )}
            >
              {description}
            </DialogPrimitive.Description>
          </div>

          <Button
            type="button"
            variant={resolvedButtonVariant}
            size="sm"
            className="w-full rounded-full"
            data-component={sub("acknowledge")}
            onClick={() => void onAcknowledge()}
          >
            {buttonLabel}
          </Button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
