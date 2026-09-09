"use client";

import { memo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Breadcrumb } from "@/lib/navigation";

function NavbarBreadcrumbComponent({ crumbs }: { crumbs: Breadcrumb[] }) {
  if (crumbs.length === 0) return null;

  return (
    <nav className="smp-crumbs" aria-label="Breadcrumb">
      <ol className="smp-crumbs__list">
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1;

          return (
            <li
              key={`${crumb.label}-${index}`}
              className="smp-crumb"
              data-current={current ? "true" : "false"}
            >
              {index > 0 ? (
                <ChevronRight
                  className="smp-crumb__sep"
                  size={12}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              ) : null}

              {current ? (
                <h1 className="smp-crumb__label" aria-current="page">
                  {crumb.label}
                </h1>
              ) : crumb.href ? (
                <Link href={crumb.href} className="smp-crumb__link" prefetch>
                  <span className="smp-crumb__label">{crumb.label}</span>
                </Link>
              ) : (
                <span className="smp-crumb__label">{crumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export const NavbarBreadcrumb = memo(NavbarBreadcrumbComponent);
