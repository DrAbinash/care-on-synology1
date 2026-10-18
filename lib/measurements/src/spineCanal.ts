// spineCanal.ts — the ONE authoritative disc-level vocabulary for the spinal
// canal AP diameter, and the canonical shape of one AP-canal measurement.
//
// Why this lives here and not in a component: four separate level vocabularies
// grew up around the canal table (the client engine, the canvas grid, the
// finding composer, and a hard-coded copy inside the server's print renderer),
// and the same anatomy could be persisted under two different names. A level
// list is clinical identity, so it belongs in the package that already owns
// measurement identity — the same reason CANAL_AP is registered in catalog.ts.
//
// Two rules this module exists to enforce:
//   1. Aliases may be accepted at INPUT boundaries. Only canonical keys may
//      enter persisted clinical state. T8-T9 and D8-D9 are the same record.
//   2. A derived projection (print, ledger, Composer) reads the canonical
//      record. Nothing writes back into it.

export type CanalSegment = "lumbar" | "cervical" | "dorsal";

/** Lumbar disc levels. Transitional anatomy adds a key — see mriSpineNumbering. */
export const LUMBAR_CANAL_LEVELS = [
  "L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1",
] as const;

/**
 * Routine cervical disc levels. C1-C2 is excluded deliberately: there is no
 * intervertebral disc at C1-C2, so an "AP canal diameter at C1-C2" is not a
 * disc-level measurement and must not be offered as one. An upper-cervical
 * measurement is its own specialized thing, not a seventh row here.
 */
export const CERVICAL_CANAL_LEVELS = [
  "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1",
] as const;

/**
 * Dorsal disc levels. D-form is canonical for both storage and display; the
 * thoracic T* spelling survives only as an accepted input alias, because
 * existing report templates and OHIF caliper labels were authored that way.
 */
export const DORSAL_CANAL_LEVELS = [
  "D1-D2", "D2-D3", "D3-D4", "D4-D5", "D5-D6", "D6-D7",
  "D7-D8", "D8-D9", "D9-D10", "D10-D11", "D11-D12",
] as const;

/**
 * The thoracolumbar junction. Never a routine member: it exists only when the
 * acquired coverage actually reaches the conus, so a level that was not
 * acquired can never receive a measurement.
 */
export const DORSAL_JUNCTION_LEVEL = "D12-L1";

export type CanalLevelOptions = { thoracolumbar?: boolean };

/** The levels a segment offers for this study. The only level list anyone may render from. */
export function canalLevelsForSegment(
  segment: CanalSegment,
  opts: CanalLevelOptions = {},
): readonly string[] {
  if (segment === "cervical") return CERVICAL_CANAL_LEVELS;
  if (segment === "dorsal") {
    return opts.thoracolumbar
      ? [...DORSAL_CANAL_LEVELS, DORSAL_JUNCTION_LEVEL]
      : DORSAL_CANAL_LEVELS;
  }
  return LUMBAR_CANAL_LEVELS;
}

/**
 * Normalize any accepted spelling to the canonical persisted key.
 *
 * Handles "L4-5", "L4/5", "L4–5", "l4-l5", "T8-T9" → "D8-D9".
 *
 * C7-T1 is decided BEFORE the thoracic rewrite: a blanket T→D substitution
 * turns "C7-T1" into "C7-D1", which belongs to no level list at all. That
 * rewrite order is the whole reason this function is not a one-liner.
 */
export function canonicalizeCanalLevel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase().replace(/[_/–—\s]/g, "-");
  if (!s) return null;

  // The cervicothoracic junction first, from every spelling that means it.
  if (/^C7-T1$/.test(s) || /^C7-D1$/.test(s) || /^C7-T$/.test(s)) return "C7-T1";
  // A sacrum-bearing lumbar key must survive the rewrite untouched.
  const sacral = s.match(/^(L\d{1,2})-S1$/);
  if (sacral) return `${sacral[1]}-S1`;
  // Transitional lumbar keys (L5-T, L6-S1) are lumbar numbering, not dorsal.
  if (/^L\d{1,2}-T$/.test(s)) return s;

  const rewritten = s.replace(/\bT(\d{1,2})\b/g, "D$1");
  const m = rewritten.match(/^(D|C|L)(\d{1,2})-(D|C|L)?(\d{1,2})$/);
  if (!m) return null;
  const upper = `${m[1]}${m[2]}`;
  const lowerPrefix = m[3] ?? m[1];
  // A level cannot descend below the segment it started in.
  if ("DCL".indexOf(lowerPrefix) < "DCL".indexOf(m[1])) return null;
  return `${upper}-${lowerPrefix}${m[4]}`;
}

