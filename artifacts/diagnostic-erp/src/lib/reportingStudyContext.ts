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
 *   spineSegment = cervical | dorsal | dorsolumbar | lumbar | whole | generic
 *                  (a routing discriminator only — see the `SpineSegment`
 *                  docblock for what each consumer means by it)
 */

import { studyRegionToBodyPart } from "./pickStructuredTemplate";
import { templateCatalogModality } from "./radiologyTemplateModality";
// The region vocabulary is shared, because the printed page is rendered by two
// different processes: the report document server-side (`reportPresentation.ts`)
// and the workspace PDF client-side (`reportPdfGenerator.ts`). Both have to read
// "Cervical Spine" and "C-Spine" the same way or the paper and the PDF state
// different anatomy for one study. The implementation lives in
// `lib/report-quality/src/reportingRegion.ts`; these names are re-exported so
// every consumer keeps importing them from this module and there is still one
// copy of the rules.
import {
  canonicalContentRegion,
  familyFromRegion,
  isDorsoLumbarRegionName,
  spineSegmentFromRegion,
  type ReportingFamily as ReportingFamilyShared,
  type SpineSegment as SpineSegmentShared,
} from "@workspace/report-quality";

export {
  canonicalContentRegion,
  familyFromRegion,
  isDorsoLumbarRegionName,
  spineSegmentFromRegion,
};

type ReportingFamily = ReportingFamilyShared;
export type { ReportingFamily };

/**
 * A coarse routing discriminator derived from the primary region name. It is
 * NOT an anatomical region, NOT a ledger region, NOT a screening region and NOT
 * a study composition, and no consumer may treat it as one of those:
 *
 * - the ledger's own region key is `radiology_study_tabs.name` ("Dorsal Spine",
 *   "LS Spine"), carried on `region` above and on every observation;
 * - screening ownership is the three `SpineScreeningRegion` values plus a
 *   `RegionRole`, resolved from the billed catalog row;
 * - study composition (`StudyComposition`, e.g. `dorsolumbar-dedicated`) is
 *   resolved in mriDorsoLumbarCatalog.ts from catalog evidence.
 *
 * `dorsolumbar` was added as a routing value only. Every consumer of this union
 * and the meaning it gives the value:
 *
 * 1. `mriSpineCanvasRegions.ts` — ROUTING. Three gates pick which canvas opens.
 *   Each bails explicitly on `dorsolumbar` so the thoracic-only or LS-only
 *   canvas cannot claim a study that spans both, and
 *   `isMriDorsoLumbarReportingContext` claims it instead.
 * 2. `mriLumbarRegions.ts` — ROUTING / FEATURE GATE. `isMriLumbarReportingContext`
 *   decides whether the LS level-naming and LS sub-master machinery applies.
 *   It bails on `dorsolumbar`: the Dorso-Lumbar canvas reuses those builders
 *   for its lumbar domain, but the study is not an LS study.
 * 3. `findingsMacros.ts` `chocolateBoxSetFor` — MACRO CATALOG ROUTING. Which
 *   built-in quick-macro tile set the Findings box offers. `dorsolumbar` falls
 *   to `SPINE_GENERIC_SET`, deliberately not `DORSAL_SET`: a Dorso-Lumbar study
 *   owns thoracic, junction and lumbar anatomy, so it must not inherit dorsal
 *   macros (or lumbar ones) as if it were that examination. A dedicated tile
 *   set belongs to the Dorso-Lumbar palette work, not to this fallback.
 * 4. `spineCanalAp.ts` `canalSegmentFromSpine` — MEASUREMENT SCOPE. Which canal
 *   AP table the context implies. It returns null for `dorsolumbar` because no
 *   single cervical/dorsal/lumbar table describes a study crossing the junction;
 *   the Dorso-Lumbar canvas supplies its levels explicitly from
 *   `dorsolumbarApLevels` instead of letting the text heuristic answer.
 * 5. `useWorkspaceClinicalUi.tsx` `composerPrimaryRegionLabel` — PRINTED LABEL.
 *   The region string the AI composer is told it is reporting on.
 *
 * A related field, `bodyPart`, is derived from `region` (not from this union) by
 * `studyRegionToBodyPart`, and it is a STRUCTURED-TEMPLATE KEY: a Dorso-Lumbar
 * region resolves to the nearest saved template family (`SPINE_LS` for
 * "Dorso-Lumbar Spine", null for "DL Spine"), never to `SPINE_DORSAL`. Like the
 * segment, it says nothing about ledger ownership or composition.
 *
 * Nothing above changes what a `dorsolumbar` study writes into the ledger: those
 * rows keep the region the composition assigns them (see
 * `canonicalizeDorsoLumbarOwnership`), and the thoracic/lumbar anatomy domains
 * are modelled in `mriDorsoLumbarCoverage.ts`, not by this union.
 */
type SpineSegment = SpineSegmentShared;
export type { SpineSegment };
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

