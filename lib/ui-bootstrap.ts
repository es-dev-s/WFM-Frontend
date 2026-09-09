import { SIDEBAR_BOOTSTRAP_SCRIPT } from "@/lib/sidebar-preference";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme-preference";

/** Theme first so color-scheme is correct before the first paint. */
export const UI_BOOTSTRAP_SCRIPT = `${THEME_BOOTSTRAP_SCRIPT}${SIDEBAR_BOOTSTRAP_SCRIPT}`;
