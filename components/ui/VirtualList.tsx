"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

type VirtualListProps<T> = {
  items: readonly T[];
  /** Fixed row height in px — keeps scroll math O(1). */
  rowHeight: number;
  height: number;
  overscan?: number;
  className?: string;
  /** When false, skip scroll work (closed menus). */
  active?: boolean;
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
};

/** Browsers clip extremely tall boxes; keep the spacer inside a safe range. */
const MAX_SPACER_PX = 8_000_000;
const MAX_OVERSCAN = 32;

function contentHeight(count: number, rowHeight: number): number {
  if (count <= 0) return 0;
  const product = count * rowHeight;
  if (!Number.isFinite(product) || product <= 0) return MAX_SPACER_PX;
  return product;
}

/**
 * Windowed list for high-volume feeds.
 * Only mounts rows in the viewport (+ overscan). Scroll handler is rAF-batched
 * so rapid streams never thrash React on every pixel.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  height,
  overscan = 6,
  className,
  active = true,
  getKey,
  renderItem,
}: VirtualListProps<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const safeRowHeight =
    Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 1;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const count = items.length;
  const safeOverscan = Math.min(
    MAX_OVERSCAN,
    Math.max(0, Math.floor(overscan)),
  );

  const finiteHeight = contentHeight(count, safeRowHeight);
  const totalHeight = Math.min(finiteHeight, MAX_SPACER_PX);
  const scaled = finiteHeight > totalHeight;

  const cancelScrollFrame = useCallback(() => {
    if (rafRef.current == null) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  useEffect(() => {
    return cancelScrollFrame;
  }, [cancelScrollFrame]);

  useEffect(() => {
    if (!active) cancelScrollFrame();
  }, [active, cancelScrollFrame]);

  useLayoutEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const maxScroll = Math.max(0, totalHeight - safeHeight);
    const next = Math.min(Math.max(0, node.scrollTop), maxScroll);
    if (node.scrollTop !== next) node.scrollTop = next;
    setScrollTop((prev) => (prev === next ? prev : next));
  }, [totalHeight, safeHeight, count]);

  const onScroll = useCallback(() => {
    if (!active) return;
    const node = scrollerRef.current;
    if (!node || rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const next = node.scrollTop;
      setScrollTop((prev) => (prev === next ? prev : next));
    });
  }, [active]);

  const { start, end, offsetY } = useMemo(() => {
    if (count === 0 || safeHeight <= 0) {
      return { start: 0, end: 0, offsetY: 0 };
    }

    const visibleCount = Math.max(1, Math.ceil(safeHeight / safeRowHeight));

    if (!scaled) {
      const startIndex = Math.max(
        0,
        Math.floor(scrollTop / safeRowHeight) - safeOverscan,
      );
      const endIndex = Math.min(
        count,
        startIndex + visibleCount + safeOverscan * 2,
      );
      return {
        start: startIndex,
        end: Math.max(startIndex, endIndex),
        offsetY: startIndex * safeRowHeight,
      };
    }

    const maxScroll = Math.max(1, totalHeight - safeHeight);
    const progress = Math.min(1, Math.max(0, scrollTop / maxScroll));
    const maxStart = Math.max(0, count - visibleCount);
    const startIndex = Math.max(
      0,
      Math.min(maxStart, Math.floor(progress * maxStart) - safeOverscan),
    );
    const endIndex = Math.min(
      count,
      startIndex + visibleCount + safeOverscan * 2,
    );

    return {
      start: startIndex,
      end: Math.max(startIndex, endIndex),
      offsetY: scrollTop,
    };
  }, [
    count,
    safeHeight,
    safeRowHeight,
    safeOverscan,
    scrollTop,
    scaled,
    totalHeight,
  ]);

  const slice = useMemo(
    () => items.slice(start, end),
    [items, start, end],
  );

  return (
    <div
      ref={scrollerRef}
      className={className}
      onScroll={active ? onScroll : undefined}
      style={
        {
          height: safeHeight,
          overflowY: "auto",
          overflowX: "hidden",
          position: "relative",
          contain: "layout paint style",
          overflowAnchor: "none",
        } satisfies CSSProperties
      }
    >
      <div
        style={{
          height: totalHeight,
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            transform: `translate3d(0, ${offsetY}px, 0)`,
            contain: "layout style",
          }}
        >
          {slice.map((item, offset) => {
            const index = start + offset;
            return (
              <div
                key={getKey(item, index)}
                style={{
                  height: safeRowHeight,
                  contain: "layout paint style",
                }}
              >
                {renderItem(item, index)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