/**
 * The label to show. D is the default dorsal spelling throughout CARE — T* is
 * accepted at input boundaries so an OHIF caliper named "T8-T9" still resolves,
 * but it is never what a CARE table renders, and it never reaches persisted
 * state. One letter, one meaning, on screen and in storage.
 */
export function displayCanalLevel(canonical: string | null | undefined): string {
  if (!canonical) return "";
  return canonicalizeCanalLevel(canonical) ?? String(canonical).trim().toUpperCase();
}

export function isCanalLevelInSegment(
  segment: CanalSegment,
  level: string,
  opts: CanalLevelOptions = {},
): boolean {
  const canonical = canonicalizeCanalLevel(level);
  return canonical !== null
    && canalLevelsForSegment(segment, opts).includes(canonical);
}

/** Which canal table a level belongs to. Junction keys resolve to their segment. */
export function canalSegmentForLevel(level: string | null | undefined): CanalSegment | null {
  const canonical = canonicalizeCanalLevel(level);
  if (!canonical) return null;
  if (canonical.startsWith("L") || canonical === "L5-S1") return "lumbar";
  if (canonical.startsWith("C")) return "cervical";
  if (canonical.startsWith("D")) return "dorsal";
  return null;
}

/** The number as printed. Whitespace-trimmed text in, text out — never a parse
 *  that could turn an unmeasured cell into a `0`. */
export function printCanalApValue(raw: number | string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (typeof raw === "number" && !Number.isFinite(raw)) return null;
  return s;
}

/**
 * The same examination's canonical record, level by level.
 *
 * `null` is an answer, not an absence: it means the draft HAS a record for that
 * level and the record refuses to report a number (two aliases disagreeing, or a
 * vertebra that moved under it). Callers must not treat it as "no opinion" and
 * fall back to the other store — that is how a declined measurement would end up
 * printed anyway.
 */
export function canalApLevelsFromCanonicalRecord(raw: unknown): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const { records } = canonicalizeCanalMap(raw as Record<string, unknown>);
  for (const [level, rec] of Object.entries(records)) {
    out.set(level, printCanalApValue(canalApValue(rec)));
  }
  return out;
}

/**
 * Fold the two stores into the one map the table prints from.
 *
 * The canonical record wins; a `null` from it deletes the level (the record
 * declined, so nothing prints); a level only the legacy store knows keeps its row.
 * Pure, so the print renderer, the draft preview, the structured (D1) preparers and
 * the workspace's own PDF export all fold identically — one fold, not two that
 * could disagree about which number a signed report carries.
 */
export function mergeCanalApLevels(
  serverByLevel: ReadonlyMap<string, string>,
  canonicalByLevel: ReadonlyMap<string, string | null>,
): Map<string, string> {
  const merged = new Map<string, string>(serverByLevel);
  for (const [level, value] of canonicalByLevel) {
    if (value === null) merged.delete(level);
    else merged.set(level, value);
  }
  return merged;
}

// ── The printed table: which columns, in which order, under which title ──────
//
// ONE plan for every surface that prints canal numbers — the draft preview, the
// legacy signed body, the structured (D1) final and amendment, and the workspace's
// own PDF — so no surface can invent its own column list. It replaced a per-surface
// habit of choosing the segment with the most filled cells, which silently dropped
// every level of the other segment: a Dorso-Lumbar study with three lumbar and one
// dorsal measurement printed a LUMBAR table, and the dorsal disc was simply absent
// from the signed report (owner DECISION 1, 2026-10-17).

/** Head to tail. The order a printed table lays its segments out in. */
const CANAL_PRINT_SEGMENT_ORDER: CanalSegment[] = ["cervical", "dorsal", "lumbar"];

/** Sorts a level key anatomically within its segment: upper vertebra, then the
 *  lower one — with a transitional key that names no lower vertebra (`L5-T`, a
 *  sacralised L5) after every numbered one. */
function canalLevelOrderKey(level: string): [number, number, number] {
  const segment = canalSegmentForLevel(level);
  const segRank = segment === null ? 999 : CANAL_PRINT_SEGMENT_ORDER.indexOf(segment);
  const m = level.match(/^([CDLS])(\d{1,2})-([CDLS])(\d{1,2})?/);
  if (!m) return [segRank < 0 ? 999 : segRank, 999, 999];
  const upper = Number(m[2]);
  const lowerPrefix = m[3];
  const lowerNumber = m[4] ? Number(m[4]) : null;
  const lower = lowerNumber ?? (lowerPrefix === "S" ? 101 : 201);
  return [segRank, upper, lower];
}

export type CanalPrintPlan = {
  /** The segments the study actually measured, in head-to-tail order. */
  segments: CanalSegment[];
  /** Every column the table prints: each measured segment's full level list, in order. */
  levels: string[];
  /** The printed heading, derived from the columns rather than written by hand. */
  title: string;
};

