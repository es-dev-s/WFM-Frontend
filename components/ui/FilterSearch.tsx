"use client";

import { Search } from "lucide-react";

type FilterSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function FilterSearch({
  value,
  onChange,
  placeholder = "Search",
}: FilterSearchProps) {
  return (
    <label className="smp-filter-search">
      <span className="smp-field__label">Search</span>
      <span className="smp-filter-search__field">
        <Search size={15} strokeWidth={1.75} />
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </span>
    </label>
  );
}
