/**
 * Persona router — selects modality/family-specific persona modules based
 * on the canonical ReportingStudyContext carried in the frozen snapshot.
 *
 * Uses ONLY fields from ComposerInputSnapshot (PR #656):
 *   modality, region, regions, bodyPart, family, spineSegment, protocol, aiMode
 *
 * Does NOT parse raw DICOM StudyDescription. Does NOT reread live frontend
 * state. Selection happens before the worker call and uses the frozen
 * snapshot context.
 *
 * Routing hierarchy (§J):
 *   MASTER + STYLE + SAFETY + modality/family-specific rules
 *   + spine-segment addendum (cervical/dorsal/lumbar)
 *   + selected-image assisted module when aiMode === SELECTED_IMAGES
 *
 * PR P0-3 (#657) + selected-image / region-aware extension.
 */
import type { ComposerInputSnapshot } from "../types";
import { CARE_RADIOLOGY_MASTER } from "./master";
import { CARE_REPORT_STYLE } from "./style";
import { CARE_SAFETY_RULES } from "./safety";
import { CARE_MRI_BRAIN } from "./mriBrain";
import { CARE_MRI_SPINE } from "./mriSpine";
import { CARE_MRI_CERVICAL } from "./mriSpineCervical";
import { CARE_MRI_DORSAL } from "./mriSpineDorsal";
import { CARE_MRI_LUMBAR } from "./mriSpineLumbar";
import { CARE_CT } from "./ct";
import { CARE_CT_SPINE } from "./ctSpine";
import { CARE_USG } from "./usg";
import { CARE_MAMMOGRAPHY } from "./mammography";
import { CARE_XRAY } from "./xray";
import { CARE_DOPPLER } from "./doppler";
import { CARE_MRCP } from "./mrcp";
import { CARE_SELECTED_IMAGE_ASSISTED } from "./selectedImages";

export const CARE_PERSONA_VERSION = "care-persona-2026.10.selected-image.modality-coverage.2";

/**
 * The only fields the router may read as a study-name signal: the canonical
 * region strings, the DICOM StudyDescription, the resolved protocol and the
 * structured bodyPart. Deliberately NOT the findings narrative — a report that
 * happens to mention "carotid" is not evidence that the study WAS a carotid
 * Doppler, and routing on prose would make the persona change when a
 * radiologist types a word.
 */
