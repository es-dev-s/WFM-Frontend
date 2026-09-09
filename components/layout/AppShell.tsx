"use client";

import {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { MOBILE_NAV_QUERY } from "@/hooks/use-media-query";
import { runIdle } from "@/lib/schedule";
import {
  LEGACY_UI_STORAGE_KEY,
  readSidebarCookieClient,
  readSidebarStorage,
  writeSidebarPreference,
} from "@/lib/sidebar-preference";
import { useUIStore } from "@/store/use-ui-store";
import { Navbar } from "./Navbar";
import { PageFallback } from "./PageFallback";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./Sidebar";

type AppShellProps = {
  children: React.ReactNode;
  initialCollapsed: boolean;
};

function readLegacyCollapsed(): boolean {
  try {
    const raw = window.localStorage.getItem(LEGACY_UI_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {
      state?: { sidebarCollapsed?: boolean };
    };
    window.localStorage.removeItem(LEGACY_UI_STORAGE_KEY);
    return parsed?.state?.sidebarCollapsed === true;
  } catch {
    return false;
  }
}

function persistCollapsed(next: boolean) {
  writeSidebarPreference(next);
}

const ShellCanvas = memo(function ShellCanvas({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="smp-shell__canvas">
      <Navbar />
      <main className="smp-main">
        <div className="smp-main__inner">
          <Suspense fallback={<PageFallback />}>{children}</Suspense>
        </div>
      </main>
    </div>
  );
});

export function AppShell({ children, initialCollapsed }: AppShellProps) {
  const pathname = usePathname();
  const mobileNavOpen = useUIStore((s) => s.mobileNavOpen);
  const closeMobileNav = useUIStore((s) => s.closeMobileNav);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialCollapsed);
  const [animationsReady, setAnimationsReady] = useState(false);
  const [railTips, setRailTips] = useState(true);
  const awaitSidebarLeaveRef = useRef(false);

  const hushRailTips = useCallback(() => {
    setRailTips(false);
    const sidebar = document.querySelector(".smp-sidebar");
    awaitSidebarLeaveRef.current = Boolean(
      sidebar instanceof HTMLElement && sidebar.matches(":hover"),
    );
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".smp-sidebar")) {
      active.blur();
    }
  }, []);

  useLayoutEffect(() => {
    const fromCookie = readSidebarCookieClient();
    const fromStorage = readSidebarStorage();
    const stored = fromCookie ?? fromStorage;

    if (stored !== null && stored !== initialCollapsed) {
      setSidebarCollapsed(stored);
      persistCollapsed(stored);
    } else {
      persistCollapsed(stored ?? initialCollapsed);
    }

    if (!initialCollapsed && readLegacyCollapsed()) {
      persistCollapsed(true);
      setSidebarCollapsed(true);
    }
  }, [initialCollapsed]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      setAnimationsReady(true);
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      persistCollapsed(next);
      return next;
    });
  }, []);

  const collapseSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      if (current) return current;
      persistCollapsed(true);
      return true;
    });
  }, []);

  const railMountedRef = useRef(false);
  useLayoutEffect(() => {
    if (!railMountedRef.current) {
      railMountedRef.current = true;
      return;
    }
    if (sidebarCollapsed) hushRailTips();
  }, [sidebarCollapsed, hushRailTips]);

  useEffect(() => {
    const onPointerOver = (event: PointerEvent) => {
      const target = event.target;
      const related = event.relatedTarget;
      if (!(target instanceof Element)) return;
      if (!target.closest(".smp-sidebar")) return;
      if (related instanceof Element && related.closest(".smp-sidebar")) return;
      if (!awaitSidebarLeaveRef.current) setRailTips(true);
    };

    const onPointerOut = (event: PointerEvent) => {
      const target = event.target;
      const related = event.relatedTarget;
      if (!(target instanceof Element)) return;
      if (!target.closest(".smp-sidebar")) return;
      if (related instanceof Element && related.closest(".smp-sidebar")) return;
      awaitSidebarLeaveRef.current = false;
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
    };
  }, []);

  useEffect(() => {
    if (sidebarCollapsed) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (window.matchMedia(MOBILE_NAV_QUERY).matches) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".smp-sidebar")) return;
      collapseSidebar();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (window.matchMedia(MOBILE_NAV_QUERY).matches) return;
      collapseSidebar();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sidebarCollapsed, collapseSidebar]);

  useEffect(() => {
    closeMobileNav();
  }, [pathname, closeMobileNav]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_NAV_QUERY);
    const onChange = () => {
      if (!media.matches) closeMobileNav();
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [closeMobileNav]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    if (!window.matchMedia(MOBILE_NAV_QUERY).matches) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMobileNav();
    };

    const previousOverflow = document.body.style.overflow;
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen, closeMobileNav]);

  useEffect(() => {
    runIdle(() => {
      // placeholder for prefetch / telemetry hooks
    });
  }, []);

  return (
    <ShellProvider
      sidebarCollapsed={sidebarCollapsed}
      toggleSidebar={toggleSidebar}
      collapseSidebar={collapseSidebar}
    >
      <div
        className="smp-shell"
        data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
        data-mobile-nav={mobileNavOpen ? "true" : "false"}
        data-ready={animationsReady ? "true" : "false"}
        data-rail-tips={railTips ? "true" : "false"}
      >
        <Sidebar />
        <button
          type="button"
          className="smp-overlay"
          aria-label="Close navigation"
          tabIndex={mobileNavOpen ? 0 : -1}
          onClick={closeMobileNav}
        />
        <ShellCanvas>{children}</ShellCanvas>
      </div>
    </ShellProvider>
  );
}
