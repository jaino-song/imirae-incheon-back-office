import type { ReactNode } from "react";

const SOURCE_COMPONENT = "ListCardLoadMore";
export interface ListCardLoadMoreProps {
  "data-component": string;
  children: ReactNode;
}

export function ListCardLoadMore({
  "data-component": dataComponent,
  children,
}: ListCardLoadMoreProps) {
  return (
    <div
      className="list-card-load-more"
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
    >
      {children}
    </div>
  );
}
