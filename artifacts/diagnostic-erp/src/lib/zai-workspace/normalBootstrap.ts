/**
 * normalBootstrap.ts — one-time complete-normal-report auto-bootstrap resolver.
 *
 * Ports the `usg-reports` product behaviour the clinic asked for:
 *   OPEN STUDY → appropriate COMPLETE NORMAL REPORT already present
 *   → radiologist records only deviations → relevant normal yields (slot engine)
 *   → untouched structures remain normal → Impression stays synchronized.
 *
 * This module ONLY decides *which existing Full Report Format* (if any) may be
 * auto-applied to a genuinely NEW, EMPTY report. It never applies anything
 * itself and never invents content — application goes through the existing
 * `applyFormatById` path (identical to a radiologist clicking the format).
 *
 * Safety rules (all must hold — "do NOT guess"):
 *   1. Modality whitelist: MR / CT / XR only (DX/CR/IO map to XR). US/MG never
 *      auto-bootstrap (mammography is not used at this clinic; US has its own
 *      companion flow).
 *   2. Candidates are COMPLETE NORMAL reports only:
 *        - name carries the word "Normal" or "Screening", AND
 *        - no pathology term is ASSERTED in findings/impression (a pathology
 *          term in the same sentence as a denial — "No disc bulge" — is fine).
 *      A whole-report format that describes Fazekas, bulges, stenosis… can
 *      never auto-apply: abnormalities are the radiologist's job (canonical
 *      ledger), never the bootstrap's.
 *   3. Canonical region must match the resolved ReportingStudyContext region.
 *   4. Protocol disambiguation by explicit markers only:
 *        contrast / post-contrast / gadolinium / CE-MRI → contrast variant
 *        epilepsy / seizure → epilepsy-protocol normal
 *        screening / whole spine → screening variant
 *        orbit → orbit limited screening
 *        plain, or no marker → plain variant (clinical convention: contrast
 *        studies are always explicitly documented; plain is the default)
 *      A contrast-marked study with no contrast variant → NO bootstrap.
 *   5. Exactly one survivor after filtering (same-identity duplicates collapse
 *      deterministically). Anything else → null (manual Start Report / picker).
 *
 * Pure functions only — no store, no React, no network.
 */

import type { ReportFormat } from "./types";
import { canonicalContentRegion } from "@/lib/reportingStudyContext";
import type { ReportingStudyContext } from "@/lib/reportingStudyContext";

/** Modalities whose studies may auto-bootstrap (MRI / CT / X-ray scope). */
const BOOTSTRAP_MODALITIES = new Set(["MR", "CT", "XR"]);

/** DICOM / worklist modality codes normalised onto the format catalog codes. */
export function bootstrapModality(raw: string | null | undefined): string | null {
  const u = (raw ?? "").toUpperCase().trim();
  if (!u) return null;
  if (u === "MR" || u === "MRI") return "MR";
  if (u === "CT") return "CT";
  if (u === "XR" || u === "XRAY" || u === "X-RAY" || u === "DX" || u === "CR" || u === "IO") return "XR";
  return null;
}

/** Pathology terms that must be DENIED in-sentence for a normal candidate. */
const ASSERTED_PATHOLOGY_TERMS = [
  "fazekas", "infarct", "ischemi", "hemorrhage", "haemorrhage", "hematoma",
  "haematoma", "hydrocephalus", "herniation", "hernia", "bulge", "protrusion",
  "prolapse", "fracture", "spondylolisthesis", "anterolisthesis", "retrolisthesis",
  "spondylodiscitis", "discitis", "degenerative", "desiccation", "stenosis",
  "myelopathy", "demyelination", "plaque", "granuloma", "tumor", "tumour",
  "glioma", "recurrence", "carcinoma", "nodule", "mass lesion", "space-occupying",
  "edema", "oedema", "effusion", "consolidation", "pneumothorax", "calculus",
  "calculi", "cholelithiasis", "listhesis", "gliosis", "compression collapse",
];

/** Denial words in the same sentence as a pathology term → term is negated. */
const DENIAL_RE =
  /\b(no|without|absence of|absent|not identified|not seen|noted\? no|free of|no evidence|no definite|no obvious|no apparent|no focal|no significant|no abnormal|no intra|no extra|none|unremarkable|negative|maintained|patent|preserved|intact|normal|symmetrical|symmetric)\b/i;

/** Marker regexes for protocol disambiguation. */
const CONTRAST_RE = /contrast|gadolin|gadobutrol|post.?contrast|ce.?mri|c\.?e\.?mri/i;
const PLAIN_RE = /\bplain\b|non.?contrast|without contrast/i;
const EPILEPSY_RE = /epilep|seizure/i;
const SCREENING_RE = /screen|whole.?spine|wbv/i;
const ORBIT_RE = /orbit/i;