/**
 * Lay out the printed canal table for the levels a study carries numbers for.
 *
 * A segment joins the table when at least one of its levels is measured, and it
 * joins with its FULL level list: the unmeasured discs print blank (`—`), which is
 * what the interactive grid shows and what the clinic's reports have always shown.
 * Nothing is ever invented — a blank cell is the absence of a measurement, not a
 * number. The thoracolumbar junction (`D12-L1`) is the deliberate exception: it is
 * offered only when it was measured, because it exists only when the acquired
 * coverage actually reaches the conus.
 *
 * `null` means there is nothing to print at all.
 */
export function canalPrintPlan(measuredLevels: Iterable<string>): CanalPrintPlan | null {
  const keys = new Set<string>();
  for (const raw of measuredLevels) {
    // A stored level that is not a canonical key (`"L4"`, an OHIF label nobody
    // normalised) still belongs to a segment and still carries a number, so it is
    // kept as written rather than dropped for failing to parse. Dropping it is how
    // a measured disc disappears from a signed report.
    const key = (canonicalizeCanalLevel(raw) ?? String(raw ?? "").trim()).toUpperCase();
    if (key) keys.add(key);
  }
  if (keys.size === 0) return null;

  const sortedKeys = [...keys].sort((a, b) => {
    const ka = canalLevelOrderKey(a);
    const kb = canalLevelOrderKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
  });
  const segments = CANAL_PRINT_SEGMENT_ORDER.filter((s) =>
    sortedKeys.some((k) => canalSegmentForLevel(k) === s),
  );

  const levels: string[] = [];
  for (const segment of segments) {
    const column = [...canalLevelsForSegment(segment)];
    if (segment === "dorsal" && keys.has(DORSAL_JUNCTION_LEVEL)) column.push(DORSAL_JUNCTION_LEVEL);
    // A transitional vertebra offers keys no routine list contains (`L5-T`, `L5-L6`,
    // `L6-S1`). They are accepted, saved and restored by the grid, so they print.
    for (const key of sortedKeys) {
      if (canalSegmentForLevel(key) === segment && !column.includes(key)) column.push(key);
    }
    levels.push(...column);
  }

  return { segments, levels, title: canalPrintTitle(segments, levels[0], levels[levels.length - 1]) };
}

/** The heading for the span a table covers. Dorso-Lumbar is the examination the
 *  clinic books, so it gets its own name; any other multi-segment span is called
 *  what it demonstrably is — more than one segment of the spine — rather than a
 *  compound examination name nobody booked. */
export function canalPrintTitle(
  segments: readonly CanalSegment[],
  firstLevel: string,
  lastLevel: string,
): string {
  const span =
    segments.length === 1
      ? segments[0].toUpperCase()
      : segments.length === 2 && segments[0] === "dorsal" && segments[1] === "lumbar"
        ? "DORSO-LUMBAR"
        : "SPINAL";
  return `${span} CANAL AP DIAMETER AT ${firstLevel} TO ${lastLevel} LEVELS`;
}

// ── Has this body already RENDERED a canal table? ────────────────────────────
//
// The signed body used to answer this by looking for the PHRASE "CANAL AP
// DIAMETER" anywhere in it. Radiologists write that phrase in prose —
// "Canal AP diameter 8 mm." — and the phrase match then suppressed the whole
// table, including a measurement taken after the prose was generated (owner
// DECISION 2, 2026-10-17). So identity is the table's own structure.
//
// A second distinction turned out to matter just as much, and is measured rather
// than assumed: the clinic's own LS-Spine template carries a canal grid whose
// every cell is a dash (`| L1-L2 | — |`, structuredReportTemplates.ts:188), and
// the report the radiologist signs must still print the numbers. A scaffold with
// nothing in it is a placeholder for exactly those numbers, so it is not evidence
// that a measurement has already been printed — and it is removed when the real
// table takes its place, so the report carries one grid, not two.

/** A level key as it appears in a column heading or a row label: `L1-L2`,
 *  `D12-L1`, `C7-T1`, and the transitional `L5-T`. Removed before asking whether a
 *  table carries a measurement, because the level names themselves are digits. */
const CANAL_LEVEL_TOKEN = /\b[CDLS]\d{1,2}(?:-[CDLS]?\d{1,2}|-T)\b/g;

/** Words that name the canal column, however the author spelled them. */
const CANAL_COLUMN_WORDS = /\b(?:AP\s*canal|canal\s*AP|AP\s*\(mm\))\b/i;

