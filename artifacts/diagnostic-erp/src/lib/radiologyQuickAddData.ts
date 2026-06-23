// ─── Study Context Detection ───────────────────────────────────────────────

export interface QuickAddButton {
  label: string;
  text: string;
  shortcut: string; // Alt+1, Alt+2 etc
  impression?: string;
}

export interface StudyContext {
  id: string;
  label: string;
  modality: string;
  bodyPart?: string;
  testKeywords: string[];
  buttons: QuickAddButton[];
  smartFormats?: SmartFormat[];
}

export interface SmartFormat {
  id: string;
  label: string;
  shortcut: string;
  title?: string;
  technique?: string;
  findings: string;
  impression?: string;
  advice?: string;
}

export interface MacroEntry {
  id: string;
  shortcut: string;
  expansion: string;
  modality?: string;
  bodyPart?: string;
}

// ─── Study Contexts ─────────────────────────────────────────────────────────

export const STUDY_CONTEXTS: StudyContext[] = [
  {
    id: "usg-abdomen",
    label: "USG Abdomen",
    modality: "US",
    bodyPart: "ABDOMEN",
    testKeywords: ["abdomen", "abdominal", "usg abd", "ultrasound abdomen", "whole abdomen"],
    buttons: [
      { label: "Fatty Liver Grade I", text: "LIVER: Normal size. Diffuse increased echotexture with slightly impaired intrahepatic vessel definition — Grade I fatty liver.", shortcut: "Alt+1", impression: "Grade I fatty liver." },
      { label: "Fatty Liver Grade II", text: "LIVER: Normal size. Marked diffuse increased echotexture with moderately impaired intrahepatic vessel definition and mild posterior beam attenuation — Grade II fatty liver.", shortcut: "Alt+2", impression: "Grade II fatty liver." },
      { label: "GB Calculus", text: "GALLBLADDER: Distended. Multiple echogenic foci with posterior acoustic shadowing within the lumen. Wall thickness normal. CBD not dilated.", shortcut: "Alt+3", impression: "Gallbladder calculi." },
      { label: "Prostatomegaly", text: "PROSTATE: Enlarged, measuring approximately ___ cc. Capsular outline regular. Internal echotexture homogeneous. No focal lesion. Residual urine: ___ ml.", shortcut: "Alt+4", impression: "Prostatomegaly." },
      { label: "Acute Appendicitis", text: "APPENDIX: Non-compressible, thickened (___ mm), blind-ending tubular structure in the right iliac fossa. Periappendiceal fat stranding and free fluid noted.", shortcut: "Alt+5", impression: "Features suggestive of acute appendicitis." },
      { label: "Renal Calculus", text: "KIDNEYS: Echogenic focus with posterior acoustic shadowing in the ___ kidney, measuring ___ mm. No hydronephrosis. Other kidney normal.", shortcut: "Alt+6", impression: "Renal calculus." },
    ],
    smartFormats: [
      { id: "usg-abd-norm", label: "Normal Abdomen", shortcut: "Shift+Alt+1", findings: "LIVER: Normal in size, shape, and echotexture. No focal lesion.\nGALLBLADDER: Normal wall thickness. No calculus.\nPANCREAS: Normal size and echotexture.\nSPLEEN: Normal size.\nKIDNEYS: Both normal size. No hydronephrosis.\nBLADDER: Normal wall.\nNo free fluid." },
      { id: "usg-abd-gb", label: "GB Calculus", shortcut: "Shift+Alt+2", findings: "GALLBLADDER: Distended with thickened wall. Multiple echogenic foci with posterior acoustic shadowing noted. CBD not dilated.", impression: "Gallbladder calculi." },
      { id: "usg-abd-kid", label: "Renal Calculus", shortcut: "Shift+Alt+3", findings: "KIDNEYS: Right kidney shows an echogenic focus with posterior shadowing in the upper pole. Left kidney normal. No hydronephrosis.", impression: "Right renal calculus." },
      { id: "usg-abd-panc", label: "Pancreatitis", shortcut: "Shift+Alt+4", findings: "PANCREAS: Enlarged, hypoechoic, poorly defined. Peripancreatic fluid collection noted.", impression: "Features suggestive of acute pancreatitis." },
      { id: "usg-abd-cbd", label: "CBD Dilated", shortcut: "Shift+Alt+5", findings: "CBD: Dilated (8.5 mm), abrupt cutoff at the distal end. Hepatic ducts show mild dilatation.", impression: "Obstructive jaundice — CBD dilated." },
      { id: "usg-abd-cyst", label: "Liver Cyst", shortcut: "Shift+Alt+6", findings: "LIVER: Well-defined anechoic lesion in the right lobe, measuring 2.5 x 2.0 cm, with posterior enhancement. No internal echoes.", impression: "Simple hepatic cyst." },
    ],
  },
  {
    id: "mri-brain",
    label: "MRI Brain",
    modality: "MR",
    bodyPart: "BRAIN",
    testKeywords: ["brain", "cranial", "mri brain", "head mri", "brain plain"],
    buttons: [
      { label: "Fazekas Grade I", text: "PERIVENTRICULAR WHITE MATTER: Few punctate hyperintense foci on T2/FLAIR (< 5 mm) — Fazekas Grade I.", shortcut: "Alt+1", impression: "Fazekas Grade I white matter changes." },
      { label: "Senile Changes", text: "BRAIN PARENCHYMA: Mild diffuse cerebral atrophy with prominent sulci and ventricles. Multiple punctate periventricular hyperintensities on FLAIR. No mass lesion.", shortcut: "Alt+2", impression: "Senile cerebral atrophy with periventricular ischemic changes." },
      { label: "Hydrocephalus", text: "VENTRICULAR SYSTEM: Dilated lateral and third ventricles. Temporal horns prominent. Transependymal CSF seepage noted on FLAIR. Fourth ventricle normal.", shortcut: "Alt+3", impression: "Hydrocephalus." },
      { label: "Acute Infarct", text: "HYPERINTENSE area on T2/FLAIR with restricted diffusion on DWI and low ADC in the ___ territory, suggestive of acute infarct. No hemorrhagic transformation.", shortcut: "Alt+4", impression: "Acute infarct in the ___ territory." },
      { label: "Chronic Ischemic", text: "MULTIPLE small T2/FLAIR hyperintense foci in the deep white matter and basal ganglia. No restricted diffusion. No mass effect. Ex-vacuo dilatation of ventricles.", shortcut: "Alt+5", impression: "Chronic ischemic changes." },
      { label: "Empty Sella", text: "SELLA TURCICA: Enlarged, predominantly filled with CSF signal. Pituitary gland flattened along the floor. No suprasellar mass.", shortcut: "Alt+6", impression: "Empty sella turcica." },
    ],
    smartFormats: [
      { id: "mri-brain-norm", label: "Normal Brain", shortcut: "Shift+Alt+1", findings: "BRAIN PARENCHYMA: Normal signal intensity on all sequences.\nVENTRICLES: Normal size and configuration.\nMIDLINE: No shift.\nEXTRACRANIAL SOFT TISSUES: Normal.\nNo focal lesion, hemorrhage, or infarct.", impression: "Normal MRI brain study." },
      { id: "mri-brain-inf", label: "Acute Infarct", shortcut: "Shift+Alt+2", findings: "HYPERINTENSE area on T2/FLAIR in the right MCA territory with restricted diffusion on DWI. No hemorrhagic transformation.", impression: "Acute infarct in the right MCA territory." },
      { id: "mri-brain-mass", label: "Mass Lesion", shortcut: "Shift+Alt+3", findings: "Well-defined mass in the left frontal lobe, T1 hypointense, T2 hyperintense, with ring enhancement. Perilesional edema with mass effect.", impression: "Space-occupying lesion in the left frontal lobe." },
      { id: "mri-brain-mets", label: "Metastases", shortcut: "Shift+Alt+4", findings: "Multiple small ring-enhancing lesions in the bilateral cerebral hemispheres and cerebellum. Surrounding vasogenic edema.", impression: "Multiple intracranial metastases." },
      { id: "mri-brain-dem", label: "Demyelination", shortcut: "Shift+Alt+5", findings: "Multiple hyperintense lesions in the periventricular white matter, juxtacortical, and infratentorial regions. Some lesions show enhancement. Dawson fingers noted.", impression: "Demyelinating disease — likely multiple sclerosis." },
      { id: "mri-brain-senile", label: "Senile Changes", shortcut: "Shift+Alt+6", findings: "BRAIN PARENCHYMA: Mild diffuse cerebral atrophy with prominent sulci and ventricles.\nPERIVENTRICULAR: Multiple punctate hyperintense foci on FLAIR — Fazekas Grade I.\nNo mass lesion, hemorrhage, or acute infarct.", impression: "Senile cerebral atrophy with mild periventricular ischemic changes (Fazekas Grade I)." },
      { id: "mri-brain-hydro", label: "Hydrocephalus", shortcut: "Shift+Alt+7", findings: "VENTRICULAR SYSTEM: Dilated lateral and third ventricles. Temporal horns prominent.\nTRansependymal: CSF seepage noted on FLAIR.\nFourth ventricle: Normal.\nNo obstructing lesion.\nMIDLINE: No shift.", impression: "Hydrocephalus." },
      { id: "mri-brain-sah", label: "SAH", shortcut: "Shift+Alt+8", findings: "BASAL CISTERNS: Hyperintense signal on FLAIR in the sulci, Sylvian fissures, and interhemispheric fissure.\nBRAIN: No intraparenchymal hemorrhage.\nVENTRICLES: Mildly enlarged.\nMIDLINE: No shift.", impression: "Subarachnoid hemorrhage." },
    ],
  },
  {
    id: "mri-ls-spine",
    label: "MRI LS Spine",
    modality: "MR",
    bodyPart: "SPINE",
    testKeywords: ["ls spine", "lumbar", "l-s spine", "lumbosacral", "mri ls"],
    buttons: [
      { label: "Disc Desiccation", text: "L___-___: Disc desiccation — loss of T2 hyperintense signal. Disc height mildly reduced.", shortcut: "Alt+1", impression: "Disc desiccation at L___-___." },
      { label: "Disc Bulge", text: "L___-___: Broad-based disc bulge, indenting the anterior thecal sac. No focal herniation.", shortcut: "Alt+2", impression: "Disc bulge at L___-___." },
      { label: "Disc Protrusion", text: "L___-___: Disc protrusion with focal contour abnormality, extending ___ mm beyond the vertebral margin. Indenting the thecal sac.", shortcut: "Alt+3", impression: "Disc protrusion at L___-___." },
      { label: "Facet Hypertrophy", text: "L___-___: Facet joint hypertrophy with subchondral sclerosis and irregular articular surfaces. Joint space narrowed.", shortcut: "Alt+4", impression: "Facet joint hypertrophy at L___-___." },
      { label: "LF Hypertrophy", text: "LIGAMENTUM FLAVUM: Thickened at L___-___ level, contributing to canal narrowing. Measured ___ mm.", shortcut: "Alt+5", impression: "Ligamentum flavum hypertrophy at L___-___." },
      { label: "Canal Stenosis", text: "SPINAL CANAL: Severe narrowing at L___-___ level. AP diameter reduced to ___ mm. Thecal sac compressed. No cord signal change.", shortcut: "Alt+6", impression: "Canal stenosis at L___-___." },
    ],
    smartFormats: [
      { id: "mri-ls-norm", label: "Normal LS Spine", shortcut: "Shift+Alt+1", findings: "VERTEBRAL BODIES: Normal height and alignment. No marrow signal abnormality.\nDISCS: All normal height and signal. No bulge or herniation.\nSPINAL CANAL: Normal AP diameter.\nSPINAL CORD: Normal signal.\nFACET JOINTS: Normal.\nPARAVERTEBRAL SOFT TISSUES: Normal.", impression: "Normal MRI lumbosacral spine." },
      { id: "mri-ls-bulge", label: "Disc Bulge", shortcut: "Shift+Alt+2", findings: "L4-L5: Disc bulge, indenting the anterior thecal sac.\nL5-S1: Mild disc bulge.\nRest of the discs: Normal.\nVERTEBRAL BODIES: Normal.\nSPINAL CANAL: Normal.\nFACET JOINTS: Mild degenerative changes.", impression: "Disc bulge at L4-L5 and mild at L5-S1." },
      { id: "mri-ls-herniation", label: "Disc Herniation", shortcut: "Shift+Alt+3", findings: "L4-L5: Disc herniation with right paracentral protrusion.\nSPINAL CANAL: Narrowed at L4-L5 level.\nNEURAL FORAMINA: Right L4-L5 narrowed.\nFACET JOINTS: Hypertrophy.", impression: "Disc herniation at L4-L5 with right lateral recess stenosis." },
      { id: "mri-ls-canal", label: "Canal Stenosis", shortcut: "Shift+Alt+4", findings: "SPINAL CANAL: Severe narrowing at L4-L5 and moderate at L5-S1.\nDISCS: Degenerated at L3-L4, L4-L5, L5-S1.\nFACET JOINTS: Severe hypertrophy bilaterally.\nLIGAMENTUM FLAVUM: Thickened.\nSPINAL CORD: Normal signal.", impression: "Severe canal stenosis at L4-L5 and moderate at L5-S1." },
      { id: "mri-ls-spondy", label: "Spondylolisthesis", shortcut: "Shift+Alt+5", findings: "L4-L5: Grade I anterolisthesis of L4 on L5.\nDISCS: Degenerated at L4-L5.\nSPINAL CANAL: Narrowed at L4-L5.\nFACET JOINTS: Severe arthropathy.\nPARS INTERARTICULARIS: Defect on the right side.", impression: "Spondylolisthesis at L4-L5 with spondylolysis." },
      { id: "mri-ls-modic", label: "Modic Changes", shortcut: "Shift+Alt+6", findings: "L4-L5: Modic Type I changes (T1 hypointense, T2 hyperintense) in the vertebral endplates.\nDISCS: Degenerated at L4-L5 with loss of T2 signal.\nSPINAL CANAL: Mild narrowing.\nVERTEBRAL BODIES: Normal.", impression: "Modic Type I changes at L4-L5 with disc degeneration." },
      { id: "mri-ls-schmorl", label: "Schmorl Node", shortcut: "Shift+Alt+7", findings: "L1-L2: Intravertebral herniation of disc material (Schmorl node) in the superior endplate of L2.\nVERTEBRAL BODY: Mild endplate irregularity.\nDISCS: Otherwise normal.\nSPINAL CANAL: Normal.", impression: "Schmorl node at L1-L2." },
      { id: "mri-ls-tumor", label: "Spinal Tumor", shortcut: "Shift+Alt+8", findings: "L2-L3: Intradural extramedullary mass, T1 isointense, T2 hyperintense, intensely enhancing.\nSPINAL CANAL: Occupied by mass.\nSPINAL CORD: Displaced anteriorly.\nNo intramedullary signal change.", impression: "Intradural extramedullary mass at L2-L3 — likely meningioma." },
    ],
  },
  {
    id: "mri-cervical-spine",
    label: "MRI Cervical Spine",
    modality: "MR",
    bodyPart: "CERVICAL SPINE",
    testKeywords: ["cervical", "c-spine", "neck spine", "cervical spine", "mri cervical"],
    buttons: [
      { label: "Disc Desiccation", text: "C___-___: Disc desiccation — loss of T2 hyperintense signal. Mild height reduction.", shortcut: "Alt+1", impression: "Disc desiccation at C___-___." },
      { label: "Disc Osteophyte", text: "C___-___: Disc osteophyte complex with endplate osteophytes. Indenting the thecal sac.", shortcut: "Alt+2", impression: "Disc osteophyte complex at C___-___." },
      { label: "Canal Narrowing", text: "SPINAL CANAL: Narrowed at C___-___ level. AP diameter reduced. No cord compression.", shortcut: "Alt+3", impression: "Canal narrowing at C___-___." },
      { label: "Cord Compression", text: "SPINAL CORD: Compression at C___-___ level. T2 hyperintense signal within the cord suggestive of myelomalacia.", shortcut: "Alt+4", impression: "Cord compression with myelomalacia at C___-___." },
      { label: "Facet Arthropathy", text: "C___-___: Facet joint arthropathy with subchondral sclerosis, irregularity, and hypertrophy. Joint effusion minimal.", shortcut: "Alt+5", impression: "Facet arthropathy at C___-___." },
      { label: "Loss of Lordosis", text: "CERVICAL ALIGNMENT: Loss of normal cervical lordosis. Straightening/reversal of curvature. No vertebral body fracture.", shortcut: "Alt+6", impression: "Loss of cervical lordosis." },
    ],
    smartFormats: [
      { id: "mri-cs-norm", label: "Normal Cervical Spine", shortcut: "Shift+Alt+1", findings: "CERVICAL VERTEBRAE: Normal alignment. No marrow signal abnormality.\nDISCS: All normal height and signal.\nSPINAL CANAL: Normal AP diameter.\nSPINAL CORD: Normal signal and caliber.\nFACET JOINTS: Normal.\nPARAVERTEBRAL SOFT TISSUES: Normal.", impression: "Normal MRI cervical spine." },
      { id: "mri-cs-bulge", label: "Cervical Disc Bulge", shortcut: "Shift+Alt+2", findings: "C5-C6: Disc bulge, indenting the anterior thecal sac.\nC6-C7: Mild disc bulge.\nRest of the discs: Normal.\nSPINAL CANAL: Normal.\nSPINAL CORD: Normal.", impression: "Disc bulge at C5-C6 and mild at C6-C7." },
      { id: "mri-cs-herniation", label: "Cervical Disc Herniation", shortcut: "Shift+Alt+3", findings: "C5-C6: Disc herniation with right paracentral protrusion.\nSPINAL CANAL: Narrowed at C5-C6 level.\nNEURAL FORAMINA: Right C5-C6 narrowed.\nSPINAL CORD: No signal abnormality.", impression: "Disc herniation at C5-C6 with right lateral recess stenosis." },
      { id: "mri-cs-cord", label: "Cord Compression", shortcut: "Shift+Alt+4", findings: "C5-C6: Disc herniation with severe canal stenosis.\nSPINAL CORD: Compression at C5-C6 level with T2 hyperintense signal suggestive of myelomalacia.\nFACET JOINTS: Hypertrophy.", impression: "Severe canal stenosis at C5-C6 with cord compression." },
      { id: "mri-cs-syrinx", label: "Syrinx", shortcut: "Shift+Alt+5", findings: "SPINAL CORD: Cystic cavity within the cord at C4-C7 levels, T2 hyperintense, T1 hypointense, no enhancement.\nCORD: Slightly expanded.\nSPINAL CANAL: Normal.\nVERTEBRAE: Normal.", impression: "Syrinx cavity in the cervical cord at C4-C7." },
      { id: "mri-cs-ossification", label: "OPLL", shortcut: "Shift+Alt+6", findings: "C3-C4: OPLL with continuous ossification of the posterior longitudinal ligament.\nSPINAL CANAL: Narrowed by 40%.\nSPINAL CORD: Compression at C3-C4.\nDISCS: Mild desiccation at C4-C5.", impression: "OPLL at C3-C4 with cervical cord compression." },
      { id: "mri-cs-ra", label: "Rheumatoid Arthritis", shortcut: "Shift+Alt+7", findings: "C1-C2: Atlantoaxial subluxation with increased predental space (6 mm).\nCORD: Mild compression at C1-C2.\nPANNUS: Enhancing soft tissue around the odontoid process.\nFACET JOINTS: Erosive changes.", impression: "Atlantoaxial subluxation with pannus formation." },
      { id: "mri-cs-lordosis", label: "Loss of Lordosis", shortcut: "Shift+Alt+8", findings: "CERVICAL ALIGNMENT: Loss of normal cervical lordosis.\nVERTEBRAE: Normal height.\nDISCS: Mild desiccation at C5-C6.\nSPINAL CANAL: Normal.\nSPINAL CORD: Normal.", impression: "Loss of cervical lordosis with mild degenerative changes." },
    ],
  },
  {
    id: "ct-brain",
    label: "CT Brain",
    modality: "CT",
    bodyPart: "BRAIN",
    testKeywords: ["ct brain", "brain ct", "ct head", "head ct", "ncct brain"],
    buttons: [
      { label: "Acute Hemorrhage", text: "HYPERDENSE area in the ___ region, measuring ___ x ___ mm. Surrounding hypodense edema. Mass effect on the ___ ventricle. No midline shift/midline shift of ___ mm.", shortcut: "Alt+1", impression: "Acute intraparenchymal hemorrhage in the ___ region." },
      { label: "Chronic Infarct", text: "HYPODENSE area in the ___ territory with ex-vacuo dilatation of the adjacent ventricle/sulci. No mass effect. No contrast enhancement.", shortcut: "Alt+2", impression: "Chronic infarct in the ___ territory." },
      { label: "Age Atrophy", text: "BRAIN PARENCHYMA: Diffuse cerebral atrophy with prominent sulci and dilated ventricles out of proportion to age. No focal lesion.", shortcut: "Alt+3", impression: "Age-related cerebral atrophy." },
      { label: "Hydrocephalus", text: "VENTRICULAR SYSTEM: Dilated lateral and third ventricles. Transependymal CSF seepage. Fourth ventricle normal. No obstructing lesion.", shortcut: "Alt+4", impression: "Hydrocephalus." },
      { label: "Fracture", text: "CALVARIUM: Linear fracture in the ___ bone, measuring ___ mm. No displacement. No associated epidural or subdural collection.", shortcut: "Alt+5", impression: "Calvarial fracture in the ___ bone." },
      { label: "Normal Study", text: "BRAIN PARENCHYMA: Normal attenuation. No focal lesion.\nVENTRICLES: Normal size and configuration.\nMIDLINE: Not shifted.\nCALVARIUM: Intact. No fracture.\nPARANASAL SINUSES: Normal.", shortcut: "Alt+6", impression: "Normal CT brain study." },
    ],
    smartFormats: [
      { id: "ct-brain-norm", label: "Normal CT Brain", shortcut: "Shift+Alt+1", findings: "BRAIN PARENCHYMA: Normal attenuation. No focal lesion.\nVENTRICLES: Normal size and configuration.\nMIDLINE: Not shifted.\nCALVARIUM: Normal. No fracture.\nPARANASAL SINUSES: Normal.", impression: "Normal CT brain." },
      { id: "ct-brain-inf", label: "Acute Infarct", shortcut: "Shift+Alt+2", findings: "HYPODENSE area in the right MCA territory, with effacement of sulci. No hemorrhagic transformation.\nVENTRICLES: Normal.", impression: "Acute infarct in the right MCA territory." },
      { id: "ct-brain-sah", label: "SAH", shortcut: "Shift+Alt+3", findings: "HYPERDENSE material in the sulci, basal cisterns, and interhemispheric fissure. No intraparenchymal hemorrhage.\nVENTRICLES: Mildly enlarged.", impression: "Subarachnoid hemorrhage." },
      { id: "ct-brain-trauma", label: "Head Trauma", shortcut: "Shift+Alt+4", findings: "FRACTURE: Linear fracture in the right parietal bone.\nEDH/SDH: Small epidural hematoma in the right temporal region.\nBRAIN: No midline shift.\nVENTRICLES: Normal.", impression: "Right parietal fracture with small epidural hematoma." },
      { id: "ct-brain-hem", label: "Intracranial Hemorrhage", shortcut: "Shift+Alt+5", findings: "HYPERDENSE area in the left basal ganglia, measuring 3.5 x 2.8 cm.\nVENTRICLES: Mild effacement of the left lateral ventricle.\nMIDLINE: Shifted 5 mm to the right.\nSULCI: Effaced.\nSURROUNDING: Hypodense edema.", impression: "Acute intraparenchymal hemorrhage in the left basal ganglia with mass effect." },
      { id: "ct-brain-edh", label: "Epidural Hematoma", shortcut: "Shift+Alt+6", findings: "RIGHT TEMPORAL: Biconvex hyperdense collection, measuring 2.5 x 1.0 cm, with mass effect.\nBRAIN: No midline shift.\nSKULL: Fracture in the right temporal bone.\nVENTRICLES: Normal.", impression: "Right temporal epidural hematoma." },
      { id: "ct-brain-sdh", label: "Subdural Hematoma", shortcut: "Shift+Alt+7", findings: "RIGHT FRONTOPARIETAL: Crescentic hyperdense collection, measuring 1.0 cm thickness.\nBRAIN: Mild mass effect.\nMIDLINE: Shifted 3 mm.\nVENTRICLES: Normal.", impression: "Right frontoparietal subdural hematoma." },
      { id: "ct-brain-abscess", label: "Brain Abscess", shortcut: "Shift+Alt+8", findings: "LEFT PARIETAL: Ring-enhancing lesion, 2.5 cm, with central hypodense necrotic area.\nPERILESIONAL: Vasogenic edema with mass effect.\nVENTRICLES: Mild effacement.\nMIDLINE: Shifted 2 mm.", impression: "Left parietal abscess with surrounding edema." },
    ],
  },
  {
    id: "xray-chest",
    label: "X-ray Chest",
    modality: "CR",
    bodyPart: "CHEST",
    testKeywords: ["chest", "xray chest", "cxr", "chest xray", "chest pa", "chest pa view"],
    buttons: [
      { label: "Normal Lung", text: "LUNG FIELDS: Clear bilaterally. No infiltrate.", shortcut: "Alt+1", impression: "Normal lungs." },
      { label: "Normal Cardiac", text: "CARDIAC SILHOUETTE: Normal size. CTR < 50%.", shortcut: "Alt+2", impression: "Normal cardiac size." },
      { label: "Normal Diaphragm", text: "COSTOPHRENIC ANGLES: Sharp bilaterally. Diaphragm contour normal.", shortcut: "Alt+3", impression: "Normal diaphragm." },
      { label: "Pneumonia", text: "HOMOGENEOUS opacity in the right/left lower zone, suggestive of pneumonia.", shortcut: "Alt+4", impression: "Pneumonia." },
      { label: "Pleural Effusion", text: "BLUNTING of the costophrenic angle, suggestive of pleural effusion.", shortcut: "Alt+5", impression: "Pleural effusion." },
      { label: "Pneumothorax", text: "AIR in the right/left pleural space. No lung markings.", shortcut: "Alt+6", impression: "Pneumothorax." },
    ],
    smartFormats: [
      { id: "cxr-norm", label: "Normal CXR", shortcut: "Shift+Alt+1", findings: "LUNG FIELDS: Clear bilaterally.\nCARDIAC SILHOUETTE: Normal size.\nMEDIASTINUM: Normal width.\nCOSTOPHRENIC ANGLES: Sharp bilaterally.\nBONY THORAX: No fracture.\nDIAPHRAGM: Normal contour.", impression: "Normal chest X-ray." },
      { id: "cxr-pneumonia", label: "Pneumonia", shortcut: "Shift+Alt+2", findings: "HOMOGENEOUS opacity in the right lower zone with air bronchogram. Rest of the lung fields clear.\nCARDIAC SILHOUETTE: Normal.\nCOSTOPHRENIC ANGLES: Sharp.", impression: "Right lower zone pneumonia." },
      { id: "cxr-effusion", label: "Pleural Effusion", shortcut: "Shift+Alt+3", findings: "BLUNTING of the right costophrenic angle with meniscus sign. Mild right lower zone opacity.\nCARDIAC SILHOUETTE: Normal.\nLEFT LUNG: Clear.\nBONY THORAX: Normal.", impression: "Right pleural effusion." },
      { id: "cxr-pneumothorax", label: "Pneumothorax", shortcut: "Shift+Alt+4", findings: "AIR in the right pleural space. No lung markings in the right upper zone. Lung collapsed.\nTRACHEA: Shifted to the left.\nMEDIASTINUM: Shifted to the left.", impression: "Right tension pneumothorax." },
      { id: "cxr-cardiomegaly", label: "Cardiomegaly", shortcut: "Shift+Alt+5", findings: "CARDIAC SILHOUETTE: Enlarged. CTR > 50%.\nPULMONARY VASCULATURE: Prominent.\nLUNG FIELDS: Mild congestion.\nCOSTOPHRENIC ANGLES: Sharp.", impression: "Cardiomegaly with mild pulmonary congestion." },
      { id: "cxr-tb", label: "Pulmonary TB", shortcut: "Shift+Alt+6", findings: "RIGHT UPPER ZONE: Thick-walled cavity with surrounding infiltrate.\nLEFT LUNG: Multiple nodular opacities.\nMEDIASTINUM: Widened.\nHILAR: Bilateral lymphadenopathy.\nCARDIAC: Normal.", impression: "Bilateral pulmonary TB with cavity." },
      { id: "cxr-mass", label: "Lung Mass", shortcut: "Shift+Alt+7", findings: "LEFT UPPER ZONE: Mass lesion, 4.5 cm, with irregular margins.\nMEDIASTINUM: Shifted right.\nCARDIAC: Normal.\nBONY THORAX: No lesion.\nHILAR: Left hilar prominence.", impression: "Left upper zone mass — likely bronchogenic carcinoma." },
      { id: "cxr-copd", label: "COPD/Emphysema", shortcut: "Shift+Alt+8", findings: "LUNG FIELDS: Hyperinflated. Low diaphragms.\nCARDIAC: Normal.\nMEDIASTINUM: Normal.\nRIBS: Widened intercostal spaces.\nBULLAE: Visible in the upper zones.", impression: "Severe COPD with emphysema." },
    ],
  },
  {
    id: "mri-pituitary",
    label: "MRI Brain Pituitary",
    modality: "MR",
    bodyPart: "BRAIN",
    testKeywords: ["pituitary", "mri pituitary", "sella", "brain with pituitary", "mri sella"],
    buttons: [
      { label: "Normal Pituitary", text: "PITUITARY: Normal size and signal. No mass.", shortcut: "Alt+1", impression: "Normal pituitary." },
      { label: "Normal Sella", text: "SELLA TURCICA: Normal size. No expansion.", shortcut: "Alt+2", impression: "Normal sella." },
      { label: "Normal Optic", text: "OPTIC CHIASMA: Normal. No compression.", shortcut: "Alt+3", impression: "Normal optic chiasma." },
      { label: "Pituitary Adenoma", text: "PITUITARY: Enlarged, T1 hypointense, T2 isointense, with suprasellar extension.", shortcut: "Alt+4", impression: "Pituitary adenoma." },
      { label: "Cavernous Sinus", text: "CAVERNOUS SINUS: Normal. No invasion.", shortcut: "Alt+5", impression: "Normal cavernous sinus." },
      { label: "Hemorrhage", text: "HYPERINTENSE area within the pituitary, suggestive of hemorrhage.", shortcut: "Alt+6", impression: "Pituitary apoplexy." },
    ],
    smartFormats: [
      { id: "mri-pit-norm", label: "Normal Pituitary", shortcut: "Shift+Alt+1", findings: "PITUITARY: Normal size (8mm x 6mm x 4mm) and signal.\nSELLA TURCICA: Normal size.\nOPTIC CHIASMA: Normal. No compression.\nCAVERNOUS SINUS: Normal.\nBRAIN PARENCHYMA: Normal.\nVENTRICLES: Normal.", impression: "Normal MRI pituitary study." },
      { id: "mri-pit-adenoma", label: "Pituitary Adenoma", shortcut: "Shift+Alt+2", findings: "PITUITARY: Enlarged (18mm x 14mm x 12mm), T1 hypointense, T2 isointense.\nSELLA TURCICA: Expanded.\nOPTIC CHIASMA: Compressed.\nCAVERNOUS SINUS: Normal.\nBRAIN: No mass.", impression: "Pituitary macroadenoma." },
      { id: "mri-pit-apoplexy", label: "Pituitary Apoplexy", shortcut: "Shift+Alt+3", findings: "PITUITARY: Hemorrhagic with T1 hyperintense and T2 hypointense areas.\nSELLA TURCICA: Expanded.\nOPTIC CHIASMA: Compressed.\nCAVERNOUS SINUS: Normal.\nBRAIN: Normal.\nVENTRICLES: Normal.", impression: "Pituitary apoplexy." },
      { id: "mri-pit-rathke", label: "Rathke Cleft Cyst", shortcut: "Shift+Alt+4", findings: "PITUITARY: Cystic lesion, 8mm, T1 hypointense, T2 hyperintense, no enhancement.\nSELLA TURCICA: Slightly expanded.\nOPTIC CHIASMA: Normal.\nCAVERNOUS SINUS: Normal.\nBRAIN: Normal.", impression: "Rathke cleft cyst." },
      { id: "mri-pit-empty", label: "Empty Sella", shortcut: "Shift+Alt+5", findings: "PITUITARY: Flattened along the floor of the sella.\nSELLA TURCICA: Enlarged, filled with CSF.\nOPTIC CHIASMA: Normal.\nCAVERNOUS SINUS: Normal.\nBRAIN: Normal.", impression: "Empty sella." },
      { id: "mri-pit-craniopharyngioma", label: "Craniopharyngioma", shortcut: "Shift+Alt+6", findings: "PITUITARY: Suprasellar mass, T1 mixed, T2 hyperintense, with cystic and solid components.\nSELLA TURCICA: Normal.\nOPTIC CHIASMA: Compressed.\nCAVERNOUS SINUS: Normal.\nBRAIN: No mass.", impression: "Suprasellar mass — likely craniopharyngioma." },
    ],
  },
  {
    id: "mri-brain-cervical",
    label: "MRI Brain+Cervical",
    modality: "MR",
    bodyPart: "BRAIN",
    testKeywords: ["brain cervical", "brain and cervical", "mri brain + cervical", "brain with cervical spine"],
    buttons: [
      { label: "Normal Brain", text: "BRAIN: Normal signal. No lesion.", shortcut: "Alt+1", impression: "Normal brain." },
      { label: "Normal Cervical", text: "CERVICAL SPINE: Normal alignment. No disc lesion.", shortcut: "Alt+2", impression: "Normal cervical spine." },
      { label: "Normal Cord", text: "SPINAL CORD: Normal signal.", shortcut: "Alt+3", impression: "Normal spinal cord." },
      { label: "Disc Bulge", text: "CERVICAL DISC BULGE at C___ level.", shortcut: "Alt+4", impression: "Cervical disc bulge." },
      { label: "Brain Lesion", text: "HYPERINTENSE lesion in the ___ region.", shortcut: "Alt+5", impression: "Brain lesion." },
      { label: "Cord Signal", text: "SPINAL CORD: T2 hyperintense signal at C___ level.", shortcut: "Alt+6", impression: "Cord signal abnormality." },
    ],
    smartFormats: [
      { id: "mri-bc-norm", label: "Normal Brain+Cervical", shortcut: "Shift+Alt+1", findings: "BRAIN: Normal signal on all sequences. No lesion.\nCERVICAL SPINE: Normal alignment. All discs normal.\nSPINAL CORD: Normal signal.\nVENTRICLES: Normal.\nEXTRACRANIAL: Normal.", impression: "Normal MRI brain and cervical spine." },
      { id: "mri-bc-brain", label: "Brain Lesion", shortcut: "Shift+Alt+2", findings: "BRAIN: T2 hyperintense lesion in the right frontal lobe. No mass effect.\nCERVICAL SPINE: Normal.\nSPINAL CORD: Normal.", impression: "Right frontal lobe lesion. Cervical spine normal." },
      { id: "mri-bc-cervical", label: "Cervical Disc Disease", shortcut: "Shift+Alt+3", findings: "CERVICAL SPINE: Disc bulge at C5-C6 and C6-C7.\nSPINAL CANAL: Narrowed at C5-C6.\nBRAIN: Normal.", impression: "Cervical disc disease at C5-C6 and C6-C7. Brain normal." },
      { id: "mri-bc-cord", label: "Cord Compression", shortcut: "Shift+Alt+4", findings: "CERVICAL SPINE: Severe canal stenosis at C5-C6.\nSPINAL CORD: Compression at C5-C6 with T2 hyperintense signal.\nBRAIN: Normal.", impression: "Cervical cord compression at C5-C6. Brain normal." },
      { id: "mri-bc-mets", label: "Brain Metastases", shortcut: "Shift+Alt+5", findings: "BRAIN: Multiple ring-enhancing lesions.\nCERVICAL SPINE: Normal.\nSPINAL CORD: Normal.", impression: "Multiple brain metastases. Cervical spine normal." },
      { id: "mri-bc-ms", label: "Demyelination", shortcut: "Shift+Alt+6", findings: "BRAIN: Multiple periventricular and juxtacortical lesions.\nCERVICAL SPINE: No cord lesion.\nSPINAL CORD: Normal.", impression: "Demyelinating disease. Cervical spine normal." },
    ],
  },
];

