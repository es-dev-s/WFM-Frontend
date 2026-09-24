"use client";

export type PunchSource = "all" | "bio" | "tivazo";

type Props = {
  value: PunchSource;
  onChange: (source: PunchSource) => void;
  /** Extra class on the outer group (e.g. filter-strip / header placement). */
  className?: string;
  id?: string;
};

/**
 * Combined | Biometrics | Tivazo segmented control.
 * Bind every instance to the same lifted punchSource state so they stay in sync.
 */
export function PunchSourceSwitch({ value, onChange, className, id }: Props) {
  const groupClass = ["smp-dashboard-filters__source", className].filter(Boolean).join(" ");
  return (
    <div className={groupClass} role="group" aria-label="Punch source">
      <div
        id={id}
        className="smp-segment smp-dashboard-source-switch"
        role="tablist"
        aria-label="Punch source"
      >
        <button
          type="button"
          role="tab"
          className="smp-segment__btn"
          data-active={value === "all" ? "true" : "false"}
          aria-selected={value === "all"}
          onClick={() => onChange("all")}
        >
          Combined
        </button>
        <button
          type="button"
          role="tab"
          className="smp-segment__btn"
          data-source="biometrics"
          data-active={value === "bio" ? "true" : "false"}
          aria-selected={value === "bio"}
          onClick={() => onChange("bio")}
        >
          Biometrics
        </button>
        <button
          type="button"
          role="tab"
          className="smp-segment__btn"
          data-source="tivazo"
          data-active={value === "tivazo" ? "true" : "false"}
          aria-selected={value === "tivazo"}
          onClick={() => onChange("tivazo")}
        >
          Tivazo
        </button>
      </div>
    </div>
  );
}