/** The printed heading is uppercase, names both ends of the table, and occupies a
 *  line of its own — or, in an HTML body, a markup element of its own
 *  (`<div class="section-heading">…LEVELS</div>`). Prose cannot produce either: a
 *  sentence that mentions the canal diameter does not end the line after "LEVELS". */
const CANAL_TABLE_TITLE = /(?:^|>)[ \t]*[A-Z][A-Z \-]*CANAL AP DIAMETER AT \S+ TO \S+ LEVELS[ \t]*(?:$|<)/gim;

/** The value row the AI-tab table writes: a whole line beginning `AP (mm)`, then
 *  one tab-separated cell per level. A bare `LEVEL` row is NOT enough — a grading
 *  table starts the same way, and a false "there is already a table here" is
 *  exactly how a measurement goes missing. */
const CANAL_TABLE_AP_ROW = /^[ \t]*AP \(mm\)[^\n]*$/gim;

export type CanalTableRegion = {
  /** Offset of the region's first character, heading line included when it has one. */
  start: number;
  /** Offset just past the region's last character. */
  end: number;
  /** True when some cell of this table carries a measurement number. */
  valued: boolean;
};

/** Does this text hold a measurement, once the level names have been taken out? */
function carriesMeasurement(text: string): boolean {
  return /\d/.test(text.replace(CANAL_LEVEL_TOKEN, " "));
}

/** `<th>`/`<td>` text of one HTML table, tags gone. */
function htmlCellText(tableHtml: string): string {
  return [...tableHtml.matchAll(/<(?:th|td)(?:\s[^>]*)?>([\s\S]*?)<\/(?:th|td)>/gi)]
    .map((m) => m[1].replace(/<[^>]*>/g, ""))
    .join(" ");
}

function tableTextRegion(m: string, start: number, valued: boolean): CanalTableRegion {
  return { start, end: start + m.length, valued };
}

/** A markdown run: consecutive lines that start with `|`, plus the heading line
 *  immediately above it when that line ends with `:` (`Canal Diameter:`). */
function markdownTableSpans(body: string): Array<{ start: number; end: number; text: string }> {
  const spans: Array<{ start: number; end: number; text: string }> = [];
  let offset = 0;
  let run: { start: number; end: number; lines: string[] } | null = null;
  for (const line of body.split("\n")) {
    const isRow = /^[ \t]*\|/.test(line);
    if (isRow) {
      if (!run) run = { start: offset, end: offset + line.length, lines: [] };
      else run.end = offset + line.length;
      run.lines.push(line);
    } else if (run) {
      spans.push({ start: run.start, end: run.end, text: run.lines.join("\n") });
      run = null;
    }
    offset += line.length + 1;
  }
  if (run) spans.push({ start: run.start, end: run.end, text: run.lines.join("\n") });
  return spans.map((s) => {
    const before = body.slice(0, s.start);
    const headingMatch = before.match(/(^|\n)([ \t]*[^\n|:]{1,60}:[ \t]*)\n$/);
    const heading = headingMatch?.[2];
    const startWithHeading = heading ? s.start - heading.length - 1 : s.start;
    return { start: Math.max(0, startWithHeading), end: s.end, text: s.text };
  });
}

/**
 * Every rendered canal AP table in this body, with whether it carries a number.
 *
 * Recognises the four shapes a real canal table arrives in — the printed HTML table,
 * the printed plain-text block, a markdown pipe table whose column names the canal
 * AP diameter, and an HTML `<table>` with that column — and nothing else. Prose that
 * merely mentions a canal diameter matches no shape, which is the point: it used to
 * hold the measurement out of the signed report.
 */
