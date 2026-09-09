export const SIDEBAR_COOKIE = "smp-sidebar";
export const SIDEBAR_STORAGE_KEY = "smp-sidebar";
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Legacy zustand persist key — migrated once to the cookie. */
export const LEGACY_UI_STORAGE_KEY = "smp-ui";

export function sidebarCookieValue(collapsed: boolean): "1" | "0" {
  return collapsed ? "1" : "0";
}

/** Icon rail is the default. Only an explicit "0" expands labels. */
export function parseSidebarCookie(value: string | undefined): boolean {
  return value !== "0";
}

export function readSidebarCookieClient(): boolean | null {
  if (typeof document === "undefined") return null;
  const row = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${SIDEBAR_COOKIE}=`));
  if (!row) return null;
  return row.slice(SIDEBAR_COOKIE.length + 1) !== "0";
}

export function readSidebarStorage(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    /* private mode */
  }
  return null;
}

/** Persist for the next request (cookie) and this origin (localStorage). */
export function writeSidebarPreference(collapsed: boolean) {
  const value = sidebarCookieValue(collapsed);

  if (typeof document !== "undefined") {
    document.cookie = `${SIDEBAR_COOKIE}=${value}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
    const root = document.documentElement;
    if (collapsed) {
      root.setAttribute("data-sidebar-collapsed", "true");
    } else {
      root.removeAttribute("data-sidebar-collapsed");
    }
  }

  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, value);
  } catch {
    /* private mode */
  }
}

/** @deprecated Use writeSidebarPreference — kept so hot reload never misses the rename. */
export const writeSidebarCookie = writeSidebarPreference;

/**
 * Blocking script: cookie → localStorage → legacy key → html attribute
 * before paint. Missing preference defaults to icon rail.
 */
export const SIDEBAR_BOOTSTRAP_SCRIPT = `(function(){try{var c=document.cookie.split("; ").find(function(x){return x.indexOf("${SIDEBAR_COOKIE}=")==0});var collapsed=true;if(c){collapsed=c.split("=")[1]!=="0";}else{try{var ls=localStorage.getItem("${SIDEBAR_STORAGE_KEY}");if(ls==="0")collapsed=false;else if(ls==="1")collapsed=true;else{var r=localStorage.getItem("${LEGACY_UI_STORAGE_KEY}");if(r){var p=JSON.parse(r);if(p&&p.state&&p.state.sidebarCollapsed===false)collapsed=false;}}}catch(e){}}document.cookie="${SIDEBAR_COOKIE}="+(collapsed?"1":"0")+"; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax";try{localStorage.setItem("${SIDEBAR_STORAGE_KEY}",collapsed?"1":"0");}catch(e){}if(collapsed){document.documentElement.setAttribute("data-sidebar-collapsed","true");}else{document.documentElement.removeAttribute("data-sidebar-collapsed");}}catch(e){}})();`;
