/**
 * Shared anatomy grouping for Section 4 Findings (clinic Quick Findings catalog).
 */

export const OTHER_ANATOMY_SECTION = "General";

const SPINAL_LEVEL_RE =
  /^(alignment|vertebrae|conus|paraspinal|sacrum|cord|canal|discs?)$/i;

/** Parse L4-5 / L4/L5 / L5-S1 style labels into sortable tuple. */
export function spinalLevelSortKey(section: string): [number, number, string] | null {
  const t = section.trim();
  const m = t.match(/^([LCST])(\d+)\s*[-/]\s*(?:([LCST])?(\d+)|S(\d+))$/i);
  if (!m) return null;
  const region = m[1]!.toUpperCase();
  const a = Number(m[2]);
  const b = m[4] != null ? Number(m[4]) : m[5] != null ? Number(m[5]) : a;
  const regionOrder = region === "C" ? 0 : region === "T" ? 1 : region === "L" ? 2 : 3;
  return [regionOrder, a * 100 + b, t.toLowerCase()];
}

export function compareAnatomySections(a: string, b: string): number {
  if (a === OTHER_ANATOMY_SECTION) return 1;
  if (b === OTHER_ANATOMY_SECTION) return -1;
  const ka = spinalLevelSortKey(a);
  const kb = spinalLevelSortKey(b);
  if (ka && kb) {
    for (let i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
    }
  }
  if (SPINAL_LEVEL_RE.test(a) && !SPINAL_LEVEL_RE.test(b)) return -1;
  if (!SPINAL_LEVEL_RE.test(a) && SPINAL_LEVEL_RE.test(b)) return 1;
  return a.localeCompare(b);
}

export function groupByAnatomy<T extends { anatomicalSection?: string | null; sortOrder: number }>(
  findings: T[],
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const f of findings) {
    const key = (f.anatomicalSection ?? "").trim() || OTHER_ANATOMY_SECTION;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }
  return [...groups.entries()].sort((a, b) => {
    const sa = Math.min(...a[1].map((x) => x.sortOrder));
    const sb = Math.min(...b[1].map((x) => x.sortOrder));
    if (sa !== sb) return sa - sb;
    return compareAnatomySections(a[0], b[0]);
  });
}

export function groupByConflict<T extends { conflictGroup?: string | null; category?: string | null; sortOrder: number }>(
  findings: T[],
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const f of findings) {
    const key = (f.conflictGroup ?? "").trim() || (f.category ?? "").trim() || "Findings";
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }
  return [...groups.entries()].sort((a, b) => {
    const sa = Math.min(...a[1].map((x) => x.sortOrder));
    const sb = Math.min(...b[1].map((x) => x.sortOrder));
    return sa - sb || a[0].localeCompare(b[0]);
  });
}

export function isSpinalLevelNavigation(sections: string[]): boolean {
  const levels = sections.filter((s) => spinalLevelSortKey(s) != null);
  return levels.length >= 3;
}

export function cycleAnatomySection(
  sections: string[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  if (sections.length === 0) return null;
  const idx = current != null ? sections.indexOf(current) : -1;
  const next = idx < 0
    ? (delta > 0 ? 0 : sections.length - 1)
    : (idx + delta + sections.length) % sections.length;
  return sections[next] ?? null;
}