export function findCanalApTables(body: string | null | undefined): CanalTableRegion[] {
  if (!body) return [];
  const found: CanalTableRegion[] = [];

  // The builder's own output, HTML or text. It is only ever produced when the study
  // has a measurement, so a table carrying this heading is always a valued one.
  for (const m of body.matchAll(CANAL_TABLE_TITLE)) {
    found.push(tableTextRegion(m[0], m.index ?? 0, true));
  }
  for (const m of body.matchAll(CANAL_TABLE_AP_ROW)) {
    found.push(tableTextRegion(m[0], m.index ?? 0, carriesMeasurement(m[0])));
  }
  for (const table of body.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const cells = htmlCellText(table[0]);
    if (!CANAL_COLUMN_WORDS.test(cells)) continue;
    found.push(tableTextRegion(table[0], table.index ?? 0, carriesMeasurement(cells)));
  }
  for (const span of markdownTableSpans(body)) {
    if (!CANAL_COLUMN_WORDS.test(span.text)) continue;
    found.push({ start: span.start, end: span.end, valued: carriesMeasurement(span.text) });
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * True when the body already carries a canal table that REPORTS a measurement.
 *
 * A blank scaffold is deliberately not enough: the clinic's own LS-Spine template
 * ships a canal grid full of dashes, and treating it as "already printed" would
 * drop every real number out of the signed report.
 */
export function hasRenderedCanalApTable(body: string | null | undefined): boolean {
  return findCanalApTables(body).some((t) => t.valued);
}

/**
 * Remove canal grids that carry no measurement, so the authoritative table takes
 * the placeholder's place instead of sitting beside it. A table that reports a
 * number is left exactly as it is — it may be the radiologist's own words.
 */
export function stripUnmeasuredCanalScaffold(body: string): string {
  const blanks = findCanalApTables(body).filter((t) => !t.valued);
  if (blanks.length === 0) return body;
  let out = "";
  let cursor = 0;
  for (const blank of blanks) {
    if (blank.start < cursor) continue;
    out += body.slice(cursor, blank.start);
    cursor = blank.end;
  }
  out += body.slice(cursor);
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

/** What the viewer said, what the radiologist chose, and how they are linked. */
export interface CanalApMeasurement {
  /** Canonical persisted key. Never an alias. */
  level: string;
  measurementId: "CANAL_AP";
  unit: "mm";
  region: CanalSegment | null;
  /** The caliper's own number, kept even after the radiologist types another. */
  viewerValue: number | null;
  /** The radiologist's chosen number. Null means "report the viewer value". */
  reportValue: number | null;
  manualOverride: boolean;
  annotationId: string | null;
  viewerMeasurementRowId: number | null;
  studyInstanceUID: string | null;
  seriesInstanceUID: string | null;
  sopInstanceUID: string | null;
  /** Null when unknown. A fabricated frame is worse than no frame. */
  frameNumber: number | null;
  viewerName: string | null;
  capturedAt: string | null;
  /** Reserved: set only by an explicit radiologist verification. */
  verifiedAt: string | null;
  staleReason: CanalApStaleReason | null;
  /**
   * Two legacy alias keys held this level with different answers. Nothing is
   * chosen on the radiologist's behalf while this is set — see canalApValue.
   */
  aliasConflict: CanalAliasConflict | null;
}

export type CanalApStaleReason =
  | "measurement_changed"
  | "annotation_deleted"
  | "annotation_missing"
  /**
   * Vertebral numbering changed (transitional vertebra, LSTV, coverage), so
   * this level key is no longer one the study offers. The record is kept and
   * flagged rather than renamed: relabelling a stored measurement to whatever
   * the new numbering happens to call that position would silently move a
   * number from one disc to another.
   */
  | "level_renumbered";

export interface CanalAliasConflict {
  /** The alias spellings the draft actually contained, in the order found. */
  aliasKeys: string[];
  /** The value each alias held, same order. Null means that alias had none. */
  values: Array<number | null>;
}

/** The number that goes in the report. A conflicted or renumbered level reports nothing. */
export function canalApValue(rec: CanalApMeasurement | null | undefined): number | null {
  if (!rec || rec.aliasConflict) return null;
  // The level this was measured at is no longer a level the study has. Keeping
  // the number and dropping the claim on the anatomy is the safe half: reporting
  // it against a label that moved would be a different measurement.
  if (rec.staleReason === "level_renumbered") return null;
  if (rec.reportValue != null) return rec.reportValue;
  return rec.viewerValue;
}

/**
 * Reconcile stored records against a level list that has just changed.
 *
 * A record whose level is no longer offered is flagged, never renamed and never
 * deleted. Renaming is the dangerous option — it would move a number from one
 * disc to another because the counting changed under it.
 */
export function flagRenumberedCanalLevels(
  records: Record<string, CanalApMeasurement>,
  isStillValid: (level: string) => boolean,
): { records: Record<string, CanalApMeasurement>; flaggedLevels: string[] } {
  const next: Record<string, CanalApMeasurement> = {};
  const flaggedLevels: string[] = [];
  for (const [key, rec] of Object.entries(records)) {
    if (isStillValid(key)) {
      next[key] = rec;
      continue;
    }
    next[key] = { ...rec, staleReason: "level_renumbered" };
    flaggedLevels.push(key);
  }
  return { records: next, flaggedLevels: flaggedLevels.sort() };
}

/**
 * True when two records describe the same measurement, so alias entries can be
 * collapsed without choosing between clinical answers. Anchor data is not
 * compared: a richer link is strictly better than a weaker one for the same
 * number, and that is a merge, not a conflict.
 */
function sameClinicalAnswer(a: CanalApMeasurement, b: CanalApMeasurement): boolean {
  return a.viewerValue === b.viewerValue && a.reportValue === b.reportValue;
}

function anchorStrength(rec: CanalApMeasurement): number {
  return (rec.annotationId ? 4 : 0)
    + (rec.sopInstanceUID ? 2 : 0)
    + (rec.seriesInstanceUID ? 1 : 0)
    + (rec.viewerMeasurementRowId != null ? 1 : 0);
}

/** Parse one persisted entry. Tolerates the pre-record shape, which held a single `value`. */
export function parseCanalApMeasurement(
  raw: unknown,
  levelKey?: string,
): CanalApMeasurement | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const level = canonicalizeCanalLevel(String(o.level ?? levelKey ?? "")) ?? String(levelKey ?? "").trim();
  if (!level) return null;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const num = (v: unknown): number | null => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const n = Number(v.trim());
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  // frame_number defaults to 1 in the DB and the ingest route writes `?? 1`, so
  // a 1 here may mean "nobody knew". Treat it as unknown unless the row says so.
  const frameRaw = o.frameNumber;
  const frame = frameRaw === 1 || frameRaw === "1" ? null : num(frameRaw);

  const manualOverride = o.manualOverride === true;
  const legacyValue = num(o.value);
  // The pre-record shape stored one number. When it was flagged manual, the
  // caliper's own reading had already been overwritten, so the honest parse is
  // "the radiologist's number, viewer value unknown" — not a claimed 9.4 twice.
  const viewerValue = "viewerValue" in o ? num(o.viewerValue) : (manualOverride ? null : legacyValue);
  const reportValue = "reportValue" in o
    ? num(o.reportValue)
    : (manualOverride ? legacyValue : null);

  const regionRaw = str(o.region) ?? str(o.measurementType);
  const region: CanalSegment | null =
    regionRaw === "lumbar" || regionRaw === "cervical" || regionRaw === "dorsal"
      ? regionRaw
      : canalSegmentForLevel(level);

  return {
    level,
    measurementId: "CANAL_AP",
    unit: "mm",
    region,
    viewerValue,
    reportValue,
    manualOverride,
    annotationId: str(o.annotationId),
    viewerMeasurementRowId: num(o.viewerMeasurementRowId),
    studyInstanceUID: str(o.studyInstanceUID),
    seriesInstanceUID: str(o.seriesInstanceUID),
    sopInstanceUID: str(o.sopInstanceUID),
    frameNumber: frame,
    viewerName: str(o.viewer) ?? str(o.viewerName),
    capturedAt: str(o.capturedAt),
    verifiedAt: str(o.verifiedAt),
    staleReason: isStaleReason(o.staleReason) ? o.staleReason : null,
    aliasConflict: isAliasConflict(o.aliasConflict) ? o.aliasConflict : null,
  };
}

function isStaleReason(v: unknown): v is CanalApStaleReason {
  return v === "measurement_changed"
    || v === "annotation_deleted"
    || v === "annotation_missing"
    || v === "level_renumbered";
}

function isAliasConflict(v: unknown): v is CanalAliasConflict {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.aliasKeys) && Array.isArray(o.values);
}

/** A viewer measurement landed. The radiologist's own number, if any, is untouched. */
export function applyCanalViewerValue(
  prev: CanalApMeasurement | null,
  next: {
    level: string;
    viewerValue: number;
    region?: CanalSegment | null;
    annotationId?: string | null;
    viewerMeasurementRowId?: number | null;
    studyInstanceUID?: string | null;
    seriesInstanceUID?: string | null;
    sopInstanceUID?: string | null;
    frameNumber?: number | null;
    viewerName?: string | null;
    capturedAt?: string | null;
  },
): CanalApMeasurement {
  const level = canonicalizeCanalLevel(next.level);
  const base: CanalApMeasurement = prev ?? emptyCanalRecord(level ?? next.level);
  const changed = base.viewerValue !== null && base.viewerValue !== next.viewerValue;
  return {
    ...base,
    level: level ?? base.level,
    region: next.region ?? base.region ?? canalSegmentForLevel(level ?? base.level),
    viewerValue: next.viewerValue,
    // A new caliper reading is not a new answer to "what did I edit". The
    // override stays, and the drift becomes visible instead of blocking.
    staleReason: base.manualOverride && changed ? "measurement_changed" : base.staleReason,
    aliasConflict: null,
    annotationId: next.annotationId ?? base.annotationId,
    viewerMeasurementRowId: next.viewerMeasurementRowId ?? base.viewerMeasurementRowId,
    studyInstanceUID: next.studyInstanceUID ?? base.studyInstanceUID,
    seriesInstanceUID: next.seriesInstanceUID ?? base.seriesInstanceUID,
    sopInstanceUID: next.sopInstanceUID ?? base.sopInstanceUID,
    frameNumber: next.frameNumber ?? base.frameNumber,
    viewerName: next.viewerName ?? base.viewerName,
    capturedAt: next.capturedAt ?? base.capturedAt,
  };
}

/** The radiologist typed a number. The caliper's number and its link survive. */
export function applyCanalManualValue(
  prev: CanalApMeasurement | null,
  level: string,
  value: number | null,
  region?: CanalSegment | null,
): CanalApMeasurement {
  const canonical = canonicalizeCanalLevel(level);
  const base: CanalApMeasurement = prev ?? emptyCanalRecord(canonical ?? level);
  if (value === null) {
    // Clearing the cell returns to the viewer's answer rather than keeping a
    // manual override over nothing, which would report an empty number forever.
    return { ...base, level: canonical ?? base.level, reportValue: null, manualOverride: false };
  }
  return {
    ...base,
    level: canonical ?? base.level,
    region: base.region ?? region ?? canalSegmentForLevel(canonical ?? base.level),
    reportValue: value,
    manualOverride: true,
    // Staleness is about the viewer drifting away from this record. Editing the
    // number is not staleness, and marking it as such would make every
    // radiologist override look like a fault to be cleared.
    aliasConflict: null,
  };
}

function emptyCanalRecord(level: string): CanalApMeasurement {
  return {
    level,
    measurementId: "CANAL_AP",
    unit: "mm",
    region: canalSegmentForLevel(level),
    viewerValue: null,
    reportValue: null,
    manualOverride: false,
    annotationId: null,
    viewerMeasurementRowId: null,
    studyInstanceUID: null,
    seriesInstanceUID: null,
    sopInstanceUID: null,
    frameNumber: null,
    viewerName: null,
    capturedAt: null,
    verifiedAt: null,
    staleReason: null,
    aliasConflict: null,
  };
}

export interface CanalMapCanonicalization {
  /** Keyed by canonical level. Every key here is a key of the persisted shape. */
  records: Record<string, CanalApMeasurement>;
  /** Canonical keys where the draft held disagreeing aliases. Also present in `records`. */
  conflictedLevels: string[];
  /** Alias keys folded away because a canonical entry (or an equal alias) already held them. */
  deduplicatedAliases: Array<{ from: string; to: string }>;
}

/**
 * Fold a persisted map to one record per level.
 *
 * Legacy drafts can hold "T8-T9" and "D8-D9" as separate entries because two
 * writers spelled the same level differently. Equal answers merge, preferring
 * the entry with the stronger image link. Different answers are preserved and
 * flagged — choosing between them is a clinical decision, and a de-duplication
 * routine does not get to make it.
 */
export function canonicalizeCanalMap(
  raw: Record<string, unknown> | null | undefined,
): CanalMapCanonicalization {
  const records: Record<string, CanalApMeasurement> = {};
  const conflictedLevels: string[] = [];
  const deduplicatedAliases: Array<{ from: string; to: string }> = [];
  if (!raw || typeof raw !== "object") return { records, conflictedLevels, deduplicatedAliases };

  const byCanonical = new Map<string, Array<{ key: string; rec: CanalApMeasurement }>>();
  for (const [key, value] of Object.entries(raw)) {
    const rec = parseCanalApMeasurement(value, key);
    if (!rec) continue;
    const canonical = canonicalizeCanalLevel(key) ?? rec.level;
    if (!canonical) continue;
    const bucket = byCanonical.get(canonical) ?? [];
    bucket.push({ key, rec: { ...rec, level: canonical } });
    byCanonical.set(canonical, bucket);
  }

  for (const [canonical, entries] of byCanonical) {
    if (entries.length === 1) {
      const only = entries[0];
      records[canonical] = only.rec;
      // A conflict written by a previous pass must survive the round trip.
      // Dropping it here would resolve the disagreement by reopening the draft.
      if (only.rec.aliasConflict) conflictedLevels.push(canonical);
      if (only.key !== canonical) deduplicatedAliases.push({ from: only.key, to: canonical });
      continue;
    }
    const first = entries[0];
    const allAgree = entries.every((e) => sameClinicalAnswer(e.rec, first.rec));
    if (allAgree) {
      const best = entries.reduce((a, b) => (anchorStrength(b.rec) > anchorStrength(a.rec) ? b : a));
      records[canonical] = best.rec;
      for (const e of entries) {
        if (e.key !== canonical) deduplicatedAliases.push({ from: e.key, to: canonical });
      }
      continue;
    }
    const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key));
    records[canonical] = {
      ...sorted[0].rec,
      aliasConflict: {
        aliasKeys: sorted.map((e) => e.key),
        values: sorted.map((e) => canalApValue(e.rec)),
      },
    };
    conflictedLevels.push(canonical);
  }

  return {
    records,
    conflictedLevels: conflictedLevels.sort(),
    deduplicatedAliases,
  };
}

