/**
 * usgReportTemplates.ts
 *
 * 13 enterprise-grade USG / Doppler report templates with auto-fill from
 * APPROVED measurements only. Low-confidence and rejected values are NEVER
 * inserted automatically — the operator must enter them manually.
 *
 * Safety guarantees:
 *   - Only `status === "approved"` measurements feed the template.
 *   - Low-confidence values (`*Confidence === "low"`) are replaced by
 *     `[___ low confidence – verify]` placeholders so the radiologist
 *     must consciously approve them before finalizing.
 *   - Doppler waveform descriptions are inserted verbatim from approved
 *     usg_doppler_measurements rows only.
 *   - Templates always end with an "IMPRESSION:" header for the
 *     radiologist's own narrative — the system never writes the impression.
 *   - "Recommendations" section is rendered empty unless the radiologist
 *     types one — the AI does not suggest clinical follow-up.
 *
 * ── Template-store consolidation ─────────────────────────────────────────────
 * Each template is now split into two parts:
 *   1. SKELETON (content): the static report body with `${token}`
 *      placeholders — data, editable by admins. The authoritative copy lives
 *      in the canonical `structured_report_templates` table (modality "USG",
 *      studyType = the UsgTemplateId), seeded from USG_STRUCTURED_TEMPLATE_
 *      PRESETS below via POST /api/structured-report-templates/seed. The
 *      copies in this file are the built-in defaults AND the fallback when
 *      no DB row exists (see lib/usgTemplateStore.ts for the DB lookup).
 *   2. BINDINGS (logic): which approved measurement feeds which token, with
 *      the low-confidence guard. This stays code — it is the safety layer
 *      and is NOT admin-editable. The header (patient identity) and footer
 *      (disclaimer) are likewise system-owned and never come from the DB.
 * After substitution, any `${token}` the binding layer doesn't know is
 * rendered as "___" so a typo in an admin-edited skeleton degrades to a
 * blank the radiologist fills manually — it can never leak a raw token or
 * an unapproved value into a report.
 */

import type { UsgMeasurement, UsgDopplerMeasurement } from "@workspace/db/schema";

// ─── Public API ───────────────────────────────────────────────────────────────

export type UsgTemplateId =
  | "OB_EARLY"
  | "OB_GROWTH"
  | "OB_ANOMALY"
  | "PELVIS_FEMALE"
  | "WHOLE_ABDOMEN"
  | "KUB"
  | "PROSTATE"
  | "SCROTUM"
  | "THYROID"
  | "BREAST"
  | "ARTERIAL_DOPPLER"
  | "VENOUS_DOPPLER"
  | "CAROTID_DOPPLER";

export interface UsgTemplateDescriptor {
  id: UsgTemplateId;
  label: string;
  category: "OB" | "Abdomen" | "Pelvis" | "Small Parts" | "Doppler";
  description: string;
}

export const USG_TEMPLATES: UsgTemplateDescriptor[] = [
  { id: "OB_EARLY",         label: "OB — Early Pregnancy",        category: "OB",          description: "≤ 13 weeks. GS/YS/CRL/FHR." },
  { id: "OB_GROWTH",        label: "OB — Growth Scan",            category: "OB",          description: "Late 2nd / 3rd trimester biometry, AFI, placenta." },
  { id: "OB_ANOMALY",       label: "OB — Anomaly Scan",           category: "OB",          description: "18–22 weeks anatomical survey." },
  { id: "PELVIS_FEMALE",    label: "Pelvis — Female (TV/TA)",     category: "Pelvis",      description: "Uterus, endometrium, ovaries, POD." },
  { id: "WHOLE_ABDOMEN",    label: "Whole Abdomen",               category: "Abdomen",     description: "Liver, GB, CBD, spleen, pancreas, kidneys, bladder." },
  { id: "KUB",              label: "KUB",                         category: "Abdomen",     description: "Kidneys, ureters, bladder, post-void residue." },
  { id: "PROSTATE",         label: "Prostate (TA/TR)",            category: "Pelvis",      description: "Volume, morphology, residual urine." },
  { id: "SCROTUM",          label: "Scrotum",                     category: "Small Parts", description: "Testes, epididymis, vascularity, hydrocele." },
  { id: "THYROID",          label: "Thyroid",                     category: "Small Parts", description: "Lobes, isthmus, nodules, TIRADS." },
  { id: "BREAST",           label: "Breast",                      category: "Small Parts", description: "Bilateral breast and axillae, BIRADS." },
  { id: "ARTERIAL_DOPPLER", label: "Arterial Doppler (limb)",     category: "Doppler",     description: "Upper/lower limb arterial — PSV, EDV, RI, PI." },
  { id: "VENOUS_DOPPLER",   label: "Venous Doppler (limb)",       category: "Doppler",     description: "DVT screen — compressibility, augmentation, flow." },
  { id: "CAROTID_DOPPLER",  label: "Carotid Doppler",             category: "Doppler",     description: "CCA / ICA / ECA / vertebrals — PSV, EDV, IMT." },
];

