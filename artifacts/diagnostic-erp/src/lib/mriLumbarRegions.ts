/**
 * MRI lumbar region keys for Reporting Canvas R2.
 * Level is a clinical capture choice; image anchor is separate provenance.
 * Anatomical subregions are NOT Study Tabs.
 */

import {
  canonicalContentRegion,
  spineSegmentFromRegion,
  type SpineSegment,
} from "./reportingStudyContext";

export type MriLumbarRegionKey =
  | "L1-L2"
  | "L2-L3"
  | "L3-L4"
  | "L4-L5"
  | "L5-S1"
  | "alignment"
  | "vertebral-marrow"
  | "conus"
  | "posterior-elements"
  | "paraspinal";

export type MriLumbarRegionDef = {
  key: MriLumbarRegionKey;
  label: string;
  kind: "disc-level" | "region";
  /** Default conflict group for disc morphology at this level. */
  conflictGroup?: string;
};

export const MRI_LUMBAR_DISC_LEVELS: MriLumbarRegionDef[] = [
  { key: "L1-L2", label: "L1-L2", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "L2-L3", label: "L2-L3", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "L3-L4", label: "L3-L4", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "L4-L5", label: "L4-L5", kind: "disc-level", conflictGroup: "disc_contour" },
  { key: "L5-S1", label: "L5-S1", kind: "disc-level", conflictGroup: "disc_contour" },
];

export const MRI_LUMBAR_EXTRA_REGIONS: MriLumbarRegionDef[] = [
  { key: "alignment", label: "Alignment", kind: "region", conflictGroup: "alignment" },
  { key: "vertebral-marrow", label: "Vertebral bodies / marrow", kind: "region", conflictGroup: "endplate" },
  { key: "conus", label: "Conus", kind: "region", conflictGroup: "conus" },
  { key: "posterior-elements", label: "Posterior elements", kind: "region", conflictGroup: "facet_joint" },
  { key: "paraspinal", label: "Paraspinal soft tissues", kind: "region", conflictGroup: "paraspinal" },
];

export const MRI_LUMBAR_ALL_REGIONS: MriLumbarRegionDef[] = [
  ...MRI_LUMBAR_DISC_LEVELS,
  ...MRI_LUMBAR_EXTRA_REGIONS,
];

export const DISC_MORPHOLOGY_OPTIONS = [
  { id: "normal", label: "Normal", findings: "Normal disc height and signal. No disc herniation.", impression: "" },
  { id: "bulge", label: "Bulge", findings: "disc bulge", impression: "disc bulge" },
  { id: "protrusion", label: "Protrusion", findings: "disc protrusion", impression: "disc protrusion" },
  { id: "extrusion", label: "Extrusion", findings: "disc extrusion", impression: "disc extrusion" },
  { id: "sequestration", label: "Sequestration", findings: "disc sequestration", impression: "disc sequestration" },
  { id: "annular-fissure", label: "Annular fissure", findings: "annular fissure", impression: "annular fissure" },
] as const;

export const LATERALITY_OPTIONS = [
  { id: "central", label: "Central" },
  { id: "left-paracentral", label: "Left paracentral" },
  { id: "right-paracentral", label: "Right paracentral" },
  { id: "left-foraminal", label: "Left foraminal" },
  { id: "right-foraminal", label: "Right foraminal" },
  { id: "bilateral", label: "Bilateral" },
] as const;

export const CANAL_STENOSIS_OPTIONS = [
  { id: "none", label: "None", findings: "No spinal canal stenosis.", severity: "" },
  { id: "mild", label: "Mild", findings: "mild canal stenosis", severity: "mild" },
  { id: "moderate", label: "Moderate", findings: "moderate canal stenosis", severity: "moderate" },
  { id: "severe", label: "Severe", findings: "severe canal stenosis", severity: "severe" },
] as const;

export const FORAMINAL_LATERALITY_OPTIONS = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "bilateral", label: "Bilateral" },
] as const;

export const FORAMINAL_SEVERITY_OPTIONS = [
  { id: "none", label: "None" },
  { id: "mild", label: "Mild" },
  { id: "moderate", label: "Moderate" },
  { id: "severe", label: "Severe" },
] as const;

