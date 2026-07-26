import type { ReactNode } from "react";

const SOURCE_COMPONENT = "ListCardLoadMore";
// TODO(data-component): Remove legacy fallback data-component="mobile-redesign-list-load-more" after caller migration.

export interface ListCardLoadMoreProps {
  "data-component"?: string;
  children: ReactNode;
}

export function ListCardLoadMore({
  "data-component": dataComponent,
  children,
}: ListCardLoadMoreProps) {
  return (
    <div
      className="list-card-load-more"
      // TODO(data-component): Remove the legacy fallback after caller migration.
      data-component={dataComponent ?? "mobile-redesign-list-load-more"}
      data-source-component={SOURCE_COMPONENT}
    >
      {children}
    </div>
  );
}
