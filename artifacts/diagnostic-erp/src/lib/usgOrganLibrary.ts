/**
 * usgOrganLibrary — organ-wise finding library + normal statements (Phase P1).
 *
 * The organ rail, the per-organ report sections and the Dynamic Finding Builder
 * are all driven by THIS data — never by text hard-coded inside React
 * components. Each organ carries a baseline normal statement (one-click Normal)
 * and the finding definitions that apply to it. The three P1 reference findings
 * (renal calculus, cholelithiasis, prostatomegaly) live here with their
 * deterministic derivation (plural agreement, sentence grammar, ellipsoid
 * volume, and the clinical guards the spec calls out).
 */

import {
  ellipsoidVolumeMl,
  isAffirmative,
  parseMeasurement,
  type UsgFindingDef,
  type DeriveResult,
  type DerivedValue,
} from "./usgFindingBuilder";
import {
  PROSTATE_CLINICAL_OPTIONS,
  suggestProstatomegaly,
} from "./usgProstateConfig";
import { EXTENDED_FINDING_DEFS, EXTENDED_ORGAN_FINDINGS } from "./usgFindingLibraryExtended";

// ── Thresholds ───────────────────────────────────────────────────────────────
/** A calculated manual-volume delta beyond this fraction is flagged to the
 *  radiologist rather than accepted silently. */
export const VOLUME_MISMATCH_REL = 0.2;
// NOTE: the prostatomegaly volume threshold lives in usgProstateConfig.ts (one
// place), NOT here — finding definitions must not carry clinical-decision
// thresholds. Re-exported for backwards-compatible imports only.
export { PROSTATE_ENLARGEMENT_THRESHOLD_ML as PROSTATE_ENLARGEMENT_ML } from "./usgProstateConfig";

// ─────────────────────────────────────────────────────────────────────────────
// Organ model + presets
// ─────────────────────────────────────────────────────────────────────────────

export type UsgSex = "male" | "female" | "any";
export type UsgPreset = "whole_abdomen" | "kub" | "pelvis";

export interface UsgOrganDef {
  key: string;
  label: string;
  sex: UsgSex;                 // organ only shown for this sex ("any" = both)
  presets: UsgPreset[];        // presets the organ belongs to
  normalText: string;         // one-click Normal statement
  findingDefIds: string[];    // finding definitions applicable to this organ
}

function normSex(sex: string | null | undefined): UsgSex {
  const s = (sex ?? "").trim().toLowerCase();
  if (s === "m" || s === "male") return "male";
  if (s === "f" || s === "female") return "female";
  return "any";
}

export const USG_ORGANS: UsgOrganDef[] = [
  {
    key: "liver", label: "Liver", sex: "any", presets: ["whole_abdomen"],
    normalText: "Liver is normal in size and echotexture. No focal lesion. Intrahepatic biliary radicles are not dilated.",
    findingDefIds: [],
  },
  {
    key: "gallbladder", label: "Gallbladder", sex: "any", presets: ["whole_abdomen"],
    normalText: "Gallbladder is normally distended with no calculus or wall thickening.",
    findingDefIds: ["gb_cholelithiasis"],
  },
  {
    key: "cbd", label: "CBD", sex: "any", presets: ["whole_abdomen"],
    normalText: "Common bile duct is not dilated.",
    findingDefIds: [],
  },
  {
    key: "pancreas", label: "Pancreas", sex: "any", presets: ["whole_abdomen"],
    normalText: "Pancreas is normal in size and echotexture. No focal lesion or ductal dilatation.",
    findingDefIds: [],
  },
  {
    key: "spleen", label: "Spleen", sex: "any", presets: ["whole_abdomen"],
    normalText: "Spleen is normal in size and echotexture. No focal lesion.",
    findingDefIds: [],
  },
  {
    key: "right_kidney", label: "Right kidney", sex: "any", presets: ["whole_abdomen", "kub"],
    normalText: "Right kidney is normal in size, position and echotexture. Corticomedullary differentiation is maintained. No calculus, hydronephrosis or mass.",
    findingDefIds: ["renal_calculus"],
  },
  {
    key: "left_kidney", label: "Left kidney", sex: "any", presets: ["whole_abdomen", "kub"],
    normalText: "Left kidney is normal in size, position and echotexture. Corticomedullary differentiation is maintained. No calculus, hydronephrosis or mass.",
    findingDefIds: ["renal_calculus"],
  },
  {
    key: "urinary_bladder", label: "Urinary bladder", sex: "any", presets: ["whole_abdomen", "kub", "pelvis"],
    normalText: "Urinary bladder is normally distended with smooth wall. No calculus or mass. No significant post-void residue.",
    findingDefIds: [],
  },
  {
    key: "prostate", label: "Prostate", sex: "male", presets: ["whole_abdomen", "kub", "pelvis"],
    normalText: "Prostate is normal in size and echotexture. No focal lesion.",
    findingDefIds: ["prostatomegaly"],
  },
  {
    key: "uterus", label: "Uterus", sex: "female", presets: ["whole_abdomen", "pelvis"],
    normalText: "Uterus is normal in size, shape and echotexture. Endometrium is normal in thickness. No focal lesion.",
    findingDefIds: [],
  },
  {
    key: "right_ovary", label: "Right ovary", sex: "female", presets: ["whole_abdomen", "pelvis"],
    normalText: "Right ovary is normal in size and echotexture. No abnormal follicle or mass.",
    findingDefIds: [],
  },
  {
    key: "left_ovary", label: "Left ovary", sex: "female", presets: ["whole_abdomen", "pelvis"],
    normalText: "Left ovary is normal in size and echotexture. No abnormal follicle or mass.",
    findingDefIds: [],
  },
];

