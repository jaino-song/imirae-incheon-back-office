"use client";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { STATUS_SURFACE } from "@/components/app/ui/status-surface";
import { X } from "lucide-react";

/**
 * Desktop toasts sit in the bottom-right corner, out of the way of the sidebar
 * and the primary content column. Mobile centres them above the tab bar
 * instead — see the mobile Toaster.
 */
const TOASTER_POSITION = "fixed bottom-6 right-6 w-full max-w-[420px]";

/**
 * Above the dialog layer (z-50). At the same z-index a dialog portalled to the
 * end of the body wins on DOM order, which hid every toast raised from inside a
 * modal.
 */
const TOASTER_LAYER = "z-[1000]";

const VARIANT_SURFACE = {
  // A plain toast is a floating surface rather than a state, so it keeps the
  // white card colour. The neutral status tint is close enough to the page
  // background that it would read as a smudge rather than a card.
  default: "bg-card border-v3-border text-v3-text",
  success: STATUS_SURFACE.success,
  destructive: STATUS_SURFACE.danger,
} as const;

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      // The container is the live region, not the individual toast: a region
      // has to exist before content lands in it to be announced reliably.
      role="status"
      aria-live="polite"
      className={cn(
        TOASTER_POSITION,
        TOASTER_LAYER,
        "pointer-events-none flex flex-col gap-2",
      )}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "group pointer-events-auto relative flex items-center justify-between gap-4 rounded-lg border p-4 pr-8 shadow-lg transition-all duration-300",
            "animate-in slide-in-from-bottom-2 fade-in-0",
            VARIANT_SURFACE[toast.variant ?? "default"],
          )}
        >
          <div className="grid gap-1">
            {toast.title && (
              <p className="text-sm font-semibold">{toast.title}</p>
            )}
            {toast.description && (
              <p className="text-sm opacity-90">{toast.description}</p>
            )}
          </div>
          {toast.action}
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="알림 닫기"
            className="absolute right-2 top-2 rounded-md p-1 opacity-0 transition-opacity focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
