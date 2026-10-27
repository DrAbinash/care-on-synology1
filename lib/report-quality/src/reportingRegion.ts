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

/**
 * The coverage one region LABEL documents — a single tab ("Cervical Spine") or the
 * multi-region form a recorded transition stores ("Cervical Spine + LS Spine").
 * Splitting on "+" is what makes the multi-select case honest: the union is the
 * answer, and a label nobody separated is still read as one region.
 */
export function coverageOfRegionLabel(
  label: string | null | undefined,
): Set<SpineCoverageSegment> | null {
  return coverageUnionOfRegions((label ?? "").split("+").map((part) => part.trim()));
}

/** What a report format declares it documents. */
export type FormatCoverageDeclaration = {
  /** Study-region name or catalog body-part the format belongs to. */
  bodyPart?: string | null;
  /** Catalog protocol (`Screening`, or a structured row's `study_type`). */
  protocolScope?: string | null;
  /** Catalog tags, the structured place an authored format records its scope. */
  diagnosisTags?: readonly string[] | null;
};

/**
 * The wording that says "this document covers the whole spine, not just the part it
 * is named after". One regular expression, because a format's tags, a structured row's
 * `study_type` and its `template_name` all have to be read the same way — two spellings
 * of this test is how one surface starts widening where the other refuses.
 */
const WHOLE_SPINE_SCREENING_MARKER_RE = /whole[\s-]?spine|screening_whole_spine|wbv/i;

export function declaresWholeSpineScreening(text: string | null | undefined): boolean {
  return WHOLE_SPINE_SCREENING_MARKER_RE.test(text ?? "");
}

/**
 * A screening examination of the whole spine documents more segments than the one
 * it is named after: the shipped "MRI Cervical Spine with Whole Spine Screening"
 * row is body part Cervical and its findings speak for the dorsal and lumbosacral
 * spine too. That is declared, not guessed — the catalog row's `study_type` and a
 * built-in baseline's tags both carry it — and only that declaration widens here.
 *
 * Null when the format is not spine at all: the same "no opinion" answer
 * `coverageOfRegion` gives, so a brain format is never measured against a spine ceiling.
 */
export function formatDocumentedCoverage(
  decl: FormatCoverageDeclaration,
): Set<SpineCoverageSegment> | null {
  const base = coverageOfRegion(decl.bodyPart);
  if (!base) return null;
  const declared = `${(decl.diagnosisTags ?? []).join(" ")} ${decl.protocolScope ?? ""}`;
  if (!declaresWholeSpineScreening(declared)) return base;
  return new Set<SpineCoverageSegment>(["cervical", "dorsal", "lumbar"]);
}

/**
 * True when `candidate` documents a segment `allowed` does not. A null on either
 * side means no opinion, and no opinion never excludes a format — refusing on
 * nothing is how a study loses its only normal report.
 */
export function coverageExceeds(
  candidate: Set<SpineCoverageSegment> | null,
  allowed: Set<SpineCoverageSegment> | null,
): boolean {
  if (!candidate || !allowed) return false;
  for (const segment of candidate) if (!allowed.has(segment)) return true;
  return false;
}

/**
 * What two coverage statements agree on.
 *
 * A null is "no opinion" (`coverageOfRegion` answers that for a non-spine region), so it
 * never narrows: the other statement governs. When both speak and share nothing the result
 * is the empty set, and a caller must decide what an empty ceiling means — it is a
 * contradiction between two decisions, not permission to document everything.
 */
export function intersectCoverage(
  a: Set<SpineCoverageSegment> | null,
  b: Set<SpineCoverageSegment> | null,
): Set<SpineCoverageSegment> | null {
  if (!a) return b;
  if (!b) return a;
  const shared = new Set<SpineCoverageSegment>();
  for (const segment of a) if (b.has(segment)) shared.add(segment);
  return shared;
}
