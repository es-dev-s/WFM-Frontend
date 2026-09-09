"use client";

import { useMenu } from "@/hooks/use-menu";
import {
  addDaysISO,
  formatRangeLabel,
  isoDateInZone,
  monthCells,
  monthTitle,
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
};

export function DateRangePicker({
  start,
  end,
  max,
  onChange,
}: DateRangePickerProps) {
  const today = useMemo(() => isoDateInZone(), []);
  const latest = max ?? today;
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

  const presets = [
    { id: "today", label: "Today", start: latest, end: latest },
    {
      id: "7d",
      label: "7 days",
      start: addDaysISO(latest, -6),
      end: latest,
    },
    {
      id: "14d",
      label: "14 days",
      start: addDaysISO(latest, -13),
      end: latest,
    },
  ];

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
    const from = nextStart <= nextEnd ? nextStart : nextEnd;
    const to = nextStart <= nextEnd ? nextEnd : nextStart;
    setDraftStart(from);
    setDraftEnd(to);
    onChange(from, to);
    setPickingEnd(false);
    setOpen(false);
  };

  const onDayClick = (iso: string) => {
    if (iso > latest) return;
    if (!pickingEnd) {
      setDraftStart(iso);
      setDraftEnd(iso);
      setPickingEnd(true);
      return;
    }
    apply(draftStart, iso);
  };

  const activePreset = presets.find(
    (item) => item.start === start && item.end === end,
  )?.id;

  return (
    <div
      className="smp-range"
      ref={rootRef}
      data-open={open ? "true" : "false"}
    >
      <span className="smp-field__label">Dates</span>
      <button
        type="button"
        className="smp-range__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <CalendarDays size={16} strokeWidth={1.75} />
        <span className="smp-range__value">{formatRangeLabel(start, end)}</span>
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

          <div className="smp-range__presets" role="group" aria-label="Quick ranges">
            {presets.map((item) => (
              <button
                key={item.id}
                type="button"
                className="smp-chip"
                data-active={activePreset === item.id ? "true" : "false"}
                onClick={() => apply(item.start, item.end)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
