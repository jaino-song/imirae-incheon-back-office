"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface SearchBoxProps {
  /** Caller-context canonical value for the search box root. */
  "data-component"?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export function SearchBox({ "data-component": dataComponent, placeholder, value, onChange }: SearchBoxProps) {
  return (
    <div data-component={dataComponent} data-slot="search-box" className="group flex items-center gap-3 rounded-2xl bg-white px-5 py-3 shadow-v3 border border-v3-border transition-all duration-200 focus-within:shadow-v3-hover focus-within:scale-[1.01]">
      <Search size={18} className="text-v3-text-muted shrink-0" />
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-auto w-full border-none bg-transparent p-0 text-[0.85rem] outline-none placeholder:text-v3-text-muted focus-visible:ring-0 focus-visible:ring-offset-0"
      />
    </div>
  );
}
