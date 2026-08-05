"use client";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      data-component="mobile_shell_toaster"
      className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] left-1/2 z-[1000] flex w-[calc(100vw-32px)] max-w-[360px] -translate-x-1/2 flex-col-reverse gap-2"
    >
      {toasts.map((toast) => (
        <div
          data-component="mobile_shell_toaster_toast"
          key={toast.id}
          className={cn(
            "pointer-events-auto relative flex items-center justify-between gap-4 rounded-2xl border p-4 pr-8 shadow-lg transition-all duration-300",
            toast.open === false
              ? "animate-out slide-out-to-bottom-2 fade-out-0"
              : "animate-in slide-in-from-bottom-2 fade-in-0",
            toast.variant === "destructive"
              ? "border-destructive/50 bg-destructive text-destructive-foreground"
              : "border-border bg-background text-foreground"
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
            className="absolute right-2 top-2 rounded-2xl p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
