"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyTheme,
  readThemeCookieClient,
  readThemeStorage,
  type ThemePreference,
} from "@/lib/theme-preference";

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialPreference,
}: {
  children: ReactNode;
  initialPreference: ThemePreference;
}) {
  const [preference, setPreferenceState] = useState(initialPreference);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    applyTheme(next);
  }, []);

  useLayoutEffect(() => {
    const fromCookie = readThemeCookieClient();
    const fromStorage = readThemeStorage();
    const stored = fromCookie ?? fromStorage;
    if (stored && stored !== initialPreference) {
      setPreferenceState(stored);
      applyTheme(stored);
      return;
    }
    applyTheme(stored ?? initialPreference);
  }, [initialPreference]);

  useEffect(() => {
    if (preference !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo(
    () => ({ preference, setPreference }),
    [preference, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
