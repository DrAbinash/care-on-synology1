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