export const MODIC_OPTIONS = [
  { id: "none", label: "None", findings: "" },
  { id: "type1", label: "Type 1", findings: "Modic type 1 endplate changes" },
  { id: "type2", label: "Type 2", findings: "Modic type 2 endplate changes" },
  { id: "type3", label: "Type 3", findings: "Modic type 3 endplate changes" },
] as const;

export const ROOT_RELATION_OPTIONS = [
  { id: "contact", label: "Contact" },
  { id: "compression", label: "Compression" },
] as const;

/** Suggested roots for a disc level — user may override (exiting vs traversing). */
export const ROOT_LEVEL_SUGGESTIONS = ["L1", "L2", "L3", "L4", "L5", "S1"] as const;

export type LumbarLevelSelection = {
  morphology?: (typeof DISC_MORPHOLOGY_OPTIONS)[number]["id"];
  laterality?: (typeof LATERALITY_OPTIONS)[number]["id"];
  canal?: (typeof CANAL_STENOSIS_OPTIONS)[number]["id"];
  /** Separate from disc laterality — foraminal stenosis side. */
  foraminalLaterality?: (typeof FORAMINAL_LATERALITY_OPTIONS)[number]["id"];
  foraminalSeverity?: (typeof FORAMINAL_SEVERITY_OPTIONS)[number]["id"];
  rootContact?: boolean;
  /** Editable; inference may prefill but is not irreversible. */
  rootLevel?: string;
  rootRelation?: (typeof ROOT_RELATION_OPTIONS)[number]["id"];
  modic?: (typeof MODIC_OPTIONS)[number]["id"];
  canalApMm?: number | null;
  desiccation?: boolean;
  reducedHeight?: boolean;
};

/** Compose a natural findings sentence from level selections (preview + narrative glue). */
export function composeLumbarLevelNarrative(level: string, sel: LumbarLevelSelection): {
  findings: string;
  impression: string;
  severity: string;
  laterality: string;
  /** Primary concept for legacy callers; prefer atomic bundle for ledger. */
  concept: string;
} {
  const morph = DISC_MORPHOLOGY_OPTIONS.find((o) => o.id === sel.morphology);
  const lat = LATERALITY_OPTIONS.find((o) => o.id === sel.laterality);
  const canal = CANAL_STENOSIS_OPTIONS.find((o) => o.id === sel.canal);
  const modic = MODIC_OPTIONS.find((o) => o.id === sel.modic);

  if (!morph || morph.id === "normal") {
    const parts = [`At ${level}, disc height and signal are preserved with no herniation.`];
    if (sel.desiccation) parts.push("Disc desiccation is noted.");
    if (sel.reducedHeight) parts.push("Disc height is reduced.");
    if (canal && canal.id !== "none") {
      parts.push(`There is ${canal.findings}.`);
    } else {
      parts.push("Neural foramina are patent. No significant canal stenosis.");
    }
    if (sel.foraminalSeverity && sel.foraminalSeverity !== "none") {
      const side = sel.foraminalLaterality ?? "bilateral";
      parts.push(`There is ${sel.foraminalSeverity} ${side} neural foraminal stenosis.`);
    }
    if (modic && modic.id !== "none" && modic.findings) {
      parts.push(`${modic.findings} are noted.`);
    }
    if (sel.canalApMm != null && Number.isFinite(sel.canalApMm)) {
      parts.push(`AP canal diameter measures ${sel.canalApMm} mm.`);
    }
    return {
      findings: parts.join(" "),
      impression: "",
      severity: canal?.severity ?? "",
      laterality: "",
      concept: "disc_contour",
    };
  }

  const latPhrase = lat ? `${lat.label.toLowerCase()} ` : "";
  let findings = `At ${level}, a ${latPhrase}${morph.findings}`;
  const effects: string[] = [];
  if (canal && canal.id !== "none") {
    effects.push(`causes ${canal.findings}`);
  }
  if (sel.rootContact) {
    const root = (sel.rootLevel ?? "").trim() || inferTraversingRoot(level);
    const relation = sel.rootRelation === "compression" ? "compresses" : "contacts";
    effects.push(`${relation} the ${root} nerve root`);
  }
  if (effects.length > 0) {
    findings += ` ${effects.join(" and ")}`;
  }
  findings += ".";
  if (sel.desiccation) findings += " Disc desiccation is noted.";
  if (sel.reducedHeight) findings += " Disc height is reduced.";
  if (sel.foraminalSeverity && sel.foraminalSeverity !== "none") {
    const side = sel.foraminalLaterality ?? "bilateral";
    findings += ` There is ${sel.foraminalSeverity} ${side} neural foraminal stenosis.`;
  }
  if (sel.canalApMm != null && Number.isFinite(sel.canalApMm)) {
    findings += ` AP canal diameter measures ${sel.canalApMm} mm.`;
  }
  if (modic && modic.id !== "none" && modic.findings) {
    findings += ` ${modic.findings} are present at this level.`;
  }

  const impParts = [`${level}: ${latPhrase}${morph.impression}`.trim()];
  if (canal && canal.id !== "none") impParts.push(canal.findings);
  if (sel.rootContact) {
    const root = (sel.rootLevel ?? "").trim() || inferTraversingRoot(level);
    impParts.push(`${root} root ${sel.rootRelation === "compression" ? "compression" : "contact"}`);
  }

  return {
    findings,
    impression: impParts.filter(Boolean).join("; ") + ".",
    severity: canal?.severity ?? "",
    laterality: lat?.id ?? "",
    concept: "disc_contour",
  };
}

