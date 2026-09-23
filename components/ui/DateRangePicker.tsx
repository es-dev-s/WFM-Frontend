"use client";

import { useMenu } from "@/hooks/use-menu";
import { datePresets, matchDatePreset } from "@/lib/date-presets";
import {
  formatRangeLabel,
  isoDateInZone,
  monthCells,
  monthTitle,
  normalizeDateRange,
  shiftMonth,
} from "@/lib/datetime";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

type DateRangePickerProps = {
  start: string;
  end: string;
  max?: string;
  onChange: (start: string, end: string) => void;
  variant?: "default" | "dashboard";
  showPresets?: boolean;
  applyOnFirstDay?: boolean;
};

export function DateRangePicker({
  start,
  end,
  max,
  onChange,
  variant = "default",
  showPresets = true,
  applyOnFirstDay,
}: DateRangePickerProps) {
  const today = useMemo(() => isoDateInZone(), []);
  const latest = max && max <= today ? max : today;
  const commitFirstDay = applyOnFirstDay ?? !showPresets;
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const [year, month] = (end || latest).split("-").map(Number);
    return { year, month };
  });
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);
  const [pickingEnd, setPickingEnd] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  const { menuId, rootRef } = useMenu({
    open,
    onClose: () => setOpen(false),
  });

  const cells = useMemo(
    () => monthCells(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );
  const presets = useMemo(() => datePresets(today), [today]);
  const activePreset = matchDatePreset(start, end, today);

  const previewStart =
    pickingEnd && hover && hover < draftStart ? hover : draftStart;
  const previewEnd = pickingEnd && hover
    ? hover < draftStart
      ? draftStart
      : hover
    : draftEnd;

  const rangeStart =
    previewStart <= previewEnd ? previewStart : previewEnd;
  const rangeEnd = previewStart <= previewEnd ? previewEnd : previewStart;

  const canPrev = `${cursor.year}-${String(cursor.month).padStart(2, "0")}` > "2000-01";
  const nextCursor = shiftMonth(cursor.year, cursor.month, 1);
  const canNext =
    `${nextCursor.year}-${String(nextCursor.month).padStart(2, "0")}` <=
    latest.slice(0, 7);

  const openPicker = () => {
    const [year, month] = (end || latest).split("-").map(Number);
    setCursor({ year, month });
    setDraftStart(start);
    setDraftEnd(end);
    setPickingEnd(false);
    setHover(null);
    setOpen(true);
  };

  const apply = (nextStart: string, nextEnd: string) => {
    const next = normalizeDateRange(nextStart, nextEnd, latest);
    setDraftStart(next.start);
    setDraftEnd(next.end);
    setPickingEnd(false);
    setOpen(false);
    if (next.start === start && next.end === end) return;
    onChange(next.start, next.end);
  };

  const onDayClick = (iso: string) => {
    if (iso > latest) return;
    if (!pickingEnd) {
      setDraftStart(iso);
      setDraftEnd(iso);
      setPickingEnd(true);
      if (commitFirstDay) apply(iso, iso);
      return;
    }
    apply(draftStart, iso);
  };

  const isDashboard = variant === "dashboard";

  return (
    <div
      className="smp-range"
      ref={rootRef}
      data-open={open ? "true" : "false"}
      data-variant={variant}
    >
      {!isDashboard ? <span className="smp-field__label">Dates</span> : null}
      <button
        type="button"
        className={isDashboard ? "smp-dashboard-date__trigger" : "smp-range__trigger"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Date range ${formatRangeLabel(start, end)}`}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <CalendarDays size={18} strokeWidth={1.75} />
        {!isDashboard ? (
          <span className="smp-range__value">{formatRangeLabel(start, end)}</span>
        ) : null}
      </button>

      <div
        id={menuId}
        className="smp-range__popover"
        role="dialog"
        aria-label={pickingEnd ? "Choose end date" : "Choose date range"}
        inert={!open}
      >
        <div className="smp-range__surface">
          <div className="smp-range__nav">
            <button
              type="button"
              className="smp-icon-btn"
              aria-label="Previous month"
              disabled={!canPrev}
              onClick={() => setCursor(shiftMonth(cursor.year, cursor.month, -1))}
            >
              <ChevronLeft size={16} strokeWidth={1.75} />
            </button>
            <p className="smp-range__month">{monthTitle(cursor.year, cursor.month)}</p>
            <button
              type="button"
              className="smp-icon-btn"
              aria-label="Next month"
              disabled={!canNext}
              onClick={() => setCursor(shiftMonth(cursor.year, cursor.month, 1))}
            >
              <ChevronRight size={16} strokeWidth={1.75} />
            </button>
          </div>

          <div className="smp-range__weekdays">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="smp-range__grid">
            {cells.map((iso, index) => {
              if (!iso) {
                return <span key={`empty-${index}`} className="smp-range__day" />;
              }
              const disabled = iso > latest;
              const inRange = iso >= rangeStart && iso <= rangeEnd;
              const isStart = iso === rangeStart;
              const isEnd = iso === rangeEnd;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  className="smp-range__day smp-range__day--btn"
                  disabled={disabled}
                  data-in-range={inRange ? "true" : "false"}
                  data-start={isStart ? "true" : "false"}
                  data-end={isEnd ? "true" : "false"}
                  data-today={isToday ? "true" : "false"}
                  onMouseEnter={() => setHover(iso)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onDayClick(iso)}
                >
                  <span className="smp-range__num">{Number(iso.slice(-2))}</span>
                </button>
              );
            })}
          </div>

          {showPresets ? (
            <div className="smp-range__presets" role="group" aria-label="Quick ranges">
              {presets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="smp-chip"
                  data-active={activePreset === item.id ? "true" : "false"}
                  aria-pressed={activePreset === item.id}
                  onClick={() => apply(item.start, item.end)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
          {pickingEnd ? (
            <p className="smp-range__hint">Select the end date</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
