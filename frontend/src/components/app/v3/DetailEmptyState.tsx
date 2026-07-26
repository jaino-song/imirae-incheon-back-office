import type { LucideIcon } from "lucide-react";

import { ListEmptyState } from "./ListEmptyState";

export interface DetailEmptyStateProps {
  message: string;
  icon?: LucideIcon;
  className?: string;
}

export function DetailEmptyState({
  message,
  icon: Icon,
  className,
}: DetailEmptyStateProps) {
  return (
    <ListEmptyState
      icon={Icon}
      message={message}
      className={className}
    />
  );
}
