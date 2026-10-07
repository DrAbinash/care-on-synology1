/**
 * Disc-level spinal canal AP helpers — the ERP facade over the ONE authoritative
 * level vocabulary and record shape, which live in @workspace/measurements
 * because the server's print renderer has to agree with the client about them.
 *
 *   Lumbar   L1-L2 … L5-S1
 *   Cervical C2-C3 … C7-T1   (no C1-C2: there is no disc there)
 *   Dorsal   D1-D2 … D11-D12, plus D12-L1 only at thoracolumbar coverage
 *
 * Tables are blank-by-default: never invent 0 / "normal".
 */

import type { SpineSegment } from "@/lib/reportingStudyContext";
import {
  CERVICAL_CANAL_LEVELS as SHARED_CERVICAL_CANAL_LEVELS,
  DORSAL_CANAL_LEVELS as SHARED_DORSAL_CANAL_LEVELS,
  DORSAL_JUNCTION_LEVEL as SHARED_DORSAL_JUNCTION_LEVEL,
  LUMBAR_CANAL_LEVELS as SHARED_LUMBAR_CANAL_LEVELS,
  applyCanalViewerValue,
  canalApValue,
  canalLevelsForSegment,
  canonicalizeCanalLevel,
  type CanalApMeasurement,
} from "@workspace/measurements";

/** What a viewer measurement carries when it lands on a level. */
export type CanalViewerValueWrite = Parameters<typeof applyCanalViewerValue>[1];

export {
  applyCanalManualValue,
  applyCanalViewerValue,
  canalApValue,
  canalSegmentForLevel,
  canonicalizeCanalLevel,
  canonicalizeCanalMap,
  displayCanalLevel,
  flagRenumberedCanalLevels,
  parseCanalApMeasurement,
} from "@workspace/measurements";
export type { CanalApMeasurement, CanalApStaleReason, CanalAliasConflict } from "@workspace/measurements";

export const LUMBAR_CANAL_LEVELS = SHARED_LUMBAR_CANAL_LEVELS;
export const CERVICAL_CANAL_LEVELS = SHARED_CERVICAL_CANAL_LEVELS;
export const DORSAL_CANAL_LEVELS = SHARED_DORSAL_CANAL_LEVELS;
export const DORSAL_JUNCTION_LEVEL = SHARED_DORSAL_JUNCTION_LEVEL;

export type CanalDiscLevel =
  | (typeof LUMBAR_CANAL_LEVELS)[number]
  | (typeof CERVICAL_CANAL_LEVELS)[number]
  | (typeof DORSAL_CANAL_LEVELS)[number]
  | typeof DORSAL_JUNCTION_LEVEL;

export type CanalSegment = "lumbar" | "cervical" | "dorsal";

export function canalSegmentFromSpine(segment: SpineSegment | null | undefined): CanalSegment | null {
  if (segment === "lumbar") return "lumbar";
  if (segment === "cervical") return "cervical";
  if (segment === "dorsal") return "dorsal";
  return null;
}

