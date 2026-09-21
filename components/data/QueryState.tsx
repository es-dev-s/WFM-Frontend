"use client";

import { ApiError } from "@/lib/api";
import type { ReactNode } from "react";

function errorCopy(error: Error, label: string): string {
  const code = error instanceof ApiError ? error.code : "";
  if (code === "warming") {
    return "This source is still loading its first snapshot. Retry in a moment.";
  }
  if (code === "network_error") return error.message;
  if (code === "not_found") return `This ${label} was not found.`;
  return error.message || "Something went wrong.";
}

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
  const hasBody = children != null && children !== false;

  if (hasBody) {
    return (
      <>
        {error ? (
          <div className="smp-state smp-state--inline" role="status">
            <p className="smp-state__copy">{errorCopy(error, label)}</p>
            {onRetry ? (
              <button type="button" className="smp-btn" onClick={onRetry}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {children}
      </>
    );
  }

  if (loading) {
    return (
      <div className="smp-state" aria-busy="true" aria-live="polite">
        <div className="smp-state__pulse" />
        <p className="smp-state__copy">Loading {label}…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="smp-state smp-state--error" role="alert">
        <p className="smp-state__copy">{errorCopy(error, label)}</p>
        {onRetry ? (
          <button type="button" className="smp-btn" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  return null;
}
