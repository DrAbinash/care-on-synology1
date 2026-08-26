import type { Modality, ReportFormat, MergeResult } from "./types";
import { mergeTwoFormats } from "./types";
import { canonicalContentRegion, contentStudyTypes, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import { formatsMissingOnServer, mergeAuthoritativeFormats, formatDedupeKey } from "./reportFormatSync";
import { formatContextRank, type FormatLookupExtras } from "./fullReportFormat";

const now = () => new Date().toISOString();
const uid = () => `rf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

function fmt(
  n: string,
  m: Modality,
  b: string,
  t: string[],
  body: {
    clinicalHistory?: string;
    technique: string;
    findings: string;
    impression: string;
    recommendation: string;
    reportTitle?: string;
    protocolScope?: string;
  },
  c = false,
): ReportFormat {
  return {
    id: uid(),
    name: n,
    modality: m,
    bodyPart: b,
    diagnosisTags: t,
    clinicalHistory: body.clinicalHistory ?? "",
    isCommon: c,
    createdAt: now(),
    updatedAt: now(),
    technique: body.technique,
    findings: body.findings,
    impression: body.impression,
    recommendation: body.recommendation,
    reportTitle: body.reportTitle ?? "",
    protocolScope: body.protocolScope ?? "",
  };
}

export function hydrateFormat(raw: Partial<ReportFormat> & { name: string }): ReportFormat {
  return {
    id: raw.id ?? uid(),
    name: raw.name,
    modality: (raw.modality ?? "MR") as Modality,
    bodyPart: canonicalContentRegion(raw.bodyPart) || (raw.bodyPart ?? ""),
    diagnosisTags: raw.diagnosisTags ?? [],
    clinicalHistory: raw.clinicalHistory ?? "",
    technique: raw.technique ?? "",
    findings: raw.findings ?? "",
    impression: raw.impression ?? "",
    recommendation: raw.recommendation ?? "",
    reportTitle: raw.reportTitle ?? "",
    protocolScope: raw.protocolScope ?? "",
    isCommon: raw.isCommon ?? false,
    custom: raw.custom,
    favorite: raw.favorite,
    usageCount: raw.usageCount,
    createdAt: raw.createdAt ?? now(),
    updatedAt: raw.updatedAt ?? now(),
  };
}

export const DEFAULT_REPORT_FORMATS: ReportFormat[] = [
  fmt("MRI Brain — Normal", "MR", "Brain", ["normal"], { clinicalHistory: "MRI brain requested. Correlate with presenting symptoms.", technique: "MRI brain on 3T. T1W, T2W, FLAIR, DWI, ADC, post-contrast T1W GRE. 5 mm.", findings: "Brain parenchyma shows normal signal intensity. No acute infarct, hemorrhage, or mass lesion. Ventricular system and cisternal spaces are normal. No midline shift. Cortical sulci normal for age. Basal cisterns unremarkable. No restricted diffusion on DWI/ADC. Flow voids in major intracranial vessels are normal. Basal ganglia are normal in signal intensity.", impression: "Normal MRI brain. No acute intracranial abnormality.", recommendation: "Clinical correlation. Follow-up as clinically indicated.", reportTitle: "MRI BRAIN PLAIN" }, true),
  fmt("MRI Brain — Fazekas 1", "MR", "Brain", ["white matter disease", "fazekas 1"], { technique: "MRI brain on 3T. T1W, T2W, FLAIR, DWI, ADC, post-contrast T1W GRE. 5 mm.", findings: "Few punctate T2/FLAIR hyperintense white matter lesions in bilateral periventricular and deep white matter, Fazekas grade 1. No confluent lesions. Brain parenchyma otherwise normal. No acute infarct, hemorrhage, or mass lesion. Ventricular system and cisternal spaces are normal. No midline shift. Cortical sulci normal for age. No restricted diffusion on DWI/ADC. Flow voids in major intracranial vessels are normal.", impression: "Mild chronic small vessel ischemic disease (Fazekas grade 1). No acute infarct or hemorrhage.", recommendation: "Clinical correlation. Control of vascular risk factors. Follow-up as clinically indicated.", reportTitle: "MRI BRAIN PLAIN" }, true),
  fmt("MRI Brain — Fazekas Grade 1 + Senile Changes", "MR", "Brain", ["white matter disease", "fazekas 1", "senile", "atrophy"], { clinicalHistory: "MRI brain requested. Correlate with presenting symptoms.", technique: "MRI Brain was performed using the configured standard brain protocol on 3T. Multiplanar T1W, T2W, FLAIR, DWI, ADC and GRE/SWI sequences were obtained.", findings: "Mild age-related cerebral volume loss with prominence of the cortical sulci and ventricular system, in keeping with senile/involutional changes.\nFew punctate/periventricular T2/FLAIR hyperintense white matter foci in bilateral cerebral hemispheres, Fazekas grade 1. No confluent lesions.\nGrey-white matter differentiation is preserved. No focal cortical or subcortical signal abnormality, mass lesion, or acute infarct identified. No restricted diffusion on DWI/ADC. Basal ganglia are normal in signal intensity. Flow voids in major intracranial vessels are normal.", impression: "Mild chronic small vessel ischemic changes — Fazekas grade 1.\nMild age-related cerebral atrophic changes.", recommendation: "", reportTitle: "MRI BRAIN PLAIN", protocolScope: "Plain" }, true),
  fmt("MRI Brain — Glioma recurrence", "MR", "Brain", ["tumor", "glioma", "recurrence", "critical"], { technique: "MRI brain with contrast on 3T. T1W, T2W, FLAIR, DWI, ADC, post-contrast T1W GRE. 5 mm. IV: Gadobutrol 0.1 mmol/kg.", findings: "Heterogeneously enhancing area in the right frontal operculum at the post-resection cavity, measuring approximately ___ × ___ × ___ cm, with surrounding T2/FLAIR hyperintensity suggestive of edema. Findings are concerning for tumor recurrence. No new satellite lesions. No midline shift. Ventricular system is normal. Basal cisterns are unremarkable. No restricted diffusion on DWI/ADC. Flow voids in major intracranial vessels are normal.", impression: "Heterogeneously enhancing lesion in the right frontal operculum with surrounding edema. Findings are concerning for tumor recurrence. Recommend correlation with clinical status and oncology referral.", recommendation: "Urgent oncology referral. Recommend MRI brain with contrast and perfusion imaging in 6-8 weeks. Consider MR spectroscopy if clinically indicated." }, true),
  fmt("MRI Brain — Acute infarct (MCA)", "MR", "Brain", ["stroke", "infarct", "critical"], { technique: "MRI brain on 3T. T1W, T2W, FLAIR, DWI, ADC, GRE/SWI. 5 mm.", findings: "Restricted diffusion in the left middle cerebral artery territory on DWI/ADC, consistent with acute infarct. No hemorrhagic transformation. Mass effect minimal. Brain parenchyma otherwise normal. Ventricular system and cisternal spaces are normal. No midline shift. Flow voids: left MCA flow void absent, consistent with occlusion.", impression: "Acute left MCA territory infarct. No hemorrhagic transformation. ASPECTS: ___/10.", recommendation: "Immediate stroke team notification. If within thrombolysis window, consider IV tPA. MRA head and neck recommended." }, true),
  fmt("MRI Cervical Spine — Normal", "MR", "Cervical Spine", ["normal"], { clinicalHistory: "MRI cervical spine requested. Correlate with neck pain or radiculopathy.", technique: "MRI cervical spine on 3T. Sagittal T1W, T2W; axial T1W, T2W. 3 mm.", findings: "Cervical vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No cord compression. Spinal cord signal is normal. Prevertebral soft tissues are unremarkable.", impression: "Normal MRI cervical spine. No cord compression or significant disc herniation.", recommendation: "Clinical correlation. Follow-up as clinically indicated.", reportTitle: "MRI CERVICAL SPINE" }, true),
  fmt("MRI Cervical Spine — Screening", "MR", "Cervical Spine", ["screening"], { technique: "MRI cervical spine screening on 3T. Sagittal T1W, T2W; selected axial T2W.", findings: "Cervical vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No cord compression. Spinal cord signal is normal. Prevertebral soft tissues are unremarkable.", impression: "Normal MRI cervical spine screening. No cord compression or significant disc herniation.", recommendation: "", reportTitle: "MRI CERVICAL SPINE SCREENING", protocolScope: "Screening" }, true),
  fmt("MRI LS Spine — Normal", "MR", "LS Spine", ["normal"], { technique: "MRI lumbo-sacral spine on 3T. Sagittal T1W, T2W; axial T1W, T2W. 4 mm.", findings: "Lumbar vertebrae show normal alignment and marrow signal. No spondylolisthesis. Disc spaces are maintained. No acute fracture. Conus medullaris at L1 with normal appearance. Cauda equina nerve roots are normally distributed. Paraspinal soft tissues are unremarkable. Sacroiliac joints are normal.", impression: "Normal MRI lumbo-sacral spine. No acute bony or disc abnormality.", recommendation: "Clinical correlation. Follow-up as clinically indicated.", reportTitle: "MRI LUMBOSACRAL SPINE" }, true),
  fmt("MRI LS Spine — Disc herniation L4-L5", "MR", "LS Spine", ["disc", "herniation"], { technique: "MRI lumbo-sacral spine on 3T. Sagittal T1W, T2W; axial T1W, T2W. 4 mm.", findings: "Broad-based disc bulge at L4-L5 with posterocentral-right paracentral protrusion causing indentation on the thecal sac and mild narrowing of bilateral neural foramina. No significant central canal stenosis. Lumbar vertebrae show normal alignment and marrow signal. No spondylolisthesis. L4-L5 disc shows mild desiccation with reduced T2 signal. Other disc spaces are maintained. Conus medullaris at L1 with normal appearance. Cauda equina nerve roots are normally distributed. Paraspinal soft tissues are unremarkable. Sacroiliac joints are normal.", impression: "Disc herniation at L4-L5 causing indentation on the thecal sac and mild narrowing of bilateral neural foramina. No significant central canal stenosis.", recommendation: "Conservative management with NSAIDs and physiotherapy. MRI if radicular symptoms persist. Surgical referral if neurological deficits develop.", reportTitle: "MRI LUMBOSACRAL SPINE" }, true),
  fmt("MRI Dorsal Spine — Screening", "MR", "Dorsal Spine", ["screening"], { technique: "Limited dorsal spine screening with sagittal T1W, T2W and STIR (limited planar and limited sequence).", findings: "DORSAL SPINE SCREENING\nDorsal vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No cord compression. Spinal cord signal is normal. This is a limited screening examination.", impression: "Normal dorsal spine screening. No cord compression.", recommendation: "", reportTitle: "MRI DORSAL SPINE SCREENING", protocolScope: "Screening" }, true),
  fmt("MRI Whole Spine — Screening", "MR", "Whole Spine", ["screening", "whole spine"], { technique: "Limited whole-spine screening was performed with sagittal T1W, T2W and STIR sequences of the cervical and dorsal spine (limited planar and limited sequence).", findings: "CERVICAL SPINE SCREENING\nCervical vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No cord compression. Spinal cord signal is normal. This is a limited screening examination.\n\nDORSAL SPINE SCREENING\nDorsal vertebrae show normal alignment and marrow signal. Disc spaces are maintained. No cord compression. Spinal cord signal is normal. This is a limited screening examination.", impression: "Normal cervical and dorsal spine screening. No cord compression.", recommendation: "", reportTitle: "MRI WHOLE SPINE SCREENING", protocolScope: "Screening" }, true),
  fmt("CT Brain — Normal", "CT", "Brain", ["normal"], { technique: "Non-contrast CT brain on 128-slice scanner. 5 mm. Axial sections from skull base to vertex.", findings: "Brain parenchyma shows normal attenuation. No acute hemorrhage or mass lesion. Ventricular system and cisternal spaces are normal. No midline shift. Cortical sulci normal for age. Basal cisterns are patent. Pineal and choroid plexus calcifications, normal for age. Bony calvarium is unremarkable.", impression: "Normal non-contrast CT brain. No acute intracranial abnormality.", recommendation: "Clinical correlation. Follow-up as clinically indicated." }, true),
  fmt("CT Brain — Acute infarct (MCA)", "CT", "Brain", ["stroke", "infarct", "critical"], { technique: "Non-contrast CT brain on 128-slice scanner. 5 mm. Axial sections from skull base to vertex.", findings: "Loss of grey-white differentiation in the left middle cerebral artery territory, consistent with acute infarct. Hyperdense left MCA sign. No hemorrhagic transformation. Mass effect with effacement of cortical sulci in the left hemisphere. No midline shift at this time. Ventricular system is normal. Basal cisterns are patent. Bony calvarium is unremarkable.", impression: "Acute left MCA territory infarct. No hemorrhagic transformation. ASPECTS: ___/10.", recommendation: "Immediate stroke team notification. If within thrombolysis window, consider IV tPA. CTA head and neck recommended." }, true),
  fmt("CT Brain — Acute ICH", "CT", "Brain", ["hemorrhage", "critical"], { technique: "Non-contrast CT brain on 128-slice scanner. 5 mm. Axial sections from skull base to vertex.", findings: "Acute intraparenchymal hemorrhage in the right basal ganglia measuring ___ × ___ cm. Intraventricular extension into the lateral ventricles. Mass effect with midline shift of ___ mm to the left. Surrounding low attenuation suggestive of edema. Ventricular system is dilated. Bony calvarium is unremarkable.", impression: "Acute intraparenchymal hemorrhage in the right basal ganglia with intraventricular extension and mass effect.", recommendation: "Urgent neurosurgery referral for hematoma evacuation. ICU admission. Blood pressure control. Repeat CT in 24-48 hours." }, true),
  fmt("CT Chest — Normal", "CT", "Chest", ["normal"], { technique: "CT thorax on 128-slice scanner. Contrast-enhanced. 5 mm. IV: 350 mgI/mL, 80 mL. MPR in coronal and sagittal planes.", findings: "Lung fields are clear. No focal consolidation, mass lesion, or nodule. Trachea and main bronchi are patent. Bilateral pleural spaces are clear. No pleural effusion or pneumothorax. Mediastinum is normal. No lymphadenopathy. Heart and great vessels are unremarkable. Pulmonary vasculature is normal. Bony thorax shows no lytic or sclerotic lesion.", impression: "Normal CT thorax. No acute intrathoracic abnormality.", recommendation: "Clinical correlation. Follow-up as clinically indicated." }, true),
  fmt("CT Chest — Bronchogenic carcinoma (RUL)", "CT", "Chest", ["malignancy", "lung cancer", "critical"], { technique: "CT thorax on 128-slice scanner. Contrast-enhanced. 5 mm. IV: 350 mgI/mL, 80 mL. MPR in coronal and sagittal planes.", findings: "Spiculated soft tissue mass in the right upper lobe measuring ___ × ___ × ___ cm with surrounding ground-glass opacities. Findings are highly suspicious for malignancy. New satellite nodules in the right upper lobe. Mediastinal lymphadenopathy: subcarinal node measuring ___ × ___ cm, paratracheal nodes enlarged. No pleural effusion. No pericardial effusion. Trachea and main bronchi are patent. Pulmonary vasculature is normal. Bony thorax shows no lytic or sclerotic lesion.", impression: "Spiculated mass in the right upper lobe with mediastinal lymphadenopathy, highly suspicious for bronchogenic carcinoma with nodal involvement.", recommendation: "Urgent oncology referral. Tissue diagnosis via CT-guided biopsy or bronchoscopy. PET-CT for complete staging. Brain MRI for metastasis assessment." }, true),
  fmt("XR LS Spine — Normal", "XR", "LS Spine", ["normal"], { technique: "Radiograph of lumbo-sacral spine on digital radiography unit. Standard AP and lateral views.", findings: "Lumbar vertebrae show normal alignment. No spondylolisthesis. Disc spaces are maintained. No acute fracture. Vertebral body heights are maintained. Bony cortex is intact. Sacroiliac joints are normal. Soft tissues are unremarkable.", impression: "Normal lumbo-sacral spine radiograph. No acute bony abnormality.", recommendation: "Clinical correlation. MRI lumbo-sacral spine if radicular symptoms persist." }, true),
  fmt("XR LS Spine — Degenerative changes", "XR", "LS Spine", ["degenerative"], { technique: "Radiograph of lumbo-sacral spine on digital radiography unit. Standard AP and lateral views.", findings: "Mild degenerative changes with marginal osteophytes at L3-L4 and L4-L5. Reduced L4-L5 disc space with endplate sclerosis. No significant spondylolisthesis. No acute fracture. Vertebral body heights are maintained. Bony cortex is intact. Sacroiliac joints are normal. Soft tissues are unremarkable.", impression: "Mild degenerative changes of the lumbar spine. No acute bony abnormality.", recommendation: "Clinical correlation. Conservative management with NSAIDs and physiotherapy. MRI if symptoms persist." }, true),
  fmt("US Abdomen — Normal", "US", "Abdomen", ["normal"], { technique: "Ultrasound of whole abdomen on convex transducer (3-6 MHz) with patient in supine position.", findings: "Liver is normal in size and echo texture. No focal lesion. Intrahepatic biliary radicals are not dilated. Portal vein is normal. Gallbladder is normal in size and wall thickness. No calculi or sludge. Common bile duct is unremarkable. Pancreas is normal in size and echo texture. Spleen is normal in size and echo texture. No focal lesion. Both kidneys are normal in size and cortical thickness. No calculus or hydronephrosis. Cortical echogenicity is normal. Urinary bladder is normal. No free fluid in abdomen.", impression: "Normal ultrasound abdomen. No focal lesion or free fluid detected.", recommendation: "Clinical correlation. Follow-up as clinically indicated." }, true),
  fmt("US Abdomen — Cholelithiasis", "US", "Abdomen", ["gallstones"], { technique: "Ultrasound of whole abdomen on convex transducer (3-6 MHz) with patient in supine position.", findings: "Multiple echogenic foci with acoustic shadowing in the gallbladder lumen, largest measuring ___ mm, suggestive of cholelithiasis. Gallbladder wall thickness is normal. No pericholecystic fluid. No sonographic Murphy sign. Common bile duct is unremarkable, measuring ___ mm. Liver is normal in size and echo texture. No focal lesion. Intrahepatic biliary radicals are not dilated. Portal vein is normal. Pancreas is normal. Spleen is normal. Both kidneys are normal. No free fluid in abdomen.", impression: "Cholelithiasis. No sonographic evidence of acute cholecystitis. No biliary dilatation.", recommendation: "Clinical correlation. Surgical consultation if symptomatic. Follow-up ultrasound as clinically indicated." }, true),
  fmt("US OB — Normal 2nd trimester", "US", "OB", ["normal", "anomaly scan"], { technique: "Ultrasound obstetric scan on convex transducer (3-6 MHz). Transabdominal. Biometry: BPD, HC, AC, FL.", findings: "Single live intrauterine gestation. Cardiac activity positive (FHR ___ bpm). Biometry corresponds to ___ weeks. BPD: ___ mm. HC: ___ mm. AC: ___ mm. FL: ___ mm. EFW: ___ g. Placenta is posterior, fundal, grade II. Normal amniotic fluid volume (AFI: ___ cm). No fetal anomaly detected. Four-chamber heart normal. Spine intact. Limbs normal. Stomach bubble seen. Bladder seen.", impression: "Single live intrauterine gestation corresponding to gestational age. No fetal anomaly detected. Normal amniotic fluid volume.", recommendation: "Routine follow-up scan at 28 weeks. Clinical correlation advised." }, true),
  fmt("MG Breast — BI-RADS 2 (Benign)", "MG", "Breast", ["birads 2", "benign", "screening"], { technique: "Bilateral mammography. Standard CC and MLO views. Tomosynthesis acquired. Comparison with prior mammogram dated ____.", findings: "Bilateral breast parenchyma is symmetric. No suspicious masses or architectural distortion. No pleomorphic microcalcifications. Two well-circumscribed oval masses with coarse calcifications in the left breast, upper outer quadrant — benign features consistent with fibroadenomas. Stable compared to prior. Axillary lymph nodes are normal in morphology. Skin and nipples are unremarkable.", impression: "BI-RADS 2: Benign findings. Stable fibroadenomas in the left breast. No suspicious masses or calcifications.", recommendation: "Routine screening mammography in 12 months. Clinical correlation advised." }, true),
  fmt("MG Breast — BI-RADS 5 (Highly suspicious)", "MG", "Breast", ["birads 5", "malignancy", "critical"], { technique: "Bilateral mammography. Standard CC and MLO views. Tomosynthesis acquired. Comparison with prior mammogram dated ____.", findings: "Spiculated mass in the right breast, upper outer quadrant, measuring ___ × ___ cm, with associated skin retraction and nipple retraction. Clustered pleomorphic microcalcifications in the same region. Enlarged right axillary lymph node with cortical thickening and loss of fatty hilum. Left breast is unremarkable.", impression: "BI-RADS 5: Highly suggestive of malignancy. Spiculated mass with microcalcifications and suspicious axillary lymph node in the right breast.", recommendation: "Image-guided biopsy of the right breast lesion is mandatory. Surgical referral advised. Bilateral breast MRI for staging. Oncology referral." }, true),
];

/** @deprecated Use lookupFormatsForContext with ReportingStudyContext. */
export function lookupFormats(formats: ReportFormat[], m: Modality | undefined, b: string | undefined): ReportFormat[] {
  return formats.filter((f) => f.modality === m && (!b || f.bodyPart === b)).sort((a, b) => {
    if (a.isCommon !== b.isCommon) return a.isCommon ? -1 : 1;
    return (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.name.localeCompare(b.name);
  });
}

export function lookupFormatsForContext(
  formats: ReportFormat[],
  m: Modality | undefined,
  ctx: ReportingStudyContext | null | undefined,
  extras?: FormatLookupExtras,
): ReportFormat[] {
  if (!ctx?.region) return [];
  const allowed = new Set(contentStudyTypes(ctx.regions.length > 0 ? ctx.regions : [ctx.region]).map((s) => s.toLowerCase()));
  const hay: FormatLookupExtras = {
    protocolName: extras?.protocolName ?? ctx.protocolName,
    studyDescription: extras?.studyDescription ?? ctx.studyDescription,
  };
  return formats
    .filter((f) => {
      if (f.modality !== m) return false;
      const bp = (canonicalContentRegion(f.bodyPart) || f.bodyPart).toLowerCase();
      return allowed.has(bp);
    })
    .sort((a, b) => {
      const ra = formatContextRank(a, hay);
      const rb = formatContextRank(b, hay);
      if (ra !== rb) return rb - ra;
      return a.name.localeCompare(b.name);
    });
}

const SK = "zai-rad-reportformats-v1";
/** Set after a successful server migrate/sync — server is authoritative thereafter. */
export const SERVER_AUTHORITATIVE_FLAG = "zai-rad-reportformats-server-v1";

export function readLocalFormatsCache(): ReportFormat[] {
  try {
    const r = localStorage.getItem(SK);
    if (!r) return [];
    const parsed = JSON.parse(r) as Partial<ReportFormat>[];
    return Array.isArray(parsed)
      ? parsed.filter((f) => f?.name).map((f) => hydrateFormat(f as Partial<ReportFormat> & { name: string }))
      : [];
  } catch {
    return [];
  }
}

export function isServerFormatsAuthoritative(): boolean {
  try {
    return localStorage.getItem(SERVER_AUTHORITATIVE_FLAG) === "1";
  } catch {
    return false;
  }
}

export function markServerFormatsAuthoritative(): void {
  try {
    localStorage.setItem(SERVER_AUTHORITATIVE_FLAG, "1");
  } catch { /* ignore */ }
}

/** Cache only — never the permanent source of truth once server sync succeeded. */
export function cacheFormatsLocally(f: ReportFormat[]): void {
  try {
    localStorage.setItem(SK, JSON.stringify(f));
  } catch { /* ignore */ }
}

/**
 * Sync load for store bootstrap / offline.
 * If server was previously authoritative, prefer cache (may be empty until hydrate).
 * Otherwise merge defaults + any pre-migration browser library (do not destroy).
 */
export function loadFormats(): ReportFormat[] {
  const cached = readLocalFormatsCache();
  if (isServerFormatsAuthoritative()) {
    return cached.length > 0 ? cached : DEFAULT_REPORT_FORMATS;
  }
  if (cached.length > 0) return cached;
  return DEFAULT_REPORT_FORMATS;
}

export function saveFormats(f: ReportFormat[]) {
  cacheFormatsLocally(f);
}

export function createFormat(i: Omit<ReportFormat, "id" | "createdAt" | "updatedAt">): ReportFormat {
  return hydrateFormat({ ...i, id: uid(), createdAt: now(), updatedAt: now(), custom: true, clinicalHistory: i.clinicalHistory ?? "" });
}

export function resetFormatsToDefaults(): ReportFormat[] {
  try {
    localStorage.removeItem(SK);
    localStorage.removeItem(SERVER_AUTHORITATIVE_FLAG);
  } catch { /* ignore */ }
  return DEFAULT_REPORT_FORMATS;
}

export function payloadForApi(f: Omit<ReportFormat, "id" | "createdAt" | "updatedAt"> | ReportFormat) {
  return {
    name: f.name,
    modality: f.modality,
    bodyPart: canonicalContentRegion(f.bodyPart) || f.bodyPart,
    diagnosisTags: f.diagnosisTags ?? [],
    clinicalHistory: f.clinicalHistory ?? "",
    technique: f.technique ?? "",
    findings: f.findings ?? "",
    impression: f.impression ?? "",
    recommendation: f.recommendation ?? "",
    reportTitle: f.reportTitle ?? "",
    protocolScope: f.protocolScope ?? "",
    isCommon: f.isCommon ?? false,
  };
}

export function overlayLocalFormatFlags(server: ReportFormat[], localCache: ReportFormat[]): ReportFormat[] {
  if (localCache.length === 0) return server;
  const byId = new Map(localCache.map((f) => [f.id, f]));
  const byKey = new Map(localCache.map((f) => [formatDedupeKey(f), f]));
  return server.map((f) => {
    const loc = byId.get(f.id) ?? byKey.get(formatDedupeKey(f));
    if (!loc) return f;
    return {
      ...f,
      favorite: loc.favorite ?? f.favorite,
      reportTitle: f.reportTitle || loc.reportTitle,
      protocolScope: f.protocolScope || loc.protocolScope,
    };
  });
}

export { formatsMissingOnServer, mergeAuthoritativeFormats, mergeTwoFormats };
export type { MergeResult };
