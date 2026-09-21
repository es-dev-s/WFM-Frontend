"use client";

import { memo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose } from "lucide-react";
import { MOBILE_NAV_QUERY } from "@/hooks/use-media-query";
import {
  getPlatformNav,
  getUtilityNav,
  formatBadgeCount,
  isNavItemActive,
  type NavItem,
} from "@/lib/navigation";
import { useSessionOptional } from "@/components/auth/SessionProvider";
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
  const session = useSessionOptional();
  const utilityNav = getUtilityNav(session?.role);
  const navigation = getPlatformNav(session?.role);

  const onBrandControlClick = useCallback(() => {
    if (window.matchMedia(MOBILE_NAV_QUERY).matches) return;
    if (sidebarCollapsed) toggleSidebar();
  }, [sidebarCollapsed, toggleSidebar]);

  const onCollapseClick = useCallback(() => {
    if (window.matchMedia(MOBILE_NAV_QUERY).matches) return;
    collapseSidebar();
  }, [collapseSidebar]);

  const onNavClick = useCallback(() => {
    closeMobileNav();
  }, [closeMobileNav]);

  return (
    <aside className="smp-sidebar" aria-label="Primary">
      <div className="smp-sidebar__brand">
        <button
          type="button"
          className="smp-sidebar__brand-control"
          onClick={onBrandControlClick}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "WFM"}
          aria-pressed={!sidebarCollapsed}
          tabIndex={0}
        >
          <BrandMark />
        </button>

        <div className="smp-sidebar__brand-copy">
          <span className="smp-sidebar__brand-name">WFM</span>
          <span className="smp-sidebar__brand-meta">Entegra</span>
        </div>

        <button
          type="button"
          className="smp-sidebar__collapse"
          onClick={onCollapseClick}
          aria-label="Collapse sidebar"
          tabIndex={sidebarCollapsed ? -1 : 0}
        >
          <PanelLeftClose size={16} strokeWidth={1.75} />
        </button>
      </div>

      <div className="smp-sidebar__scroll">
        {navigation.map((group) => (
          <div key={group.id} className="smp-sidebar__group">
            <div className="smp-sidebar__group-label">{group.label}</div>
            <nav className="smp-sidebar__nav" aria-label={group.label}>
              {group.items.map((item) => (
                <SidebarNavItem
                  key={item.href}
                  item={item}
                  active={isNavItemActive(pathname, item.href)}
                  onNavClick={onNavClick}
                />
              ))}
            </nav>
          </div>
        ))}
      </div>

      <div className="smp-sidebar__foot">
        {session ? (
          <div className="smp-nav-slot">
            <Link
              href="/settings"
              className="smp-sidebar__account"
              onClick={onNavClick}
              aria-label={`${session.name}, ${session.roleLabel}`}
            >
              <span className="smp-sidebar__avatar" aria-hidden="true">
                {session.initials}
              </span>
              <span className="smp-sidebar__account-copy">
                <span className="smp-sidebar__account-name">{session.name}</span>
                <span className="smp-sidebar__account-role">{session.roleLabel}</span>
              </span>
            </Link>
            <span className="smp-nav-item__tooltip" aria-hidden="true">
              {session.name}
            </span>
          </div>
        ) : null}

        <nav className="smp-sidebar__nav" aria-label="Utility">
          {utilityNav.map((item) => (
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
