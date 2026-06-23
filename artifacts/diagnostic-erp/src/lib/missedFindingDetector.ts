// Phase 7A: Missed Finding Detector
// Critical finding detection for common radiology modalities.
// Purely suggestive — radiologist remains final authority.

export interface MissedFindingCheck {
  finding: string;
  severity: "critical" | "urgent" | "important";
  description: string;
  keywords: string[];
  negativeKeywords?: string[];
  confidence: number;
  why: string;
  suggestion: string;
}

const MISSED_FINDING_KB: Record<string, MissedFindingCheck[]> = {
  "MRI Brain": [
    { finding: "Acute Infarct", severity: "critical", description: "Acute/subacute infarct on DWI/ADC", keywords: ["infarct", "stroke", "diffusion restriction", "dwi hyperintense", "adc hypointense", "acute ischemia", "territorial infarct"], negativeKeywords: ["old infarct", "chronic infarct", "gliosis", "no acute infarct"], confidence: 0.95, why: "DWI hyperintensity with ADC hypointensity is the hallmark of acute infarct and may be missed on non-DWI sequences.", suggestion: "Review DWI/ADC sequences carefully. Measure ADC values if available." },
    { finding: "Hemorrhage", severity: "critical", description: "Acute or subacute hemorrhage", keywords: ["hemorrhage", "hematoma", "bleed", "hyperintense on t1", "t2 hypointense", "susceptibility", "blooming", "hemosiderin"], negativeKeywords: ["no hemorrhage", "no bleeding", "chronic hemorrhage"], confidence: 0.92, why: "SWI/GRE sequences are highly sensitive for blood products. Small hemorrhages may be missed on T1/T2 alone.", suggestion: "Review SWI/GRE for hypointense foci. Correlate with T1 signal changes." },
    { finding: "Extra-axial Collection", severity: "critical", description: "Subdural, epidural, or subarachnoid collection", keywords: ["subdural", "epidural", "subarachnoid", "hematoma", "effusion", "empyema", "extra-axial"], negativeKeywords: ["no extra-axial", "no subdural"], confidence: 0.90, why: "Extra-axial collections can be subtle on single sequences and may be missed if not systematically reviewed.", suggestion: "Systematically review convexity, falx, tentorium, and skull base on all sequences." },
    { finding: "Mass Lesion", severity: "critical", description: "Space-occupying lesion", keywords: ["mass", "tumor", "lesion", "enhancement", "solid component", "cystic", "necrosis", "ring enhancing"], negativeKeywords: ["no mass", "no tumor", "normal brain"], confidence: 0.88, why: "Small or low-grade lesions may be isointense on non-contrast sequences and missed if contrast is not reviewed.", suggestion: "Carefully review post-contrast T1 sequences. Look for focal enhancement or mass effect." },
    { finding: "Midline Shift", severity: "critical", description: "Deviation of septum pellucidum or other midline structures", keywords: ["midline shift", "mass effect", "deviation", "septum pellucidum"], negativeKeywords: ["no midline shift", "midline preserved"], confidence: 0.94, why: "Midline shift is an objective measurement that indicates significant mass effect and may be overlooked.", suggestion: "Measure septum pellucidum deviation from the expected centerline." },
    { finding: "Hydrocephalus", severity: "critical", description: "Ventricular enlargement", keywords: ["hydrocephalus", "ventricular enlargement", "dilated ventricles", "transependymal flow", "periventricular hyperintensity"], negativeKeywords: ["no hydrocephalus", "ventricles normal", "no enlargement"], confidence: 0.91, why: "Hydrocephalus can be subtle, especially in early stages. Periventricular T2 hyperintensity (transependymal flow) is a key sign.", suggestion: "Measure ventricular indices. Look for periventricular T2 hyperintensity on FLAIR." },
  ],
  "MRI Spine": [
    { finding: "Cord Compression", severity: "critical", description: "Spinal cord compression", keywords: ["cord compression", "cord signal", "myelomalacia", "cord flattening", "thecal sac"], negativeKeywords: ["no cord compression", "cord normal", "no signal abnormality"], confidence: 0.93, why: "Cord compression is a surgical emergency. T2 cord hyperintensity (myelomalacia) indicates chronic compression.", suggestion: "Review axial T2 images at each level. Assess cord calibre and signal." },
    { finding: "Severe Canal Stenosis", severity: "critical", description: "Spinal canal stenosis < 10mm", keywords: ["canal stenosis", "severe stenosis", "spinal canal", "ap diameter", "canal diameter"], negativeKeywords: ["no stenosis", "mild stenosis", "canal adequate"], confidence: 0.89, why: "Severe canal stenosis (< 10mm) may cause progressive myelopathy. Measurements are often omitted.", suggestion: "Measure spinal canal AP diameter at narrowest point. < 10mm is severe." },
    { finding: "Severe Foraminal Stenosis", severity: "urgent", description: "Neural foraminal stenosis", keywords: ["foraminal stenosis", "neural foramen", "nerve root", "exiting nerve", "foraminal narrowing"], negativeKeywords: ["no foraminal stenosis", "foramina patent"], confidence: 0.87, why: "Foraminal stenosis causes radiculopathy and may be missed if only central canal is assessed.", suggestion: "Review parasagittal images. Assess each neural foramen for patency." },
    { finding: "Fracture", severity: "critical", description: "Vertebral body fracture", keywords: ["fracture", "compression", "vertebral body", "cortical disruption", "marrow edema", "signal change"], negativeKeywords: ["no fracture", "no compression", "no acute fracture"], confidence: 0.90, why: "Acute fractures show marrow edema on T2/STIR. Chronic fractures may be missed if only T1 is reviewed.", suggestion: "Review STIR/T2 fat-sat for marrow edema. Assess cortical integrity on T1." },
    { finding: "Spondylolisthesis", severity: "important", description: "Vertebral body slip", keywords: ["spondylolisthesis", "spondylolysis", "pars defect", "slip", "retrolisthesis", "anterolisthesis"], negativeKeywords: ["no spondylolisthesis", "no slip", "alignment maintained"], confidence: 0.85, why: "Spondylolisthesis may be missed on axial images alone. Sagittal alignment is key.", suggestion: "Review sagittal T1/T2 for alignment. Measure slip angle and grade." },
  ],
  "CT Brain": [
    { finding: "Hemorrhage", severity: "critical", description: "Acute intracranial hemorrhage", keywords: ["hemorrhage", "hematoma", "hyperdense", "hyperdensity", "blood", "acute bleed"], negativeKeywords: ["no hemorrhage", "no bleed", "no hyperdense"], confidence: 0.94, why: "Acute blood is hyperdense on CT. Small hemorrhages or posterior fossa bleeds may be missed.", suggestion: "Systematically review for hyperdense foci. Check basal cisterns and posterior fossa." },
    { finding: "Fracture", severity: "critical", description: "Skull or facial bone fracture", keywords: ["fracture", "cortical disruption", "step", "depression", "linear lucency", "bone"], negativeKeywords: ["no fracture", "skull intact", "no cortical disruption"], confidence: 0.88, why: "Skull fractures may be subtle on brain windows. Bone windows are essential.", suggestion: "Review bone windows systematically. Check temporal bone, skull base, and facial bones." },
    { finding: "Midline Shift", severity: "critical", description: "Deviation of midline structures", keywords: ["midline shift", "mass effect", "deviation", "septum pellucidum"], negativeKeywords: ["no midline shift", "midline preserved"], confidence: 0.93, why: "Midline shift indicates significant mass effect. Often overlooked in small bleeds or edema.", suggestion: "Measure septum pellucidum from center. Check for uncal/subfalcine herniation." },
    { finding: "Infarct", severity: "critical", description: "Acute cerebral infarct", keywords: ["infarct", "stroke", "hypodense", "hypodensity", "loss of gray-white differentiation", "insular ribbon"], negativeKeywords: ["no infarct", "no acute infarct", "no hypodensity"], confidence: 0.90, why: "Early infarct (< 6h) may be subtle. Look for loss of gray-white differentiation and insular ribbon sign.", suggestion: "Review for loss of gray-white differentiation. Check basal ganglia and insular cortex." },
  ],
  "Chest": [
    { finding: "Pneumothorax", severity: "critical", description: "Air in pleural space", keywords: ["pneumothorax", "pleural air", "visceral pleural line", "no lung markings", "lung collapse"], negativeKeywords: ["no pneumothorax", "no pleural air", "lungs fully expanded"], confidence: 0.92, why: "Small pneumothoraces may be missed at lung apices. Expiratory films help.", suggestion: "Review lung apices carefully. Look for visceral pleural line without lung markings peripheral to it." },
    { finding: "Pleural Effusion", severity: "urgent", description: "Fluid in pleural space", keywords: ["effusion", "pleural fluid", "blunting", "meniscus", "costophrenic angle"], negativeKeywords: ["no effusion", "no pleural fluid", "costophrenic angles clear"], confidence: 0.89, why: "Small effusions may be missed on AP views. Lateral decubitus or lateral views help.", suggestion: "Review costophrenic angles on both sides. Check for blunting or meniscus." },
    { finding: "Consolidation", severity: "urgent", description: "Airspace disease", keywords: ["consolidation", "pneumonia", "opacity", "airspace", "air bronchogram", "ground glass"], negativeKeywords: ["no consolidation", "lungs clear", "no opacity"], confidence: 0.87, why: "Consolidation may be subtle behind the heart or diaphragm. Lateral views help.", suggestion: "Review retrocardiac and subdiaphragmatic regions. Look for air bronchograms." },
    { finding: "Large Mass", severity: "critical", description: "Pulmonary or mediastinal mass > 3cm", keywords: ["mass", "tumor", "nodule", "opacity", "mediastinal mass", "hilar mass", "lobe mass"], negativeKeywords: ["no mass", "no nodule", "no opacity", "lungs clear"], confidence: 0.86, why: "Large masses may be obscured by heart, mediastinum, or diaphragm. Lateral views and CT follow-up essential.", suggestion: "Review behind heart and mediastinum. Check for hilar enlargement. Measure any opacity." },
  ],
  "Abdomen": [
    { finding: "Large Mass", severity: "critical", description: "Intra-abdominal mass > 5cm", keywords: ["mass", "tumor", "lesion", "opacity", "soft tissue mass", "organomegaly", "enlarged"], negativeKeywords: ["no mass", "no tumor", "organs normal", "no abnormal mass"], confidence: 0.85, why: "Large abdominal masses may be missed if not systematically reviewing all organs.", suggestion: "Systematically review each organ. Check for abnormal contours or displacements." },
    { finding: "Obstruction", severity: "urgent", description: "Bowel obstruction", keywords: ["obstruction", "dilated bowel", "air-fluid levels", "transition point", "ileus", "volvulus"], negativeKeywords: ["no obstruction", "no dilated bowel", "no air-fluid levels"], confidence: 0.88, why: "Air-fluid levels may be missed on supine films. Upright films and CT help.", suggestion: "Check for dilated bowel loops and air-fluid levels. Look for transition point." },
    { finding: "Hydronephrosis", severity: "urgent", description: "Dilated renal collecting system", keywords: ["hydronephrosis", "dilated pelvicalyceal", "pelviectasis", "caliectasis", "ureteral dilation", "obstruction"], negativeKeywords: ["no hydronephrosis", "collecting system normal", "no pelviectasis"], confidence: 0.87, why: "Hydronephrosis may be missed on non-contrast imaging. CT urogram or ultrasound confirms.", suggestion: "Review renal collecting system on all slices. Measure pelvicalyceal dilation if present." },
  ],
};

export function detectMissedFindings(
  modality: string,
  studyDescription: string,
  reportBody: string,
  impression: string,
): MissedFindingCheck[] {
  const combinedText = `${studyDescription} ${reportBody} ${impression}`.toLowerCase();
  const checks = MISSED_FINDING_KB[modality] ?? MISSED_FINDING_KB["CT Brain"] ?? [];

  return checks
    .map((check) => {
      // Check if any positive keyword is present in the report
      const found = check.keywords.some((kw) => combinedText.includes(kw.toLowerCase()));
      // Check if negative keywords explicitly rule it out
      const ruledOut = check.negativeKeywords?.some((nk) => combinedText.includes(nk.toLowerCase()));

      // If explicitly ruled out, skip
      if (ruledOut) return null;

      // If not mentioned, flag as potential missed finding
      if (!found) {
        return { ...check, confidence: check.confidence * 0.7 };
      }
      return null;
    })
    .filter((c): c is MissedFindingCheck => c !== null);
}

export function getAllModalities(): string[] {
  return Object.keys(MISSED_FINDING_KB);
}

export function getFindingsForModality(modality: string): MissedFindingCheck[] {
  return MISSED_FINDING_KB[modality] ?? [];
}