/** True when `text` asserts a pathology (term present, not denied in-sentence). */
function assertsPathology(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    for (const term of ASSERTED_PATHOLOGY_TERMS) {
      if (!lower.includes(term)) continue;
      if (DENIAL_RE.test(sentence)) continue; // negated in the same sentence
      return true;
    }
  }
  return false;
}

/**
 * True when a format is a COMPLETE NORMAL report that may auto-apply.
 * Screening normals are allowed (they ARE complete normal reports) — but only
 * if their body actually reads normal (the pathological "screening" complete
 * cases like the degenerative LS+Whole-Spine variant fail the assertion check).
 */
export function isNormalBootstrapCandidate(
  format: Pick<ReportFormat, "name" | "findings" | "impression" | "diagnosisTags" | "protocolScope">,
): boolean {
  const name = (format.name ?? "").toLowerCase();
  const isNormalish = /\bnormal\b/.test(name) || /\bscreening\b/.test(name);
  if (!isNormalish) return false;
  const body = `${format.findings ?? ""}\n${format.impression ?? ""}`;
  if (assertsPathology(body)) return false;
  return true;
}

export type NormalBootstrapInput = {
  /** Resolved study context (region / regions must be resolved, not "unresolved"). */
  ctx: Pick<ReportingStudyContext, "modality" | "region" | "regions" | "protocolName" | "studyDescription">;
  /** Loaded Full Report Format library (store list at call time). */
  formats: ReportFormat[];
};

export type NormalBootstrapDecision =
  | {
    status: "apply";
    format: ReportFormat;
    /** Human-readable basis, surfaced in the toast / tests. */
    basis: string;
  }
  | {
    /** Identity resolved but no unique safe candidate — keep manual flow. */
    status: "no-match" | "ambiguous";
    reason: string;
  };

function regionKeys(ctx: Pick<ReportingStudyContext, "region" | "regions">): string[] {
  const raw = (ctx.regions?.length ? ctx.regions : ctx.region ? [ctx.region] : []).filter(Boolean);
  return [...new Set(raw.map((r) => canonicalContentRegion(r).toLowerCase()))];
}

/**
 * Resolve the one complete-normal format that may auto-apply for this study.
 * Returns a decision; the caller enforces the NEW + EMPTY one-time guards.
 *
 * `null` means "not decidable yet" (identity unresolved or library empty) —
 * callers may retry when the context / library resolves.
 */
