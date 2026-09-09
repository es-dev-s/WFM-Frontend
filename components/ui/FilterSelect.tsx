"use client";

import { useMenu } from "@/hooks/use-menu";
import { Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

export type FilterOption = {
  id: string;
  label: string;
};

type FilterSelectProps = {
  label: string;
  value: string;
  options: FilterOption[];
  allLabel: string;
  onChange: (value: string) => void;
};

export function FilterSelect({
  label,
  value,
  options,
  allLabel,
  onChange,
}: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const { menuId, rootRef } = useMenu({
    open,
    onClose: () => setOpen(false),
  });

  const current = useMemo(
    () => options.find((option) => option.id === value)?.label ?? allLabel,
    [allLabel, options, value],
  );

  return (
    <div
      className="smp-filter-select"
      ref={rootRef}
      data-open={open ? "true" : "false"}
    >
      <span className="smp-field__label">{label}</span>
      <button
        type="button"
        className="smp-filter-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span className="smp-filter-select__value">{current}</span>
        <ChevronDown size={14} strokeWidth={1.75} />
      </button>
      <div className="smp-filter-select__popover" id={menuId} inert={!open}>
        <div className="smp-filter-select__menu" role="listbox" aria-label={label}>
          <button
            type="button"
            className="smp-filter-select__option"
            role="option"
            aria-selected={value === ""}
            data-active={value === "" ? "true" : "false"}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            <span>{allLabel}</span>
            {value === "" ? <Check size={14} strokeWidth={2} /> : null}
          </button>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="smp-filter-select__option"
              role="option"
              aria-selected={value === option.id}
              data-active={value === option.id ? "true" : "false"}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {value === option.id ? <Check size={14} strokeWidth={2} /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
