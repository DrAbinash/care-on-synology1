/**
 * ReportingStudyContext — ONE resolved reporting identity per open study.
 *
 * Region matching lives in studyRegion.ts (`resolveAutoStudyRegion`: billed
 * procedure first, then modality+StudyDescription via `matchStudyRegion`
 * against `radiology_study_tabs.name`). This module consumes that already-
 * resolved region (plus optional manual override) and derives the stable
 * identifiers every content consumer must use.
 *
 * Downstream features must NOT re-parse modality + StudyDescription / billed
 * name once a context exists. StudyDescription / DICOM body part are provenance only.
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
/**
 * How the primary region was chosen.
 * - billed / dicom: auto match at study-open (billed procedure preferred)
 * - auto: legacy synonym still accepted by builders/tests (treat as dicom-era auto)
 * - override / unresolved: manual or no match
 */
export type ReportingSource = "billed" | "dicom" | "auto" | "override" | "unresolved";

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

/**
 * MRI Brain reporting context — activates Brain measures strip (ABC/2, midline,
 * ASPECTS, aneurysm). Mirrors isMriLumbarReportingContext / cervical / dorsal.
 */
export function isMriBrainReportingContext(opts: {
  modality?: string | null;
  region?: string | null;
  family?: string | null;
  studyDescription?: string | null;
}): boolean {
  const mod = (opts.modality ?? "").toUpperCase();
  if (mod && mod !== "MR" && mod !== "MRI") return false;
  if (opts.family === "brain") return true;
  const canonical = canonicalContentRegion(opts.region);
  if (canonical === "Brain" || /^brain$/i.test((opts.region ?? "").trim())) return true;
  if (familyFromRegion(opts.region) === "brain") return true;
  const desc = (opts.studyDescription ?? "").toLowerCase();
  if (/\b(mri|mr)\b/.test(desc) && /\bbrain\b/.test(desc) && !/\bspine\b/.test(desc)) {
    return true;
  }
  return false;
}

/**
 * CT Brain / stroke reporting context — same Brain measures strip for NCCT
 * stroke workups (ASPECTS, ICH ABC/2, midline).
 */
export function isCtBrainReportingContext(opts: {
  modality?: string | null;
  region?: string | null;
  family?: string | null;
  studyDescription?: string | null;
}): boolean {
  const mod = (opts.modality ?? "").toUpperCase();
  if (mod && mod !== "CT" && mod !== "CTA") return false;
  if (opts.family === "brain") return true;
  const canonical = canonicalContentRegion(opts.region);
  if (canonical === "Brain" || /^brain$/i.test((opts.region ?? "").trim())) return true;
  if (familyFromRegion(opts.region) === "brain") return true;
  const desc = (opts.studyDescription ?? "").toLowerCase();
  if (/\bct\b/.test(desc) && /\b(brain|head|stroke)\b/.test(desc) && !/\bspine\b/.test(desc)) {
    return true;
  }
  return false;
}

/** True when either MRI or CT brain context should show Brain measures. */
export function isBrainMeasuresReportingContext(opts: {
  modality?: string | null;
  region?: string | null;
  family?: string | null;
  studyDescription?: string | null;
}): boolean {
  return isMriBrainReportingContext(opts) || isCtBrainReportingContext(opts);
}

/**
 * DICOM modality codes a plain radiograph can arrive under. The billing
 * department maps "X-Ray" → "CR" (api-server radiology.ts MODALITY_MAP), so a
 * live chest film is CR — never the literal "X-RAY" that seed data uses.
 */
const XR_MODALITY_CODES = ["XR", "CR", "DX", "XA", "RF", "X-RAY", "XRAY", "X RAY"];

function isXrModality(modality: string): boolean {
  const m = modality.trim().toUpperCase();
  if (!m) return false;
  return XR_MODALITY_CODES.includes(m) || m.includes("X-RAY") || m.includes("XRAY");
}

const CHEST_TEXT = /\bchest\b|\bcxr\b|\bthorax\b|\bpneumoperitoneum\b/i;

/**
 * X-ray Chest reporting context — activates the chest clinical sub-master
 * (views/adequacy, palettes, devices). Mirrors isMriBrainReportingContext.
 *
 * Two failure modes this deliberately avoids:
 *  - CT Chest / USG Chest must NOT receive the plain-film canvas, so a
 *    recognised non-XR modality rejects immediately;
 *  - a study whose tab is a chest X-Ray tab must qualify even when the worklist
 *    row arrives with an unexpected modality string, so the tab name is
 *    accepted on its own.
 */
export function isXrayChestReportingContext(opts: {
  modality?: string | null;
  region?: string | null;
  family?: string | null;
  studyDescription?: string | null;
}): boolean {
  const mod = (opts.modality ?? "").trim();
  const region = (opts.region ?? "").trim();
  const desc = (opts.studyDescription ?? "").trim();

  if (mod && !isXrModality(mod)) return false;

  // Tab names are the canonical keys: "X-Ray Chest PA", "X-Ray Portable Chest".
  if (region && /^X[- ]RAY\b/i.test(region) && CHEST_TEXT.test(region)) return true;

  if (mod && isXrModality(mod)) {
    if (opts.family === "chest") return true;
    if (region && CHEST_TEXT.test(region)) return true;
    if (desc && CHEST_TEXT.test(desc)) return true;
    return false;
  }

  // No modality at all — require both plain-film and chest evidence.
  const hay = `${region} ${desc}`;
  return /x[- ]?ray|xray|\bcxr\b|\bcr\b|\bdx\b/i.test(hay) && CHEST_TEXT.test(hay);
}