export function resolveNormalBootstrapFormat(input: NormalBootstrapInput): NormalBootstrapDecision | null {
  const { ctx, formats } = input;
  if (formats.length === 0) return null; // library not loaded yet — caller may retry

  const modality = bootstrapModality(ctx.modality);
  if (!modality) {
    return { status: "no-match", reason: `modality ${ctx.modality ?? "?"} not in MR/CT/XR scope` };
  }
  const keys = regionKeys(ctx);
  if (keys.length === 0 || !ctx.region) {
    return null; // identity not resolved yet — caller may retry when it resolves
  }

  const hay = `${ctx.protocolName ?? ""} ${ctx.studyDescription ?? ""}`.trim();

  // 1. Modality + canonical region + complete-normal-only candidates.
  const candidates = formats.filter((f) => {
    if (bootstrapModality(f.modality) !== modality) return false;
    const bp = canonicalContentRegion(f.bodyPart).toLowerCase() || (f.bodyPart ?? "").toLowerCase();
    if (!keys.includes(bp)) return false;
    return isNormalBootstrapCandidate(f);
  });
  if (candidates.length === 0) {
    return { status: "no-match", reason: "no complete-normal format for this region in the library" };
  }

  // 2. Protocol markers narrow the candidate set.
  const wantsContrast = CONTRAST_RE.test(hay) && !PLAIN_RE.test(hay);
  const wantsEpilepsy = EPILEPSY_RE.test(hay);
  const wantsScreening = SCREENING_RE.test(hay);
  const wantsOrbit = ORBIT_RE.test(hay);

  const name = (f: ReportFormat) => (f.name ?? "").toLowerCase();
  const isContrastVariant = (f: ReportFormat) => /contrast/.test(name(f)) || /contrast/i.test(f.protocolScope ?? "");
  const isScreeningVariant = (f: ReportFormat) => /screening/.test(name(f)) || /screening/i.test(f.protocolScope ?? "");
  const isEpilepsyVariant = (f: ReportFormat) => /epilep/.test(name(f)) || EPILEPSY_RE.test(f.protocolScope ?? "");
  const isOrbitVariant = (f: ReportFormat) => /orbit/.test(name(f));

  let pool = candidates;

  // Orbit is its own examination — only when the study says orbit.
  pool = wantsOrbit ? pool.filter((f) => isOrbitVariant(f)) : pool.filter((f) => !isOrbitVariant(f));
  if (pool.length === 0) return { status: "no-match", reason: "orbit study but no orbit normal format" };

  // Epilepsy protocol normal is its own complete format.
  if (wantsEpilepsy) {
    pool = pool.filter((f) => isEpilepsyVariant(f));
    if (pool.length === 0) return { status: "no-match", reason: "epilepsy protocol without epilepsy normal format" };
  } else {
    pool = pool.filter((f) => !isEpilepsyVariant(f));
  }

  // Plain / contrast identity. A contrast-marked study never takes a plain
  // format (that would mis-document the technique actually performed).
  if (wantsContrast) {
    const contrast = pool.filter((f) => isContrastVariant(f));
    if (contrast.length === 0) {
      return { status: "no-match", reason: "contrast study but no contrast normal format" };
    }
    pool = contrast;
  } else {
    const plain = pool.filter((f) => !isContrastVariant(f));
    if (plain.length === 0) {
      return { status: "no-match", reason: "plain study but no plain normal format" };
    }
    pool = plain;
  }

  // Screening identity (e.g. "LS + Whole Spine Screening", "Cervical Screening").
  if (wantsScreening) {
    const screening = pool.filter((f) => isScreeningVariant(f));
    // Prefer the most specific screening variant; a non-screening normal is a
    // fallback only when no screening variant exists (still a complete normal).
    if (screening.length > 0) pool = screening;
    else pool = pool.filter((f) => !isScreeningVariant(f));
  } else if (pool.some((f) => !isScreeningVariant(f))) {
    // Non-screening study → prefer the detailed/plain normal variant.
    pool = pool.filter((f) => !isScreeningVariant(f));
  }

  // 3. Exactly one survivor. Same-identity duplicates (local cache + server
  // copy of one format) collapse deterministically to the first.
  const dedupe = new Set(pool.map((f) => `${f.name}|${f.modality}|${canonicalContentRegion(f.bodyPart)}`));
  if (pool.length === 1 || dedupe.size === 1) {
    const f = pool[0]!;
    return {
      status: "apply",
      format: f,
      basis: `${f.modality} ${canonicalContentRegion(f.bodyPart) || f.bodyPart} — ${f.name}`,
    };
  }

  return { status: "ambiguous", reason: `${pool.length} competing normal formats for this identity` };
}

// ─── Baseline format identity (save / reopen) ────────────────────────────────
//
// `usg-reports` persists the whole composer state; CARE's equivalent for the
// normal-baseline concept is a small identity record in the structured_json
// envelope (`careReportFormatIdentity`) so a saved report reopens with its
// baseline format banner intact and can never be re-bootstrapped.

export const CARE_REPORT_FORMAT_IDENTITY_KIND = "care.report_format_identity.v1";

export type CareReportFormatIdentity = {
  kind: typeof CARE_REPORT_FORMAT_IDENTITY_KIND;
  /** Full Report Format name (stable identity across local/server format ids). */
  name: string;
  /** Printed exam-identity title from the format, when it carried one. */
  reportTitle?: string;
  /** ISO timestamp of when the baseline was applied. */
  appliedAt: string;
};

export function buildCareReportFormatIdentity(input: {
  name: string;
  reportTitle?: string | null;
}): CareReportFormatIdentity {
  return {
    kind: CARE_REPORT_FORMAT_IDENTITY_KIND,
    name: input.name.trim(),
    ...(input.reportTitle?.trim() ? { reportTitle: input.reportTitle.trim() } : {}),
    appliedAt: new Date().toISOString(),
  };
}

function isReportFormatIdentity(v: unknown): v is CareReportFormatIdentity {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  return rec.kind === CARE_REPORT_FORMAT_IDENTITY_KIND && typeof rec.name === "string" && rec.name.trim() !== "";
}

/** Read the persisted baseline format identity from a draft structured_json column. */
export function extractCareReportFormatIdentity(column: unknown): CareReportFormatIdentity | null {
  if (!column || typeof column !== "object") return null;
  const rec = column as Record<string, unknown>;
  if (isReportFormatIdentity(rec)) return rec;
  if (isReportFormatIdentity(rec.careReportFormatIdentity)) {
    return rec.careReportFormatIdentity as CareReportFormatIdentity;
  }
  return null;
}