// ── The AI Composer's read-only projection ──────────────────────────────────
//
// A language model that writes a spine report must be handed the same numbers the
// signed table prints, or the report carries two canal diameters for one disc. So
// this projection answers through the identical authority as the print fold
// (`canonicalizeCanalMap` → `canalApValue` → `printCanalApValue`) and in the
// identical order (`canalPrintPlan`).
//
// It is deliberately STRICTER than print about one thing. `canalPrintPlan` keeps
// a stored level it cannot canonicalise, because dropping it is how a measured
// disc disappears from a signed report. A prose generator gets no such key: a
// number attached to an anatomy the model cannot name is how a level gets invented
// downstream. Those keys are reported as `ambiguousLevels` and withheld.
//
// Nothing here writes. The canonical record is the only store (owner DECISION 4,
// RIS-013); this is a derived read of it, the same kind of projection the print
// preparers are.

export interface CanalApComposerReading {
  /** Canonical persisted key — the same label the printed table puts in the column. */
  level: string;
  /** The number as text, exactly as `canalPrintPlan` would print it. Never re-parsed. */
  valueMm: string;
  unit: "mm";
  /** Which canal table this level belongs to. */
  segment: CanalSegment | null;
  /** Whose number this is, so the prompt can say so. */
  source: "radiologist-entered" | "viewer-caliper";
  manualOverride: boolean;
  /**
   * Verbatim from the record. `measurement_changed` keeps its radiologist number
   * (that is what the table prints), so the drift travels with the reading rather
   * than being hidden from the reader.
   */
  staleReason: CanalApStaleReason | null;
}

