"use client";

import { memo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft, PanelLeftClose } from "lucide-react";
import { MOBILE_NAV_QUERY } from "@/hooks/use-media-query";
import {
  NAVIGATION,
  UTILITY_NAV,
  formatBadgeCount,
  isNavItemActive,
  type NavItem,
} from "@/lib/navigation";
import { useUIStore } from "@/store/use-ui-store";
import { BrandMark } from "./BrandMark";
import { useShell } from "./shell-context";

const SidebarNavItem = memo(function SidebarNavItem({
  item,
  active,
  onNavClick,
}: {
  item: NavItem;
  active: boolean;
  onNavClick: () => void;
}) {
  const Icon = item.icon;
  const badgeLabel = formatBadgeCount(item.badge ?? 0);
  const tooltip = badgeLabel ? `${item.label} · ${badgeLabel}` : item.label;

  return (
    <div className="smp-nav-slot">
      <Link
        href={item.href}
        className="smp-nav-item"
        data-active={active ? "true" : "false"}
        onClick={onNavClick}
        prefetch
        aria-current={active ? "page" : undefined}
        aria-label={
          badgeLabel ? `${item.label}, ${badgeLabel} pending` : item.label
        }
      >
        <span className="smp-nav-item__icon" aria-hidden="true">
          <Icon strokeWidth={1.75} />
          {badgeLabel ? <span className="smp-nav-item__dot" /> : null}
        </span>
        <span className="smp-nav-item__label">{item.label}</span>
        {badgeLabel ? (
          <span className="smp-nav-item__badge">{badgeLabel}</span>
        ) : null}
      </Link>
      <span className="smp-nav-item__tooltip" aria-hidden="true">
        {tooltip}
      </span>
    </div>
  );
});

function SidebarComponent() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar, collapseSidebar } = useShell();
  const closeMobileNav = useUIStore((s) => s.closeMobileNav);

  const onBrandControlClick = useCallback(() => {
    if (window.matchMedia(MOBILE_NAV_QUERY).matches) return;
    toggleSidebar();
  }, [toggleSidebar]);

  const onNavClick = useCallback(() => {
    closeMobileNav();
    if (window.matchMedia(MOBILE_NAV_QUERY).matches) return;
    collapseSidebar();
  }, [closeMobileNav, collapseSidebar]);

  const brandAction = sidebarCollapsed ? "Show labels" : "Icon rail";

  return (
    <aside className="smp-sidebar" aria-label="Primary">
      <div className="smp-sidebar__brand">
        <button
          type="button"
          className="smp-sidebar__brand-control"
          onClick={onBrandControlClick}
          aria-label={brandAction}
          aria-pressed={!sidebarCollapsed}
          tabIndex={0}
        >
          <span
            className="smp-sidebar__brand-face smp-sidebar__brand-face--mark"
            aria-hidden="true"
          >
            <BrandMark />
          </span>
          <span
            className="smp-sidebar__brand-face smp-sidebar__brand-face--action"
            aria-hidden="true"
          >
            {sidebarCollapsed ? (
              <PanelLeft strokeWidth={1.75} />
            ) : (
              <PanelLeftClose strokeWidth={1.75} />
            )}
          </span>
        </button>

        <div className="smp-sidebar__brand-spacer" aria-hidden="true" />

        <div className="smp-sidebar__brand-copy">
          <span className="smp-sidebar__brand-name">Schola</span>
          <span className="smp-sidebar__brand-meta">Workforce</span>
        </div>
      </div>

      <div className="smp-sidebar__scroll">
        {NAVIGATION.map((group) => (
          <div key={group.id} className="smp-sidebar__group">
            <div className="smp-sidebar__group-label">{group.label}</div>
            <nav className="smp-sidebar__nav" aria-label={group.label}>
              {group.items.map((item) => {
                const active = isNavItemActive(pathname, item.href);

                return (
                  <SidebarNavItem
                    key={item.href}
                    item={item}
                    active={active}
                    onNavClick={onNavClick}
                  />
                );
              })}
            </nav>
          </div>
        ))}
      </div>

      <div className="smp-sidebar__foot">
        <nav className="smp-sidebar__nav" aria-label="Utility">
          {UTILITY_NAV.map((item) => (
            <SidebarNavItem
              key={item.href}
              item={item}
              active={isNavItemActive(pathname, item.href)}
              onNavClick={onNavClick}
            />
          ))}
        </nav>
      </div>
    </aside>
  );
}

export const Sidebar = memo(SidebarComponent);
