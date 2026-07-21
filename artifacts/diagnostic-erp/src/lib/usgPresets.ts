/**
 * usgPresets — examination-preset registry for the USG Companion (Phase P2.5).
 *
 * A preset defines what a given ultrasound examination is expected to cover:
 * which organs, in what order, its report title, and whether PCPNDT applies.
 * Clinical modifiers (post-cholecystectomy, nephrectomy, …) safely alter the
 * expected-organ set so Normal-all-remaining and readiness never mark an absent
 * or unseen organ as normal.
 *
 * This is pure data + resolution logic that reuses the organ library
 * (usgOrganLibrary) — it does NOT redefine organs or normal statements. Non-
 * obstetric presets only in P2; obstetric/Doppler presets arrive with the P5
 * consolidation.
 */

import { USG_ORGANS, type UsgOrganDef } from "./usgOrganLibrary";

export type UsgSex = "male" | "female" | "any";

/** Clinical modifiers that change which organs are expected/normal-eligible. */
export type UsgClinicalModifier =
  | "post_cholecystectomy"
  | "post_hysterectomy"
  | "nephrectomy_left"
  | "nephrectomy_right"
  | "post_prostatectomy"
  | "inadequate_bladder_filling"
  | "bowel_gas_limitation"
  | "postmenopausal"
  | "transplanted_kidney";

export interface UsgPresetDef {
  key: string;
  label: string;
  reportTitle: string;
  /** Restrict the whole preset to a sex (e.g. male/female pelvis); "any" otherwise. */
  restrictSex: UsgSex;
  /** Expected organ keys in display order (filtered by patient sex at resolve time). */
  organKeys: string[];
  /** Obstetric presets set this true; none in P2. */
  pcpndtApplicable: boolean;
}

const ABDOMEN = ["liver", "gallbladder", "cbd", "pancreas", "spleen", "right_kidney", "left_kidney", "urinary_bladder"];
const PELVIS_F = ["urinary_bladder", "uterus", "right_ovary", "left_ovary"];
const PELVIS_M = ["urinary_bladder", "prostate"];

export const USG_PRESETS: UsgPresetDef[] = [
  { key: "whole_abdomen", label: "Whole Abdomen", reportTitle: "USG Whole Abdomen", restrictSex: "any", pcpndtApplicable: false,
    organKeys: [...ABDOMEN, "prostate", "uterus", "right_ovary", "left_ovary"] },
  { key: "whole_abdomen_pelvis", label: "Whole Abdomen + Pelvis", reportTitle: "USG Whole Abdomen and Pelvis", restrictSex: "any", pcpndtApplicable: false,
    organKeys: [...ABDOMEN, "prostate", "uterus", "right_ovary", "left_ovary"] },
  { key: "kub", label: "KUB", reportTitle: "USG KUB", restrictSex: "any", pcpndtApplicable: false,
    organKeys: ["right_kidney", "left_kidney", "urinary_bladder", "prostate"] },
  { key: "renal", label: "Renal", reportTitle: "USG Renal", restrictSex: "any", pcpndtApplicable: false,
    organKeys: ["right_kidney", "left_kidney", "urinary_bladder"] },
  { key: "hepatobiliary", label: "Hepatobiliary", reportTitle: "USG Hepatobiliary System", restrictSex: "any", pcpndtApplicable: false,
    organKeys: ["liver", "gallbladder", "cbd", "pancreas"] },
  { key: "male_pelvis", label: "Male Pelvis", reportTitle: "USG Male Pelvis", restrictSex: "male", pcpndtApplicable: false,
    organKeys: PELVIS_M },
  { key: "female_pelvis", label: "Female Pelvis", reportTitle: "USG Female Pelvis", restrictSex: "female", pcpndtApplicable: false,
    organKeys: PELVIS_F },
  { key: "prostate_pvr", label: "Prostate + PVR", reportTitle: "USG Prostate with Post-void Residue", restrictSex: "male", pcpndtApplicable: false,
    organKeys: ["prostate", "urinary_bladder"] },
];

