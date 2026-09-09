import type { LucideIcon } from "lucide-react";
import { Fingerprint, House, Settings, Timer } from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
};

export function formatBadgeCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  if (count > 99) return "99+";
  return String(Math.floor(count));
}

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export type Breadcrumb = {
  label: string;
  href?: string;
};

export type PageMeta = {
  title: string;
  eyebrow: string;
};

export const NAVIGATION: NavGroup[] = [
  {
    id: "platform",
    label: "Platform",
    items: [
      { label: "Home", href: "/", icon: House },
      { label: "Tivazo", href: "/tivazo", icon: Timer },
      { label: "Biomatic", href: "/biomatic", icon: Fingerprint },
    ],
  },
];

/** Pinned to the sidebar foot — always visible, outside the scroll groups. */
export const UTILITY_NAV: NavItem[] = [
  { label: "Settings", href: "/settings", icon: Settings },
];

const UTILITY_GROUP: NavGroup = {
  id: "utility",
  label: "Settings",
  items: UTILITY_NAV,
};

function findMatchedNav(pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  let bestLength = -1;

  for (const group of [...NAVIGATION, UTILITY_GROUP]) {
    for (const item of group.items) {
      if (!isNavItemActive(pathname, item.href)) continue;
      if (item.href.length <= bestLength) continue;
      bestLength = item.href.length;
      best = { group, item };
    }
  }

  return best;
}

export function getPageMeta(pathname: string): PageMeta {
  const match = findMatchedNav(pathname);
  return match
    ? { title: match.item.label, eyebrow: match.group.label }
    : { title: "Home", eyebrow: "Platform" };
}

function titleizeSegment(segment: string): string {
  let value = segment;
  try {
    value = decodeURIComponent(segment);
  } catch {
    value = segment;
  }

  if (
    value.includes(":") ||
    value.length > 36 ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    return "Detail";
  }

  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parentHref(pathname: string): string | undefined {
  if (pathname === "/") return undefined;
  return "/";
}

export function getBreadcrumbs(
  pathname: string,
  override?: Breadcrumb[] | null,
): Breadcrumb[] {
  if (override && override.length > 0) {
    return override;
  }

  const match = findMatchedNav(pathname);
  const meta = match
    ? { title: match.item.label, eyebrow: match.group.label, href: match.item.href }
    : { title: "Home", eyebrow: "Platform", href: "/" };

  const crumbs: Breadcrumb[] = [];
  if (meta.eyebrow && meta.eyebrow !== meta.title) {
    crumbs.push({
      label: meta.eyebrow,
      href: parentHref(pathname),
    });
  }

  const extra =
    match && pathname.startsWith(`${match.item.href}/`)
      ? pathname.slice(match.item.href.length).split("/").filter(Boolean)
      : [];

  if (extra.length === 0) {
    crumbs.push({ label: meta.title });
    return crumbs;
  }

  crumbs.push({ label: meta.title, href: meta.href });
  extra.forEach((segment, index) => {
    const href = `${meta.href}/${extra.slice(0, index + 1).join("/")}`;
    crumbs.push({
      label: titleizeSegment(segment),
      href: index < extra.length - 1 ? href : undefined,
    });
  });

  return crumbs;
}