// ─── Default macros (20+) ───────────────────────────────────────────────────

export const DEFAULT_MACROS: MacroEntry[] = [
  { id: "macro-norm", shortcut: "norm", expansion: "Normal in size, shape, and echotexture." },
  { id: "macro-nles", shortcut: "nles", expansion: "No focal lesion seen." },
  { id: "macro-adq", shortcut: "adq", expansion: "Adequately visualized." },
  { id: "macro-nvis", shortcut: "nvis", expansion: "Not adequately visualized." },
  { id: "macro-enl", shortcut: "enl", expansion: "Enlarged in size." },
  { id: "macro-atr", shortcut: "atr", expansion: "Atrophic changes noted." },
  { id: "macro-ncal", shortcut: "ncal", expansion: "No calcification." },
  { id: "macro-nflu", shortcut: "nflu", expansion: "No free fluid." },
  { id: "macro-cor", shortcut: "cor", expansion: "Clinical correlation advised." },
  { id: "macro-fup", shortcut: "fup", expansion: "Follow-up advised." },
  { id: "macro-inc", shortcut: "inc", expansion: "Incidental finding." },
  { id: "macro-mild", shortcut: "mild", expansion: "Mild degenerative changes." },
  { id: "macro-mod", shortcut: "mod", expansion: "Moderate degenerative changes." },
  { id: "macro-sev", shortcut: "sev", expansion: "Severe degenerative changes." },
  { id: "macro-ok", shortcut: "ok", expansion: "Normal study." },
  { id: "macro-nab", shortcut: "nab", expansion: "No abnormality detected." },
  { id: "macro-nod", shortcut: "nod", expansion: "No definite abnormality detected." },
  { id: "macro-rec", shortcut: "rec", expansion: "Further evaluation recommended." },
  { id: "macro-ct", shortcut: "ctcor", expansion: "Clinical and laboratory correlation recommended." },
  { id: "macro-us", shortcut: "usfup", expansion: "Follow-up ultrasound advised." },
  { id: "macro-mri", shortcut: "mrifup", expansion: "Follow-up MRI advised." },
  { id: "macro-ctscan", shortcut: "ctfup", expansion: "Follow-up CT advised." },
  { id: "macro-dis", shortcut: "dis", expansion: "Discharge from follow-up not advised." },
  { id: "macro-older", shortcut: "older", expansion: "Age-related degenerative changes." },
  { id: "macro-stable", shortcut: "stable", expansion: "Stable findings compared to previous study." },
  { id: "macro-impr", shortcut: "impr", expansion: "Improving compared to previous study." },
  { id: "macro-worse", shortcut: "worse", expansion: "Worsening compared to previous study." },
  { id: "macro-hydr", shortcut: "hydr", expansion: "Hydronephrosis noted." },
  { id: "macro-calc", shortcut: "calc", expansion: "Calcification noted." },
  { id: "macro-cyst", shortcut: "cyst", expansion: "Simple cyst noted." },
  { id: "macro-mass", shortcut: "mass", expansion: "Mass lesion noted." },
  // Phase 2C: Modality-specific macros
  { id: "macro-fl1", shortcut: "fl1", expansion: "Grade I fatty liver — diffuse increased echotexture with preserved vessel definition." },
  { id: "macro-fl2", shortcut: "fl2", expansion: "Grade II fatty liver — marked increased echotexture with impaired vessel definition and posterior attenuation." },
  { id: "macro-faz1", shortcut: "faz1", expansion: "Fazekas Grade I — few punctate periventricular hyperintensities (< 5 mm)." },
  { id: "macro-faz2", shortcut: "faz2", expansion: "Fazekas Grade II — multiple periventricular hyperintensities with beginning confluence." },
  { id: "macro-faz3", shortcut: "faz3", expansion: "Fazekas Grade III — large confluent areas of periventricular hyperintensity." },
  { id: "macro-disc", shortcut: "disc", expansion: "Disc desiccation with loss of T2 hyperintense signal." },
  { id: "macro-bulge", shortcut: "bulge", expansion: "Broad-based disc bulge indenting the anterior thecal sac." },
  { id: "macro-protrusion", shortcut: "protrusion", expansion: "Focal disc protrusion extending beyond the vertebral margin, indenting the thecal sac." },
  { id: "macro-normal", shortcut: "normal", expansion: "Normal study. No abnormality detected." },
  { id: "macro-noacute", shortcut: "noacute", expansion: "No acute intracranial abnormality." },
  { id: "macro-fup", shortcut: "fup", expansion: "Follow-up imaging advised." },
  { id: "macro-compare", shortcut: "compare", expansion: "Findings compared to previous study dated ___." },
  { id: "macro-clinical", shortcut: "clinical", expansion: "Clinical correlation recommended." },
  { id: "macro-neuro", shortcut: "neuro", expansion: "Neurosurgical consultation advised." },
  { id: "macro-surgical", shortcut: "surgical", expansion: "Surgical evaluation recommended." },
  { id: "macro-urgent", shortcut: "urgent", expansion: "URGENT: Findings require immediate attention." },
  { id: "macro-dwi", shortcut: "dwi", expansion: "Restricted diffusion on DWI with corresponding low ADC — suggestive of acute ischemia." },
  { id: "macro-gliosis", shortcut: "gliosis", expansion: "T2/FLAIR hyperintense foci in the periventricular/deep white matter — likely chronic ischemic gliosis." },
  { id: "macro-mass-effect", shortcut: "masseffect", expansion: "Mass effect on the adjacent ventricle/sulci with midline shift of ___ mm." },
];