/**
 * Radiographic cervical text. "C-spine" and "C spine" are the live billed/format
 * spellings, and the seeded cervical knowledge pack titles its chip "Neck trauma
 * — query cervical spine injury", so `neck` is included. A dorsal or lumbar film
 * never matches: those words are excluded explicitly rather than by ordering.
 */
const CERVICAL_TEXT = /\bcervical\b|\bc[- ]?spine\b|\bcspine\b|\bneck\b/i;
const NON_CERVICAL_SPINE_TEXT = /\b(?:dorsal|thoracic|lumbar|lumbo|sacral|whole)\b/i;

/**
 * Radiographic lumbosacral text. The centre bills these films as "LS SPINE"
 * (`XRAYLSPINE`, `XR028`) while the Study Tab spells them "X-Ray Lumbar Spine",
 * so both vocabularies are first-class here. `dl` ("XRAY DL SPINE AP/LAT")
 * matches neither: a dorsolumbar film covers the thoracolumbar junction and must
 * not inherit the lumbosacral protocol silently.
 */
const LS_TEXT = /\blumbar\b|\blumbosacral\b|\blumbo\b|\bls\b|\bl[- ]s\b/i;
/**
 * "lumbosacral" is one word, so `\bsacral\b` cannot match inside it — the
 * exclusion catches a sacral film without excluding the LS study itself.
 */
const NON_LS_SPINE_TEXT =
  /\b(?:cervical|c[- ]?spine|cspine|neck|dorsal|thoracic|sacral|sacrum|coccyx|whole)\b/i;

/**
 * X-ray Lumbosacral Spine reporting context — activates the lumbosacral clinical
 * sub-master (numbering basis / LSTV handling, views and adequacy with pars,
 * oblique, flexion-extension and L5-S1 coverage gating, palettes, measurements,
 * dynamic and hardware panels).
 *
 * Mirrors isXrayCervicalReportingContext and its two failure modes: an MRI / CT /
 * US lumbar study must not receive the plain-film canvas, because the radiography
 * sub-master carries different conclusions (spec §1) — no canal, root or disc
 * signal assessment; and a lumbar X-Ray tab still qualifies when the worklist row
 * arrives with an unexpected modality string.
 */
export function isXrayLsReportingContext(opts: {
  modality?: string | null;
  region?: string | null;
  family?: string | null;
  studyDescription?: string | null;
}): boolean {
  const mod = (opts.modality ?? "").trim();
  const region = (opts.region ?? "").trim();
  const desc = (opts.studyDescription ?? "").trim();

  if (mod && !isXrModality(mod)) return false;

  // Canonical tab key: "X-Ray Lumbar Spine".
  if (region && /^X[- ]RAY\b/i.test(region) && LS_TEXT.test(region) && !NON_LS_SPINE_TEXT.test(region)) {
    return true;
  }

  if (mod && isXrModality(mod)) {
    if (region && LS_TEXT.test(region) && !NON_LS_SPINE_TEXT.test(region)) return true;
    if (desc && LS_TEXT.test(desc) && !NON_LS_SPINE_TEXT.test(desc)) return true;
    return false;
  }

  // No modality at all — require both plain-film and lumbosacral evidence.
  const hay = `${region} ${desc}`;
  return /x[- ]?ray|xray/i.test(hay) && LS_TEXT.test(hay) && !NON_LS_SPINE_TEXT.test(hay);
}

/**
 * X-ray Cervical Spine reporting context — activates the cervical clinical
 * sub-master (views/adequacy with odontoid / oblique / flexion-extension
 * gating, palettes, measurements, dynamic and hardware panels).
 *
 * Mirrors isXrayChestReportingContext, including the two failure modes it
 * avoids: an MRI / CT / US cervical study must not receive the plain-film
 * canvas (spec §1 — the radiography sub-master carries different conclusions),
 * and a cervical X-Ray tab still qualifies when the worklist row arrives with an
 * unexpected modality string.
 */
export function isXrayCervicalReportingContext(opts: {
  modality?: string | null;
  region?: string | null;
  family?: string | null;
  studyDescription?: string | null;
}): boolean {
  const mod = (opts.modality ?? "").trim();
  const region = (opts.region ?? "").trim();
  const desc = (opts.studyDescription ?? "").trim();

  if (mod && !isXrModality(mod)) return false;

  // Canonical tab key: "X-Ray Cervical Spine" (seeded radiology_study_tabs 976).
  if (region && /^X[- ]RAY\b/i.test(region) && CERVICAL_TEXT.test(region)) return true;

  if (mod && isXrModality(mod)) {
    if (region && CERVICAL_TEXT.test(region) && !NON_CERVICAL_SPINE_TEXT.test(region)) return true;
    if (desc && CERVICAL_TEXT.test(desc) && !NON_CERVICAL_SPINE_TEXT.test(desc)) return true;
    return false;
  }

  // No modality at all — require both plain-film and cervical evidence.
  const hay = `${region} ${desc}`;
  return (
    /x[- ]?ray|xray/i.test(hay) &&
    CERVICAL_TEXT.test(hay) &&
    !NON_CERVICAL_SPINE_TEXT.test(hay)
  );
}

