"use client";

import { memo } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

function ThemeToggleComponent() {
  const { setPreference } = useTheme();

  return (
    <button
      type="button"
      className="smp-icon-btn smp-theme-toggle"
      aria-label="Toggle appearance"
      title="Toggle appearance"
      onClick={() => {
        const resolved =
          document.documentElement.getAttribute("data-theme") === "dark"
            ? "dark"
            : "light";
        setPreference(resolved === "dark" ? "light" : "dark");
      }}
    >
      <span className="smp-theme-toggle__icon smp-theme-toggle__icon--moon" aria-hidden="true">
        <Moon size={16} strokeWidth={1.75} />
      </span>
      <span className="smp-theme-toggle__icon smp-theme-toggle__icon--sun" aria-hidden="true">
        <Sun size={16} strokeWidth={1.75} />
      </span>
    </button>
  );
}

export const ThemeToggle = memo(ThemeToggleComponent);
