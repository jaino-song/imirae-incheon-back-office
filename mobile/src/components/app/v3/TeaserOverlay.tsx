"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface TeaserOverlayProps {
  /** Caller-context canonical value. Composites pass `${base}_teaser-overlay`. */
  "data-component"?: string;
  onClick: () => void;
  label?: string;
  className?: string;
}

export function TeaserOverlay({
  "data-component": dataComponent,
  onClick,
  label = "탭하여 더 보기",
  className,
}: TeaserOverlayProps) {
  return (
    <button
      data-component={dataComponent}
      data-slot="teaser-overlay"
      onClick={onClick}
      className={cn("absolute inset-x-0 bottom-0 h-36 cursor-pointer group", className)}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
      <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-1 text-v3-text-muted text-sm group-hover:text-v3-primary transition-colors">
        <span>{label}</span>
        <ChevronDown className="w-5 h-5 animate-ball-bounce" />
      </div>
    </button>
  );
}
