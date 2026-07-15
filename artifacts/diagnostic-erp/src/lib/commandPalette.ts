/**
 * commandPalette.ts — the pure engine behind the Reporting Workspace's
 * universal Ctrl+K command palette (Radiologist Productivity, PR #77).
 *
 * The palette is a *view* over data the workspace already has cached (quick
 * findings, protocols, templates, clinical-history chips, studies) plus a
 * static command/settings registry — there is NO new search index and NO new
 * data model. This module only turns those items into a ranked, grouped view;
 * the React component owns rendering and the workspace owns the run handlers.
 *
 * Alias-free (no `@/` imports) so it is unit-testable under the root vitest
 * config, same reasoning as quickSelectFindingsPayload.ts / structuredFindings.ts.
 *
 * Extensibility: adding a new searchable surface is one new `PaletteItemKind`
 * plus building its items — ranking, grouping, favourites and recents all work
 * automatically. "Any action reachable from Ctrl+K" is a matter of registering
 * a command item, never touching this engine.
 */

export type PaletteItemKind =
  | "study"
  | "protocol"
  | "template"
  | "finding"
  | "history"
  | "combination"
  | "command"
  | "setting";

export interface PaletteItem {
  /** Stable unique id, conventionally `${kind}:${sourceId}`. */
  id: string;
  kind: PaletteItemKind;
  title: string;
  subtitle?: string;
  /** Extra searchable text (tags, study type, aliases) — never displayed. */
  keywords?: string;
  /** Whether the user may ⭐ this item (protocols / templates / findings). */
  favouritable?: boolean;
  /** Opaque payload the workspace uses to run the item (a finding, protocol…). */
  payload?: unknown;
}

export interface RankContext {
  query: string;
  /** Recently-run item ids, most-recent first. */
  recent: readonly string[];
  /** Favourited item ids. */
  favourites: ReadonlySet<string>;
}

export interface PaletteSection {
  key: string;
  label: string;
  items: PaletteItem[];
}

// Display order + headings for the per-kind groups (search view).
export const CATEGORY_LABEL: Record<PaletteItemKind, string> = {
  study: "Studies",
  protocol: "Protocols",
  template: "Templates",
  finding: "Quick Findings",
  history: "Clinical History",
  combination: "Saved Combinations",
  command: "Commands",
  setting: "Settings",
};

const CATEGORY_ORDER: PaletteItemKind[] = [
  "finding", "protocol", "template", "combination", "history", "study", "command", "setting",
];

const MATCH = { exact: 50, prefix: 40, word: 30, substr: 20, keyword: 10, none: -1 };
const FAVOURITE_BOOST = 100;
const RECENT_BASE = 200; // recent items outrank favourites; recency breaks ties within

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How well an item matches the query (higher = better; <0 = no match). */
export function matchScore(item: PaletteItem, queryLower: string): number {
  const t = item.title.toLowerCase();
  if (t === queryLower) return MATCH.exact;
  if (t.startsWith(queryLower)) return MATCH.prefix;
  if (new RegExp(`\\b${escapeRegExp(queryLower)}`).test(t)) return MATCH.word;
  if (t.includes(queryLower)) return MATCH.substr;
  if ((item.keywords ?? "").toLowerCase().includes(queryLower)) return MATCH.keyword;
  return MATCH.none;
}

/** Composite score: match quality + favourite + recency boosts. Recent →
 *  favourite → exact → partial → remaining falls out of the boost sizes. */
export function scoreItem(item: PaletteItem, ctx: RankContext, queryLower: string): number {
  const m = matchScore(item, queryLower);
  if (m < 0) return -Infinity;
  const recentIdx = ctx.recent.indexOf(item.id);
  const recentBoost = recentIdx >= 0 ? RECENT_BASE - recentIdx : 0;
  const favBoost = ctx.favourites.has(item.id) ? FAVOURITE_BOOST : 0;
  return m + recentBoost + favBoost;
}

/**
 * Build the palette's sectioned view.
 *
 * - Empty query → curated landing view: Recent (recency order, capped 10),
 *   then Favourites, then Commands — instant keyboard access without typing.
 * - Non-empty query → matched items ranked by scoreItem, grouped by kind;
 *   sections ordered by their best item (so the group holding your
 *   recent/favourite/exact hit floats to the top), ties broken by category
 *   order. Every section internally ranked.
 *
 * `recentLimit` and `perSection` keep the list short so rendering stays instant.
 */
export function buildPaletteView(
  items: PaletteItem[],
  ctx: RankContext,
  opts: { recentLimit?: number; perSection?: number } = {},
): PaletteSection[] {
  const recentLimit = opts.recentLimit ?? 10;
  const perSection = opts.perSection ?? 8;
  const q = ctx.query.trim().toLowerCase();

  if (!q) {
    const byId = new Map(items.map((it) => [it.id, it]));
    const recentItems = ctx.recent
      .map((id) => byId.get(id))
      .filter((it): it is PaletteItem => !!it)
      .slice(0, recentLimit);
    const shown = new Set(recentItems.map((it) => it.id));
    const favouriteItems = items.filter((it) => ctx.favourites.has(it.id) && !shown.has(it.id));
    favouriteItems.forEach((it) => shown.add(it.id));
    const commandItems = items.filter((it) => it.kind === "command" && !shown.has(it.id));
    return [
      recentItems.length ? { key: "recent", label: "Recent", items: recentItems } : null,
      favouriteItems.length ? { key: "favourites", label: "Favourites", items: favouriteItems } : null,
      commandItems.length ? { key: "command", label: CATEGORY_LABEL.command, items: commandItems } : null,
    ].filter((s): s is PaletteSection => !!s);
  }

  const scored = items
    .map((it) => ({ it, s: scoreItem(it, ctx, q) }))
    .filter((x) => x.s > -Infinity)
    .sort((a, b) => b.s - a.s || a.it.title.localeCompare(b.it.title));

  const groups = new Map<PaletteItemKind, { items: PaletteItem[]; best: number }>();
  for (const { it, s } of scored) {
    const g = groups.get(it.kind) ?? { items: [], best: s };
    if (g.items.length < perSection) g.items.push(it);
    g.best = Math.max(g.best, s);
    groups.set(it.kind, g);
  }

  return [...groups.entries()]
    .sort((a, b) => b[1].best - a[1].best || CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]))
    .map(([kind, g]) => ({ key: kind, label: CATEGORY_LABEL[kind], items: g.items }));
}

/** Flatten sections to the linear order the arrow keys walk. */
export function flattenSections(sections: PaletteSection[]): PaletteItem[] {
  return sections.flatMap((s) => s.items);
}

/** Move an id to the front of the recents list, de-duped and capped. Pure. */
export function pushRecent(recent: readonly string[], id: string, max = 10): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}

/** Toggle an id in a favourites set, returning a new array. Pure. */
export function toggleFavourite(favourites: readonly string[], id: string): string[] {
  return favourites.includes(id) ? favourites.filter((f) => f !== id) : [...favourites, id];
}
