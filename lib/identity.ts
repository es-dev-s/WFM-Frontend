export type IdentityLike = {
  email?: string;
  id?: string;
  memberId?: string;
  employeeId?: string;
  name?: string;
  source?: "bio" | "tivazo";
};

export type IdentityIndex = {
  canonical: Map<string, string>;
  nameRoots: Map<string, string>;
};

export function normalizeEmail(value: string | undefined | null): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizePersonName(value: string | undefined | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[._']/g, " ")
    .replace(/\s+/g, " ");
}

const COMPOSITE_DAY_ID = /:\d{4}-\d{2}-\d{2}$/;

function stableId(value: string | undefined | null): string {
  const id = String(value ?? "").trim().toLowerCase();
  if (!id || COMPOSITE_DAY_ID.test(id)) return "";
  return id;
}

export function identityTokens(row: IdentityLike): string[] {
  const tokens: string[] = [];
  const email = normalizeEmail(row.email);
  if (email) tokens.push(email);
  for (const value of [row.memberId, row.employeeId, row.id]) {
    const id = stableId(value);
    if (id && id !== email && !tokens.includes(id)) tokens.push(id);
  }
  return tokens;
}

export function identityName(row: IdentityLike): string {
  return normalizePersonName(row.name);
}

function findRoot(parent: Map<string, string>, token: string): string {
  let cursor = token;
  while (parent.get(cursor) && parent.get(cursor) !== cursor) {
    const next = parent.get(cursor)!;
    parent.set(cursor, parent.get(next) || next);
    cursor = next;
  }
  if (!parent.has(cursor)) parent.set(cursor, cursor);
  return cursor;
}

function unionTokens(parent: Map<string, string>, left: string, right: string): void {
  const a = findRoot(parent, left);
  const b = findRoot(parent, right);
  if (a !== b) parent.set(a, b);
}

export function createIdentityIndex(people: IdentityLike[]): IdentityIndex {
  const parent = new Map<string, string>();
  const clusters: { tokens: string[]; name: string; sources: Set<"bio" | "tivazo"> }[] = [];

  for (const row of people) {
    const tokens = identityTokens(row);
    const name = identityName(row);
    if (!tokens.length && !name) continue;
    if (tokens.length) {
      let root = tokens[0];
      for (const token of tokens) {
        unionTokens(parent, root, token);
        root = findRoot(parent, token);
      }
    }
    const sources = new Set<"bio" | "tivazo">();
    if (row.source) sources.add(row.source);
    clusters.push({ tokens, name, sources });
  }

  const nameGroups = new Map<string, { roots: Set<string>; sources: Set<"bio" | "tivazo"> }>();
  for (const cluster of clusters) {
    if (!cluster.name) continue;
    const roots = cluster.tokens.length
      ? new Set(cluster.tokens.map((token) => findRoot(parent, token)))
      : new Set<string>();
    const group = nameGroups.get(cluster.name) ?? { roots: new Set<string>(), sources: new Set() };
    for (const root of roots) group.roots.add(root);
    if (!roots.size) group.roots.add(`n:${cluster.name}:${group.roots.size}`);
    for (const source of cluster.sources) group.sources.add(source);
    nameGroups.set(cluster.name, group);
  }

  for (const [name, group] of nameGroups) {
    const roots = [...group.roots];
    const bioAndTivazo = group.sources.has("bio") && group.sources.has("tivazo");
    if (roots.length === 2 && bioAndTivazo) {
      unionTokens(parent, roots[0], roots[1]);
    }
    if (roots.length === 1 && !roots[0].startsWith("n:")) {
      parent.set(`n:${name}`, findRoot(parent, roots[0]));
    }
  }

  const canonical = new Map<string, string>();
  const emails = new Map<string, string>();
  for (const row of people) {
    const tokens = identityTokens(row);
    if (!tokens.length) continue;
    const root = findRoot(parent, tokens[0]);
    const email = normalizeEmail(row.email);
    const key = email || tokens[0];
    const prev = emails.get(root);
    emails.set(root, prev && prev.includes("@") ? prev : key);
  }
  for (const row of people) {
    const tokens = identityTokens(row);
    const name = identityName(row);
    const anchor = tokens[0] || (name ? `n:${name}` : "");
    if (!anchor || !parent.has(anchor) && !tokens.length) continue;
    const root = tokens.length ? findRoot(parent, tokens[0]) : findRoot(parent, `n:${name}`);
    const canon = emails.get(root) || root;
    for (const token of tokens) canonical.set(token, canon);
    if (name && nameGroups.get(name)?.roots.size === 1) canonical.set(`n:${name}`, canon);
  }

  const nameRoots = new Map<string, string>();
  for (const [name, group] of nameGroups) {
    const liveRoots = [
      ...new Set(
        [...group.roots]
          .filter((root) => !root.startsWith("n:"))
          .map((root) => findRoot(parent, root)),
      ),
    ];
    if (liveRoots.length === 1) {
      const root = liveRoots[0];
      const canon = emails.get(root) || canonical.get(root) || root;
      nameRoots.set(name, canon);
      canonical.set(`n:${name}`, canon);
    }
  }

  return { canonical, nameRoots };
}

export function identityCanonical(index: IdentityIndex, row: IdentityLike): string {
  for (const token of identityTokens(row)) {
    const hit = index.canonical.get(token);
    if (hit) return hit;
  }
  const name = identityName(row);
  if (name) {
    const byName = index.nameRoots.get(name) || index.canonical.get(`n:${name}`);
    if (byName) return byName;
  }
  return identityTokens(row)[0] || name;
}

export function identitiesMatch(index: IdentityIndex, left: IdentityLike, right: IdentityLike): boolean {
  const a = identityCanonical(index, left);
  const b = identityCanonical(index, right);
  return Boolean(a && b && a === b);
}

export function identityMatchesNeedle(row: IdentityLike, needle: string, index?: IdentityIndex): boolean {
  const want = needle.trim().toLowerCase();
  if (!want) return true;
  if (identityTokens(row).some((token) => token === want) || identityName(row) === normalizePersonName(needle)) {
    return true;
  }
  if (!index) return false;
  const canon = identityCanonical(index, { email: want, id: want, name: needle });
  const rowCanon = identityCanonical(index, row);
  return Boolean(canon && rowCanon && canon === rowCanon);
}
