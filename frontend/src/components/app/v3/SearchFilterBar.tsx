"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

import { ExpandableSearch } from "./ExpandableSearch";

interface FilterOption {
  label: string;
  value: string;
}

interface SearchFilterBarProps {
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  filterOptions: FilterOption[];
  filterValue: string;
  onFilterChange: (value: string) => void;
  filterLabel?: string;
}

export function SearchFilterBar({
  searchPlaceholder,
  searchValue,
  onSearchChange,
  filterOptions,
  filterValue,
  onFilterChange,
  filterLabel = "필터",
}: SearchFilterBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeOption = filterOptions.find((o) => o.value === filterValue);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div data-component="desktop_v3_search-filter-bar" className="flex items-center gap-3 rounded-[50px] bg-white px-5 py-3 shadow-v3 border border-v3-border transition-all duration-200 focus-within:shadow-v3-hover animate-v3-slide-up">
      <ExpandableSearch
        placeholder={searchPlaceholder}
        value={searchValue}
        onChange={onSearchChange}
        expandedWidth="flex-1"
        className="min-w-0 flex-1"
      />

      <div className="h-5 w-px bg-v3-border shrink-0" />

      <div ref={dropdownRef} className="relative shrink-0">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-[0.8rem] font-medium text-v3-text hover:text-v3-primary transition-colors whitespace-nowrap"
        >
          <span className={activeOption?.value !== filterOptions[0]?.value ? "text-v3-primary" : ""}>
            {activeOption?.label || filterLabel}
          </span>
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-v3-hover border border-v3-border py-1.5 z-50 animate-v3-pop-in">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onFilterChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-4 py-2 text-[0.8rem] transition-colors ${
                  option.value === filterValue
                    ? "text-v3-primary font-semibold bg-v3-primary-light"
                    : "text-v3-text hover:bg-v3-dim-white"
                }`}
              >
                <span>{option.label}</span>
                {option.value === filterValue && <Check size={14} className="text-v3-primary" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