export interface AutoGenInput {
  templateId: UsgTemplateId;
  measurement?: UsgMeasurement | null;
  dopplerMeasurements?: UsgDopplerMeasurement[];
  patientName?: string | null;
  patientAge?: string | null;
  patientSex?: string | null;
  referringDoctor?: string | null;
  accessionNumber?: string | null;
  studyDate?: string | null;
  lmp?: string | null;
}

export interface AutoGenOutput {
  content: string;
  templateId: UsgTemplateId;
  filledFieldCount: number;
  skippedLowConfidenceCount: number;
  usedMeasurementId: number | null;
  usedDopplerIds: number[];
}

/** Options for autoGenerateReport — `skeletonOverride` is the admin-edited
 *  skeleton body from structured_report_templates (defaultFindings column);
 *  null/undefined/blank falls back to the built-in skeleton. */
export interface AutoGenOptions {
  skeletonOverride?: string | null;
}

// ─── Smart template selector ──────────────────────────────────────────────────
// Suggest the best template from modality + studyDescription + body part.

export function suggestTemplate(opts: {
  modality?: string | null;
  studyDescription?: string | null;
  bodyPart?: string | null;
}): UsgTemplateId {
  const text = `${opts.modality ?? ""} ${opts.studyDescription ?? ""} ${opts.bodyPart ?? ""}`.toLowerCase();

  if (/anomaly|tiff|level\s*ii|18.{0,3}week|nuchal/.test(text)) return "OB_ANOMALY";
  if (/growth|trimester|3rd|2nd\s+tri|fetal\s+well/.test(text))  return "OB_GROWTH";
  if (/early|nt\s+scan|dating|gestational\s+sac|1st\s+tri|first\s+trimester/.test(text)) return "OB_EARLY";
  if (/obstet|preg|fet[ao]|nuchal|tiffa/.test(text))             return "OB_GROWTH";

  if (/carotid|cca|ica|vertebral|imt/.test(text))                return "CAROTID_DOPPLER";
  if (/venous|dvt|deep\s+vein/.test(text))                       return "VENOUS_DOPPLER";
  if (/arterial|abi|tbi|peripheral\s+art/.test(text))            return "ARTERIAL_DOPPLER";
  if (/doppler/.test(text))                                       return "ARTERIAL_DOPPLER";

  if (/thyroid|tirads|neck/.test(text))                          return "THYROID";
  if (/breast|birads|axill/.test(text))                          return "BREAST";
  if (/scrotum|testis|testes|epididym/.test(text))               return "SCROTUM";
  if (/prostate|trus|tr\s+us/.test(text))                        return "PROSTATE";

  if (/kub|kidney.*bladder|bladder.*kidney/.test(text))          return "KUB";
  if (/whole\s+abd|abdomen|liver|gallbladder|pancreas/.test(text)) return "WHOLE_ABDOMEN";

  if (/pelvis|uterus|ovary|adnex/.test(text))                    return "PELVIS_FEMALE";

  return "WHOLE_ABDOMEN";
}

// ─── Skeletons (content — DB-overridable) ────────────────────────────────────

export interface UsgTemplateSkeleton {
  /** Report title line rendered in the system-owned header. */
  title: string;
  /** bodyPart value used for the structured_report_templates row. */
  bodyPart: string;
  /** Report body with ${token} placeholders bound by buildBindings(). */
  skeleton: string;
}