/** Resolve which canal table to show — force dorsal overrides inferred LS/cervical. */
export function resolveActiveCanalSegment(opts: {
  spineSegment?: SpineSegment | null;
  regionHint?: string | null;
  reportingRegion?: string | null;
  studyDescription?: string | null;
  regions?: string[] | null;
  forceDorsal?: boolean;
}): CanalSegment | null {
  if (opts.forceDorsal) return "dorsal";
  const fromCtx = canalSegmentFromSpine(opts.spineSegment);
  if (fromCtx) return fromCtx;
  const hay = [
    opts.regionHint,
    opts.reportingRegion,
    opts.studyDescription,
    ...(opts.regions ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  return resolveCanalSegment(hay);
}

/** Resolve LS / cervical / dorsal from region / study description / protocol text. */
export function resolveCanalSegment(haystack: string | null | undefined): CanalSegment | null {
  const h = (haystack ?? "").toLowerCase();
  if (!h.trim()) return null;
  if (
    h.includes("cervical")
    || /\bc[\s-]?spine\b/.test(h)
    || /\bc1\b/.test(h)
    || /\bc2\b/.test(h)
    || /\bc7\b/.test(h)
  ) {
    return "cervical";
  }
  if (
    h.includes("dorsal")
    || h.includes("thoracic")
    || /\bt[\s-]?spine\b/.test(h)
    || /\bd[\s-]?spine\b/.test(h)
  ) {
    return "dorsal";
  }
  if (
    h.includes("lumbar")
    || h.includes("lumbo")
    || h.includes("ls spine")
    || h.includes("lumbosacral")
    || /\bl[\s-]?spine\b/.test(h)
    || h.includes("dl spine")
    || /dorso[-\s]?lumbar/.test(h)
  ) {
    return "lumbar";
  }
  return null;
}

export function levelsForCanalSegment(
  segment: CanalSegment,
  opts: { thoracolumbar?: boolean } = {},
): readonly string[] {
  return canalLevelsForSegment(segment, opts);
}

/**
 * The printed table heading. Derived from the level list rather than written by
 * hand, so a heading can no longer advertise a level the table cannot hold.
 */
export function canalTableTitle(segment: CanalSegment): string {
  const levels = levelsForCanalSegment(segment);
  const first = (levels[0] ?? "").split("-")[0];
  const last = (levels[levels.length - 1] ?? "").split("-").slice(1).join("-");
  const label = segment === "cervical" ? "Cervical" : segment === "dorsal" ? "Dorsal" : "Lumbar";
  return `${label.toUpperCase()} CANAL AP DIAMETER AT ${first} TO ${last} LEVELS`;
}

export function canalSegmentBadge(segment: CanalSegment): string {
  if (segment === "cervical") return "Cervical";
  if (segment === "dorsal") return "Dorsal";
  return "LS Spine";
}

/**
 * Normalize OHIF-style labels: "L4-5", "L4/5", "T4-T5", "D4-D5" → CARE disc form.
 * Thoracic T* is rewritten to CARE dorsal D*, and the cervicothoracic junction
 * is decided before that rewrite so C7-T1 cannot become C7-D1.
 */
export function normalizeDiscLevel(raw: string | null | undefined): string | null {
  return canonicalizeCanalLevel(raw);
}

/**
 * The rows an AP canal table offers, in the form the record stores them under.
 *
 * A table's level list comes from a numbering / coverage resolver, and those
 * resolvers still speak the report's letters: the dorsal resolver says "T8-T9"
 * while the canonical record says "D8-D9". Canonicalising the row list is what
 * makes a cell's READ key and its WRITE key the same key — without it a table
 * can store a measurement it then never displays, and print a blank beside a
 * number the radiologist typed. Deduped, because two spellings of one disc are
 * one row, not two cells competing for the same record.
 */
export function canalRows(levels: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const level of levels) {
    const canonical = normalizeDiscLevel(level);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

/**
 * The reportable number for one row, whichever lettering the caller holds.
 * `null` when the level is unmeasured, conflicted or renumbered — the caller
 * shows an empty cell, never a guess.
 */
export function canalApValueAt(
  records: Record<string, CanalApMeasurement | undefined> | null | undefined,
  level: string | null | undefined,
): number | null {
  if (!records) return null;
  const canonical = normalizeDiscLevel(level);
  if (!canonical) return null;
  return canalApValue(records[canonical]);
}

/** Extract a disc level from a free-form measurement label / type string. */
export function discLevelFromLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  const direct = normalizeDiscLevel(label);
  if (direct) return direct;
  const m = label.toUpperCase().match(/\b([CDLT]\d{1,2})\s*[-–—/]\s*([CDLT]?\d{1,2}|S1)\b/);
  if (!m) return null;
  return normalizeDiscLevel(`${m[1]}-${m[2]}`);
}

/** True when level belongs to the given canal segment's table. Aliases resolve first. */
export function isLevelInSegment(segment: CanalSegment, level: string): boolean {
  const canonical = normalizeDiscLevel(level);
  return canonical !== null && levelsForCanalSegment(segment).includes(canonical);
}

/**
 * Pick which canal table to render for print when multiple segment values exist.
 * Prefers the segment with the most filled cells (ties: lumbar > cervical > dorsal).
 */
export function pickPrintCanalSegment(
  byLevel: Map<string, string>,
): CanalSegment | null {
  const count = (seg: CanalSegment) =>
    levelsForCanalSegment(seg).filter((l) => byLevel.has(l) && byLevel.get(l)!.trim()).length;
  const lumbar = count("lumbar");
  const cervical = count("cervical");
  const dorsal = count("dorsal");
  if (lumbar === 0 && cervical === 0 && dorsal === 0) return null;
  if (lumbar >= cervical && lumbar >= dorsal) return "lumbar";
  if (cervical >= dorsal) return "cervical";
  return "dorsal";
}

export function formatCanalApTableText(
  segment: CanalSegment,
  values: Record<string, string>,
): string {
  const levels = levelsForCanalSegment(segment);
  const title = canalTableTitle(segment);
  const header = ["LEVEL", ...levels].join("\t");
  const row = ["AP (mm)", ...levels.map((l) => (values[l]?.trim() || "—"))].join("\t");
  const prose = levels
    .filter((l) => values[l]?.trim())
    .map((l) => `${l}: ${values[l].trim()} mm`)
    .join("; ");
  const lines = [title, header, row];
  if (prose) lines.push(`Spinal canal AP diameter — ${prose}.`);
  return lines.join("\n");
}

export function canalApToPdfRows(
  segment: CanalSegment,
  values: Record<string, string>,
): Array<{ label: string; value: string }> {
  const levels = levelsForCanalSegment(segment);
  return levels
    .filter((l) => values[l]?.trim())
    .map((l) => ({ label: `Canal AP ${l}`, value: `${values[l].trim()} mm` }));
}

/** HTML table for print / letter-pad (black-on-white bordered grid). */
export function canalApTableHtml(
  segment: CanalSegment,
  values: Record<string, string>,
  esc: (s: string) => string = (s) => s,
): string {
  const levels = levelsForCanalSegment(segment);
  const filled = levels.some((l) => values[l]?.trim());
  if (!filled) return "";
  const th = levels.map((l) => `<th style="border:1px solid #000;padding:2px 6px;font-size:11px;">${esc(l)}</th>`).join("");
  const td = levels
    .map((l) => `<td style="border:1px solid #000;padding:2px 6px;text-align:center;font-size:11px;">${esc(values[l]?.trim() || "—")}</td>`)
    .join("");
  return `<div class="section-heading" style="margin:8px 0 4px;">${esc(canalTableTitle(segment))}</div>
<table style="border-collapse:collapse;margin:0 0 8px;width:auto;">
  <thead><tr><th style="border:1px solid #000;padding:2px 6px;font-size:11px;">LEVEL</th>${th}</tr></thead>
  <tbody><tr><td style="border:1px solid #000;padding:2px 6px;font-size:11px;">AP (mm)</td>${td}</tr></tbody>
</table>`;
}

export function parseCanalApNumber(raw: string | null | undefined): string {
  if (raw == null) return "";
  const m = String(raw).replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : "";
}

/** Provenance attached to a canal cell (stored in structured_json / local state). */
/**
 * One AP-canal measurement at one level. This is the canonical record — the
 * name is kept for call-site stability, not because the object is only
 * provenance. The caliper's number and the radiologist's number live side by
 * side here, so an override never destroys what the viewer measured.
 */
export type CanalApCellProvenance = CanalApMeasurement;

/** Arm watermark so "next measurement" cannot consume pre-existing rows. */
export type CanalCaptureArm = {
  level: string;
  /** Only rows with id > maxExistingRowId are eligible. */
  maxExistingRowId: number;
  /** Annotation ids already present when armed (also excluded). */
  existingAnnotationIds: string[];
  armedAtMs: number;
};

export type CanalCaptureCandidate = {
  id: number;
  status?: string | null;
  value: string;
  createdAt?: string | null;
  imageCoordinates?: string | null;
  studyInstanceUID?: string | null;
  seriesInstanceUID?: string | null;
  sopInstanceUID?: string | null;
  frameNumber?: number | null;
  viewerName?: string | null;
  measurementId?: string | null;
};

/** Snapshot max existing row id + annotation ids when arming a canal capture level. */
export function armCanalCapture(
  level: string,
  rows: CanalCaptureCandidate[],
  parseAnnotationId: (raw: string | null | undefined) => string | null,
  nowMs: number = Date.now(),
): CanalCaptureArm {
  let maxId = 0;
  const anns: string[] = [];
  for (const r of rows) {
    if (typeof r.id === "number" && r.id > maxId) maxId = r.id;
    const a = parseAnnotationId(r.imageCoordinates);
    if (a) anns.push(a);
  }
  return {
    level,
    maxExistingRowId: maxId,
    existingAnnotationIds: anns,
    armedAtMs: nowMs,
  };
}

/**
 * Pick the newest eligible viewer row for an armed capture.
 * Historical rows (id ≤ watermark or known annotation) never qualify.
 */
export function pickEligibleCanalCaptureRow(
  arm: CanalCaptureArm,
  rows: CanalCaptureCandidate[],
  parseAnnotationId: (raw: string | null | undefined) => string | null,
  consumedIds: ReadonlySet<number>,
): CanalCaptureCandidate | null {
  const existingAnns = new Set(arm.existingAnnotationIds);
  const eligible = rows
    .filter((m) => m.status !== "ignored")
    .filter((m) => !consumedIds.has(m.id))
    .filter((m) => m.id > arm.maxExistingRowId)
    .filter((m) => {
      const a = parseAnnotationId(m.imageCoordinates);
      return !a || !existingAnns.has(a);
    })
    .sort((a, b) => {
      const tb = Date.parse(b.createdAt || "") || 0;
      const ta = Date.parse(a.createdAt || "") || 0;
      if (tb !== ta) return tb - ta;
      return b.id - a.id;
    });
  return eligible[0] ?? null;
}

export type CanalApProvenanceMap = Record<string, CanalApCellProvenance>;

// `applyCanalApValue` and `markCanalApManualOverride` used to live here. They
// were the two half-writers: one refused a viewer value outright because the
// cell had been typed in, the other stamped every keystroke as an override.
// Both are replaced by `applyCanalViewerValue` / `applyCanalManualValue` in
// @workspace/measurements, reached only through the store's single writer, so a
// manual number and a caliper number can no longer fight over one field.
