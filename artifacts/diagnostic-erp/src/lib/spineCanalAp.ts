/**
 * Disc-level spinal canal AP helpers for LS / cervical MRI reports.
 * Clinical table layout matches letter-pad exports:
 *   Lumbar:   L1-L2 … L5-S1 (5 levels)
 *   Cervical: C2-C3 … C6-C7 (5 disc levels; C1–C2 omitted as AP canal table)
 */

import type { SpineSegment } from "@/lib/reportingStudyContext";

export const LUMBAR_CANAL_LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"] as const;
/** Seven cervical disc levels (C1–C2 through C7–T1) for canal AP tables. */
export const CERVICAL_CANAL_LEVELS = [
  "C1-C2", "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1",
] as const;

export type CanalDiscLevel =
  | (typeof LUMBAR_CANAL_LEVELS)[number]
  | (typeof CERVICAL_CANAL_LEVELS)[number];

export type CanalSegment = "lumbar" | "cervical";

export function canalSegmentFromSpine(segment: SpineSegment | null | undefined): CanalSegment | null {
  if (segment === "lumbar") return "lumbar";
  if (segment === "cervical") return "cervical";
  return null;
}

/** Resolve LS vs cervical from region / study description / protocol text. */
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
    h.includes("lumbar")
    || h.includes("lumbo")
    || h.includes("ls spine")
    || h.includes("lumbosacral")
    || /\bl[\s-]?spine\b/.test(h)
    || h.includes("dl spine")
    || h.includes("dorso.?lumbar")
  ) {
    return "lumbar";
  }
  return null;
}

export function levelsForCanalSegment(segment: CanalSegment): readonly CanalDiscLevel[] {
  return segment === "cervical" ? CERVICAL_CANAL_LEVELS : LUMBAR_CANAL_LEVELS;
}

export function canalTableTitle(segment: CanalSegment): string {
  return segment === "cervical"
    ? "CERVICAL CANAL AP DIAMETER AT C1 TO C7 LEVELS"
    : "LUMBAR CANAL AP DIAMETER AT L1 TO L5 LEVELS";
}

/** Normalize OHIF-style labels: "L4-5", "L4/5", "L4 – L5", "l4_l5" → "L4-L5". */
export function normalizeDiscLevel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase().replace(/[_/–—]/g, "-").replace(/\s+/g, "");
  // L4-5 or L4-L5 or L5-S1
  const m = s.match(/^([CTL])(\d{1,2})-([CTL])?(\d{1,2}|S1)$/);
  if (!m) {
    // Already "L4-L5"
    const full = s.match(/^([CTL]\d{1,2}|S1)-([CTL]\d{1,2}|S1)$/);
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
  const m = label.toUpperCase().match(/\b([CTL]\d{1,2})\s*[-–—/]\s*([CTL]?\d{1,2}|S1)\b/);
  if (!m) return null;
  return normalizeDiscLevel(`${m[1]}-${m[2]}`);
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
