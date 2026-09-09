"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import type { ThemePreference } from "@/lib/theme-preference";

const OPTIONS: {
  id: ThemePreference;
  label: string;
  description: string;
  icon: typeof Sun;
}[] = [
  {
    id: "light",
    label: "Light",
    description: "White canvas, forest green",
    icon: Sun,
  },
  {
    id: "dark",
    label: "Dark",
    description: "True black surfaces",
    icon: Moon,
  },
  {
    id: "system",
    label: "System",
    description: "Match this device",
    icon: Monitor,
  },
];

export function AppearanceSettings() {
  const { preference, setPreference } = useTheme();

  return (
    <section className="smp-page-panel" aria-labelledby="appearance-heading">
      <span className="smp-page-panel__accent">Appearance</span>
      <h3 id="appearance-heading" className="smp-page-panel__title">
        Light, dark, or follow the system.
      </h3>
      <p className="smp-page-panel__body">
        Light uses a cool gray canvas and forest green. Dark uses true black
        chrome with elevated graphite panels.
      </p>

      <div
        className="smp-appearance"
        role="radiogroup"
        aria-label="Color theme"
      >
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = preference === option.id;

          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              className="smp-appearance__option"
              data-active={active ? "true" : "false"}
              onClick={() => setPreference(option.id)}
            >
              <span
                className={`smp-appearance__swatch smp-appearance__swatch--${option.id}`}
                aria-hidden="true"
              />
              <span className="smp-appearance__meta">
                <span className="smp-appearance__icon">
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="smp-appearance__copy">
                  <span className="smp-appearance__label">{option.label}</span>
                  <span className="smp-appearance__desc">{option.description}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
