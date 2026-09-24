"use client";

import { useMenu } from "@/hooks/use-menu";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  searchable?: boolean;
  /** Visually hide the field label (kept for a11y via aria on the trigger). */
  hideLabel?: boolean;
};

export function FilterSelect({
  label,
  value,
  options,
  allLabel,
  onChange,
  searchable = false,
  hideLabel = false,
}: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const { menuId, rootRef } = useMenu({
    open,
    onClose: () => {
      setOpen(false);
      setSearch("");
    },
  });

  // Focus search after open so one click → type (wait a frame for popover paint).
  useEffect(() => {
    if (!open || !searchable) return;
    let cancelled = false;
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        searchRef.current?.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(id);
    };
  }, [open, searchable]);

  const matched = options.find((option) => option.id === value);
  const [sticky, setSticky] = useState({ id: "", label: allLabel });
  if (value && matched && (sticky.id !== value || sticky.label !== matched.label)) {
    setSticky({ id: value, label: matched.label });
  }
  if (!value && sticky.id) {
    setSticky({ id: "", label: allLabel });
  }
  const current = value
    ? matched?.label ?? (sticky.id === value ? sticky.label : allLabel)
    : allLabel;
  const resolvedOptions = useMemo(() => {
    if (!value || options.some((option) => option.id === value)) return options;
    if (sticky.id === value && sticky.label) {
      return [{ id: sticky.id, label: sticky.label }, ...options];
    }
    return options;
  }, [options, sticky.id, sticky.label, value]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return resolvedOptions;
    return resolvedOptions.filter((option) => option.label.toLowerCase().includes(needle));
  }, [resolvedOptions, search]);

  return (
    <div
      className="smp-filter-select"
      ref={rootRef}
      data-open={open ? "true" : "false"}
    >
      <span className="smp-field__label" data-hidden={hideLabel ? "true" : undefined}>
        {label}
      </span>
      <button
        type="button"
        className="smp-filter-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={hideLabel ? label : undefined}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span className="smp-filter-select__value">{current}</span>
        <ChevronDown size={14} strokeWidth={1.75} />
      </button>
      <div className="smp-filter-select__popover" id={menuId} inert={!open}>
        <div className="smp-filter-select__menu" role="listbox" aria-label={label}>
          {searchable ? (
            <input
              ref={searchRef}
              className="smp-filter-select__search"
              type="search"
              value={search}
              placeholder={`Search ${label.toLowerCase()}`}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              onClick={(event) => event.stopPropagation()}
            />
          ) : null}
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
          {visible.map((option) => (
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
                setSearch("");
              }}
            >
              <span>{option.label}</span>
              {value === option.id ? <Check size={14} strokeWidth={2} /> : null}
            </button>
          ))}
          {searchable && visible.length === 0 ? (
            <p className="smp-filter-select__empty">No {label.toLowerCase()} match</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
