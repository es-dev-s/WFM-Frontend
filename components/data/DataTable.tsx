"use client";

import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

export type DataColumn<T> = {
  id: string;
  header: string;
  width: string;
  align?: "left" | "right" | "center";
  sticky?: boolean;
  /** Share leftover table width. Sticky+flex stays pinned but can grow. */
  flex?: boolean;
  /** Person column — name + full email, wrapping allowed. */
  person?: boolean;
  /** 1 always, 2 hide below 760px, 3 hide below 1100px */
  priority?: 1 | 2 | 3;
  render: (row: T) => ReactNode;
};

const TABLE_COMPACT = "(max-width: 1100px)";
const TABLE_TIGHT = "(max-width: 760px)";

function parsePx(width: string): number {
  const value = Number.parseFloat(width);
  return Number.isFinite(value) ? value : 0;
}

function isFixedSticky<T>(column: DataColumn<T>): boolean {
  return Boolean(column.sticky && !column.flex);
}

export function DataTable<T>({
  columns,
  rows,
  getKey,
  empty,
  onRowClick,
  selectedKey,
  refreshing = false,
  resetKey,
  hasMore = false,
  loadingMore = false,
  totalCount,
  onNearEnd,
}: {
  columns: DataColumn<T>[];
  rows: readonly T[];
  getKey: (row: T, index: number) => string | number;
  empty: string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | number | null;
  refreshing?: boolean;
  resetKey?: string | number;
  hasMore?: boolean;
  loadingMore?: boolean;
  totalCount?: number;
  onNearEnd?: () => void;
}) {
  const compact = useMediaQuery(TABLE_COMPACT);
  const tight = useMediaQuery(TABLE_TIGHT);
  const visibleColumns = useMemo(
    () =>
      columns.filter((column) => {
        const priority = column.priority ?? 1;
        if (tight) return priority <= 1;
        if (compact) return priority <= 2;
        return true;
      }),
    [columns, compact, tight],
  );
  const tableWidth = useMemo(
    () =>
      visibleColumns.reduce((sum, column) => sum + parsePx(column.width), 0),
    [visibleColumns],
  );
  const stickyTotal = useMemo(
    () =>
      visibleColumns.reduce(
        (sum, column) =>
          sum + (isFixedSticky(column) ? parsePx(column.width) : 0),
        0,
      ),
    [visibleColumns],
  );
  const flexTotal = useMemo(
    () =>
      visibleColumns.reduce(
        (sum, column) =>
          sum + (isFixedSticky(column) ? 0 : parsePx(column.width)),
        0,
      ),
    [visibleColumns],
  );
  const stickyOffsets = useMemo(() => {
    let left = 0;
    return visibleColumns.map((column) => {
      if (!column.sticky) return undefined;
      const offset = left;
      left += parsePx(column.width);
      return offset;
    });
  }, [visibleColumns]);

  const colStyle = (column: DataColumn<T>): CSSProperties => {
    const width = parsePx(column.width);
    if (isFixedSticky(column) || flexTotal <= 0) {
      return { width };
    }
    if (stickyTotal <= 0) {
      return { width: `${(width / flexTotal) * 100}%` };
    }
    return {
      width: `calc((100% - ${stickyTotal}px) * ${width / flexTotal})`,
    };
  };

  const cellStyle = (
    column: DataColumn<T>,
    index: number,
  ): CSSProperties => {
    const width = parsePx(column.width);
    if (isFixedSticky(column)) {
      return {
        width,
        minWidth: width,
        maxWidth: width,
        left: stickyOffsets[index],
      };
    }
    if (column.sticky) {
      return {
        minWidth: width,
        left: stickyOffsets[index],
      };
    }
    return { minWidth: width };
  };

  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0, left: 0 });
  }, [resetKey]);

  useEffect(() => {
    if (!onNearEnd || !hasMore || loadingMore) return;
    const root = scrollerRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onNearEnd();
      },
      { root, rootMargin: "280px 0px", threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [onNearEnd, hasMore, loadingMore, rows.length]);

  const onRowMouseDown = (event: MouseEvent<HTMLTableRowElement>) => {
    if (!onRowClick || event.button !== 0) return;
    event.preventDefault();
  };

  const loaded = rows.length;
  const total = totalCount ?? loaded;
  const showStatus = loaded > 0;

  return (
    <div
      className="smp-table-shell"
      data-refreshing={refreshing ? "true" : "false"}
    >
      <div className="smp-table__scroller" ref={scrollerRef}>
        <table
          className="smp-table"
          style={{ width: "100%", minWidth: tableWidth }}
        >
          <colgroup>
            {visibleColumns.map((column) => (
              <col key={column.id} style={colStyle(column)} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((column, index) => (
                <th
                  key={column.id}
                  data-align={column.align ?? "left"}
                  data-sticky={column.sticky ? "true" : undefined}
                  data-person={column.person ? "true" : undefined}
                  style={cellStyle(column, index)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const key = getKey(row, index);
              const interactive = Boolean(onRowClick);
              return (
                <tr
                  key={String(key)}
                  className={cn(interactive && "smp-table__row--interactive")}
                  data-selected={selectedKey === key ? "true" : "false"}
                  onMouseDown={interactive ? onRowMouseDown : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {visibleColumns.map((column, columnIndex) => (
                    <td
                      key={column.id}
                      data-align={column.align ?? "left"}
                      data-sticky={column.sticky ? "true" : undefined}
                      data-person={column.person ? "true" : undefined}
                      style={cellStyle(column, columnIndex)}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="smp-table__empty">{empty}</div>
        ) : (
          <div ref={sentinelRef} className="smp-table__sentinel" />
        )}
      </div>
      {showStatus ? (
        <div className="smp-table__status">
          <span>
            {loaded === total ? `${total} rows` : `${loaded} of ${total}`}
          </span>
          {loadingMore ? (
            <span className="smp-table__status-more">Loading</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
