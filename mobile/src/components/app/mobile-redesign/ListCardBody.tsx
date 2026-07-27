"use client";

import { useState } from "react";
import type { ReactNode, RefObject, UIEvent } from "react";

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
  const [hasTopOverflow, setHasTopOverflow] = useState(false);
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    setHasTopOverflow(event.currentTarget.scrollTop > 1);
  };

  return (
    <div
      ref={scrollRef}
      className={`list-card-scroll${hasTopOverflow ? " has-top-overflow" : ""}`}
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      onScroll={handleScroll}
    >
      {children}
    </div>
  );
}
