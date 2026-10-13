/**
 * reportingRegion.ts — the spine region vocabulary, in one place.
 *
 * These functions decide what a region NAME means: which family it belongs to,
 * which spine segment(s) it acquires, and what the picker's legacy aliases map
 * to. They were in `artifacts/diagnostic-erp/src/lib/reportingStudyContext.ts`
 * and `regionTransition.ts`, which is fine while only the workspace reads them.
 * The printed page needs the same answers from the API server (`reportPresentation`
 * is rendered server-side, the workspace PDF is rendered client-side), and two
 * copies of a region vocabulary is how a report comes to print one region on the
 * paper and another on the PDF. The ERP modules now re-export these, so no
 * caller changed and there is still exactly one implementation.
 *
 * Pure TypeScript: no React, no Express, no database — the same code runs in the
 * browser bundle and in the server bundle.
 */

export type ReportingFamily = "brain" | "spine" | "chest" | "abdomen" | "unknown";

/**
 * A coarse routing discriminator derived from the primary region name. It is
 * NOT an anatomical region, NOT a ledger region, NOT a screening region and NOT
 * a study composition, and no consumer may treat it as one of those.
 *
 * The meanings every consumer gives it are listed on the re-export in
 * `artifacts/diagnostic-erp/src/lib/reportingStudyContext.ts`, next to the
 * consumers they name.
 */
export type SpineSegment = "cervical" | "dorsal" | "dorsolumbar" | "lumbar" | "whole" | "generic";

export function familyFromRegion(region: string | null | undefined): ReportingFamily {
  if (!region) return "unknown";
  const r = region.toLowerCase();
  if (r.includes("brain") || r.includes("head") || r.includes("skull") || r.includes("pituitary")) {
    return "brain";
  }
  if (
    r.includes("spine")
    || r.includes("cervical")
    || r.includes("lumbar")
    || r.includes("lumbo")
    || r.includes("dorsal")
    || r.includes("thoracic")
  ) {
    return "spine";
  }
  if (r.includes("chest") || r.includes("thorax") || r.includes("lung")) return "chest";
  if (r.includes("abdomen") || r.includes("pelvis")) return "abdomen";
  return "unknown";
}

/**
 * A Dorso-Lumbar examination names both halves of the spine, or carries the
 * clinic's own "DL" abbreviation for it. "DORSAL" never matches: it does not
 * contain "dorso", and the catalog books the dorsal examination under its own name.
 */
export function isDorsoLumbarRegionName(region: string | null | undefined): boolean {
  const r = (region ?? "").toLowerCase().replace(/[\s-]+/g, "");
  if (!r) return false;
  if (r.includes("thoracolumbar") || r.includes("dorsolumbar")) return true;
  if (r.includes("dlspine") || r.includes("tlsspine")) return true;
  return /dors.*lumbar|thoraco.*lumbar/.test(r);
}

export function spineSegmentFromRegion(region: string | null | undefined): SpineSegment | null {
  if (familyFromRegion(region) !== "spine") return null;
  const r = (region ?? "").toLowerCase();
  if (r.includes("whole spine")) return "whole";
  if (r.includes("cervical")) return "cervical";
  // Before the dorsal / lumbar substring tests: "dorso lumbar" contains
  // "lumbar", and the old code therefore read a Dorso-Lumbar booking as LS.
  if (isDorsoLumbarRegionName(region)) return "dorsolumbar";
  if (r.includes("dorsal") || r.includes("thoracic")) return "dorsal";
  if (r.includes("ls spine") || r.includes("lumbar") || r.includes("lumbo")) return "lumbar";
  return "generic";
}

/**
 * Map legacy picker aliases onto radiology_study_tabs.name.
 * "C Spine" in the format dialog is the same region as "Cervical Spine".
 */
export function canonicalContentRegion(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  const l = t.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
  if (l === "c spine" || l === "cervical" || l === "cspine") return "Cervical Spine";
  if (l === "t spine" || l === "thoracic spine" || l === "dorsal") return "Dorsal Spine";
  if (l === "l spine" || l === "lumbar spine" || l === "lumbosacral spine") return "LS Spine";
  return t;
}

export type SpineCoverageSegment = "cervical" | "dorsal" | "lumbar";

/** Everything a reporting region actually acquires. */
export function coverageOfRegion(region: string | null | undefined): Set<SpineCoverageSegment> | null {
  const canonical = canonicalContentRegion(region);
  const segment = spineSegmentFromRegion(canonical || (region ?? ""));
  switch (segment) {
    case "cervical":
      return new Set<SpineCoverageSegment>(["cervical"]);
    case "dorsal":
      return new Set<SpineCoverageSegment>(["dorsal"]);
    case "lumbar":
      return new Set<SpineCoverageSegment>(["lumbar"]);
    case "dorsolumbar":
      return new Set<SpineCoverageSegment>(["dorsal", "lumbar"]);
    case "whole":
      return new Set<SpineCoverageSegment>(["cervical", "dorsal", "lumbar"]);
    // "generic" (the bare "Spine" tab), null (non-spine) and anything unresolved.
    default:
      return null;
  }
}

/**
 * The union of what a whole region SELECTION acquires.
 *
 * The Study / Region chips are multi-select, and clicking one that is already selected
 * makes it primary rather than removing it (`nextStudyRegions`). Coverage is therefore a
 * property of the list, not of its first entry: Cervical + LS Spine acquires two segments,
 * and re-ordering it must not read as a narrowing that retires anything.
 * Null when nothing in the list is spine — the same "no opinion" answer `coverageOfRegion`
 * gives for a single region.
 */
export function coverageUnionOfRegions(
  regions: readonly (string | null | undefined)[],
): Set<SpineCoverageSegment> | null {
  let union: Set<SpineCoverageSegment> | null = null;
  for (const region of regions) {
    const coverage = coverageOfRegion(region);
    if (!coverage) continue;
    if (!union) union = new Set(coverage);
    else for (const segment of coverage) union.add(segment);
  }
  return union;
}