export interface CanalApComposerRecord {
  /** Reportable diameters, ordered exactly as the printed table lays its columns out. */
  readings: CanalApComposerReading[];
  /**
   * Levels the authority REFUSES to answer for (`aliasConflict`, `level_renumbered`).
   * The model must say nothing about these discs, so they are named rather than
   * silently absent.
   */
  declinedLevels: string[];
  /** Keys that resolve to no canonical level. Withheld from the clinical text. */
  ambiguousLevels: string[];
  /** True when the study carries no canal record at all. */
  isEmpty: boolean;
}

/**
 * The canal AP diameters a compose job may be told about, from the draft's
 * `structured_json.careCanalApProvenance`.
 *
 * Accepts the raw persisted shape (an object keyed by level, whose entries may be
 * full records or the older single-`value` form) and tolerates a missing or
 * malformed one by carrying nothing — an absent measurement is never an error.
 */
export function canalApComposerReadings(raw: unknown): CanalApComposerRecord {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const { records } = canonicalizeCanalMap(source);

  const readings: CanalApComposerReading[] = [];
  const declinedLevels: string[] = [];
  const ambiguousLevels: string[] = [];

  for (const [storedKey, rec] of Object.entries(records)) {
    // A key that is not its own canonical form names no anatomy the model can be
    // trusted with. `canonicalizeCanalMap` already folded every alias it could
    // resolve, so anything failing here is a genuinely unresolvable label.
    if (canonicalizeCanalLevel(storedKey) !== storedKey) {
      ambiguousLevels.push(storedKey);
      continue;
    }
    const value = canalApValue(rec);
    if (value === null) {
      // Two ways the authority declines, and one way it simply has no number.
      if (rec.aliasConflict || rec.staleReason === "level_renumbered") {
        declinedLevels.push(storedKey);
      }
      continue;
    }
    const valueMm = printCanalApValue(value);
    if (valueMm === null) continue;
    readings.push({
      level: storedKey,
      valueMm,
      unit: "mm",
      segment: canalSegmentForLevel(storedKey) ?? rec.region,
      source: rec.manualOverride || rec.reportValue != null ? "radiologist-entered" : "viewer-caliper",
      manualOverride: rec.manualOverride,
      staleReason: rec.staleReason,
    });
  }

  const plan = readings.length > 0 ? canalPrintPlan(readings.map((r) => r.level)) : null;
  const printOrder = plan?.levels ?? [];
  readings.sort((a, b) => {
    const ia = printOrder.indexOf(a.level);
    const ib = printOrder.indexOf(b.level);
    return (ia < 0 ? printOrder.length : ia) - (ib < 0 ? printOrder.length : ib);
  });
  declinedLevels.sort();
  ambiguousLevels.sort();

  return {
    readings,
    declinedLevels,
    ambiguousLevels,
    isEmpty: readings.length === 0 && declinedLevels.length === 0 && ambiguousLevels.length === 0,
  };
}
