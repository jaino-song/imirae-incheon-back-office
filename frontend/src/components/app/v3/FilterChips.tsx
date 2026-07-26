"use client";

interface FilterChipsProps {
  items: { label: string; value: string }[];
  activeValue: string;
  onChange: (value: string) => void;
}

export function FilterChips({ items, activeValue, onChange }: FilterChipsProps) {
  return (
    <div data-component="desktop_v3_filter-chips" className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item.value}
          onClick={() => onChange(item.value)}
          className={`rounded-[50px] px-4 py-2 text-[0.8rem] font-medium transition-all duration-200 ${
            item.value === activeValue
              ? "bg-v3-primary text-white shadow-v3"
              : "bg-white text-v3-text shadow-v3 hover:translate-y-[-2px]"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
