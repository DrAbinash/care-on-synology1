/**
 * Match structured report templates to DICOM modality + study description.
 * Shared by Radiology Reporting Workspace (auto-select on open) and any
 * future callers. Replaces the broken `description.includes(template.bodyPart)`
 * check where bodyPart is an internal code (SPINE_LS) not natural language.
 */

import { templateCatalogModality } from "./radiologyTemplateModality";

export type StructuredTemplateMatch = {
  bodyPart: string;
  studyType?: string | null;
};

export type StructuredTemplateRow = {
  id: number;
  templateName: string;
  modality: string;
  bodyPart: string;
  studyType: string | null;
  isDefault?: boolean;
  schemaVersion?: number;
};

/** Infer internal bodyPart (+ optional studyType) from modality + description. */
export function inferStructuredTemplateMatch(
  modality: string | null | undefined,
  studyDescription: string | null | undefined,
): StructuredTemplateMatch | null {
  const mod = templateCatalogModality(modality);
  const desc = `${modality ?? ""} ${studyDescription ?? ""}`.toUpperCase();

  if (mod === "MRI") {
    const wholeSpine = desc.includes("WHOLE SPINE") || desc.includes("SCREENING");
    if (wholeSpine) {
      if (desc.includes("CERVICAL") || desc.includes("C-SPINE") || desc.includes("C SPINE")) {
        return { bodyPart: "SPINE_CERVICAL", studyType: "SCREENING_WHOLE_SPINE" };
      }
      return { bodyPart: "SPINE_LS", studyType: "SCREENING_WHOLE_SPINE" };
    }
    if (
      desc.includes("LUMBO") || desc.includes("LS SPINE") || desc.includes("L-S SPINE")
      || desc.includes("LUMBAR") || desc.includes("LUMBOSACRAL") || desc.includes("LUMBOSACRAL")
      || /\bLS\b/.test(desc) && desc.includes("SPINE")
    ) {
      return { bodyPart: "SPINE_LS", studyType: "PLAIN" };
    }
    if (desc.includes("CERVICAL") || desc.includes("C-SPINE") || desc.includes("C SPINE")) {
      return { bodyPart: "SPINE_CERVICAL", studyType: "PLAIN" };
    }
    if (desc.includes("DORSAL") || desc.includes("THORACIC") || desc.includes("D-SPINE")) {
      return { bodyPart: "SPINE_DORSAL", studyType: "PLAIN" };
    }
    if (desc.includes("STROKE")) return { bodyPart: "BRAIN", studyType: "STROKE_PROTOCOL" };
    if (desc.includes("CONTRAST") && (desc.includes("BRAIN") || desc.includes("HEAD"))) {
      return { bodyPart: "BRAIN", studyType: "CONTRAST" };
    }
    if (desc.includes("BRAIN") || desc.includes("HEAD") || desc.includes("SKULL")) {
      return { bodyPart: "BRAIN", studyType: "PLAIN" };
    }
    if (desc.includes("SPINE")) return { bodyPart: "SPINE_LS", studyType: "PLAIN" };
    return { bodyPart: "BRAIN", studyType: "PLAIN" };
  }

  if (mod === "CT") {
    if (desc.includes("HRCT") || desc.includes("HIGH RESOLUTION")) return { bodyPart: "CHEST", studyType: "HRCT" };
    if (desc.includes("CHEST")) return { bodyPart: "CHEST", studyType: "PLAIN" };
    if (desc.includes("ABDOMEN") || desc.includes("PELVIS")) return { bodyPart: "ABDOMEN", studyType: "PLAIN" };
    if (desc.includes("TRAUMA")) return { bodyPart: "BRAIN", studyType: "TRAUMA" };
    return { bodyPart: "BRAIN", studyType: "PLAIN" };
  }

  if (mod === "USG") {
    if (desc.includes("PELVIS")) return { bodyPart: "PELVIS" };
    if (desc.includes("OBSTETRIC") || desc.includes(" OB ") || desc.includes("FETAL")) return { bodyPart: "OBSTETRIC" };
    if (desc.includes("THYROID") || desc.includes("NECK")) return { bodyPart: "NECK" };
    if (desc.includes("DOPPLER")) return { bodyPart: "DOPPLER" };
    return { bodyPart: "ABDOMEN" };
  }

  if (mod === "X-RAY") {
    if (desc.includes("CERVICAL")) return { bodyPart: "SPINE_CERVICAL" };
    if (desc.includes("LS") || desc.includes("LUMBO")) return { bodyPart: "SPINE_LS" };
    if (desc.includes("CHEST")) return { bodyPart: "CHEST" };
    return { bodyPart: "CHEST" };
  }

  return null;
}

