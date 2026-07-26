import type { LucideIcon } from "lucide-react";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ListEmptyStateProps {
  message: string;
  icon?: LucideIcon;
  className?: string;
}

export function ListEmptyState({
  message,
  icon: Icon = History,
  className,
}: ListEmptyStateProps) {
  return (
    <div
      className={cn("flex min-h-full flex-1 items-center justify-center", className)}
    >
      <div data-component="desktop_v3_list-empty-state_copy" className="text-center text-v3-text-muted">
        <Icon className="mx-auto mb-[calc(12px*var(--glint-ui-scale,1))] h-[calc(48px*var(--glint-ui-scale,1))] w-[calc(48px*var(--glint-ui-scale,1))] opacity-30" />
        <p className="text-[calc(12.8px*var(--glint-ui-scale,1))]">{message}</p>
      </div>
    </div>
  );
}
