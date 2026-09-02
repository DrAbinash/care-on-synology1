/**
 * Hardcoded quick-select tile catalog (data only).
 *
 * Kept free of `@/` path aliases so `@workspace/scripts` can import it for
 * clinic ownership sync without typechecking the ERP Vite graph.
 */
const now = () => new Date().toISOString();
const uid = () => `qs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export type QuickSelectOwnershipTile = {
  id: string;
  field: string;
  label: string;
  sentence: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  mnemonic?: string;
  scopeModality?: string;
  scopeBodyPart?: string;
  favorite?: boolean;
  custom?: boolean;
  impressionSentence?: string;
  /** Explicit canonical concept (preferred). See conceptCanon/contentPacks.ts. */
  concept?: string;
  conflictGroup?: string;
  anatomicalSection?: string;
  baselineReplaces?: string;
  properties?: string;
};

function t(
  field: string,
  label: string,
  sentence: string,
  extra: Partial<QuickSelectOwnershipTile> = {},
): QuickSelectOwnershipTile {
  return {
    id: uid(),
    field,
    label,
    sentence,
    category: "normal",
    createdAt: now(),
    updatedAt: now(),
    ...extra,
  };
}

export const DEFAULT_QUICK_SELECT_TILES: QuickSelectOwnershipTile[] = [
  t("clinicalHistory","Standard H&P","Patient presents with [symptom] for [duration]. No relevant past medical history.",{mnemonic:"hp"}),
  t("clinicalHistory","Trauma","History of trauma. Patient complains of pain and swelling at the site of injury.",{mnemonic:"tr"}),
  t("clinicalHistory","Glioma follow-up","Known case of glioma post-resection. Follow-up for recurrence. Worsening headache since 2 weeks.",{mnemonic:"gf",scopeModality:"MR",scopeBodyPart:"Brain"}),
  t("clinicalHistory","Chronic headache","Chronic headache with progressive visual disturbance. No history of trauma.",{mnemonic:"ch",scopeModality:"MR",scopeBodyPart:"Brain"}),
  t("clinicalHistory","Seizure evaluation","Seizure disorder — first-time MRI evaluation for structural cause.",{mnemonic:"sz",scopeModality:"MR",scopeBodyPart:"Brain"}),
  t("clinicalHistory","Acute stroke","Sudden onset right-sided weakness since 2 hours. Suspected acute stroke.",{mnemonic:"as",scopeModality:"CT",scopeBodyPart:"Brain"}),
  t("clinicalHistory","Back pain + radiculopathy","Lower back pain with radiculopathy right lower limb. Suspected disc herniation.",{mnemonic:"br",scopeModality:"MR",scopeBodyPart:"LS Spine"}),
  t("clinicalHistory","Known malignancy","Known case of bronchogenic carcinoma. Staging CT. Chronic smoker (40 pack-years).",{mnemonic:"km",scopeModality:"CT",scopeBodyPart:"Chest"}),
  t("clinicalHistory","RUQ pain","Right upper quadrant pain. Suspected gallstone disease.",{mnemonic:"rq",scopeModality:"US",scopeBodyPart:"Abdomen"}),
  t("clinicalHistory","Routine anomaly scan","G3P2L2 at 22 weeks gestation. Routine anomaly scan. Previous LSCS.",{mnemonic:"ob",scopeModality:"US",scopeBodyPart:"OB"}),
  t("clinicalHistory","Screening mammography","Screening mammography. Family history of breast carcinoma (mother).",{mnemonic:"sm",scopeModality:"MG",scopeBodyPart:"Breast"}),
  t("technique","MRI 3T standard","MRI performed on 3T scanner. Sequences: T1W, T2W, FLAIR, DWI, ADC, post-contrast T1W GRE. Slice thickness 5 mm.",{mnemonic:"m1",scopeModality:"MR"}),
  t("technique","MRI LS Spine","MRI lumbo-sacral spine on 3T. Sagittal T1W, T2W; axial T1W, T2W. Slice thickness 4 mm.",{mnemonic:"ml",scopeModality:"MR",scopeBodyPart:"LS Spine"}),
  t("technique","CT non-contrast","CT on 128-slice scanner. Non-contrast study. Slice thickness 5 mm.",{mnemonic:"cn",scopeModality:"CT"}),
  t("technique","CT with contrast","CT on 128-slice scanner. Contrast-enhanced. Slice thickness 5 mm. IV contrast: 350 mgI/mL, 80 mL.",{mnemonic:"cc",scopeModality:"CT"}),
  t("technique","XR standard","Radiograph on digital radiography unit. Standard AP and lateral views.",{mnemonic:"xr",scopeModality:"XR"}),
  t("technique","US abdomen","Ultrasound on convex transducer (3-6 MHz) with patient in supine position.",{mnemonic:"ua",scopeModality:"US",scopeBodyPart:"Abdomen"}),
  t("technique","MG standard","Bilateral mammography. Standard CC and MLO views. Tomosynthesis acquired.",{mnemonic:"mg",scopeModality:"MG"}),
  t("findings","Normal brain parenchyma","Brain parenchyma shows normal signal intensity. No evidence of acute infarct, hemorrhage, or mass lesion.",{mnemonic:"nb",scopeModality:"MR",scopeBodyPart:"Brain",favorite:true}),
  t("findings","Normal ventricles","Ventricular system and cisternal spaces are normal in size and configuration. No midline shift.",{mnemonic:"nv",scopeModality:"MR",scopeBodyPart:"Brain",favorite:true,concept:"ventricles",conflictGroup:"ventricular",baselineReplaces:"Ventricular system and cisternal spaces are normal in size and configuration. No midline shift.",impressionSentence:"Ventricles and cisternal spaces are normal. No hydrocephalus."}),
  t("findings","Hydrocephalus","The ventricular system is dilated, consistent with hydrocephalus. No midline shift.",{mnemonic:"hc",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"ventricles",conflictGroup:"hydrocephalus",baselineReplaces:"Ventricular system and cisternal spaces are normal in size and configuration. No midline shift.",impressionSentence:"Hydrocephalus."}),
  t("findings","Glioma recurrence","Heterogeneously enhancing area in the right frontal operculum at the post-resection cavity, measuring approximately ___ × ___ × ___ cm, with surrounding T2/FLAIR hyperintensity suggestive of edema. Findings are concerning for tumor recurrence.",{mnemonic:"gr",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",favorite:true,concept:"glioma",conflictGroup:"tumor recurrence"}),
  t("findings","Acute infarct (DWI)","Restricted diffusion in the {side} MCA territory on DWI/ADC, consistent with acute infarct. No hemorrhagic transformation.",{mnemonic:"ai",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"infarct",anatomicalSection:"mca",conflictGroup:"infarct",properties:"side",impressionSentence:"Acute {side} MCA territory infarct."}),
  t("findings","Basal ganglia hemorrhage","Acute intraparenchymal hemorrhage in the {side} basal ganglia with intraventricular extension. Mass effect with midline shift of ___ mm.",{mnemonic:"ah",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"hemorrhage",anatomicalSection:"basal ganglia",conflictGroup:"hemorrhage",properties:"side",impressionSentence:"Acute {side} basal ganglia hemorrhage."}),
  t("findings","Acute hemorrhage","Acute intraparenchymal hemorrhage in the {side} basal ganglia with intraventricular extension. Mass effect with midline shift of ___ mm to the contralateral side.",{mnemonic:"ah2",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"hemorrhage",anatomicalSection:"basal ganglia",conflictGroup:"hemorrhage",properties:"side",impressionSentence:"Acute {side} basal ganglia hemorrhage."}),
  t("findings","Fazekas 1","Few punctate T2/FLAIR hyperintense white matter lesions in bilateral periventricular and deep white matter, Fazekas grade 1. No confluent lesions.",{mnemonic:"f1",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"fazekas",conflictGroup:"fazekas",impressionSentence:"Mild chronic small vessel ischemic disease (Fazekas grade 1)."}),
  t("findings","Fazekas 2","Confluent T2/FLAIR hyperintense white matter lesions in bilateral periventricular and deep white matter, Fazekas grade 2.",{mnemonic:"f2",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"fazekas",conflictGroup:"fazekas",impressionSentence:"Moderate chronic small vessel ischemic disease (Fazekas grade 2)."}),
  t("findings","Orbital cellulitis","Preseptal and postseptal inflammatory change in the {side} orbit, consistent with orbital cellulitis.",{mnemonic:"oc",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"orbital",conflictGroup:"orbital",properties:"side",impressionSentence:"{side} orbital cellulitis."}),
  t("findings","Normal LS spine","Lumbar vertebrae show normal alignment and marrow signal. No spondylolisthesis. Disc spaces maintained.",{mnemonic:"nl",scopeModality:"MR",scopeBodyPart:"LS Spine",favorite:true,concept:"spondylolisthesis",conflictGroup:"spondylolisthesis",baselineReplaces:"No spondylolisthesis."}),
  t("findings","Disc herniation L4-L5","Broad-based disc bulge at L4-L5 with posterocentral-right paracentral protrusion causing indentation on the thecal sac and mild narrowing of bilateral neural foramina. No significant central canal stenosis.",{mnemonic:"dh",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",favorite:true,concept:"disc_contour",conflictGroup:"disc bulge",impressionSentence:"Disc herniation at L4-L5 causing indentation on the thecal sac."}),
  t("findings","Disc bulge L3-L4","Disc bulge at L3-L4 without nerve root compression.",{mnemonic:"db34",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"disc_contour",conflictGroup:"disc bulge"}),
  t("findings","Disc protrusion L5-S1","Posterocentral disc protrusion at L5-S1 indenting the thecal sac.",{mnemonic:"dp51",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"disc_contour",conflictGroup:"disc protrusion"}),
  t("findings","Disc desiccation L4-L5","Loss of T2 signal (desiccation) of the L4-L5 disc.",{mnemonic:"dd45",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"disc_signal",conflictGroup:"desiccation"}),
  t("findings","Reduced disc height L4-L5","Disc height is reduced at L4-L5.",{mnemonic:"dh45",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"disc_height",conflictGroup:"disc height"}),
  t("findings","Mild canal stenosis L4-L5","Mild canal stenosis at L4-L5 without cord compression.",{mnemonic:"cs1",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"canal_stenosis",conflictGroup:"canal stenosis"}),
  t("findings","Moderate canal stenosis L4-L5","Moderate canal stenosis at L4-L5.",{mnemonic:"cs2",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"canal_stenosis",conflictGroup:"canal stenosis"}),
  t("findings","Severe canal stenosis L4-L5","Severe canal stenosis at L4-L5 with thecal sac compression.",{mnemonic:"cs3",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"critical",concept:"canal_stenosis",conflictGroup:"canal stenosis",impressionSentence:"Severe canal stenosis at L4-L5."}),
  t("findings","Grade 1 spondylolisthesis L4-L5","Grade 1 spondylolisthesis at L4-L5.",{mnemonic:"sl1",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"spondylolisthesis",conflictGroup:"spondylolisthesis"}),
  t("findings","Grade 2 spondylolisthesis L4-L5","Grade 2 spondylolisthesis at L4-L5.",{mnemonic:"sl2",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"spondylolisthesis",conflictGroup:"spondylolisthesis"}),
  t("findings","Modic type 1 L4-L5","Modic type 1 endplate changes at L4-L5.",{mnemonic:"m1",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"endplate",conflictGroup:"endplate"}),
  t("findings","Modic type 2 L4-L5","Modic type 2 endplate changes at L4-L5.",{mnemonic:"m2",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"endplate",conflictGroup:"endplate"}),
  t("findings","Facet arthropathy L4-L5","Facet arthropathy at L4-L5.",{mnemonic:"fa45",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"facet_joint",conflictGroup:"facet"}),
  t("findings","Compression fracture L1","Acute compression fracture at L1 vertebral body with marrow edema on T2/STIR. Posterior wall intact.",{mnemonic:"cf",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"critical",concept:"compression_fracture",conflictGroup:"compression fracture"}),
  // ── High-value additions cross-referenced from DrAbinash/mri-reports ──
  // These clinically distinct concepts coexist at the same level and must
  // NOT be collapsed into generic "degenerative changes" (PR crosswalk §12).
  t("findings","LF hypertrophy L4-L5","Ligamentum flavum hypertrophy at L4-L5.",{mnemonic:"lf45",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"ligamentum_flavum",conflictGroup:"ligamentum_flavum"}),
  t("findings","Foraminal stenosis L4-L5","{severity} {side} neural foraminal stenosis at L4-L5.",{mnemonic:"fs45",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"foraminal_stenosis",conflictGroup:"foraminal_stenosis",properties:"side"}),
  t("findings","Schmorl node L1","Schmorl node at L1 vertebral endplate.",{mnemonic:"sn1",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"schmorl",conflictGroup:"schmorl"}),
  t("findings","Vertebral hemangioma L1","Vertebral hemangioma at L1 — typical T1/T2 hyperintense signal.",{mnemonic:"vh1",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"normal",concept:"hemangioma",conflictGroup:"hemangioma"}),
  t("findings","Loss of cervical lordosis","Evidence of loss of cervical lordosis — alignment alteration, ? due to spasm.",{mnemonic:"lcl",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"alignment",conflictGroup:"alignment"}),
  t("findings","Disc desiccation L5-S1","Loss of T2 signal (desiccation) of the L5-S1 disc.",{mnemonic:"dd51",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"disc_signal",conflictGroup:"disc_signal"}),
  t("findings","Normal CT brain","Brain parenchyma shows normal attenuation. No evidence of acute hemorrhage or mass lesion.",{mnemonic:"nb",scopeModality:"CT",scopeBodyPart:"Brain",favorite:true,concept:"hemorrhage",conflictGroup:"hemorrhage",baselineReplaces:"No evidence of acute hemorrhage or mass lesion."}),
  t("findings","Acute infarct (CT)","Loss of grey-white differentiation in the left MCA territory, consistent with acute infarct. Hyperdense MCA sign.",{mnemonic:"ai",scopeModality:"CT",scopeBodyPart:"Brain",category:"critical",favorite:true,concept:"infarct",conflictGroup:"infarct"}),
  t("findings","Acute ICH","Acute intraparenchymal hemorrhage in the right basal ganglia measuring ___ × ___ cm. Intraventricular extension. Mass effect with midline shift of ___ mm.",{mnemonic:"ih",scopeModality:"CT",scopeBodyPart:"Brain",category:"critical",concept:"hemorrhage",conflictGroup:"hemorrhage"}),
  t("findings","SDH","Acute subdural hematoma over the right convexity, maximum thickness ___ mm. Mass effect with midline shift of ___ mm to the left.",{mnemonic:"sd",scopeModality:"CT",scopeBodyPart:"Brain",category:"critical",concept:"subdural_hematoma",conflictGroup:"subdural hematoma"}),
  t("findings","Normal lungs","Lung fields are clear. No focal consolidation or mass lesion. No pleural effusion.",{mnemonic:"nl",scopeModality:"CT",scopeBodyPart:"Chest",favorite:true,concept:"pneumothorax",conflictGroup:"pneumothorax",baselineReplaces:"Lung fields are clear. No focal consolidation or mass lesion. No pleural effusion."}),
  t("findings","Pulmonary nodule","Spiculated pulmonary nodule measuring ___ × ___ × ___ cm in the right upper lobe. Surrounding ground-glass opacities. Findings are highly suspicious for malignancy.",{mnemonic:"pn",scopeModality:"CT",scopeBodyPart:"Chest",category:"abnormal",favorite:true,concept:"pulmonary_nodule",conflictGroup:"pulmonary nodule"}),
  t("findings","Pneumothorax","Tension pneumothorax on the right with mediastinal shift to the left.",{mnemonic:"px",scopeModality:"CT",scopeBodyPart:"Chest",category:"critical",concept:"pneumothorax",conflictGroup:"pneumothorax"}),
  t("findings","Normal gallbladder","Gallbladder is normal in size and wall thickness. No calculi or sludge. Common bile duct is unremarkable.",{mnemonic:"ng",scopeModality:"US",scopeBodyPart:"Abdomen",favorite:true,concept:"cholelithiasis",conflictGroup:"cholelithiasis",baselineReplaces:"Gallbladder is normal in size and wall thickness. No calculi or sludge. Common bile duct is unremarkable."}),
  t("findings","Gallstones","Multiple echogenic foci with acoustic shadowing in the gallbladder lumen, largest measuring ___ mm, suggestive of cholelithiasis. Gallbladder wall thickness normal.",{mnemonic:"gs",scopeModality:"US",scopeBodyPart:"Abdomen",category:"abnormal",favorite:true,concept:"cholelithiasis",conflictGroup:"cholelithiasis"}),
  t("findings","Renal calculus","Echogenic renal calculus in the {side} kidney with posterior acoustic shadowing.",{mnemonic:"rk",scopeModality:"US",scopeBodyPart:"Abdomen",category:"abnormal",concept:"renal",conflictGroup:"renal",properties:"side"}),
  t("findings","Normal breast","No suspicious masses or calcifications. Bilateral breast parenchyma is symmetric.",{mnemonic:"nb",scopeModality:"MG",scopeBodyPart:"Breast",favorite:true,concept:"birads"}),
  t("findings","Spiculated mass","Spiculated mass in the right upper outer quadrant measuring ___ × ___ cm with associated skin retraction. Highly suspicious for malignancy.",{mnemonic:"sm",scopeModality:"MG",scopeBodyPart:"Breast",category:"critical",concept:"birads",conflictGroup:"spiculated mass"}),
  t("findings","Meniscus tear","Oblique tear of the {side} meniscus.",{mnemonic:"mt",scopeModality:"MR",scopeBodyPart:"Knee",category:"abnormal",concept:"meniscus",conflictGroup:"meniscus",properties:"side"}),
  t("findings","Rotator cuff tear","Full-thickness tear of the {side} rotator cuff.",{mnemonic:"rc",scopeModality:"MR",scopeBodyPart:"Shoulder",category:"abnormal",concept:"rotator_cuff",conflictGroup:"rotator cuff",properties:"side"}),
  t("findings","Hip effusion","Moderate effusion in the {side} hip joint.",{mnemonic:"he",scopeModality:"MR",scopeBodyPart:"Pelvis",category:"abnormal",concept:"hip",conflictGroup:"hip",properties:"side"}),
  t("findings","Maxillary sinusitis","Mucosal thickening in the {side} maxillary sinus.",{mnemonic:"ms",scopeModality:"CT",scopeBodyPart:"PNS",category:"abnormal",concept:"sinus",conflictGroup:"sinus",properties:"side"}),
  t("impression","Normal study","No acute abnormality detected. Clinical correlation advised.",{mnemonic:"no",favorite:true,concept:"normal_study"}),
  t("impression","BI-RADS 1","BI-RADS 1: Negative. No abnormalities. Routine screening recommended.",{mnemonic:"b1",scopeModality:"MG",scopeBodyPart:"Breast",concept:"birads"}),
  t("impression","BI-RADS 4","BI-RADS 4: Suspicious for malignancy. Image-guided biopsy recommended.",{mnemonic:"b4",scopeModality:"MG",scopeBodyPart:"Breast",category:"abnormal",concept:"birads",conflictGroup:"bi-rads"}),
  t("impression","BI-RADS 5","BI-RADS 5: Highly suggestive of malignancy. Biopsy mandatory. Surgical referral advised.",{mnemonic:"b5",scopeModality:"MG",scopeBodyPart:"Breast",category:"critical",concept:"birads",conflictGroup:"bi-rads"}),
  t("recommendation","Clinical correlation","Clinical correlation advised. Follow-up as clinically indicated.",{mnemonic:"cc",favorite:true}),
  t("recommendation","Follow-up scan","Follow-up scan recommended in ___ weeks.",{mnemonic:"fu"}),
  t("recommendation","Biopsy","Image-guided biopsy recommended for tissue diagnosis.",{mnemonic:"bx",scopeModality:"MG",scopeBodyPart:"Breast",category:"abnormal"}),
  t("recommendation","Stroke team","Immediate stroke team notification advised. If within thrombolysis window, consider IV tPA per protocol. CTA head and neck recommended.",{mnemonic:"st",scopeModality:"CT",scopeBodyPart:"Brain",category:"critical",favorite:true,conflictGroup:"stroke team"}),
];