// ─── Context detection ─────────────────────────────────────────────────────

export function detectStudyContext(
  modality: string,
  studyDescription?: string | null,
  testName?: string | null,
  bodyPart?: string | null,
): StudyContext | null {
  const desc = (studyDescription ?? "").toLowerCase();
  const test = (testName ?? "").toLowerCase();
  const body = (bodyPart ?? "").toLowerCase();
  const mod = (modality ?? "").toUpperCase();

  // Match by testKeywords in descending priority
  const score = (ctx: StudyContext): number => {
    let s = 0;
    if (ctx.modality === mod || ctx.modality === "ALL") s += 10;
    if (ctx.bodyPart && body.includes(ctx.bodyPart.toLowerCase())) s += 20;
    for (const kw of ctx.testKeywords) {
      if (desc.includes(kw.toLowerCase())) s += 5;
      if (test.includes(kw.toLowerCase())) s += 5;
    }
    return s;
  };

  let best: StudyContext | null = null;
  let bestScore = 0;
  for (const ctx of STUDY_CONTEXTS) {
    const s = score(ctx);
    if (s > bestScore) {
      bestScore = s;
      best = ctx;
    }
  }

  return bestScore >= 5 ? best : null;
}

// ─── Merge engine for Smart Format ──────────────────────────────────────────

