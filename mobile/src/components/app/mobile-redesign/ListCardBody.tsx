import type { ReactNode, RefObject } from "react";

const SOURCE_COMPONENT = "ListCardBody";
export interface ListCardBodyProps {
  "data-component": string;
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
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
    >
      {children}
    </div>
  );
}