/** Map study-region tab name (e.g. "LS Spine") to template bodyPart code. */
export function studyRegionToBodyPart(region: string | null | undefined): string | null {
  if (!region) return null;
  const r = region.toLowerCase();
  if (r.includes("ls spine") || r.includes("lumbar") || r.includes("lumbo")) return "SPINE_LS";
  if (r.includes("cervical")) return "SPINE_CERVICAL";
  if (r.includes("dorsal") || r.includes("thoracic")) return "SPINE_DORSAL";
  if (r.includes("brain")) return "BRAIN";
  if (r.includes("chest")) return "CHEST";
  if (r.includes("abdomen")) return "ABDOMEN";
  return null;
}

function nameHintMatch(templateName: string, inferred: StructuredTemplateMatch): boolean {
  const n = templateName.toLowerCase();
  switch (inferred.bodyPart) {
    case "SPINE_LS": return n.includes("ls spine") || n.includes("lumbo");
    case "SPINE_CERVICAL": return n.includes("cervical");
    case "SPINE_DORSAL": return n.includes("dorsal") || n.includes("thoracic");
    case "BRAIN":
      if (inferred.studyType === "STROKE_PROTOCOL") return n.includes("stroke");
      if (inferred.studyType === "CONTRAST") return n.includes("contrast");
      return n.includes("brain");
    default: return false;
  }
}

function preferRegionDefault<T extends StructuredTemplateRow>(rows: T[]): T | undefined {
  if (rows.length === 0) return undefined;
  return rows.find((t) => t.isDefault)
    ?? rows.find((t) => (t.schemaVersion ?? 1) >= 2)
    ?? rows[0];
}

/** Pick the best structured template row for a study. Never falls back to arbitrary first MRI row. */
export function pickStructuredTemplate<T extends StructuredTemplateRow>(
  templates: T[],
  modality: string | null | undefined,
  studyDescription: string | null | undefined,
): T | null {
  const mod = templateCatalogModality(modality);
  const inferred = inferStructuredTemplateMatch(modality, studyDescription);
  if (!inferred) return null;

  const pool = templates.filter((t) => templateCatalogModality(t.modality) === mod);
  if (pool.length === 0) return null;

  if (inferred.studyType) {
    const exact = pool.filter(
      (t) => t.bodyPart === inferred.bodyPart
        && (t.studyType || "PLAIN").toUpperCase() === inferred.studyType!.toUpperCase(),
    );
    const picked = preferRegionDefault(exact);
    if (picked) return picked;
  }

  const byBody = preferRegionDefault(pool.filter((t) => t.bodyPart === inferred.bodyPart));
  if (byBody) return byBody;

  const byName = pool.find((t) => nameHintMatch(t.templateName, inferred));
  if (byName) return byName;

  return null;
}

/** Prefer the study-region chip (LS Spine) over a generic MRI description that would match Brain. */
export function pickStructuredTemplateForRegion<T extends StructuredTemplateRow>(
  templates: T[],
  modality: string | null | undefined,
  region: string | null | undefined,
  studyDescription?: string | null,
): T | null {
  const mod = templateCatalogModality(modality);
  const bodyPart = studyRegionToBodyPart(region);
  if (bodyPart) {
    const pool = templates.filter((t) => templateCatalogModality(t.modality) === mod);
    const byBody = pool.filter((t) => t.bodyPart === bodyPart);
    const preferred = preferRegionDefault(byBody);
    if (preferred) return preferred;
    const inferred: StructuredTemplateMatch = { bodyPart, studyType: "PLAIN" };
    const byName = pool.find((t) => nameHintMatch(t.templateName, inferred));
    if (byName) return byName;
  }
  return pickStructuredTemplate(templates, modality, studyDescription ?? region);
}

/** True when loaded template anatomy disagrees with resolved study region. */
export function templateRegionMismatch(
  studyRegion: string | null | undefined,
  templateBodyPart: string | null | undefined,
): boolean {
  const expected = studyRegionToBodyPart(studyRegion);
  if (!expected || !templateBodyPart) return false;
  return expected !== templateBodyPart;
}
