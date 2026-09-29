/**
 * mriBrainLesion.ts — ONE shared lesion-characterization component model for
 * MRI Brain reporting, plus the shared MR-Spectroscopy structured entry.
 *
 * Tumor, infection, inflammatory, CPA, epilepsy structural-lesion and
 * post-operative sub-masters all reuse THESE atoms — they do not re-declare
 * lesion fields. Enhancement atoms are emitted only when contrast was
 * performed; DWI/SWI statements only when those sequences exist.
 *
 * The builder never converts morphology into a histopathological diagnosis;
 * differentials stay radiologist-selected wording ("considered / favored").
 */

import type { PendingPathologyPatch } from "@/lib/zai-workspace/store";
import {
  brainAtomsToPatches,
  brainBundleId,
  type BrainAtomSpec,
} from "@/lib/mriBrainAtoms";
import { sequenceAllows, type BrainSequenceContext } from "@/lib/mriBrainSequences";
import { abc2Volume } from "@/lib/mriBrainMeasures";

export type LesionCompartment = "intra-axial" | "extra-axial" | "intraventricular";
export type LesionNumber = "solitary" | "multiple";
export type LesionLaterality = "right" | "left" | "bilateral" | "midline" | "";
export type EnhancementPattern =
  | "none"
  | "homogeneous"
  | "heterogeneous"
  | "ring"
  | "nodular"
  | "peripheral"
  | "dural-based with dural tail";

export const LESION_MORPHOLOGIES = [
  "solid",
  "cystic",
  "necrotic",
  "mixed",
  "well-defined",
  "ill-defined",
] as const;

export const LESION_FEATURES = [
  "vasogenic edema",
  "cytotoxic edema",
  "haemorrhage",
  "susceptibility blooming",
  "ventricular compression",
  "sulcal effacement",
  "mass effect",
  "midline shift",
  "hydrocephalus",
  "herniation",
] as const;

export type BrainLesionInput = {
  number: LesionNumber;
  compartment: LesionCompartment;
  location: string;
  laterality?: LesionLaterality;
  size?: { ap?: number; transverse?: number; cc?: number; unit?: "cm" | "mm" };
  signal?: Partial<Record<"t1" | "t2" | "flair" | "dwi" | "adc" | "swiGre", string>>;
  morphology?: string[];
  enhancement?: EnhancementPattern | "";
  features?: string[];
  midlineShiftMm?: number;
  /** Radiologist-selected considerations — never auto-diagnosis. */
  differentials?: string[];
};

const COMPARTMENT_CONCEPT: Record<LesionCompartment, { concept: string; section: string; baselineReplaces: string }> = {
  "intra-axial": {
    concept: "brain_parenchyma",
    section: "brain parenchyma",
    baselineReplaces:
      "The cerebral hemispheres show normal morphology with preserved grey-white matter differentiation. No focal parenchymal signal abnormality is seen.",
  },
  "extra-axial": {
    concept: "extra_axial",
    section: "extra-axial spaces",
    baselineReplaces: "No extra-axial collection is identified.",
  },
  intraventricular: {
    concept: "ventricles",
    section: "ventricles",
    baselineReplaces:
      "The ventricular system is appropriate for age. The basal cisterns are patent. No hydrocephalus.",
  },
};

const SIGNAL_LABELS: Record<keyof NonNullable<BrainLesionInput["signal"]>, string> = {
  t1: "T1",
  t2: "T2",
  flair: "FLAIR",
  dwi: "DWI",
  adc: "ADC",
  swiGre: "GRE/SWI",
};

function sizePhrase(size: BrainLesionInput["size"]): string {
  if (!size) return "";
  const unit = size.unit ?? "cm";
  const parts = [size.ap, size.transverse, size.cc].filter(
    (n) => n != null && Number.isFinite(n) && n > 0,
  );
  if (parts.length === 0) return "";
  return ` measuring ${parts.join(" x ")} ${unit}`;
}

