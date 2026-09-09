"use client";

import { StatusPill } from "@/components/data/StatusPill";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useMenu } from "@/hooks/use-menu";
import {
  type SearchHit,
  type SearchResponse,
  type SearchSection,
  useQuery,
  withQuery,
} from "@/lib/api";
import { recordHref } from "@/lib/href";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

type Source = "tivazo" | "biomatic";

type FlatHit = {
  key: string;
  source: Source;
  hit: SearchHit;
  href: string;
};

function hitHref(source: Source, hit: SearchHit): string {
  if (source === "tivazo") {
    if (hit.kind === "group") {
      return `/tivazo?group=${encodeURIComponent(hit.id)}`;
    }
    return recordHref("/tivazo", hit.id);
  }
  if (hit.kind === "team") {
    return recordHref("/biomatic/teams", hit.id);
  }
  return recordHref("/biomatic/members", hit.id);
}

function flattenSection(source: Source, section: SearchSection | undefined): FlatHit[] {
  const people = section?.people ?? [];
  const teams = section?.teams ?? [];
  return [
    ...people.map((hit) => ({
      key: `${source}-person-${hit.id}`,
      source,
      hit,
      href: hitHref(source, hit),
    })),
    ...teams.map((hit) => ({
      key: `${source}-team-${hit.id}`,
      source,
      hit,
      href: hitHref(source, hit),
    })),
  ];
}

function NavbarSearchComponent() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const needle = useDebouncedValue(query.trim(), 200);
  const open = query.trim().length > 0;
  const { menuId, rootRef } = useMenu({
    open,
    onClose: () => {
      setQuery("");
      inputRef.current?.blur();
    },
  });

  const results = useQuery<SearchResponse>(
    needle.length >= 2 ? withQuery("/search", { q: needle }) : null,
  );

  const tivazoHits = useMemo(
    () => flattenSection("tivazo", results.data?.tivazo),
    [results.data],
  );
  const biomaticHits = useMemo(
    () => flattenSection("biomatic", results.data?.biomatic),
    [results.data],
  );
  const flat = useMemo(
    () => [...tivazoHits, ...biomaticHits],
    [tivazoHits, biomaticHits],
  );

  useEffect(() => {
    setActive(0);
  }, [needle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      inputRef.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (href: string) => {
    setQuery("");
    router.push(href);
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      inputRef.current?.blur();
      return;
    }
    if (!open || flat.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => (value + 1) % flat.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => (value - 1 + flat.length) % flat.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const next = flat[active] ?? flat[0];
      if (next) go(next.href);
    }
  };

  return (
    <div className="smp-search-wrap" ref={rootRef}>
      <label className="smp-search" data-open={open ? "true" : "false"}>
        <span className="smp-search__icon" aria-hidden="true">
          <Search strokeWidth={1.75} />
        </span>
        <span className="smp-sr-only">Search people and teams</span>
        <input
          ref={inputRef}
          type="search"
          className="smp-search__input"
          placeholder="Search people or teams"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
        />
        <span className="smp-search__keys" aria-hidden="true">
          <kbd className="smp-kbd">⌘</kbd>
          <kbd className="smp-kbd">K</kbd>
        </span>
      </label>

      {open ? (
        <div
          className="smp-search-panel"
          id={menuId}
          role="listbox"
          aria-label="Search results"
        >
          {needle.length < 2 ? (
            <p className="smp-search-panel__hint">
              Type at least 2 characters
            </p>
          ) : results.error && !results.data ? (
            <p className="smp-search-panel__hint">Couldn’t search. Try again.</p>
          ) : (
            <div className="smp-search-panel__grid" id={listId}>
              <SearchSectionBlock
                title="Tivazo"
                hits={tivazoHits}
                activeKey={flat[active]?.key}
                loading={results.loading}
                onPick={go}
                onHover={(key) => {
                  const index = flat.findIndex((item) => item.key === key);
                  if (index >= 0) setActive(index);
                }}
              />
              <SearchSectionBlock
                title="Biomatic"
                hits={biomaticHits}
                activeKey={flat[active]?.key}
                loading={results.loading}
                onPick={go}
                onHover={(key) => {
                  const index = flat.findIndex((item) => item.key === key);
                  if (index >= 0) setActive(index);
                }}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SearchSectionBlock({
  title,
  hits,
  activeKey,
  loading,
  onPick,
  onHover,
}: {
  title: string;
  hits: FlatHit[];
  activeKey?: string;
  loading: boolean;
  onPick: (href: string) => void;
  onHover: (key: string) => void;
}) {
  return (
    <section className="smp-search-section">
      <h3 className="smp-search-section__title">{title}</h3>
      {loading && hits.length === 0 ? (
        <p className="smp-search-section__empty">Searching…</p>
      ) : hits.length === 0 ? (
        <p className="smp-search-section__empty">No matches</p>
      ) : (
        <ul className="smp-search-section__list">
          {hits.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className="smp-search-hit"
                role="option"
                aria-selected={item.key === activeKey}
                data-active={item.key === activeKey ? "true" : "false"}
                onMouseEnter={() => onHover(item.key)}
                onClick={() => onPick(item.href)}
              >
                <span className="smp-search-hit__copy">
                  <span className="smp-search-hit__title">{item.hit.title}</span>
                  {item.hit.subtitle ? (
                    <span className="smp-search-hit__sub">{item.hit.subtitle}</span>
                  ) : null}
                </span>
                <span className="smp-search-hit__meta">
                  {item.hit.status ? (
                    <StatusPill value={item.hit.status} />
                  ) : (
                    <span className="smp-search-hit__kind">
                      {item.hit.kind === "group"
                        ? "Group"
                        : item.hit.kind === "team"
                          ? "Team"
                          : "Person"}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const NavbarSearch = memo(NavbarSearchComponent);