/** Prefill suggestion only — user may choose exiting root instead. */
export function inferTraversingRoot(level: string): string {
  const m = level.toUpperCase().match(/L(\d)/);
  if (!m) return "nerve";
  const n = Number(m[1]);
  if (n >= 5) return "S1";
  return `L${n + 1}`;
}

export function inferExitingRoot(level: string): string {
  const m = level.toUpperCase().match(/L(\d)/);
  if (!m) return "nerve";
  return `L${m[1]}`;
}

/**
 * MRI lumbar detailed canvas activation.
 * Uses canonical Study Tab / reporting-context semantics — not loose "spine" guessing.
 * Whole-spine screening must NOT activate detailed LS level canvas.
 */
export function isMriLumbarReportingContext(opts: {
  modality?: string | null;
  region?: string | null;
  family?: string | null;
  spineSegment?: string | null;
  /** Protocol / format scope hint — "Screening" suppresses detailed LS canvas. */
  protocolName?: string | null;
  studyDescription?: string | null;
}): boolean {
  const mod = (opts.modality ?? "").toUpperCase();
  if (mod && mod !== "MR" && mod !== "MRI") return false;

  const protocol = `${opts.protocolName ?? ""} ${opts.studyDescription ?? ""}`.toLowerCase();
  const regionRaw = (opts.region ?? "").trim();
  const canonical = canonicalContentRegion(regionRaw);
  const seg: SpineSegment | null =
    (opts.spineSegment as SpineSegment | null | undefined)
    ?? spineSegmentFromRegion(canonical || regionRaw);

  // Whole spine / screening → no detailed LS disc canvas
  if (seg === "whole") return false;
  if (/\bscreening\b/.test(protocol) && seg !== "lumbar") return false;
  if (canonical === "Whole Spine" || /^whole\s*spine$/i.test(regionRaw)) return false;

  // Explicit non-lumbar spine segments
  if (seg === "cervical" || seg === "dorsal") return false;
  if (canonical === "Cervical Spine" || canonical === "Dorsal Spine") return false;
  if (canonical === "Brain" || (opts.family === "brain")) return false;

  // Canonical LS Spine Study Tab / lumbar segment
  if (canonical === "LS Spine") return true;
  if (seg === "lumbar") return true;

  // Last resort: exact-ish LS names only (avoid matching "ls" inside unrelated words)
  const region = regionRaw.toLowerCase();
  if (
    region === "ls spine"
    || region === "lumbar spine"
    || region === "lumbosacral spine"
    || region === "l-spine"
    || region === "l spine"
  ) {
    return true;
  }
  return false;
}