/** Three orthogonal axes in cm → ellipsoid volume, always labelled estimated. */
function abc2Phrase(size: BrainLesionInput["size"]): string {
  if (!size || (size.unit ?? "cm") !== "cm") return "";
  const { ap, transverse, cc } = size;
  if (![ap, transverse, cc].every((n) => n != null && Number.isFinite(n) && n > 0)) return "";
  return `, estimated ABC/2 volume ${abc2Volume(ap!, transverse!, cc!)} cc`;
}

/** A free-text location that already names the side must not be doubled. */
const SIDE_IN_LOCATION = /^(right|left|bilateral|midline)\b/i;

function lateralityPrefix(
  laterality: BrainLesionInput["laterality"],
  location: string,
  capitalize: boolean,
): string {
  if (!laterality || SIDE_IN_LOCATION.test(location)) return "";
  return capitalize ? `${laterality[0].toUpperCase()}${laterality.slice(1)} ` : `${laterality} `;
}

/** Compose the ONE structured lesion description sentence. */
export function composeLesionSentence(lesion: BrainLesionInput, seq: BrainSequenceContext): string {
  const num = lesion.number === "multiple"
    ? "Multiple"
    : /^[aeiou]/i.test(lesion.compartment)
      ? "An"
      : "A";
  const loc = (lesion.location || "").trim() || lesion.compartment;
  const lat = lateralityPrefix(lesion.laterality, loc, false);
  const morph = (lesion.morphology ?? []).filter(Boolean);
  const morphPhrase = morph.length ? ` with ${morph.join(", ")} morphology` : "";
  const signalKeys = (Object.keys(lesion.signal ?? {}) as Array<keyof NonNullable<BrainLesionInput["signal"]>>)
    .filter((k) => (lesion.signal?.[k] ?? "").trim())
    .filter((k) => {
      if ((k === "dwi" || k === "adc") && !sequenceAllows(seq, ["dwi", "adc"])) return false;
      if (k === "swiGre" && !seq.performed.swiGre) return false;
      return true;
    });
  const signalPhrase = signalKeys.length
    ? ` (${signalKeys.map((k) => `${SIGNAL_LABELS[k]}: ${String(lesion.signal?.[k]).trim()}`).join("; ")})`
    : "";
  const enh = lesion.enhancement && seq.performed.contrast
    ? ` Showing ${lesion.enhancement === "none" ? "no significant enhancement" : `${lesion.enhancement} enhancement`}.`
    : "";
  return (
    `${num} ${lat}${lesion.compartment} lesion is seen in the ${loc}`
    + `${sizePhrase(lesion.size)}${morphPhrase}${signalPhrase}${abc2Phrase(lesion.size)}.${enh}`
  );
}

export function composeLesionImpressionFragment(lesion: BrainLesionInput, seq: BrainSequenceContext): string {
  const loc = (lesion.location || "").trim() || lesion.compartment;
  const lat = lateralityPrefix(lesion.laterality, loc, true);
  const core = `${lesion.number === "multiple" ? "Multiple" : ""} ${lat}${loc} ${lesion.compartment} lesion${lesion.number === "multiple" ? "s" : ""}`.trim();
  const differential = (lesion.differentials ?? []).filter(Boolean);
  const differentialPhrase = differential.length
    ? ` — radiologist-selected considerations: ${differential.join(", ")}.`
    : ".";
  const enh = lesion.enhancement && lesion.enhancement !== "none" && seq.performed.contrast
    ? ` (${lesion.enhancement} enhancing)`
    : "";
  return `${core.charAt(0).toUpperCase()}${core.slice(1)}${enh}${differentialPhrase}`;
}

/**
 * Build ledger atoms for one characterized lesion + its associated features.
 * Associated-feature atoms reuse the shared grading concepts (mass_effect,
 * midline_shift, hemorrhage, hydrocephalus, herniation, edema) so validation,
 * critical detection and reconciliation work identically everywhere.
 */
