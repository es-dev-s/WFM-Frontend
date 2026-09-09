"use client";

import { useSyncExternalStore } from "react";

export const MOBILE_NAV_QUERY = "(max-width: 960px)";

const mediaQueryCache = new Map<string, MediaQueryList>();

function getMediaQueryList(query: string): MediaQueryList {
  let media = mediaQueryCache.get(query);
  if (!media) {
    media = window.matchMedia(query);
    mediaQueryCache.set(query, media);
  }
  return media;
}

function subscribe(query: string, onChange: () => void) {
  const media = getMediaQueryList(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * Shared, tear-free media query subscription.
 * One MediaQueryList per query string; safe under Strict Mode.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined") return () => {};
      return subscribe(query, onStoreChange);
    },
    () => getMediaQueryList(query).matches,
    () => false,
  );
}
