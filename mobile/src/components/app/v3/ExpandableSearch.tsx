"use client";

import { useState, useRef } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface ExpandableSearchProps {
  /** Caller-context canonical value. Composites pass `${base}_search`. */
  "data-component"?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  expandedWidth?: string;
  className?: string;
}

export function ExpandableSearch({
  "data-component": dataComponent,
  value,
  onChange,
  placeholder = "검색...",
  expandedWidth = "w-20",
  className,
}: ExpandableSearchProps) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = () => {
    setExpanded((prev) => {
      if (!prev) setTimeout(() => inputRef.current?.focus(), 50);
      else onChange("");
      return !prev;
    });
  };

  const handleBlur = () => {
    if (!value) setExpanded(false);
  };

  return (
    <div data-component={dataComponent} data-slot="expandable-search" className={cn("flex items-center gap-1.5", className)}>
      <button
        onClick={handleToggle}
        className="flex h-[44px] w-[44px] items-center justify-center rounded-2xl hover:bg-v3-dim-white"
      >
        <Search className={expanded ? "hidden" : "w-[18px] h-[18px] text-v3-text-muted"} />
      </button>
      <Input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        style={{ border: "none", outline: "none", boxShadow: "none" }}
        className={cn(
          "h-auto border-none bg-transparent p-0 text-sm text-v3-dark caret-v3-primary placeholder:text-v3-text-muted/50 focus-visible:ring-0 focus-visible:ring-offset-0",
          expanded ? expandedWidth : "w-0"
        )}
      />
    </div>
  );
}
