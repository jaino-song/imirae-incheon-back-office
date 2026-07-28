import type { LucideIcon } from "lucide-react";

import { DetailPanel } from "./DetailPanel";
import { ListEmptyState } from "./ListEmptyState";

export interface EmptyStateProps {
  icon?: LucideIcon;
  message: string;
  className?: string;
}

export function EmptyState({ icon: Icon, message, className }: EmptyStateProps) {
  return (
    <DetailPanel data-component="desktop_v3_split-layout_detail-panel"
      emptyState={
        <ListEmptyState
          icon={Icon}
          message={message}
          className={className}
        />
      }
    >
      {null}
    </DetailPanel>
  );
}
