"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

type Props = {
  children: ReactNode;
  className?: string;
  /** Stagger delay in seconds for stacked sections. */
  delay?: number;
  as?: "div" | "section" | "article";
  "aria-label"?: string;
};

/**
 * Subtle enter animation (opacity + slight Y). Honors prefers-reduced-motion.
 * Uses transform/opacity only — no layout animation.
 */
export function MotionSection({
  children,
  className,
  delay = 0,
  as = "div",
  "aria-label": ariaLabel,
}: Props) {
  const reduce = useReducedMotion();

  if (reduce) {
    if (as === "section") {
      return (
        <section className={className} aria-label={ariaLabel}>
          {children}
        </section>
      );
    }
    if (as === "article") {
      return (
        <article className={className} aria-label={ariaLabel}>
          {children}
        </article>
      );
    }
    return (
      <div className={className} aria-label={ariaLabel}>
        {children}
      </div>
    );
  }

  const Tag = as === "section" ? motion.section : as === "article" ? motion.article : motion.div;

  return (
    <Tag
      className={className}
      aria-label={ariaLabel}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE, delay }}
    >
      {children}
    </Tag>
  );
}