export const USG_TEMPLATE_SKELETONS: Record<UsgTemplateId, UsgTemplateSkeleton> = {
  OB_EARLY: {
    title: "USG OBSTETRIC — EARLY PREGNANCY",
    bodyPart: "OBSTETRIC",
    skeleton: [
      "GESTATIONAL SAC:  ${gestationalSac}      Yolk Sac: ${yolkSac}",
      "CRL             : ${crl}",
      "Gestational Age : ${ga}    EDD: ${edd}",
      "FHR             : ${fhr} bpm     Cardiac activity: Present / Absent",
      "Uterus          : ${uterus}",
      "Ovaries         : R ${rightOvary}    L ${leftOvary}",
      "",
      "FINDINGS:",
      "Single live intrauterine gestation noted.",
      "Gestational sac is regular, with yolk sac visualised.",
      "CRL corresponds to ${ga} of gestation.",
      "Cardiac activity is present at ${fhr} bpm.",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  OB_GROWTH: {
    title: "USG OBSTETRIC — GROWTH SCAN",
    bodyPart: "OBSTETRIC",
    skeleton: [
      "FETAL BIOMETRY:",
      "  BPD : ${bpd}        HC : ${hc}",
      "  AC  : ${ac}         FL : ${fl}",
      "  EFW : ${efw}",
      "",
      "GESTATIONAL AGE:",
      "  By USG: ${ga}        EDD by USG: ${edd}",
      "",
      "FETAL WELL-BEING:",
      "  FHR        : ${fhr} bpm   Rhythm: Regular",
      "  Presentation: ${presentation}",
      "  Fetal movements: Present",
      "",
      "PLACENTA & LIQUOR:",
      "  Placenta: ${placenta}     Grade: ___",
      "  AFI     : ${afi} cm        (Normal: 8–18 cm)",
      "",
      "FINDINGS:",
      "Single live intrauterine fetus seen.",
      "Biometry corresponds to approximately ${ga}.",
      "BPD ${bpd}, HC ${hc}, AC ${ac}, FL ${fl}.",
      "Estimated fetal weight ${efw}.",
      "FHR ${fhr} bpm. Placenta ${placenta}. Liquor ${afi}.",
      "EDD by USG: ${edd}.",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  OB_ANOMALY: {
    title: "USG OBSTETRIC — ANOMALY SCAN (18–22 wks)",
    bodyPart: "OBSTETRIC",
    skeleton: [
      "BIOMETRY: BPD ${bpd}  HC ${hc}  AC ${ac}  FL ${fl}  EFW ${efw}",
      "GA: ${ga}    EDD: ${edd}    FHR: ${fhr} bpm",
      "",
      "ANATOMICAL SURVEY:",
      "  Head & Neck : ___",
      "  Face & Profile: ___",
      "  Cranium / Cerebellum / Cavum Septum Pellucidum: ___",
      "  Lateral Ventricles: ___",
      "  Spine: ___",
      "  Heart (4-chamber view): ___    Outflow tracts: ___",
      "  Diaphragm: ___",
      "  Stomach: ___       Bowel: ___       Kidneys: ___",
      "  Urinary bladder: ___           Genitalia: ___",
      "  Upper limbs: ___      Lower limbs: ___      Hands/Feet: ___",
      "  Placenta: ___        Cord (3 vessels): ___",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  PELVIS_FEMALE: {
    title: "USG PELVIS — FEMALE (TV / TA)",
    bodyPart: "PELVIS",
    skeleton: [
      "UTERUS      : Size ${uterus}   Position: Anteverted / Retroverted",
      "              Myometrium: Homogeneous     Endometrium: ${endometrium}",
      "RIGHT OVARY : ${rightOvary}   Follicles: ___",
      "LEFT OVARY  : ${leftOvary}   Follicles: ___",
      "POD         : Free / Fluid",
      "Adnexal lesion: Nil / Present",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  WHOLE_ABDOMEN: {
    title: "USG WHOLE ABDOMEN",
    bodyPart: "ABDOMEN",
    skeleton: [
      "LIVER       : Size ${liver}   Echotexture: Homogeneous   IHBR: Not dilated",
      "              Portal Vein: Normal calibre",
      "GALLBLADDER : Wall ${gbWall} mm   Calculi: Nil   Sludge: Nil",
      "CBD         : ${cbd} mm",
      "SPLEEN      : ${spleen}   Echotexture: Homogeneous",
      "PANCREAS    : Head/Body/Tail visualised, normal echotexture",
      "RIGHT KIDNEY: ${rightKidney}",
      "LEFT KIDNEY : ${leftKidney}",
      "U. BLADDER  : Adequately filled, wall normal, no calculi",
      "AORTA / IVC : Normal calibre",
      "Free fluid  : Nil",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  KUB: {
    title: "USG KUB",
    bodyPart: "KUB",
    skeleton: [
      "RIGHT KIDNEY : ${rightKidney}   Cortex: ___ mm   Calculi: Nil / Present",
      "LEFT KIDNEY  : ${leftKidney}   Cortex: ___ mm   Calculi: Nil / Present",
      "URETERS      : Not dilated / Dilated at ___",
      "U. BLADDER   : Capacity ___ ml   Wall: Normal   Calculi: Nil",
      "               Post-void residue: ___ ml",
      "PROSTATE     : ${prostateVolume} ml (if applicable)",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  PROSTATE: {
    title: "USG PROSTATE (TA / TRUS)",
    bodyPart: "PELVIS",
    skeleton: [
      "PROSTATE      : Volume ${prostateVolume} ml",
      "                Shape: Normal / Enlarged",
      "                Echotexture: Homogeneous / Heterogeneous",
      "                Median lobe protrusion: Absent / Present",
      "                Calcifications: Nil / Present",
      "SEMINAL VESICLES: Symmetric, no abnormality",
      "U. BLADDER    : Wall normal   Capacity: ___ ml",
      "                Post-void residue: ___ ml",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  SCROTUM: {
    title: "USG SCROTUM",
    bodyPart: "SCROTUM",
    skeleton: [
      "RIGHT TESTIS  : ___ × ___ × ___ mm   Volume: ___ ml   Echotexture: Homogeneous",
      "LEFT TESTIS   : ___ × ___ × ___ mm   Volume: ___ ml   Echotexture: Homogeneous",
      "RIGHT EPIDIDYMIS: Head ___ mm   No focal lesion",
      "LEFT EPIDIDYMIS : Head ___ mm   No focal lesion",
      "HYDROCELE     : Nil / Right / Left / Bilateral",
      "VARICOCELE    : Nil / Right / Left",
      "VASCULARITY   : Symmetric arterial flow on colour Doppler",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  THYROID: {
    title: "USG THYROID + NECK",
    bodyPart: "NECK",
    skeleton: [
      "RIGHT LOBE  : ___ × ___ × ___ mm   Volume: ___ ml",
      "LEFT LOBE   : ___ × ___ × ___ mm   Volume: ___ ml",
      "ISTHMUS     : ___ mm",
      "ECHOTEXTURE : Homogeneous / Heterogeneous",
      "NODULES     : Nil / Right ___ TIRADS ___ / Left ___ TIRADS ___",
      "CERVICAL LN : No significant adenopathy",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  BREAST: {
    title: "USG BREAST — BILATERAL",
    bodyPart: "BREAST",
    skeleton: [
      "RIGHT BREAST : No focal lesion   Skin/Subcutaneous: Normal",
      "               Ductal dilatation: Nil",
      "LEFT BREAST  : No focal lesion   Skin/Subcutaneous: Normal",
      "               Ductal dilatation: Nil",
      "RIGHT AXILLA : No significant adenopathy",
      "LEFT AXILLA  : No significant adenopathy",
      "BIRADS       : ___",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  ARTERIAL_DOPPLER: {
    title: "ARTERIAL DOPPLER",
    bodyPart: "LIMB",
    skeleton: [
      "VESSELS EVALUATED:",
      "${dopplerRows}",
      "",
      "ANKLE-BRACHIAL INDEX (ABI):\n  Right: ___        Left: ___",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  VENOUS_DOPPLER: {
    title: "VENOUS DOPPLER",
    bodyPart: "LIMB",
    skeleton: [
      "VESSELS EVALUATED:",
      "${dopplerRows}",
      "",
      "COMPRESSIBILITY: ___ \nAUGMENTATION   : ___ \nFLOW PHASICITY : ___",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
  CAROTID_DOPPLER: {
    title: "CAROTID DOPPLER",
    bodyPart: "CAROTID",
    skeleton: [
      "VESSELS EVALUATED:",
      "${dopplerRows}",
      "",
      "INTIMA-MEDIA THICKNESS:\n  Right CCA: ___ mm     Left CCA: ___ mm\nPLAQUE  : Nil / Right ___ / Left ___",
      "",
      "IMPRESSION:",
    ].join("\n"),
  },
};

/** Rows for the canonical structured_report_templates table (modality "USG",
 *  studyType = UsgTemplateId, defaultFindings = the skeleton). Seeded by
 *  POST /api/structured-report-templates/seed so the canonical store — not
 *  this file — is what admins edit; this file remains the fallback. */
export const USG_STRUCTURED_TEMPLATE_PRESETS = USG_TEMPLATES.map((t) => {
  const s = USG_TEMPLATE_SKELETONS[t.id];
  const placeholders = [...new Set([...s.skeleton.matchAll(/\$\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]))];
  return {
    templateName: t.label,
    modality: "USG",
    bodyPart: s.bodyPart,
    studyType: t.id,
    defaultFindings: s.skeleton,
    sectionsJson: JSON.stringify({
      kind: "usg-autofill-skeleton",
      placeholders,
      note:
        "Skeleton for USG auto-generated reports (/api/usg-reports). ${tokens} are filled " +
        "from APPROVED measurements only; unknown tokens render as '___'. The report header, " +
        "footer and safety disclaimer are system-owned and cannot be edited here.",
    }),
    macrosJson: null as string | null,
    isPreset: true,
  };
});

// ─── Renderer ─────────────────────────────────────────────────────────────────

const LOW = "[___ low confidence – verify]";

/** Use the measurement field only if it exists AND is not flagged low-confidence. */
function val(
  m: UsgMeasurement | null | undefined,
  field: keyof UsgMeasurement,
  confField?: keyof UsgMeasurement,
): { text: string; filled: boolean; skipped: boolean } {
  if (!m) return { text: "___", filled: false, skipped: false };
  const raw = m[field];
  if (raw === null || raw === undefined || raw === "") return { text: "___", filled: false, skipped: false };
  if (confField) {
    const conf = m[confField] as string | null;
    if (conf === "low") return { text: LOW, filled: false, skipped: true };
  }
  return { text: String(raw), filled: true, skipped: false };
}

function header(opts: AutoGenInput, titleLine: string): string {
  const date = opts.studyDate ?? new Date().toISOString().slice(0, 10);
  return [
    titleLine,
    "═".repeat(Math.max(60, titleLine.length)),
    `Patient   : ${opts.patientName ?? "___"}` +
      (opts.patientAge ? `   Age: ${opts.patientAge}` : "") +
      (opts.patientSex ? `   Sex: ${opts.patientSex}` : ""),
    `Accession : ${opts.accessionNumber ?? "___"}`,
    `Study Date: ${date}`,
    `Referrer  : ${opts.referringDoctor ?? "___"}`,
    "",
  ].join("\n");
}

function footer(source?: string | null): string {
  const disclaimerLines = [
    "",
    "RECOMMENDATIONS:",
    "(to be added by the radiologist)",
    "",
    "─── Disclaimer ───────────────────────────────────────────────",
    "This report is generated from approved measurements only.",
    "Low-confidence OCR values were excluded and require manual entry.",
    "AI never finalizes a report — human verification is mandatory.",
  ];
  if (source === "ocr" || source === "combined") {
    disclaimerLines.push("Note: Measurements in this report were auto-extracted using Gemini AI OCR from modality captures and verified/approved by the signing radiologist.");
  }
  return disclaimerLines.join("\n");
}

/** Substitute ${token} placeholders. Unknown tokens degrade to "___" — an
 *  admin skeleton typo can never leak a raw token or an unapproved value. */
function renderSkeleton(skeleton: string, bindings: Record<string, string>): string {
  return skeleton.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_whole, token: string) =>
    Object.prototype.hasOwnProperty.call(bindings, token) ? bindings[token] : "___",
  );
}

/** Render the template, filling in approved measurements and tracking stats.
 *  Pass opts.skeletonOverride (the admin-edited structured_report_templates
 *  row's defaultFindings) to render that skeleton instead of the built-in;
 *  bindings, header, footer and all safety rules are identical either way. */
export function autoGenerateReport(input: AutoGenInput, opts: AutoGenOptions = {}): AutoGenOutput {
  const m = input.measurement ?? null;
  const d = input.dopplerMeasurements ?? [];
  let filled = 0;
  let skipped = 0;

  // Tiny helper to grab + count
  const g = (field: keyof UsgMeasurement, conf?: keyof UsgMeasurement) => {
    const r = val(m, field, conf);
    if (r.filled)  filled++;
    if (r.skipped) skipped++;
    return r.text;
  };

  const usedDopplerIds: number[] = [];
  let bindings: Record<string, string>;

  switch (input.templateId) {
    case "OB_EARLY":
      bindings = {
        gestationalSac: "___",
        yolkSac: "___",
        crl: g("crl", "crlConfidence"),
        ga: g("ga", "gaConfidence"),
        edd: g("edd", "eddConfidence"),
        fhr: g("fhr", "fhrConfidence"),
        uterus: g("uterusSize", "uterusSizeConfidence"),
        rightOvary: g("rightOvary", "rightOvaryConfidence"),
        leftOvary: g("leftOvary", "leftOvaryConfidence"),
      };
      break;

    case "OB_GROWTH":
      bindings = {
        bpd: g("bpd", "bpdConfidence"),
        hc:  g("hc",  "hcConfidence"),
        ac:  g("ac",  "acConfidence"),
        fl:  g("fl",  "flConfidence"),
        efw: g("efw", "efwConfidence"),
        ga:  g("ga",  "gaConfidence"),
        edd: g("edd", "eddConfidence"),
        fhr: g("fhr", "fhrConfidence"),
        // Directly substituted (no confidence column, not counted) — same as
        // the pre-consolidation renderer.
        afi: String(m?.liquorAfi ?? "___"),
        placenta: String(m?.placentaPosition ?? "___"),
        presentation: String(m?.fetalPresentation ?? "___"),
      };
      break;

    case "OB_ANOMALY":
      bindings = {
        bpd: g("bpd", "bpdConfidence"),
        hc:  g("hc",  "hcConfidence"),
        ac:  g("ac",  "acConfidence"),
        fl:  g("fl",  "flConfidence"),
        efw: g("efw", "efwConfidence"),
        ga:  g("ga",  "gaConfidence"),
        edd: g("edd", "eddConfidence"),
        fhr: g("fhr", "fhrConfidence"),
      };
      break;

    case "PELVIS_FEMALE":
      bindings = {
        uterus: g("uterusSize", "uterusSizeConfidence"),
        endometrium: g("endometrium", "endometriumConfidence"),
        rightOvary: g("rightOvary", "rightOvaryConfidence"),
        leftOvary: g("leftOvary", "leftOvaryConfidence"),
      };
      break;

    case "WHOLE_ABDOMEN":
      bindings = {
        liver: g("liverSize", "liverSizeConfidence"),
        gbWall: g("gbWall", "gbWallConfidence"),
        cbd: g("cbd", "cbdConfidence"),
        spleen: g("spleenSize", "spleenSizeConfidence"),
        rightKidney: g("rightKidney", "rightKidneyConfidence"),
        leftKidney: g("leftKidney", "leftKidneyConfidence"),
      };
      break;

    case "KUB":
      bindings = {
        rightKidney: g("rightKidney", "rightKidneyConfidence"),
        leftKidney: g("leftKidney", "leftKidneyConfidence"),
        prostateVolume: g("prostateVolume", "prostateVolumeConfidence"),
      };
      break;

    case "PROSTATE":
      bindings = {
        prostateVolume: g("prostateVolume", "prostateVolumeConfidence"),
      };
      break;

    case "SCROTUM":
    case "THYROID":
    case "BREAST":
      bindings = {};
      break;

    case "ARTERIAL_DOPPLER":
    case "VENOUS_DOPPLER":
    case "CAROTID_DOPPLER": {
      const rows = d.length
        ? d.map((row) => {
            usedDopplerIds.push(row.id);
            filled++;
            const side = row.side && row.side !== "unknown" ? ` (${row.side})` : "";
            return `  ${row.vesselName}${side}:  PSV ${row.psv ?? "___"}   EDV ${row.edv ?? "___"}   RI ${row.ri ?? "___"}   PI ${row.pi ?? "___"}   S/D ${row.sdRatio ?? "___"}` +
              (row.waveformLabel ? `\n    Waveform: ${row.waveformLabel}` : "") +
              (row.waveformDescription ? `\n    ${row.waveformDescription}` : "");
          }).join("\n\n")
        : "  (no approved Doppler measurements — add vessels in the Doppler Reporting page)";
      bindings = { dopplerRows: rows };
      break;
    }
  }

  const tpl = USG_TEMPLATE_SKELETONS[input.templateId];
  const skeleton = opts.skeletonOverride && opts.skeletonOverride.trim().length > 0
    ? opts.skeletonOverride
    : tpl.skeleton;
  const body = renderSkeleton(skeleton, bindings);

  return {
    content: header(input, tpl.title) + body + footer(m?.source),
    templateId: input.templateId,
    filledFieldCount: filled,
    skippedLowConfidenceCount: skipped,
    usedMeasurementId: m?.id ?? null,
    usedDopplerIds,
  };
}