/** Organs relevant to a study, filtered by patient sex and examination preset. */
export function organsForStudy(opts: { sex?: string | null; preset?: UsgPreset }): UsgOrganDef[] {
  const sex = normSex(opts.sex);
  const preset = opts.preset ?? "whole_abdomen";
  return USG_ORGANS.filter((o) => {
    const sexOk = o.sex === "any" || sex === "any" || o.sex === sex;
    const presetOk = o.presets.includes(preset);
    return sexOk && presetOk;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference finding definitions
// ─────────────────────────────────────────────────────────────────────────────

function relDiff(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : Infinity;
  return Math.abs(a - b) / Math.abs(b);
}
function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** Lower-case an anatomical location without mangling acronyms like PUJ. */
function locationDisplay(location: string): string {
  return /calyx|calyceal|pelvis/i.test(location) ? location.toLowerCase() : location;
}

// 1 ── Renal calculus ─────────────────────────────────────────────────────────
const RENAL_CALCULUS: UsgFindingDef = {
  id: "renal_calculus",
  organ: "kidney",
  organLabel: "Kidney",
  findingType: "Renal calculus",
  lateralityParam: "side",
  params: [
    { key: "side", label: "Side", type: "select", options: ["Right", "Left", "Bilateral"], default: "Right", required: true, sortOrder: 1 },
    { key: "location", label: "Location", type: "select", options: ["Upper calyx", "Middle calyx", "Lower calyx", "Renal pelvis", "PUJ"], default: "Lower calyx", required: true, sortOrder: 2 },
    { key: "number", label: "Number", type: "select", options: ["Single", "Multiple"], default: "Single", required: true, sortOrder: 3 },
    { key: "size", label: "Largest size", type: "number", unit: "mm", units: ["mm", "cm"], normalizeTo: "mm", required: true, sortOrder: 4 },
    { key: "shadowing", label: "Posterior acoustic shadowing", type: "yesno", default: "Present", sortOrder: 5 },
    { key: "twinkle", label: "Twinkle artefact", type: "select", options: ["Present", "Absent", "Not assessed"], default: "Not assessed", sortOrder: 6 },
    { key: "hydronephrosis", label: "Hydronephrosis", type: "select", options: ["None", "Mild", "Moderate", "Severe"], default: "None", sortOrder: 7 },
    { key: "ureter", label: "Ureteric dilatation", type: "select", options: ["None", "Present"], default: "None", sortOrder: 8 },
  ],
  findingText:
    "{count_article} echogenic {calc_word} measuring {size} {is_are} seen in the {location_disp} of {kidney_phrase}[, {shadow_phrase}][, {twinkle_phrase}]. {hydro_sentence}[ {ureter_sentence}]",
  impressionText: "{side} nephrolithiasis {hydro_impression}.",
  derive: (v): DeriveResult => {
    const side = (v.side ?? "").trim();
    const multiple = (v.number ?? "").trim().toLowerCase() === "multiple";
    const grade = (v.hydronephrosis ?? "None").trim();
    const sideLower = side.toLowerCase();
    const kidneyPhrase = side === "Bilateral" ? "both kidneys" : `the ${sideLower} kidney`;
    const hydroSentence = grade === "None" || grade === ""
      ? "No hydronephrosis is noted."
      : `There is ${grade.toLowerCase()} hydronephrosis.`;
    const hydroImpression = grade === "None" || grade === ""
      ? "without hydronephrosis"
      : `with ${grade.toLowerCase()} hydronephrosis`;
    return {
      render: {
        count_article: multiple ? "Multiple" : "A single",
        calc_word: multiple ? "calculi" : "calculus",
        is_are: multiple ? "are" : "is",
        location_disp: locationDisplay((v.location ?? "").trim()),
        kidney_phrase: kidneyPhrase,
        shadow_phrase: isAffirmative(v.shadowing) ? "showing posterior acoustic shadowing" : "",
        twinkle_phrase: (v.twinkle ?? "").trim() === "Present" ? "with twinkle artefact on colour Doppler" : "",
        hydro_sentence: hydroSentence,
        ureter_sentence: (v.ureter ?? "").trim() === "Present" ? "There is associated ureteric dilatation." : "",
        hydro_impression: hydroImpression,
      },
    };
  },
};

// 2 ── Cholelithiasis ─────────────────────────────────────────────────────────
const CHOLELITHIASIS: UsgFindingDef = {
  id: "gb_cholelithiasis",
  organ: "gallbladder",
  organLabel: "Gallbladder",
  findingType: "Cholelithiasis",
  params: [
    { key: "number", label: "Number", type: "select", options: ["Single", "Multiple"], default: "Single", required: true, sortOrder: 1 },
    { key: "largest", label: "Largest calculus", type: "number", unit: "cm", units: ["mm", "cm"], normalizeTo: "mm", required: true, sortOrder: 2 },
    { key: "mobility", label: "Mobility", type: "select", options: ["Mobile", "Impacted", "Not assessed"], default: "Mobile", sortOrder: 3 },
    { key: "impaction_site", label: "Impaction site", type: "select", options: ["", "Neck", "Hartmann pouch", "Cystic duct region", "Other"], default: "", sortOrder: 4 },
    { key: "wall", label: "Gallbladder wall", type: "select", options: ["Normal", "Thickened", "Not assessed"], default: "Normal", sortOrder: 5 },
    { key: "wall_thickness", label: "Wall thickness", type: "number", unit: "mm", units: ["mm"], normalizeTo: "mm", sortOrder: 6 },
    { key: "pericholecystic", label: "Pericholecystic fluid", type: "select", options: ["Absent", "Present"], default: "Absent", sortOrder: 7 },
    { key: "murphy", label: "Sonographic Murphy sign", type: "select", options: ["Not assessed", "Negative", "Positive"], default: "Not assessed", sortOrder: 8 },
    { key: "distension", label: "Distension", type: "select", options: ["Normal", "Distended", "Contracted"], default: "Normal", sortOrder: 9 },
    { key: "sludge", label: "Biliary sludge", type: "yesno", default: "Absent", sortOrder: 10 },
  ],
  findingText:
    "{count_article} {mobility_lower} {calc_word} {is_are} seen within the gallbladder[{impaction_clause}], the largest measuring {largest}.[ {wall_sentence}.][ {distension_sentence}.] {pericholecystic_sentence}.[ {murphy_sentence}.][ {sludge_sentence}.]",
  impressionText: "Cholelithiasis[ {cholecystitis_exclusion}].",
  derive: (v): DeriveResult => {
    const single = (v.number ?? "").trim().toLowerCase() === "single";
    const mobility = (v.mobility ?? "").trim();
    const wall = (v.wall ?? "").trim();
    const murphy = (v.murphy ?? "").trim();
    const pericholecystic = (v.pericholecystic ?? "").trim();
    const distension = (v.distension ?? "").trim();
    const site = (v.impaction_site ?? "").trim();

    const wallThk = parseMeasurement(v.wall_thickness, { defaultUnit: "mm", normalizeTo: "mm" });
    let wallSentence = "";
    if (wall === "Normal") wallSentence = "Gallbladder wall thickness is within normal limits";
    else if (wall === "Thickened") {
      wallSentence = wallThk.display
        ? `The gallbladder wall is thickened, measuring ${wallThk.display}`
        : "The gallbladder wall is thickened";
    }

    const distensionSentence = distension === "Distended" ? "The gallbladder is distended"
      : distension === "Contracted" ? "The gallbladder is contracted" : "";

    const pericholecysticSentence = pericholecystic === "Present"
      ? "There is pericholecystic fluid"
      : "No pericholecystic collection is seen";

    const murphySentence = murphy === "Negative" ? "Sonographic Murphy sign is negative"
      : murphy === "Positive" ? "Sonographic Murphy sign is positive" : "";

    // Guard: only exclude acute cholecystitis when all supporting fields were
    // actually recorded as reassuring — never assert it by default.
    const exclusion = wall === "Normal" && murphy === "Negative" && pericholecystic === "Absent"
      ? "without sonographic evidence of acute cholecystitis"
      : "";

    return {
      render: {
        count_article: single ? "A single" : "Multiple",
        calc_word: single ? "calculus" : "calculi",
        is_are: single ? "is" : "are",
        mobility_lower: mobility === "Not assessed" ? "" : mobility.toLowerCase(),
        impaction_clause: mobility === "Impacted" && site ? `, impacted at the ${site.toLowerCase()}` : "",
        wall_sentence: wallSentence,
        distension_sentence: distensionSentence,
        pericholecystic_sentence: pericholecysticSentence,
        murphy_sentence: murphySentence,
        sludge_sentence: isAffirmative(v.sludge) ? "Layering biliary sludge is noted" : "",
        cholecystitis_exclusion: exclusion,
      },
    };
  },
};

// 3 ── Prostatomegaly (dimensions → ellipsoid volume) ────────────────────────
const PROSTATOMEGALY: UsgFindingDef = {
  id: "prostatomegaly",
  organ: "prostate",
  organLabel: "Prostate",
  findingType: "Prostate dimensions / volume",
  params: [
    { key: "ap", label: "AP dimension", type: "number", unit: "cm", units: ["mm", "cm"], normalizeTo: "mm", required: true, sortOrder: 1 },
    { key: "tr", label: "Transverse dimension", type: "number", unit: "cm", units: ["mm", "cm"], normalizeTo: "mm", required: true, sortOrder: 2 },
    { key: "cc", label: "Craniocaudal dimension", type: "number", unit: "cm", units: ["mm", "cm"], normalizeTo: "mm", required: true, sortOrder: 3 },
    { key: "manual_volume", label: "Manual volume override", type: "number", unit: "cc", units: ["cc", "ml"], normalizeTo: "cc", sortOrder: 4 },
    { key: "override_reason", label: "Override reason", type: "text", sortOrder: 5 },
    { key: "median_lobe", label: "Median lobe projection", type: "yesno", presentText: "median lobe projection into the bladder base", default: "Absent", sortOrder: 6 },
    { key: "calcification", label: "Prostatic calcification", type: "yesno", presentText: "parenchymal calcification", default: "Absent", sortOrder: 7 },
    { key: "pvr", label: "Post-void residual urine", type: "number", unit: "ml", units: ["ml", "cc"], normalizeTo: "ml", sortOrder: 8 },
    // Clinical decision is SEPARATE from the measurement and defaults to
    // "Awaiting radiologist" — the impression is not written until a human
    // confirms. The builder only *suggests* an outcome from the volume.
    { key: "clinical_finding", label: "Clinical finding", type: "select", options: [...PROSTATE_CLINICAL_OPTIONS], default: "Awaiting radiologist", sortOrder: 9 },
  ],
  // The finding text always states the MEASUREMENT (dimensions + calculated
  // volume). The clinical interpretation goes only into the impression, and only
  // when the radiologist has chosen one.
  findingText:
    "Prostate measures {dims} cm, with a calculated volume of approximately {vol_cc} cc.[ There is {median_lobe}.][ There is {calcification}.][ Post-void residual urine measures {pvr}.]",
  impressionText: "{prostate_impression}",
  derive: (v): DeriveResult => {
    const ap = parseMeasurement(v.ap, { defaultUnit: "cm", normalizeTo: "mm" });
    const tr = parseMeasurement(v.tr, { defaultUnit: "cm", normalizeTo: "mm" });
    const cc = parseMeasurement(v.cc, { defaultUnit: "cm", normalizeTo: "mm" });
    const calcVol = ellipsoidVolumeMl(ap.normalized, tr.normalized, cc.normalized);

    const manual = parseMeasurement(v.manual_volume, { defaultUnit: "cc", normalizeTo: "cc" });
    const manualVol = manual.value;
    const reason = (v.override_reason ?? "").trim();

    const warnings: string[] = [];
    let effective = calcVol;
    let volSource: DerivedValue["source"] = "calculated";
    let provenance = "AP × TR × CC ellipsoid (0.523)";
    let overrideReason: string | null = null;

    if (manualVol != null) {
      if (!reason) {
        // Never accept a supplied volume blindly: require a recorded reason.
        warnings.push("Manual volume override ignored — a reason must be recorded to override the calculated volume.");
      } else {
        effective = manualVol;
        volSource = "manual";
        overrideReason = reason;
        provenance = `manual override (${reason})`;
        if (calcVol != null && relDiff(manualVol, calcVol) > VOLUME_MISMATCH_REL) {
          warnings.push(
            `Manually entered volume (${manualVol} cc) differs materially from the calculated volume (${calcVol} cc).`,
          );
        }
      }
    }

    const dims = ap.normalized != null && tr.normalized != null && cc.normalized != null
      ? `${fmt1(ap.normalized / 10)} × ${fmt1(tr.normalized / 10)} × ${fmt1(cc.normalized / 10)}`
      : "";
    const volDisplay = effective != null ? String(Math.round(effective)) : "";

    // Suggestion only — never a decision, never silently written to the report.
    const suggestion = suggestProstatomegaly(effective);
    const clinical = (v.clinical_finding ?? "Awaiting radiologist").trim();
    if (suggestion.suggestsProstatomegaly && clinical === "Awaiting radiologist") {
      warnings.push(
        `Calculated volume ${volDisplay} cc exceeds the prostatomegaly threshold (${suggestion.thresholdMl} cc) — set the clinical finding to confirm. (No impression is written until you do.)`,
      );
    }

    // Impression is driven ONLY by the radiologist's clinical finding. Never a
    // numeric grade (no approved grading configuration exists).
    let prostateImpression = "";
    if (clinical === "Prostatomegaly") {
      prostateImpression = `Prostatomegaly (volume approximately ${volDisplay} cc).`;
    } else if (clinical === "Normal prostate") {
      prostateImpression = `Prostate normal in size (volume approximately ${volDisplay} cc).`;
    } else if (clinical === "Indeterminate") {
      prostateImpression = `Prostate volume approximately ${volDisplay} cc; clinical significance to be correlated.`;
    } // "Awaiting radiologist" → no impression contribution.

    const derived: DerivedValue[] = [{
      key: "volume", label: "Prostate volume", value: effective, unit: "cc", source: volSource, provenance,
      calculated: calcVol, entered: manualVol, reason: overrideReason,
    }];

    return {
      render: { dims, vol_cc: volDisplay, prostate_impression: prostateImpression },
      derived,
      warnings,
    };
  },
};

export const USG_FINDING_DEFS: UsgFindingDef[] = [
  RENAL_CALCULUS, CHOLELITHIASIS, PROSTATOMEGALY,
  ...EXTENDED_FINDING_DEFS,   // P2.6 expanded library
];

const DEF_BY_ID = new Map(USG_FINDING_DEFS.map((d) => [d.id, d]));
export function findingDefById(id: string): UsgFindingDef | undefined {
  return DEF_BY_ID.get(id);
}

/** All finding ids applicable to an organ: base + P2.6 extended (deduped). */
function organFindingIds(organKey: string): string[] {
  const organ = USG_ORGANS.find((o) => o.key === organKey);
  const base = organ?.findingDefIds ?? [];
  const extended = EXTENDED_ORGAN_FINDINGS[organKey] ?? [];
  return Array.from(new Set([...base, ...extended]));
}

/** The finding definitions applicable to an organ (resolves the organ's ids). */
export function findingDefsForOrgan(organKey: string): UsgFindingDef[] {
  return organFindingIds(organKey).map((id) => DEF_BY_ID.get(id)).filter((d): d is UsgFindingDef => !!d);
}

export function organByKey(key: string): UsgOrganDef | undefined {
  return USG_ORGANS.find((o) => o.key === key);
}
