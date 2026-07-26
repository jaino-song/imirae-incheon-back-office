import type { ReactNode, RefObject } from "react";

const SOURCE_COMPONENT = "ListCardBody";
// TODO(data-component): Remove legacy fallback data-component="mobile-redesign-list-scroll" after caller migration.

export interface ListCardBodyProps {
  "data-component"?: string;
  children: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
}

export function ListCardBody({
  "data-component": dataComponent,
  children,
  scrollRef,
}: ListCardBodyProps) {
  return (
    <div
      ref={scrollRef}
      className="list-card-scroll"
      // TODO(data-component): Remove the legacy fallback after caller migration.
      data-component={dataComponent ?? "mobile-redesign-list-scroll"}
      data-source-component={SOURCE_COMPONENT}
    >
      {children}
    </div>
  );
}
