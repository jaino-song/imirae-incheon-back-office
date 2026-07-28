"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DataTablePaginationProps } from "./types";

export function DataTablePagination({
  "data-component": dataComponent,
  count,
  page,
  rowsPerPage,
  onPageChange,
  disabled = false,
}: DataTablePaginationProps) {
  const totalPages = Math.ceil(count / rowsPerPage);
  const startItem = page * rowsPerPage + 1;
  const endItem = Math.min((page + 1) * rowsPerPage, count);

  const canGoPrevious = page > 0;
  const canGoNext = page < totalPages - 1;

  return (
    <div data-component={dataComponent} className="flex items-center justify-end gap-4 py-2 px-2">
      <span className="text-sm text-muted-foreground">
        {count > 0 ? `${startItem}-${endItem} / ${count}` : "0개"}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8",
            !canGoPrevious && "opacity-50"
          )}
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || !canGoPrevious}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-8 w-8",
            !canGoNext && "opacity-50"
          )}
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || !canGoNext}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
