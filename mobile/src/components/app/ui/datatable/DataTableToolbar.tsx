"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DataTableToolbarProps } from "./types";

export function DataTableToolbar({
  "data-component": dataComponent,
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSearchIconClick = () => {
    setIsSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const handleSearchBlur = () => {
    if (!searchQuery.trim()) {
      setIsSearchOpen(false);
    }
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(event.target.value);
  };

  const handleFilterSelect = (value: string) => {
    // Convert "all" back to null for the parent component
    onFilterChange?.(value === "all" ? null : value);
  };

  return (
    <div
      data-component={dataComponent}
      className="flex items-center justify-end gap-2 py-2"
    >
      {/* Search */}
      {searchEnabled && (
        isSearchOpen ? (
          <Input
            ref={searchInputRef}
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={handleSearchChange}
            onBlur={handleSearchBlur}
            autoFocus
            className="w-[100px] h-10 transition-all"
          />
        ) : (
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-[100px]"
            onClick={handleSearchIconClick}
            aria-label="search"
          >
            <Search className="h-4 w-4" />
          </Button>
        )
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
