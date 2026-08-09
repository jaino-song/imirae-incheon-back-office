"use client";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { STATUS_SURFACE } from "@/components/app/ui/status-surface";
import { X } from "lucide-react";

/**
 * Mobile toasts sit at the bottom centre, clear of the tab bar and the home
 * indicator, so the message never lands under a thumb. Desktop puts them in the
 * bottom-right corner instead — see the frontend Toaster.
 */
const TOASTER_POSITION =
  "fixed bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] left-1/2 w-[calc(100vw-32px)] max-w-[360px] -translate-x-1/2";

/**
 * Above the detail sheet and any dialog, so a toast raised from inside one is
 * never buried behind it.
 */
const TOASTER_LAYER = "z-[1000]";

const VARIANT_SURFACE = {
  // A plain toast is a floating surface rather than a state, so it keeps the
  // white card colour. The neutral status tint is the same value as the page
  // background and would disappear against it.
  default: "bg-card border-v3-border text-v3-text",
  success: STATUS_SURFACE.success,
  destructive: STATUS_SURFACE.danger,
} as const;

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      data-component="mobile_shell_toaster"
      // The container is the live region, not the individual toast: a region
      // has to exist before content lands in it to be announced reliably.
      role="status"
      aria-live="polite"
      className={cn(
        TOASTER_POSITION,
        TOASTER_LAYER,
        "pointer-events-none flex flex-col-reverse gap-2",
      )}
    >
      {toasts.map((toast) => (
        <div
          data-component="mobile_shell_toaster_toast"
          key={toast.id}
          className={cn(
            "group pointer-events-auto relative flex items-center justify-between gap-4 rounded-2xl border p-4 pr-8 shadow-lg transition-all duration-300",
            toast.open === false
              ? "animate-out slide-out-to-bottom-2 fade-out-0"
              : "animate-in slide-in-from-bottom-2 fade-in-0",
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
            className="absolute right-2 top-2 rounded-2xl p-1 opacity-0 transition-opacity focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
