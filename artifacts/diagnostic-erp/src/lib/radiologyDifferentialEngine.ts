// ── Phase 6: Differential Diagnosis Engine ──
// Structured differential suggestions with confidence levels. NO AI.
// Deterministic, rule-based knowledge base. Editable before insertion.

export interface DifferentialItem {
  diagnosis: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  supportingFeatures?: string[];
  distinguishingFeatures?: string[];
}

export interface DifferentialGroup {
  id: string;
  title: string;
  items: DifferentialItem[];
}

export const DIFFERENTIAL_DATABASE: Record<string, DifferentialGroup> = {
  "ring-enhancing-lesion": {
    id: "ring-enhancing-lesion",
    title: "Ring Enhancing Lesion",
    items: [
      { diagnosis: "Abscess", confidence: "high", rationale: "Central necrosis with ring enhancement. Restricted diffusion on DWI. Surrounding vasogenic edema.", supportingFeatures: ["DWI restriction", "Fever", "T2 hypointense rim"], distinguishingFeatures: ["Central pus/liquefaction", "Complete ring enhancement"] },
      { diagnosis: "Metastasis", confidence: "high", rationale: "Multiple lesions at grey-white junction. Known primary malignancy. Variable sizes.", supportingFeatures: ["Multiple lesions", "Grey-white junction", "Known primary"], distinguishingFeatures: ["Multiple lesions", "Disproportionate edema"] },
      { diagnosis: "Glioblastoma Multiforme (GBM)", confidence: "medium", rationale: "Irregular ring enhancement with central necrosis. Mass effect. Crossing corpus callosum (butterfly lesion).", supportingFeatures: ["Crossing corpus callosum", "Irregular thick ring", "Mass effect"], distinguishingFeatures: ["Irregular thick ring", "Crossing midline"] },
      { diagnosis: "Tuberculoma", confidence: "medium", rationale: "Central caseation necrosis. Target sign (caseous center). TB endemic area.", supportingFeatures: ["Target sign", "TB endemic area", "Basal location"], distinguishingFeatures: ["Target sign", "Solid eccentric nodule"] },
      { diagnosis: "Demyelinating disease", confidence: "low", rationale: "Open ring enhancement. Incomplete ring. Callososeptal orientation.", supportingFeatures: ["Open ring enhancement", "Incomplete ring", "Dawson fingers"], distinguishingFeatures: ["Open ring", "Incomplete enhancement"] },
      { diagnosis: "Resolving hematoma", confidence: "low", rationale: "Ring of hemosiderin. Peripherally enhancing. Appropriate clinical history.", supportingFeatures: ["Hemosiderin ring", "Blood products on SWI"], distinguishingFeatures: ["SWI blooming", "Blood products"] },
    ],
  },
  "discitis": {
    id: "discitis",
    title: "Discitis / Spondylodiscitis",
    items: [
      { diagnosis: "Pyogenic (bacterial) spondylodiscitis", confidence: "high", rationale: "Endplate destruction. T2 hyperintense disc. Epidural/phlegmon. Fever, elevated ESR/CRP.", supportingFeatures: ["Endplate destruction", "T2 hyperintense disc", "Epidural phlegmon"], distinguishingFeatures: ["Rapid onset", "Fever", "Epidural abscess"] },
      { diagnosis: "Tuberculous spondylodiscitis", confidence: "medium", rationale: "Paradiscal location. Multiple contiguous vertebral involvement. Large paraspinal cold abscess.", supportingFeatures: ["Multiple contiguous vertebrae", "Large cold abscess", "Paradiscal"], distinguishingFeatures: ["Large cold abscess", "Relative disc sparing", "Body > disc involvement"] },
      { diagnosis: "Fungal spondylodiscitis", confidence: "low", rationale: "Immunocompromised host. Less aggressive than pyogenic. Consider in endemic areas.", supportingFeatures: ["Immunocompromised", "Endemic area"], distinguishingFeatures: ["Immunocompromised host", "Less aggressive course"] },
      { diagnosis: "Brucellar spondylitis", confidence: "low", rationale: "Endemic area (Middle East). Focal anterior endplate erosions.", supportingFeatures: ["Endemic area", "Anterior endplate erosions"], distinguishingFeatures: ["Focal anterior erosions", "Brucella exposure history"] },
    ],
  },
  "cystic-liver-lesion": {
    id: "cystic-liver-lesion",
    title: "Cystic Liver Lesion",
    items: [
      { diagnosis: "Simple hepatic cyst", confidence: "high", rationale: "Well-defined, thin-walled, anechoic. No internal echoes. No enhancement.", supportingFeatures: ["Anechoic", "Thin wall", "No enhancement", "No internal echoes"], distinguishingFeatures: ["Anechoic", "No septations", "Thin wall"] },
      { diagnosis: "Hydatid cyst (Echinococcosis)", confidence: "medium", rationale: "Endemic area. Daughter cysts. Water lily sign. Calcified wall. Serology positive.", supportingFeatures: ["Daughter cysts", "Water lily sign", "Endemic area"], distinguishingFeatures: ["Daughter cysts", "Calcified wall", "Water lily sign"] },
      { diagnosis: "Abscess (pyogenic)", confidence: "medium", rationale: "Irregular thick wall. Internal debris. Septations. Fever, elevated WBC.", supportingFeatures: ["Fever", "Thick wall", "Internal debris", "Elevated WBC"], distinguishingFeatures: ["Thick wall", "Internal debris", "Fever"] },
      { diagnosis: "Biliary cystadenoma/cystadenocarcinoma", confidence: "low", rationale: "Multiloculated. Septations with enhancing mural nodules. More common in females.", supportingFeatures: ["Multiloculated", "Enhancing nodules", "Female"], distinguishingFeatures: ["Enhancing mural nodules", "Multiloculated"] },
    ],
  },
  "solid-liver-lesion": {
    id: "solid-liver-lesion",
    title: "Solid Liver Lesion",
    items: [
      { diagnosis: "Hepatocellular Carcinoma (HCC)", confidence: "high", rationale: "Arterial hyperenhancement. Portal venous washout. Capsule. Cirrhosis background.", supportingFeatures: ["Arterial hyperenhancement", "Washout", "Capsule", "Cirrhosis"], distinguishingFeatures: ["Washout", "Capsule", "Cirrhosis background"] },
      { diagnosis: "Hemangioma", confidence: "high", rationale: "Peripheral nodular enhancement. Centripetal fill-in. T2 hyperintense (light bulb).", supportingFeatures: ["Peripheral nodular enhancement", "Centripetal fill-in", "T2 hyperintense"], distinguishingFeatures: ["Centripetal fill-in", "T2 hyperintense (light bulb)"] },
      { diagnosis: "Metastasis", confidence: "high", rationale: "Multiple lesions. Target/ring enhancement. Known primary. Variable enhancement patterns.", supportingFeatures: ["Multiple lesions", "Known primary", "Target/ring enhancement"], distinguishingFeatures: ["Multiple lesions", "Known primary"] },
      { diagnosis: "Focal Nodular Hyperplasia (FNH)", confidence: "medium", rationale: "Central scar. Homogeneous arterial enhancement. Iso/hyperintense on T1. Hepatobiliary uptake.", supportingFeatures: ["Central scar", "Homogeneous enhancement", "Hepatobiliary uptake"], distinguishingFeatures: ["Central scar", "Hepatobiliary uptake on EOB"] },
      { diagnosis: "Hepatic Adenoma", confidence: "medium", rationale: "Risk of hemorrhage. HNF1-alpha inactivated (fatty). Beta-catenin mutated (risk of HCC).", supportingFeatures: ["Hormonal history", "Fatty", "Hemorrhage"], distinguishingFeatures: ["Fat content", "Hormonal history", "Hemorrhage risk"] },
      { diagnosis: "Cholangiocarcinoma", confidence: "medium", rationale: "Peripheral arterial enhancement. Delayed central enhancement. Biliary dilation. CA 19-9 elevated.", supportingFeatures: ["Delayed enhancement", "Biliary dilation", "CA 19-9 elevated"], distinguishingFeatures: ["Delayed enhancement", "Biliary dilation"] },
    ],
  },
  "meningioma-vs-others": {
    id: "meningioma-vs-others",
    title: "Dural-Based Extra-Axial Mass",
    items: [
      { diagnosis: "Meningioma", confidence: "high", rationale: "Dural-based, broad dural base. Iso/hyperintense on T1. Homogeneous enhancement. Dural tail. Hyperostosis.", supportingFeatures: ["Dural tail", "Broad dural base", "Hyperostosis", "Homogeneous enhancement"], distinguishingFeatures: ["Dural tail", "Hyperostosis", "Broad dural base"] },
      { diagnosis: "Metastasis (dural-based)", confidence: "medium", rationale: "Known primary malignancy. Multiple dural lesions. May not have dural tail.", supportingFeatures: ["Known primary", "Multiple lesions", "Dural-based"], distinguishingFeatures: ["Multiple lesions", "Known primary"] },
      { diagnosis: "Hemangiopericytoma / Solitary Fibrous Tumor", confidence: "low", rationale: "Hypervascular. Lobulated. Dural-based but aggressive. May have bone destruction.", supportingFeatures: ["Hypervascular", "Lobulated", "Bone destruction"], distinguishingFeatures: ["Aggressive features", "Bone destruction", "No hyperostosis"] },
      { diagnosis: "Lymphoma", confidence: "low", rationale: "Dural-based but usually homogeneous. Homogeneous enhancement. Can be multifocal.", supportingFeatures: ["Homogeneous", "Dural-based", "Multifocal"], distinguishingFeatures: ["Homogeneous", "Dural-based", "Multifocal"] },
    ],
  },
  "acute-kidney-injury": {
    id: "acute-kidney-injury",
    title: "Acute Kidney Injury (Imaging Correlation)",
    items: [
      { diagnosis: "Acute pyelonephritis", confidence: "high", rationale: "Striated nephrogram. Wedge-shaped hypoattenuation. Perinephric stranding. Fever, dysuria.", supportingFeatures: ["Striated nephrogram", "Wedge-shaped", "Fever"], distinguishingFeatures: ["Striated nephrogram", "Wedge-shaped defects"] },
      { diagnosis: "Renal infarction", confidence: "medium", rationale: "Wedge-shaped peripheral hypoattenuation. Avascular on contrast. Atrial fibrillation or embolic source.", supportingFeatures: ["Wedge-shaped", "Peripheral", "Avascular", "AF/emblic source"], distinguishingFeatures: ["Avascular", "Wedge-shaped peripheral", "Embolic source"] },
      { diagnosis: "Acute tubular necrosis (ATN)", confidence: "medium", rationale: "Diffuse swelling. Reduced enhancement. Clinical context (contrast, sepsis, ischemia).", supportingFeatures: ["Diffuse swelling", "Reduced enhancement", "Contrast exposure"], distinguishingFeatures: ["Diffuse (not wedge-shaped)", "Clinical context"] },
      { diagnosis: "Cortical necrosis", confidence: "low", rationale: "Non-enhancing cortex. Preserved medulla. HUS / pregnancy complication.", supportingFeatures: ["Non-enhancing cortex", "HUS/pregnancy"], distinguishingFeatures: ["Non-enhancing cortex", "Preserved medulla"] },
    ],
  },
  "adrenal-mass": {
    id: "adrenal-mass",
    title: "Adrenal Mass",
    items: [
      { diagnosis: "Adrenal adenoma", confidence: "high", rationale: "Lipid-rich. <10 HU on non-contrast. Rapid washout (>50% at 10 min). Homogeneous.", supportingFeatures: ["<10 HU non-contrast", ">50% washout", "Homogeneous"], distinguishingFeatures: ["<10 HU", ">50% washout"] },
      { diagnosis: "Pheochromocytoma", confidence: "medium", rationale: "Hypervascular. T2 hyperintense (light bulb). Clinical: hypertension, palpitations, sweating. Elevated catecholamines.", supportingFeatures: ["T2 hyperintense", "Hypervascular", "Hypertension"], distinguishingFeatures: ["T2 hyperintense (light bulb)", "Clinical triad", "Catecholamines"] },
      { diagnosis: "Adrenal metastasis", confidence: "medium", rationale: "Known primary. >10 HU. Heterogeneous. Delayed washout. Bilateral.", supportingFeatures: ["Known primary", ">10 HU", "Heterogeneous", "Bilateral"], distinguishingFeatures: ["Bilateral", "Known primary", "Heterogeneous"] },
      { diagnosis: "Myelolipoma", confidence: "low", rationale: "Macroscopic fat. < -30 HU. No enhancement of fat component. Benign.", supportingFeatures: ["Macroscopic fat", "<-30 HU", "Benign"], distinguishingFeatures: ["Macroscopic fat", "<-30 HU", "Benign"] },
      { diagnosis: "Adrenal carcinoma", confidence: "low", rationale: "Large (>4-6 cm). Heterogeneous. Invasive. Calcifications. Functional hormone excess.", supportingFeatures: [">6 cm", "Heterogeneous", "Invasive", "Calcifications"], distinguishingFeatures: ["Large", "Invasive", "Heterogeneous", "Calcifications"] },
    ],
  },
  "pulmonary-nodule": {
    id: "pulmonary-nodule",
    title: "Solitary Pulmonary Nodule",
    items: [
      { diagnosis: "Granuloma (healed)", confidence: "high", rationale: "Calcified. Stable >2 years. Benign pattern of calcification.", supportingFeatures: ["Calcified", "Stable >2 years", "Benign calcification"], distinguishingFeatures: ["Calcified", "Stable", "Benign pattern"] },
      { diagnosis: "Primary lung cancer", confidence: "high", rationale: "Spiculated. Pleural retraction. Growing. Smoking history. Upper lobe.", supportingFeatures: ["Spiculated", "Growing", "Smoking history", "Upper lobe"], distinguishingFeatures: ["Spiculated", "Pleural retraction", "Growing"] },
      { diagnosis: "Metastasis", confidence: "medium", rationale: "Multiple. Smooth. Known primary. Variable sizes.", supportingFeatures: ["Multiple", "Known primary", "Smooth"], distinguishingFeatures: ["Multiple", "Known primary", "Smooth"] },
      { diagnosis: "Hamartoma", confidence: "medium", rationale: "Popcorn calcification. Fat. Well-defined. Benign.", supportingFeatures: ["Popcorn calcification", "Fat", "Well-defined"], distinguishingFeatures: ["Popcorn calcification", "Fat", "Well-defined"] },
      { diagnosis: "Infectious nodule (active)", confidence: "medium", rationale: "Cavitary. Feeding vessel sign. Halo sign. Clinical infection.", supportingFeatures: ["Cavitary", "Halo sign", "Fever"], distinguishingFeatures: ["Cavitary", "Halo sign", "Fever/immunocompromised"] },
    ],
  },
  "ovarian-mass": {
    id: "ovarian-mass",
    title: "Ovarian Mass",
    items: [
      { diagnosis: "Ovarian fibroma / Thecoma", confidence: "high", rationale: "Hypointense T2. Solid. No enhancement. May have calcification.", supportingFeatures: ["Hypointense T2", "Solid", "No enhancement"], distinguishingFeatures: ["Hypointense T2", "Solid", "No enhancement"] },
      { diagnosis: "Serous cystadenoma", confidence: "high", rationale: "Unilocular. Thin-walled. Anechoic. Simple cyst.", supportingFeatures: ["Unilocular", "Thin-walled", "Anechoic"], distinguishingFeatures: ["Unilocular", "Simple", "Thin wall"] },
      { diagnosis: "Mucinous cystadenoma", confidence: "medium", rationale: "Multilocular. Thick septations. T1 hyperintense (mucin). Large.", supportingFeatures: ["Multilocular", "Thick septations", "T1 hyperintense"], distinguishingFeatures: ["Multilocular", "Thick septations", "T1 hyperintense (mucin)"] },
      { diagnosis: "Endometrioma", confidence: "medium", rationale: "T1 hyperintense. T2 shading. T2 hyperintense foci. Endometriosis history.", supportingFeatures: ["T1 hyperintense", "T2 shading", "Endometriosis history"], distinguishingFeatures: ["T1 hyperintense", "T2 shading", "Endometriosis history"] },
      { diagnosis: "Dermoid cyst (Mature cystic teratoma)", confidence: "high", rationale: "Fat. Calcification. Teeth. Hair. Rokitansky nodule. Fat-fluid level.", supportingFeatures: ["Fat", "Calcification", "Hair", "Rokitansky nodule"], distinguishingFeatures: ["Fat", "Calcification", "Hair/teeth"] },
      { diagnosis: "Ovarian carcinoma", confidence: "medium", rationale: "Solid components. Papillary projections. Thick septations. Ascites. Peritoneal implants.", supportingFeatures: ["Solid components", "Papillary projections", "Ascites", "Peritoneal implants"], distinguishingFeatures: ["Solid components", "Papillary projections", "Ascites/implants"] },
    ],
  },
  "spinal-cord-lesion": {
    id: "spinal-cord-lesion",
    title: "Spinal Cord Lesion (Intramedullary)",
    items: [
      { diagnosis: "Astrocytoma", confidence: "high", rationale: "Expansile. T2 hyperintense. Syrinx. Holocord. Cervical/thoracic. Enhancing. Wide cord.", supportingFeatures: ["Expansile", "T2 hyperintense", "Syrinx", "Holocord", "Wide cord"], distinguishingFeatures: ["Expansile", "Holocord", "Syrinx"] },
      { diagnosis: "Ependymoma", confidence: "high", rationale: "Well-circumscribed. Hemorrhage. Cap sign. Eccentric. Cauda equina/filum terminale.", supportingFeatures: ["Hemorrhage", "Cap sign", "Eccentric"], distinguishingFeatures: ["Hemorrhage", "Cap sign (T2 hypointense rim)", "Eccentric"] },
      { diagnosis: "Demyelinating disease", confidence: "medium", rationale: "Multiple lesions. Callososeptal. Dawson fingers. Partial enhancement. Clinical history.", supportingFeatures: ["Multiple lesions", "Dawson fingers", "Partial enhancement"], distinguishingFeatures: ["Dawson fingers", "Multiple lesions", "Partial enhancement"] },
      { diagnosis: "Transverse myelitis", confidence: "medium", rationale: "Central T2 hyperintensity. Expansile. Long segment. Clinical: acute/subacute paraparesis.", supportingFeatures: ["Central T2 hyperintensity", "Long segment", "Acute paraparesis"], distinguishingFeatures: ["Central T2 hyperintensity", "Long segment", "Acute paraparesis"] },
      { diagnosis: "Spinal cord infarction", confidence: "low", rationale: "Anterior horn / gray matter. Owl's eyes. Vascular territory. Sudden onset.", supportingFeatures: ["Owl's eyes", "Anterior horn", "Sudden onset"], distinguishingFeatures: ["Owl's eyes", "Anterior horn", "Sudden onset"] },
    ],
  },
  "ivc-thrombus": {
    id: "ivc-thrombus",
    title: "IVC Filling Defect",
    items: [
      { diagnosis: "Thrombus ( bland )", confidence: "high", rationale: "Hypodense. No enhancement. Expanding IVC. Chronic: recanalization.", supportingFeatures: ["Hypodense", "No enhancement", "Expanding IVC"], distinguishingFeatures: ["No enhancement", "Hypodense", "Expanding IVC"] },
      { diagnosis: "Tumor thrombus (HCC / RCC / Adrenal)", confidence: "high", rationale: "Enhancing. Expanding IVC. Continuity with primary tumor. Arterial enhancement.", supportingFeatures: ["Enhancing", "Expanding IVC", "Continuity with primary"], distinguishingFeatures: ["Enhancing", "Continuity with primary", "Arterial enhancement"] },
      { diagnosis: "Bland + tumor thrombus (mixed)", confidence: "medium", rationale: "Partial enhancement. Partial non-enhancement. Complex filling defect.", supportingFeatures: ["Partial enhancement", "Complex filling defect"], distinguishingFeatures: ["Partial enhancement", "Complex"] },
    ],
  },
  "splenic-lesion": {
    id: "splenic-lesion",
    title: "Splenic Lesion",
    items: [
      { diagnosis: "Splenic cyst", confidence: "high", rationale: "Anechoic. Well-defined. No enhancement. No internal echoes.", supportingFeatures: ["Anechoic", "Well-defined", "No enhancement"], distinguishingFeatures: ["Anechoic", "No enhancement", "Well-defined"] },
      { diagnosis: "Splenic abscess", confidence: "medium", rationale: "Complex. Thick wall. Internal debris. Enhancing rim. Fever.", supportingFeatures: ["Complex", "Thick wall", "Internal debris", "Fever"], distinguishingFeatures: ["Thick wall", "Internal debris", "Fever"] },
      { diagnosis: "Splenic metastasis", confidence: "medium", rationale: "Multiple. Hypodense. Known primary. Variable size.", supportingFeatures: ["Multiple", "Hypodense", "Known primary"], distinguishingFeatures: ["Multiple", "Known primary", "Hypodense"] },
      { diagnosis: "Lymphoma", confidence: "medium", rationale: "Homogeneous hypodense. Mild enlargement. Diffuse. No calcification.", supportingFeatures: ["Homogeneous", "Hypodense", "Diffuse", "No calcification"], distinguishingFeatures: ["Homogeneous", "Diffuse", "No calcification"] },
      { diagnosis: "Hamartoma", confidence: "low", rationale: "Heterogeneous. Fat. Calcification. Enhancing. Rare.", supportingFeatures: ["Fat", "Calcification", "Heterogeneous"], distinguishingFeatures: ["Fat", "Calcification", "Heterogeneous"] },
    ],
  },
};

export function getDifferential(id: string): DifferentialGroup | undefined {
  return DIFFERENTIAL_DATABASE[id];
}

export function getAllDifferentialIds(): string[] {
  return Object.keys(DIFFERENTIAL_DATABASE);
}

export function searchDifferentials(query: string): string[] {
  const q = query.toLowerCase();
  return Object.keys(DIFFERENTIAL_DATABASE).filter((id) => {
    const group = DIFFERENTIAL_DATABASE[id];
    if (group.title.toLowerCase().includes(q)) return true;
    return group.items.some((item) => item.diagnosis.toLowerCase().includes(q) || item.rationale.toLowerCase().includes(q));
  });
}
