"use client";

import { create } from "zustand";
import type { Breadcrumb } from "@/lib/navigation";

type UIState = {
  mobileNavOpen: boolean;
  crumbOverride: Breadcrumb[] | null;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  toggleMobileNav: () => void;
  setCrumbOverride: (crumbs: Breadcrumb[] | null) => void;
};

/** Transient UI only — sidebar open/close lives in ShellProvider (cookie + SSR). */
export const useUIStore = create<UIState>((set, get) => ({
  mobileNavOpen: false,
  crumbOverride: null,

  openMobileNav: () => set({ mobileNavOpen: true }),

  closeMobileNav: () => {
    if (!get().mobileNavOpen) return;
    set({ mobileNavOpen: false });
  },

  toggleMobileNav: () =>
    set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),

  setCrumbOverride: (crumbs) => set({ crumbOverride: crumbs }),
}));
