"use client";

import { ApiError } from "@/lib/api";
import type { ReactNode } from "react";

export function QueryState({
  loading,
  error,
  onRetry,
  children,
  label = "data",
}: {
  loading: boolean;
  error: Error | null;
  onRetry?: () => void;
  children?: ReactNode;
  label?: string;
}) {
  if (loading) {
    return (
      <div className="smp-state" aria-busy="true" aria-live="polite">
        <div className="smp-state__pulse" />
        <p className="smp-state__copy">Loading {label}…</p>
      </div>
    );
  }

  if (error) {
    const code = error instanceof ApiError ? error.code : "";
    const message =
      code === "tivazo_disabled"
        ? "Tivazo is not configured on the API. Add server keys and try again."
        : code === "not_found"
          ? `This ${label} was not found.`
          : error.message || "Something went wrong.";

    return (
      <div className="smp-state smp-state--error" role="alert">
        <p className="smp-state__copy">{message}</p>
        {onRetry ? (
          <button type="button" className="smp-btn" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  return <>{children}</>;
}
