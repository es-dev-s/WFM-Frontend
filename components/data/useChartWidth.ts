"use client";

import { useLayoutEffect, useRef, useState } from "react";

export function useChartWidth(fallback = 640) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  const widthRef = useRef(fallback);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const update = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      if (next > 0 && next !== widthRef.current) {
        widthRef.current = next;
        setWidth(next);
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { containerRef, width };
}

export function pickNearestIndex(
  clientX: number,
  svgRect: DOMRect,
  viewWidth: number,
  xs: number[],
): number {
  if (!xs.length || svgRect.width <= 0 || viewWidth <= 0) return 0;
  const x = ((clientX - svgRect.left) / svgRect.width) * viewWidth;
  let nearest = 0;
  let minDist = Number.POSITIVE_INFINITY;
  xs.forEach((pointX, index) => {
    const dist = Math.abs(pointX - x);
    if (dist < minDist) {
      minDist = dist;
      nearest = index;
    }
  });
  return nearest;
}
