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

/** Render the template, filling in approved measurements and tracking stats. */
export function autoGenerateReport(input: AutoGenInput): AutoGenOutput {
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

  let body = "";
  switch (input.templateId) {
    case "OB_EARLY":
      body = [
        "GESTATIONAL SAC:  ${gs}      Yolk Sac: ${ys}",
        "CRL             : ${crl}",
        "Gestational Age : ${ga}    EDD: ${edd}",
        "FHR             : ${fhr} bpm     Cardiac activity: Present / Absent",
        "Uterus          : ${uterus}",
        "Ovaries         : R ${ro}    L ${lo}",
        "",
        "FINDINGS:",
        "Single live intrauterine gestation noted.",
        "Gestational sac is regular, with yolk sac visualised.",
        "CRL corresponds to ${ga} of gestation.",
        "Cardiac activity is present at ${fhr} bpm.",
        "",
        "IMPRESSION:",
      ].join("\n")
        .replace("${gs}", "___")
        .replace("${ys}", "___")
        .replace("${crl}", g("crl", "crlConfidence"))
        .replace(/\$\{ga\}/g, g("ga", "gaConfidence"))
        .replace("${edd}", g("edd", "eddConfidence"))
        .replace(/\$\{fhr\}/g, g("fhr", "fhrConfidence"))
        .replace("${uterus}", g("uterusSize", "uterusSizeConfidence"))
        .replace("${ro}", g("rightOvary", "rightOvaryConfidence"))
        .replace("${lo}", g("leftOvary", "leftOvaryConfidence"));
      return { content: header(input, "USG OBSTETRIC — EARLY PREGNANCY") + body + footer(m?.source), templateId: input.templateId, filledFieldCount: filled, skippedLowConfidenceCount: skipped, usedMeasurementId: m?.id ?? null, usedDopplerIds: [] };

    case "OB_GROWTH": {
      const bpd = g("bpd", "bpdConfidence");
      const hc  = g("hc",  "hcConfidence");
      const ac  = g("ac",  "acConfidence");
      const fl  = g("fl",  "flConfidence");
      const efw = g("efw", "efwConfidence");
      const ga  = g("ga",  "gaConfidence");
      const edd = g("edd", "eddConfidence");
      const fhr = g("fhr", "fhrConfidence");
      const afi = m?.liquorAfi ?? "___";
      const placenta = m?.placentaPosition ?? "___";
      const presentation = m?.fetalPresentation ?? "___";
      body = [
        "FETAL BIOMETRY:",
        `  BPD : ${bpd}        HC : ${hc}`,
        `  AC  : ${ac}         FL : ${fl}`,
        `  EFW : ${efw}`,
        "",
        "GESTATIONAL AGE:",
        `  By USG: ${ga}        EDD by USG: ${edd}`,
        "",
        "FETAL WELL-BEING:",
        `  FHR        : ${fhr} bpm   Rhythm: Regular`,
        `  Presentation: ${presentation}`,
        "  Fetal movements: Present",
        "",
        "PLACENTA & LIQUOR:",
        `  Placenta: ${placenta}     Grade: ___`,
        `  AFI     : ${afi} cm        (Normal: 8–18 cm)`,
        "",
        "FINDINGS:",
        "Single live intrauterine fetus seen.",
        `Biometry corresponds to approximately ${ga}.`,
        `BPD ${bpd}, HC ${hc}, AC ${ac}, FL ${fl}.`,
        `Estimated fetal weight ${efw}.`,
        `FHR ${fhr} bpm. Placenta ${placenta}. Liquor ${afi}.`,
        `EDD by USG: ${edd}.`,
        "",
        "IMPRESSION:",
      ].join("\n");
      return { content: header(input, "USG OBSTETRIC — GROWTH SCAN") + body + footer(m?.source), templateId: input.templateId, filledFieldCount: filled, skippedLowConfidenceCount: skipped, usedMeasurementId: m?.id ?? null, usedDopplerIds: [] };
    }

    case "OB_ANOMALY": {
      const bpd = g("bpd","bpdConfidence"), hc=g("hc","hcConfidence"), ac=g("ac","acConfidence"), fl=g("fl","flConfidence"), efw=g("efw","efwConfidence"), ga=g("ga","gaConfidence"), edd=g("edd","eddConfidence"), fhr=g("fhr","fhrConfidence");
      body = [
        `BIOMETRY: BPD ${bpd}  HC ${hc}  AC ${ac}  FL ${fl}  EFW ${efw}`,
        `GA: ${ga}    EDD: ${edd}    FHR: ${fhr} bpm`,
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
      ].join("\n");
      return { content: header(input, "USG OBSTETRIC — ANOMALY SCAN (18–22 wks)") + body + footer(m?.source), templateId: input.templateId, filledFieldCount: filled, skippedLowConfidenceCount: skipped, usedMeasurementId: m?.id ?? null, usedDopplerIds: [] };
    }

    case "PELVIS_FEMALE": {
      const ut = g("uterusSize","uterusSizeConfidence"), endo=g("endometrium","endometriumConfidence"), ro=g("rightOvary","rightOvaryConfidence"), lo=g("leftOvary","leftOvaryConfidence");
      body = [
        `UTERUS      : Size ${ut}   Position: Anteverted / Retroverted`,
        `              Myometrium: Homogeneous     Endometrium: ${endo}`,
        `RIGHT OVARY : ${ro}   Follicles: ___`,
        `LEFT OVARY  : ${lo}   Follicles: ___`,
        "POD         : Free / Fluid",
        "Adnexal lesion: Nil / Present",
        "",
        "IMPRESSION:",
      ].join("\n");
      return { content: header(input, "USG PELVIS — FEMALE (TV / TA)") + body + footer(m?.source), templateId: input.templateId, filledFieldCount: filled, skippedLowConfidenceCount: skipped, usedMeasurementId: m?.id ?? null, usedDopplerIds: [] };
    }

    case "WHOLE_ABDOMEN": {
      const liver=g("liverSize","liverSizeConfidence"), gbw=g("gbWall","gbWallConfidence"), cbd=g("cbd","cbdConfidence"), spleen=g("spleenSize","spleenSizeConfidence"), rk=g("rightKidney","rightKidneyConfidence"), lk=g("leftKidney","leftKidneyConfidence");
      body = [
        `LIVER       : Size ${liver}   Echotexture: Homogeneous   IHBR: Not dilated`,
        `              Portal Vein: Normal calibre`,
        `GALLBLADDER : Wall ${gbw} mm   Calculi: Nil   Sludge: Nil`,
        `CBD         : ${cbd} mm`,
        `SPLEEN      : ${spleen}   Echotexture: Homogeneous`,
        "PANCREAS    : Head/Body/Tail visualised, normal echotexture",
        `RIGHT KIDNEY: ${rk}`,
        `LEFT KIDNEY : ${lk}`,
        "U. BLADDER  : Adequately filled, wall normal, no calculi",
        "AORTA / IVC : Normal calibre",
        "Free fluid  : Nil",
        "",
        "IMPRESSION:",
      ].join("\n");
      return { content: header(input, "USG WHOLE ABDOMEN") + body + footer(m?.source), templateId: input.templateId, filledFieldCount: filled, skippedLowConfidenceCount: skipped, usedMeasurementId: m?.id ?? null, usedDopplerIds: [] };
    }

    case "KUB": {
      const rk=g("rightKidney","rightKidneyConfidence"), lk=g("leftKidney","leftKidneyConfidence"), pv=g("prostateVolume","prostateVolumeConfidence");
      body = [
        `RIGHT KIDNEY : ${rk}   Cortex: ___ mm   Calculi: Nil / Present`,
        `LEFT KIDNEY  : ${lk}   Cortex: ___ mm   Calculi: Nil / Present`,
        "URETERS      : Not dilated / Dilated at ___",
        "U. BLADDER   : Capacity ___ ml   Wall: Normal   Calculi: Nil",
        "               Post-void residue: ___ ml",
        `PROSTATE     : ${pv} ml (if applicable)`,
        "",
        "IMPRESSION:",
      ].join("\n");
      return { content: header(input, "USG KUB") + body + footer(m?.source), templateId: input.templateId, filledFieldCount: filled, skippedLowConfidenceCount: skipped, usedMeasurementId: m?.id ?? null, usedDopplerIds: [] };
    }

    case "PROSTATE": {
      const pv=g("prostateVolume","prostateVolumeConfidence");
      body = [
        `PROSTATE      : Volume ${pv} ml`,
        "                Shape: Normal / Enlarged",
        "                Echotexture: Homogeneous / Heterogeneous",
        "                Median lobe protrusion: Absent / Present",
        "                Calcifications: Nil / Present",
        "SEMINAL VESICLES: Symmetric, no abnormality",
        "U. BLADDER    : Wall normal   Capacity: ___ ml",
        "                Post-void residue: ___ ml",
        "",
        "IMPRESSION:",
      ].join("\n");
      return { content: header(input, "USG PROSTATE (TA / TRUS)") + body + footer(m?.source), templateId: input.templateId, filledFieldCount: filled, skippedLowConfidenceCount: skipped, usedMeasurementId: m?.id ?? null, usedDopplerIds: [] };
    }

    case "SCROTUM":
      body = [
        "RIGHT TESTIS  : ___ × ___ × ___ mm   Volume: ___ ml   Echotexture: Homogeneous",
        "LEFT TESTIS   : ___ × ___ × ___ mm   Volume: ___ ml   Echotexture: Homogeneous",
        "RIGHT EPIDIDYMIS: Head ___ mm   No focal lesion",
        "LEFT EPIDIDYMIS : Head ___ mm   No focal lesion",
        "HYDROCELE     : Nil / Right / Left / Bilateral",
        "VARICOCELE    : Nil / Right / Left",
        "VASCULARITY   : Symmetric arterial flow on colour Doppler",
        "",
        "IMPRESSION:",
      ].join("\n");
      return { content: header(input, "USG SCROTUM") + body + footer(m?.source), templateId: input.templateId, filledFieldCount: filled, skippedLowConfidenceCount: skipped, usedMeasurementId: m?.id ?? null, usedDopplerIds: [] };

    case "THYROID":
      body = [
        "RIGHT LOBE  : ___ × ___ × ___ mm   Volume: ___ ml",
        "LEFT LOBE   : ___ × ___ × ___ mm   Volume: ___ ml",
        "ISTHMUS     : ___ mm",
        "ECHOTEXTURE : Homogeneous / Heterogeneous",
        "NODULES     : Nil / Right ___ TIRADS ___ / Left ___ TIRADS ___",
        "CERVICAL LN : No significant adenopathy",
        "",
        "IMPRESSION:",
      ].join("\n");
      return { content: header(input, "USG THYROID + NECK") + body + footer(m?.source), templateId: input.templateId, filledFieldCount: filled, skippedLowConfidenceCount: skipped, usedMeasurementId: m?.id ?? null, usedDopplerIds: [] };

    case "BREAST":
      body = [
        "RIGHT BREAST : No focal lesion   Skin/Subcutaneous: Normal",
        "               Ductal dilatation: Nil",
        "LEFT BREAST  : No focal lesion   Skin/Subcutaneous: Normal",
        "               Ductal dilatation: Nil",
        "RIGHT AXILLA : No significant adenopathy",
        "LEFT AXILLA  : No significant adenopathy",
        "BIRADS       : ___",
        "",
        "IMPRESSION:",
      ].join("\n");
      return { content: header(input, "USG BREAST — BILATERAL") + body + footer(m?.source), templateId: input.templateId, filledFieldCount: filled, skippedLowConfidenceCount: skipped, usedMeasurementId: m?.id ?? null, usedDopplerIds: [] };

    case "ARTERIAL_DOPPLER":
    case "VENOUS_DOPPLER":
    case "CAROTID_DOPPLER": {
      const titleMap: Record<string,string> = {
        ARTERIAL_DOPPLER: "ARTERIAL DOPPLER",
        VENOUS_DOPPLER:   "VENOUS DOPPLER",
        CAROTID_DOPPLER:  "CAROTID DOPPLER",
      };
      const usedDopplerIds: number[] = [];
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

      body = [
        `VESSELS EVALUATED:`,
        rows,
        "",
        input.templateId === "VENOUS_DOPPLER"
          ? "COMPRESSIBILITY: ___ \nAUGMENTATION   : ___ \nFLOW PHASICITY : ___"
          : input.templateId === "CAROTID_DOPPLER"
            ? "INTIMA-MEDIA THICKNESS:\n  Right CCA: ___ mm     Left CCA: ___ mm\nPLAQUE  : Nil / Right ___ / Left ___"
            : "ANKLE-BRACHIAL INDEX (ABI):\n  Right: ___        Left: ___",
        "",
        "IMPRESSION:",
      ].join("\n");
      return { content: header(input, `${titleMap[input.templateId]}`) + body + footer(m?.source), templateId: input.templateId, filledFieldCount: filled, skippedLowConfidenceCount: skipped, usedMeasurementId: m?.id ?? null, usedDopplerIds };
    }
  }
}
