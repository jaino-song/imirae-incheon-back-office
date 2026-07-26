"use client";

import { Plus } from "lucide-react";

import { ExpandableSearch } from "@/components/app/v3/ExpandableSearch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DataTableToolbarProps } from "./types";

export function DataTableToolbar({
  searchEnabled = true,
  searchPlaceholder = "검색...",
  searchQuery,
  onSearchChange,
  filterOptions,
  filterValue,
  onFilterChange,
  filterAddAction,
  actions,
}: DataTableToolbarProps) {
  const handleFilterSelect = (value: string) => {
    // Convert "all" back to null for the parent component
    onFilterChange?.(value === "all" ? null : value);
  };

  return (
    <div
      data-component="desktop_v3_data-table_toolbar"
      className="flex items-center justify-end gap-2 py-2"
    >
      {/* Search */}
      {searchEnabled && (
        <ExpandableSearch
          value={searchQuery}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          expandedWidth="w-[100px]"
          className="h-10 items-center"
          openLabel="search"
          closeLabel="search"
        />
      )}

      {/* Filter */}
      {filterOptions && filterOptions.length > 0 && (
        <Select
          value={filterValue ?? "all"}
          onValueChange={handleFilterSelect}
        >
          <SelectTrigger className="w-[100px] [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:justify-end">
            <SelectValue placeholder="상태" />
          </SelectTrigger>
          <SelectContent position="popper" align="end" className="min-w-[100px] w-[100px]">
            {filterOptions.map((option) => (
              <SelectItem
                key={option.value ?? "all"}
                value={option.value ?? "all"}
                className="justify-center pr-2 [&_span[data-slot=select-item-indicator]]:hidden"
              >
                {option.label}
              </SelectItem>
            ))}
            {filterAddAction && (
              <>
                <div className="h-px bg-border my-1" />
                <Button
                  variant="ghost"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    filterAddAction.onClick();
                  }}
                  className="w-full justify-center gap-1 h-8 text-sm font-medium"
                >
                  <Plus className="h-4 w-4" />
                  추가
                </Button>
              </>
            )}
          </SelectContent>
        </Select>
      )}

      {/* Custom actions */}
      {actions}
    </div>
  );
}