export function buildBrainLesionAtoms(
  lesion: BrainLesionInput,
  opts: { region?: string; seq: BrainSequenceContext; bundleId?: string; impressionworthy?: boolean },
): { bundleId: string; observations: PendingPathologyPatch[] } {
  const region = opts.region ?? "Brain";
  const bundleId = opts.bundleId ?? brainBundleId("lesion", Date.now().toString(36));
  const owner = COMPARTMENT_CONCEPT[lesion.compartment];
  const findings = composeLesionSentence(lesion, opts.seq);
  const impression =
    opts.impressionworthy === false ? undefined : composeLesionImpressionFragment(lesion, opts.seq);

  const atoms: BrainAtomSpec[] = [
    {
      concept: owner.concept,
      conflictGroup: owner.concept,
      anatomicalSection: owner.section,
      findings,
      impression,
      baselineReplaces: owner.baselineReplaces,
      laterality: lesion.laterality || undefined,
      state: lesion.compartment,
    },
  ];

  const features = new Set((lesion.features ?? []).map((f) => f.toLowerCase()));
  const pushFeature = (
    concept: string,
    conflictGroup: string,
    sentence: string,
    extra?: Partial<BrainAtomSpec>,
  ) =>
    atoms.push({
      concept,
      conflictGroup,
      anatomicalSection: "brain",
      findings: sentence,
      ...extra,
    });

  if (features.has("vasogenic edema")) {
    pushFeature("edema", "edema", "Vasogenic oedema is seen surrounding the lesion.");
  }
  if (features.has("cytotoxic edema")) {
    pushFeature("edema", "edema", "Cytotoxic oedema is seen in the region of the lesion.");
  }
  if (features.has("haemorrhage") || features.has("hemorrhage")) {
    pushFeature("hemorrhage", "hemorrhage", "Within the lesion there is haemorrhagic component.", {
      baselineReplaces: "No intracranial haemorrhage is seen.",
    });
  }
  if (features.has("susceptibility blooming")) {
    if (opts.seq.performed.swiGre) {
      pushFeature("susceptibility", "susceptibility", "Susceptibility blooming is seen in relation to the lesion.", {
        baselineReplaces: "No abnormal susceptibility blooming is seen on GRE/SWI.",
      });
    }
  }
  if (features.has("ventricular compression") || features.has("sulcal effacement")) {
    const what = features.has("ventricular compression")
      ? "with compression of the adjacent ventricle"
      : "with effacement of the adjacent cortical sulci";
    pushFeature("mass_effect", "mass_effect", `Local mass effect is present ${what}.`);
  } else if (features.has("mass effect")) {
    pushFeature("mass_effect", "mass_effect", "Mass effect is present.");
  }
  if (features.has("midline shift")) {
    const mm = Number(lesion.midlineShiftMm);
    if (Number.isFinite(mm) && mm > 0) {
      atoms.push({
        concept: "midline_shift",
        conflictGroup: "midline",
        anatomicalSection: "midline",
        findings: `Midline shift of ${mm} mm is present.`,
        impression: `Midline shift ${mm} mm.`,
        baselineReplaces: "No midline shift. No mass effect.",
        measurement: String(mm),
        severity: mm >= 5 ? "critical" : "significant",
      });
    } else {
      pushFeature("midline_shift", "midline", "Midline shift is present.", {
        baselineReplaces: "No midline shift. No mass effect.",
      });
    }
  }
  if (features.has("hydrocephalus")) {
    atoms.push({
      concept: "cerebral_hydrocephalus",
      conflictGroup: "ventricles",
      anatomicalSection: "ventricles",
      findings: "Hydrocephalus is present.",
      impression: "Hydrocephalus.",
      baselineReplaces:
        "The ventricular system is appropriate for age. The basal cisterns are patent. No hydrocephalus.",
      severity: "urgent",
    });
  }
  if (features.has("herniation")) {
    atoms.push({
      concept: "brain_herniation",
      conflictGroup: "brain_herniation",
      anatomicalSection: "brain",
      findings: "Trans-tentorial / tonsillar herniation is present.",
      impression: "Herniation.",
      severity: "critical",
    });
  }

  const differential = (lesion.differentials ?? []).filter(Boolean);
  if (differential.length) {
    atoms.push({
      concept: "lesion_differential",
      conflictGroup: "lesion_differential",
      anatomicalSection: owner.section,
      findings:
        `Imaging characteristics favor ${differential[0]}`
        + (differential.length > 1
          ? `; differentials considered include ${differential.slice(1).join(", ")}`
          : "")
        + ". Histopathological correlation is required for definitive diagnosis.",
    });
  }

  return { bundleId, observations: brainAtomsToPatches(region, bundleId, atoms) };
}

