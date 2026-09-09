export const THEME_COOKIE = "smp-theme";
export const THEME_STORAGE_KEY = "smp-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(
  value: string | undefined | null,
): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function parseThemeCookie(value: string | undefined): ThemePreference {
  return isThemePreference(value) ? value : "system";
}

export function readThemeCookieClient(): ThemePreference | null {
  if (typeof document === "undefined") return null;
  const row = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${THEME_COOKIE}=`));
  if (!row) return null;
  const value = row.slice(THEME_COOKIE.length + 1);
  return isThemePreference(value) ? value : null;
}

export function readThemeStorage(): ThemePreference | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function writeThemePreference(preference: ThemePreference) {
  if (typeof document !== "undefined") {
    document.cookie = `${THEME_COOKIE}=${preference}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* private mode */
  }
}

export function applyTheme(preference: ThemePreference) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-preference", preference);
  root.style.colorScheme = resolved;
  writeThemePreference(preference);
}

/**
 * Blocking script: cookie → localStorage → system, onto <html> before paint.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var d=document.documentElement;var c=document.cookie.split("; ").find(function(x){return x.indexOf("${THEME_COOKIE}=")==0});var pref=c?c.split("=")[1]:"";if(pref!=="light"&&pref!=="dark"&&pref!=="system"){try{pref=localStorage.getItem("${THEME_STORAGE_KEY}")||""}catch(e){pref=""}if(pref!=="light"&&pref!=="dark"&&pref!=="system")pref="system";}var resolved=pref==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):pref;d.setAttribute("data-theme",resolved);d.setAttribute("data-theme-preference",pref);d.style.colorScheme=resolved;document.cookie="${THEME_COOKIE}="+pref+"; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax";try{localStorage.setItem("${THEME_STORAGE_KEY}",pref)}catch(e){}}catch(e){}})();`;
