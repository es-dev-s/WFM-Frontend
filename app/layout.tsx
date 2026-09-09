import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Instrument_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import {
  parseSidebarCookie,
  SIDEBAR_COOKIE,
} from "@/lib/sidebar-preference";
import {
  parseThemeCookie,
  THEME_COOKIE,
} from "@/lib/theme-preference";
import { UI_BOOTSTRAP_SCRIPT } from "@/lib/ui-bootstrap";
import "./globals.css";

export const dynamic = "force-dynamic";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Schola — Workforce",
    template: "%s · Schola",
  },
  description: "Workforce operations for Tivazo and Biomatic.",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jar = await cookies();
  const themePreference = parseThemeCookie(jar.get(THEME_COOKIE)?.value);
  const sidebarCollapsed = parseSidebarCookie(jar.get(SIDEBAR_COOKIE)?.value);
  const theme =
    themePreference === "system" ? undefined : themePreference;

  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} h-full`}
      data-theme={theme}
      data-theme-preference={themePreference}
      data-sidebar-collapsed={sidebarCollapsed ? "true" : undefined}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: UI_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className={`${instrumentSans.className} min-h-full`} suppressHydrationWarning>
        <ThemeProvider initialPreference={themePreference}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