function routingStudyText(snapshot: ComposerInputSnapshot): string {
  return [
    snapshot.region ?? "",
    ...(snapshot.regions ?? []),
    snapshot.studyType ?? "",
    snapshot.protocol ?? "",
    snapshot.bodyPart ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/** Projection radiography. `DX` is shared with mammography, which is matched first. */
const PLAIN_RADIOGRAPH_MODALITIES = new Set(["DX", "CR", "DR", "XR", "XRAY", "X-RAY"]);

/** Vascular examination names carried by the study context, not the narrative. */
const VASCULAR_RE = /doppler|venous|venography|artery|arterial|arteriography|carotid|vertebral artery|lower limb|lower extremity|upper limb|upper extremity|\bdvt\b|flux|vascular|haemodialysis|dialysis|fistula|thromb/;

/** Biliary / pancreatic duct MR. */
const MRCP_RE = /mrcp|cholangiopancreat|biliar|pancreatobiliary|pancreatic duct/;

/**
 * Map a spine-segment string onto the canonical values `spineSegmentFromRegion()`
 * in @workspace/report-quality emits: cervical | dorsal | dorsolumbar | lumbar |
 * whole | generic.
 *
 * The shared resolver already accepts "LS Spine", "Lumbosacral" and "Thoracic", so
 * the workspace normally hands the composer a canonical value. But
 * `ComposerInputSnapshot.spineSegment` is a free `z.string()`, and any snapshot
 * built by another path can carry the booking's own spelling. The router used to
 * match `spineSegment === "lumbar"` and nothing else, so such a study lost its
 * segment addendum silently — no level ordering, no "preserve the AP canal
 * measurements exactly" — while still reporting as a spine study everywhere else.
 *
 * Order matters: "dorso lumbar" and "thoracolumbar" both CONTAIN "lumbar", so the
 * combined segment is tested first, or a study spanning two regions is routed as
 * lumbosacral only. That is the same trap the shared resolver documents.
 */
export function normaliseSpineSegment(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().replace(/[_/]+/g, " ").trim();
  if (!s) return "";
  if (/whole|entire|total|screening/.test(s)) return "whole";
  if (/dorso[\s-]?lumbar|thoraco[\s-]?lumbar|\bdl\b/.test(s)) return "dorsolumbar";
  if (/cervical|\bc[\s-]?spine\b/.test(s)) return "cervical";
  if (/dorsal|thoracic|\bd[\s-]?spine\b|\bt[\s-]?spine\b/.test(s)) return "dorsal";
  if (/lumbar|lumbo|\bls\b|\bl[\s-]?spine\b/.test(s)) return "lumbar";
  return "generic";
}

/**
 * Select the ordered list of persona modules to load for a given snapshot.
 *
 * Returns the ALWAYS-LOADED base modules (MASTER + STYLE + SAFETY) plus
 * modality/family-specific module(s). Avoids loading irrelevant modules
 * to keep the prompt compact for local Ollama models.
 */
export function selectPersonaModules(snapshot: ComposerInputSnapshot): string[] {
  const modules: string[] = [
    CARE_RADIOLOGY_MASTER,
    CARE_REPORT_STYLE,
    CARE_SAFETY_RULES,
  ];

  const modality = (snapshot.modality ?? "").toUpperCase();
  const family = (snapshot.family ?? "").toLowerCase();
  const spineSegment = normaliseSpineSegment(snapshot.spineSegment);

  if ((modality === "MG") || (modality === "DX" && family === "breast") || (family === "breast")) {
    modules.push(CARE_MAMMOGRAPHY);
  } else if (family === "brain" && (modality === "MR" || modality === "MRI")) {
    modules.push(CARE_MRI_BRAIN);
  } else if (family === "spine" && (modality === "MR" || modality === "MRI")) {
    modules.push(CARE_MRI_SPINE);
    if (spineSegment === "cervical") modules.push(CARE_MRI_CERVICAL);
    else if (spineSegment === "dorsal") modules.push(CARE_MRI_DORSAL);
    else if (spineSegment === "lumbar") modules.push(CARE_MRI_LUMBAR);
    else if (spineSegment === "dorsolumbar") {
      // A Dorso-Lumbar booking is its own examination spanning both regions — the
      // shared resolver returns it as a distinct value precisely so a thoracic-only
      // or LS-only consumer cannot claim it. Routing it to neither addendum left
      // the study with no level ordering and no canal-measurement rule at all.
      modules.push(CARE_MRI_DORSAL, CARE_MRI_LUMBAR);
    }
  } else if (modality === "CT") {
    modules.push(CARE_CT);
    // CT spine needs the same level and measurement discipline as MRI spine, but
    // not the MRI modules that carry it: those instruct the model in sequence and
    // "limited-sequence screening" wording that must not appear in a CT report.
    if (family === "spine") modules.push(CARE_CT_SPINE);
  } else if (modality === "US" || modality === "USG") {
    modules.push(CARE_USG);
  } else if (PLAIN_RADIOGRAPH_MODALITIES.has(modality)) {
    modules.push(CARE_XRAY);
  }

  // Sub-specialty addenda — additive, never replacing the modality rules above.
  // A lower-limb venous study still needs the ultrasound rules; an MRCP still
  // needs whatever generic MRI rules apply to it.
  const studyText = routingStudyText(snapshot);
  if ((modality === "US" || modality === "USG" || modality === "D") && VASCULAR_RE.test(studyText)) {
    modules.push(CARE_DOPPLER);
  }
  if ((modality === "MR" || modality === "MRI") && MRCP_RE.test(studyText)) {
    modules.push(CARE_MRCP);
  }

  // Selected-image assisted mode — additive safety module (never replaces region rules).
  if ((snapshot.aiMode ?? "TEXT_ONLY") === "SELECTED_IMAGES") {
    modules.push(CARE_SELECTED_IMAGE_ASSISTED);
  }

  return modules;
}

/**
 * Human-readable primary region label for UI / provenance.
 */
export function resolvePrimaryRegionLabel(snapshot: ComposerInputSnapshot): string {
  const family = (snapshot.family ?? "").toLowerCase();
  const segment = normaliseSpineSegment(snapshot.spineSegment);
  // This label is written into the SELECTED-IMAGE context line the model reads.
  // It said "MRI" for every modality, so a CT study was told it was an MRI study.
  const prefix = (snapshot.modality ?? "").toUpperCase() === "CT" ? "CT" : "MRI";
  if (family === "brain") return `${prefix} Brain`;
  if (family === "spine") {
    if (segment === "cervical") return `${prefix} Cervical Spine`;
    if (segment === "dorsal") return `${prefix} Dorsal Spine`;
    if (segment === "lumbar") return `${prefix} Lumbosacral Spine`;
    // A Dorso-Lumbar booking is its own examination; calling it "Spine" would
    // hand the composer a region no study was billed for.
    if (segment === "dorsolumbar") return `${prefix} Dorso-Lumbar Spine`;
    return `${prefix} Spine`;
  }
  return snapshot.region?.trim() || snapshot.bodyPart?.trim() || "Unknown region";
}

/**
 * Check whether the snapshot carries a Whole Spine Screening component.
 */
export function hasScreeningComponent(snapshot: ComposerInputSnapshot): boolean {
  const regions = snapshot.regions ?? [];
  return regions.some((r) => {
    const lower = (r ?? "").toLowerCase();
    return lower.includes("screening") || lower.includes("whole spine");
  });
}

export { CARE_RADIOLOGY_MASTER, CARE_REPORT_STYLE, CARE_SAFETY_RULES };
export { CARE_MRI_BRAIN, CARE_MRI_SPINE, CARE_CT, CARE_USG, CARE_MAMMOGRAPHY };
export { CARE_MRI_CERVICAL, CARE_MRI_DORSAL, CARE_MRI_LUMBAR, CARE_SELECTED_IMAGE_ASSISTED };
export { CARE_XRAY, CARE_DOPPLER, CARE_MRCP, CARE_CT_SPINE };
