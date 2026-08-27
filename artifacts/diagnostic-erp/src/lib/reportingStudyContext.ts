/**
 * ReportingStudyContext — ONE resolved reporting identity per open study.
 *
 * DICOM hint → region matching stays in studyRegion.ts (`matchStudyRegion`
 * against `radiology_study_tabs.name`). This module consumes that already-
 * resolved region (plus optional manual override) and derives the stable
 * identifiers every content consumer must use.
 *
 * Downstream features must NOT re-parse `modality + StudyDescription` once
 * a context exists. StudyDescription / DICOM body part are provenance only.
 *
 * Live canonical keys (not a new taxonomy):
 *   region     = radiology_study_tabs.name  e.g. "Cervical Spine"
 *   bodyPart   = structured-template code   e.g. "SPINE_CERVICAL"
 *   family     = inheritance group          e.g. "spine"
 *   spineSegment = cervical | dorsal | lumbar | whole | generic
 */

import { studyRegionToBodyPart } from "./pickStructuredTemplate";
import { templateCatalogModality } from "./radiologyTemplateModality";

export type ReportingFamily = "brain" | "spine" | "chest" | "abdomen" | "unknown";
export type SpineSegment = "cervical" | "dorsal" | "lumbar" | "whole" | "generic";
export type ReportingSource = "auto" | "override" | "unresolved";

export type ReportingStudyContext = {
  modality: string | null;
  catalogModality: string | null;
  /** DICOM / worklist StudyDescription — provenance only. */
  studyDescription: string | null;
  /** DICOM body-part tag — provenance only; never used as the region key. */
  dicomBodyPart: string | null;
  /** Primary radiology_study_tabs.name (e.g. "Cervical Spine"). */
  region: string | null;
  /** All selected regions (multi-select). Primary is regions[0]. */
  regions: string[];
  /** Structured-template bodyPart code (BRAIN, SPINE_CERVICAL, …). */
  bodyPart: string | null;
  family: ReportingFamily;
  spineSegment: SpineSegment | null;
  source: ReportingSource;
  /** Active protocol / sub-technique name when known (format ranking only). */
  protocolName: string | null;
};

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

export function spineSegmentFromRegion(region: string | null | undefined): SpineSegment | null {
  if (familyFromRegion(region) !== "spine") return null;
  const r = (region ?? "").toLowerCase();
  if (r.includes("whole spine")) return "whole";
  if (r.includes("cervical")) return "cervical";
  if (r.includes("dorsal") || r.includes("thoracic")) return "dorsal";
  if (r.includes("ls spine") || r.includes("lumbar") || r.includes("lumbo")) return "lumbar";
  return "generic";
}

/**
 * Intentional inheritance only: a specific spine segment may also see the
 * generic "Spine" tab. Cervical never inherits lumbar (or vice versa).
 */
export function inheritedStudyTypes(region: string | null | undefined): string[] {
  if (!region) return [];
  if (familyFromRegion(region) === "spine" && region !== "Spine" && spineSegmentFromRegion(region) !== "generic") {
    return ["Spine"];
  }
  return [];
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

/** Visible region(s) plus inherited fallback keys, de-duplicated, primary first. */
export function contentStudyTypes(regions: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of regions) {
    if (!r || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
    for (const extra of inheritedStudyTypes(r)) {
      if (!seen.has(extra)) {
        seen.add(extra);
        out.push(extra);
      }
    }
  }
  return out;
}

/** True when a content row scoped to `scopeKey` belongs in this context. */
export function matchesContentScope(
  ctx: ReportingStudyContext,
  scopeKey: string | null | undefined,
): boolean {
  if (!scopeKey) return true;
  if (!ctx.region) return false;
  const allowed = new Set(
    contentStudyTypes(ctx.regions.length > 0 ? ctx.regions : [ctx.region]).map((s) => s.toLowerCase()),
  );
  return allowed.has(scopeKey.toLowerCase());
}

/**
 * Haystack for legacy `studyIncludes: "brain"|"spine"` gates.
 * Prefer the resolved region so a Cervical Spine study never matches "brain"
 * even if the raw description is noisy, and so a manual override wins.
 */
export function studyMatchHaystack(input: {
  region?: string | null;
  studyDescription?: string | null;
}): string {
  return (input.region ?? input.studyDescription ?? "").toLowerCase();
}

export function buildReportingStudyContext(input: {
  modality?: string | null;
  studyDescription?: string | null;
  dicomBodyPart?: string | null;
  regions: string[];
  source: ReportingSource;
  protocolName?: string | null;
}): ReportingStudyContext {
  const regions = input.regions.filter(Boolean);
  const region = regions[0] ?? null;
  const source: ReportingSource = region ? input.source : "unresolved";
  return {
    modality: input.modality ?? null,
    catalogModality: input.modality ? templateCatalogModality(input.modality) : null,
    studyDescription: input.studyDescription ?? null,
    dicomBodyPart: input.dicomBodyPart ?? null,
    region,
    regions,
    bodyPart: studyRegionToBodyPart(region),
    family: familyFromRegion(region),
    spineSegment: spineSegmentFromRegion(region),
    source,
    protocolName: input.protocolName ?? null,
  };
}

export const EMPTY_REPORTING_STUDY_CONTEXT: ReportingStudyContext = buildReportingStudyContext({
  regions: [],
  source: "unresolved",
});

export function reportingContextEqual(
  a: ReportingStudyContext | null | undefined,
  b: ReportingStudyContext | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.region === b.region
    && a.regions.join("\0") === b.regions.join("\0")
    && a.modality === b.modality
    && a.source === b.source
    && a.bodyPart === b.bodyPart
    && a.protocolName === b.protocolName
  );
}