const PRESET_BY_KEY = new Map(USG_PRESETS.map((p) => [p.key, p]));
export function presetByKey(key: string): UsgPresetDef | undefined {
  return PRESET_BY_KEY.get(key);
}

function normSex(sex: string | null | undefined): UsgSex {
  const s = (sex ?? "").trim().toLowerCase();
  if (s === "m" || s === "male") return "male";
  if (s === "f" || s === "female") return "female";
  return "any";
}

/** An organ removed from the expected set by a clinical modifier, with wording. */
export interface AbsentOrgan {
  organKey: string;
  reason: UsgClinicalModifier;
  /** clinically-appropriate statement, or "" to emit no report text. */
  statement: string;
}

const MODIFIER_REMOVES: Partial<Record<UsgClinicalModifier, { organ: string; statement: string }>> = {
  post_cholecystectomy: { organ: "gallbladder", statement: "Gallbladder is surgically absent (post-cholecystectomy)." },
  post_hysterectomy: { organ: "uterus", statement: "Uterus is surgically absent (post-hysterectomy)." },
  nephrectomy_left: { organ: "left_kidney", statement: "Left kidney is surgically absent (post-nephrectomy)." },
  nephrectomy_right: { organ: "right_kidney", statement: "Right kidney is surgically absent (post-nephrectomy)." },
  post_prostatectomy: { organ: "prostate", statement: "Prostate is surgically absent/altered (post-prostatectomy)." },
};

/** Non-organ limitation notes some modifiers add to the report/readiness. */
export const MODIFIER_LIMITATIONS: Partial<Record<UsgClinicalModifier, string>> = {
  inadequate_bladder_filling: "Assessment limited by inadequate bladder filling.",
  bowel_gas_limitation: "Assessment limited by overlying bowel gas.",
};

export interface ResolvedPreset {
  preset: UsgPresetDef;
  organs: UsgOrganDef[];      // expected & present, in preset order, sex-filtered
  absent: AbsentOrgan[];      // surgically-absent organs (from modifiers)
  limitations: string[];      // limitation notes (bowel gas, bladder filling)
}

/**
 * Resolve a preset for a patient: expected organs in order, sex-filtered, with
 * clinical modifiers applied. Surgically-absent organs are separated out (they
 * get "surgically absent" wording, never a normal statement).
 */
export function resolvePreset(
  presetKey: string,
  opts: { sex?: string | null; modifiers?: UsgClinicalModifier[] } = {},
): ResolvedPreset {
  const preset = PRESET_BY_KEY.get(presetKey) ?? PRESET_BY_KEY.get("whole_abdomen")!;
  const sex = normSex(opts.sex);
  const modifiers = opts.modifiers ?? [];

  const removedByModifier = new Map<string, UsgClinicalModifier>();
  const absent: AbsentOrgan[] = [];
  for (const m of modifiers) {
    const rem = MODIFIER_REMOVES[m];
    if (rem && !removedByModifier.has(rem.organ)) {
      removedByModifier.set(rem.organ, m);
      absent.push({ organKey: rem.organ, reason: m, statement: rem.statement });
    }
  }

  const byKey = new Map(USG_ORGANS.map((o) => [o.key, o]));
  const organs: UsgOrganDef[] = [];
  for (const key of preset.organKeys) {
    if (removedByModifier.has(key)) continue;             // surgically absent → not expected-normal
    const organ = byKey.get(key);
    if (!organ) continue;
    const sexOk = organ.sex === "any" || sex === "any" || organ.sex === sex;
    if (sexOk) organs.push(organ);
  }

  const limitations = modifiers.map((m) => MODIFIER_LIMITATIONS[m]).filter((s): s is string => !!s);
  return { preset, organs, absent, limitations };
}

/** Preset options a patient of the given sex may run (restrictSex honoured). */
export function presetsForSex(sex: string | null | undefined): UsgPresetDef[] {
  const s = normSex(sex);
  return USG_PRESETS.filter((p) => p.restrictSex === "any" || s === "any" || p.restrictSex === s);
}