// ─── Shared MR Spectroscopy ────────────────────────────────────────────────

export type BrainMrsInput = {
  voxelLocation: string;
  cho?: number | "";
  cr?: number | "";
  naa?: number | "";
  lipid?: boolean;
  lactate?: boolean;
  choCr?: number | "";
  choNaa?: number | "";
  /** Radiologist-selected descriptive interpretation only. */
  interpretation?: Array<
    | "elevated choline"
    | "reduced NAA"
    | "lipid/lactate peak"
    | "no significant metabolite abnormality"
    | string
  >;
};

export function composeMrsSentence(mrs: BrainMrsInput): string {
  const loc = (mrs.voxelLocation || "").trim() || "the lesion";
  const values: string[] = [];
  const num = (v: number | "" | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const cho = num(mrs.cho);
  const cr = num(mrs.cr);
  const naa = num(mrs.naa);
  if (cho != null) values.push(`Cho ${cho}`);
  if (cr != null) values.push(`Cr ${cr}`);
  if (naa != null) values.push(`NAA ${naa}`);
  const ratioChoCr = num(mrs.choCr);
  const ratioChoNaa = num(mrs.choNaa);
  if (ratioChoCr != null) values.push(`Cho/Cr ${ratioChoCr}`);
  if (ratioChoNaa != null) values.push(`Cho/NAA ${ratioChoNaa}`);
  if (mrs.lipid) values.push("lipid peak");
  if (mrs.lactate) values.push("lactate peak");
  const interp = (mrs.interpretation ?? []).filter(Boolean);
  const valuePhrase = values.length ? ` Metabolite values: ${values.join(", ")}.` : "";
  const interpPhrase = interp.length ? ` Impression of the spectroscopy: ${interp.join("; ")}.` : "";
  return (
    `MR spectroscopy with voxel over ${loc} was analysed.`
    + `${valuePhrase}${interpPhrase}`
  );
}

/**
 * MRS atoms — descriptive only. Never auto-diagnoses tumor/TB/NCC/abscess
 * from metabolite patterns; the integrated interpretation is the
 * radiologist's.
 */
export function buildBrainMrsAtoms(
  mrs: BrainMrsInput,
  opts: { region?: string; seq: BrainSequenceContext; bundleId?: string },
): { bundleId: string; observations: PendingPathologyPatch[] } | null {
  if (!opts.seq.performed.mrs) return null; // MRS not performed → no spectroscopy findings.
  const region = opts.region ?? "Brain";
  const bundleId = opts.bundleId ?? brainBundleId("mrs", Date.now().toString(36));
  const findings = composeMrsSentence(mrs);
  const atoms: BrainAtomSpec[] = [
    {
      concept: "mrs_metabolites",
      conflictGroup: "mrs",
      anatomicalSection: "spectroscopy",
      findings,
      baselineReplaces: "MR spectroscopy shows no significant metabolite abnormality.",
    },
  ];
  return { bundleId, observations: brainAtomsToPatches(region, bundleId, atoms) };
}