export interface MergedFormat {
  title: string;
  technique: string;
  findings: string;
  impression: string;
  advice: string;
}

export function mergeSmartFormats(formats: SmartFormat[]): MergedFormat {
  // Deduplicate findings by line
  const seenLines = new Set<string>();
  const findingsLines: string[] = [];
  let impression = "";
  let advice = "";
  let title = "";
  let technique = "";

  for (const f of formats) {
    if (f.title) title = f.title; // last one wins
    if (f.technique) technique = f.technique; // last one wins
    if (f.impression) impression = f.impression; // last one wins
    if (f.advice) advice = f.advice; // last one wins
    const lines = (f.findings || "").split("\n").map((l) => l.trim()).filter((l) => l);
    for (const line of lines) {
      if (!seenLines.has(line)) {
        seenLines.add(line);
        findingsLines.push(line);
      }
    }
  }

  return {
    title,
    technique,
    findings: findingsLines.join("\n"),
    impression,
    advice,
  };
}

// ─── Multi-Study Merge Engine ───

export interface StudyMergeResult {
  title: string;
  findings: string;
  impression: string;
}

export function mergeStudyContexts(ctxs: StudyContext[]): StudyMergeResult {
  const titles: string[] = [];
  const allFindings: string[] = [];
  const allImpressions: string[] = [];
  const seenFindings = new Set<string>();
  const seenImpressions = new Set<string>();

  for (const ctx of ctxs) {
    if (ctx.label) titles.push(ctx.label.toUpperCase());
    // Collect findings from first smart format or normal template
    const fmt = ctx.smartFormats?.[0];
    if (fmt) {
      const lines = fmt.findings.split("\n").map((l) => l.trim()).filter((l) => l);
      for (const line of lines) {
        if (!seenFindings.has(line)) {
          seenFindings.add(line);
          allFindings.push(line);
        }
      }
      if (fmt.impression && !seenImpressions.has(fmt.impression)) {
        seenImpressions.add(fmt.impression);
        allImpressions.push(fmt.impression);
      }
    }
  }

  return {
    title: titles.join(" WITH "),
    findings: allFindings.join("\n"),
    impression: allImpressions.join("\n"),
  };
}
