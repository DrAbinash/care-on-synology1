/**
 * Disc-level spinal canal AP helpers — ONE common engine for:
 *   Lumbar   L1-L2 … L5-S1
 *   Cervical C1-C2 … C7-T1
 *   Dorsal   D1-D2 … D11-D12  (CARE terminology; T* labels normalize to D*)
 *
 * Tables are blank-by-default: never invent 0 / "normal".
 */

import type { SpineSegment } from "@/lib/reportingStudyContext";

export const LUMBAR_CANAL_LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"] as const;

/** Seven cervical disc levels (C1–C2 through C7–T1) for canal AP tables. */
export const CERVICAL_CANAL_LEVELS = [
  "C1-C2", "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1",
] as const;

/** Dorsal (thoracic) disc levels — CARE uses D1–D12, not T*. */
export const DORSAL_CANAL_LEVELS = [
  "D1-D2", "D2-D3", "D3-D4", "D4-D5", "D5-D6", "D6-D7",
  "D7-D8", "D8-D9", "D9-D10", "D10-D11", "D11-D12",
] as const;

export type CanalDiscLevel =
  | (typeof LUMBAR_CANAL_LEVELS)[number]
  | (typeof CERVICAL_CANAL_LEVELS)[number]
  | (typeof DORSAL_CANAL_LEVELS)[number];

export type CanalSegment = "lumbar" | "cervical" | "dorsal";

export function canalSegmentFromSpine(segment: SpineSegment | null | undefined): CanalSegment | null {
  if (segment === "lumbar") return "lumbar";
  if (segment === "cervical") return "cervical";
  if (segment === "dorsal") return "dorsal";
  return null;
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

export function levelsForCanalSegment(segment: CanalSegment): readonly CanalDiscLevel[] {
  if (segment === "cervical") return CERVICAL_CANAL_LEVELS;
  if (segment === "dorsal") return DORSAL_CANAL_LEVELS;
  return LUMBAR_CANAL_LEVELS;
}

export function canalTableTitle(segment: CanalSegment): string {
  if (segment === "cervical") return "CERVICAL CANAL AP DIAMETER AT C1 TO C7 LEVELS";
  if (segment === "dorsal") return "DORSAL CANAL AP DIAMETER AT D1 TO D12 LEVELS";
  return "LUMBAR CANAL AP DIAMETER AT L1 TO L5 LEVELS";
}

export function canalSegmentBadge(segment: CanalSegment): string {
  if (segment === "cervical") return "Cervical";
  if (segment === "dorsal") return "Dorsal";
  return "LS Spine";
}

/**
 * Normalize OHIF-style labels: "L4-5", "L4/5", "T4-T5", "D4-D5" → CARE disc form.
 * Thoracic T* is rewritten to CARE dorsal D*.
 */
export function normalizeDiscLevel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().toUpperCase().replace(/[_/–—]/g, "-").replace(/\s+/g, "");
  // Map thoracic T → CARE dorsal D (observation ledger already prefers D).
  s = s.replace(/\bT(\d{1,2})\b/g, "D$1");
  const m = s.match(/^([CDL])(\d{1,2})-([CDL])?(\d{1,2}|S1)$/);
  if (!m) {
    const full = s.match(/^([CDL]\d{1,2}|S1)-([CDL]\d{1,2}|S1)$/);
    return full ? `${full[1]}-${full[2]}` : null;
  }
  const upper = m[1];
  const uNum = m[2];
  const lowerPrefix = m[3] || (m[4] === "S1" ? "S" : upper);
  const lNum = m[4];
  const lower = lNum === "S1" ? "S1" : `${lowerPrefix}${lNum}`;
  return `${upper}${uNum}-${lower}`;
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

/** True when level belongs to the given canal segment's table. */
export function isLevelInSegment(segment: CanalSegment, level: string): boolean {
  return (levelsForCanalSegment(segment) as readonly string[]).includes(level);
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
export type CanalApCellProvenance = {
  region: CanalSegment;
  level: string;
  measurementType: "CANAL_AP";
  value: string;
  unit: "mm";
  measurementId?: string | null;
  annotationId?: string | null;
  studyInstanceUID?: string | null;
  seriesInstanceUID?: string | null;
  sopInstanceUID?: string | null;
  frameNumber?: number | null;
  instanceNumber?: number | null;
  viewer?: string | null;
  capturedAt?: string | null;
  manualOverride: boolean;
};

export type CanalApProvenanceMap = Record<string, CanalApCellProvenance>;

/**
 * Apply a viewer-derived canal AP value with manual-override protection.
 * Returns null when blocked (manual override without forceRefresh).
 */
export function applyCanalApValue(opts: {
  level: string;
  nextValue: string;
  currentValue?: string;
  provenance?: CanalApCellProvenance | null;
  forceRefresh?: boolean;
}): { value: string; provenance: CanalApCellProvenance } | { blocked: true } {
  const num = parseCanalApNumber(opts.nextValue);
  if (!num) return { blocked: true };
  if (opts.provenance?.manualOverride && !opts.forceRefresh) {
    return { blocked: true };
  }
  const base = opts.provenance ?? {
    region: "lumbar" as CanalSegment,
    level: opts.level,
    measurementType: "CANAL_AP" as const,
    value: num,
    unit: "mm" as const,
    manualOverride: false,
  };
  return {
    value: num,
    provenance: {
      ...base,
      level: opts.level,
      value: num,
      unit: "mm",
      measurementType: "CANAL_AP",
      manualOverride: false,
    },
  };
}

/** Mark a cell as manually overridden (radiologist wins). */
export function markCanalApManualOverride(
  provenance: CanalApCellProvenance | null | undefined,
  level: string,
  value: string,
  region: CanalSegment,
): CanalApCellProvenance {
  return {
    ...(provenance ?? {
      region,
      level,
      measurementType: "CANAL_AP",
      unit: "mm",
    }),
    region: provenance?.region ?? region,
    level,
    value: parseCanalApNumber(value) || value,
    unit: "mm",
    measurementType: "CANAL_AP",
    manualOverride: true,
  };
}
