"use client";

import { useEffect, useMemo } from "react";
import type { Breadcrumb } from "@/lib/navigation";
import { useUIStore } from "@/store/use-ui-store";

export function PageMeta({ crumbs }: { crumbs: Breadcrumb[] }) {
  const setCrumbOverride = useUIStore((s) => s.setCrumbOverride);
  const serialized = useMemo(
    () => crumbs.map((crumb) => `${crumb.label}:${crumb.href ?? ""}`).join("|"),
    [crumbs],
  );

  useEffect(() => {
    setCrumbOverride(crumbs);
    return () => setCrumbOverride(null);
    // serialized captures crumb identity without looping on array refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, setCrumbOverride]);

  return null;
}
