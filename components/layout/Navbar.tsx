"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { getBreadcrumbs } from "@/lib/navigation";
import { useUIStore } from "@/store/use-ui-store";
import { NavbarBreadcrumb } from "./NavbarBreadcrumb";
import { NavbarSearch } from "./NavbarSearch";
import { NotificationMenu } from "./NotificationMenu";
import { ProfileMenu } from "./ProfileMenu";
import { ThemeToggle } from "./ThemeToggle";

type OpenMenu = "notifications" | "profile" | null;

function NavbarComponent() {
  const pathname = usePathname();
  const toggleMobileNav = useUIStore((s) => s.toggleMobileNav);
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const pageMetaOverride = useUIStore((s) => s.crumbOverride);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);

  const crumbs = useMemo(
    () => getBreadcrumbs(pathname, pageMetaOverride),
    [pathname, pageMetaOverride],
  );

  useEffect(() => {
    setOpenMenu(null);
  }, [pathname]);

  const onNotificationsOpenChange = useCallback((open: boolean) => {
    setOpenMenu(open ? "notifications" : null);
  }, []);

  const onProfileOpenChange = useCallback((open: boolean) => {
    setOpenMenu(open ? "profile" : null);
  }, []);

  return (
    <header className="smp-navbar">
      <div className="smp-navbar__left">
        <button
          type="button"
          className="smp-icon-btn smp-navbar__mobile-toggle"
          onClick={toggleMobileNav}
          aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileNavOpen}
        >
          <Menu size={16} strokeWidth={1.75} />
        </button>

        <NavbarBreadcrumb crumbs={crumbs} />
      </div>

      <div className="smp-navbar__right">
        <NavbarSearch />

        <div className="smp-navbar__actions">
          <ThemeToggle />
          <NotificationMenu
            open={openMenu === "notifications"}
            onOpenChange={onNotificationsOpenChange}
          />
        </div>

        <div className="smp-navbar__divider" aria-hidden="true" />

        <ProfileMenu
          open={openMenu === "profile"}
          onOpenChange={onProfileOpenChange}
        />
      </div>
    </header>
  );
}

export const Navbar = memo(NavbarComponent);
