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
  /**
   * What the box also writes into Recommendation, so one click completes the
   * bottom line and the advice that goes with it. Every value here is copied
   * verbatim from the Report Format of the same diagnosis (source cited per
   * tile) — the tile catalog does not invent clinical advice.
   */
  recommendationSentence?: string;
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
  t("findings","Normal brain parenchyma","Brain parenchyma shows normal signal intensity. No evidence of acute infarct, hemorrhage, or mass lesion.",{mnemonic:"nb",scopeModality:"MR",scopeBodyPart:"Brain",favorite:true,concept:"brain_parenchyma",conflictGroup:"brain_parenchyma"}),
  t("findings","Normal ventricles","Ventricular system and cisternal spaces are normal in size and configuration. No midline shift.",{mnemonic:"nv",scopeModality:"MR",scopeBodyPart:"Brain",favorite:true,concept:"ventricles",conflictGroup:"ventricular",baselineReplaces:"Ventricular system and cisternal spaces are normal in size and configuration.",impressionSentence:"Ventricles and cisternal spaces are normal. No hydrocephalus."}),
  t("findings","Hydrocephalus","The ventricular system is dilated, consistent with hydrocephalus. No midline shift.",{mnemonic:"hc",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"ventricles",conflictGroup:"hydrocephalus",baselineReplaces:"Ventricular system and cisternal spaces are normal in size and configuration.",impressionSentence:"Hydrocephalus.",recommendationSentence:"Clinical correlation. Neurosurgical consultation for possible shunt placement."}), // report-formats-library.ts fmt("MRI Brain — Hydrocephalus").recommendation
  t("findings","Glioma recurrence","Heterogeneously enhancing area in the right frontal operculum at the post-resection cavity, measuring approximately ___ × ___ × ___ cm, with surrounding T2/FLAIR hyperintensity suggestive of edema. Findings are concerning for tumor recurrence.",{mnemonic:"gr",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",favorite:true,concept:"glioma",conflictGroup:"tumor recurrence",recommendationSentence:"Urgent oncology referral. Recommend MRI brain with contrast and perfusion imaging in 6-8 weeks. Consider MR spectroscopy if clinically indicated."}), // report-formats-library.ts fmt("MRI Brain — Glioma recurrence").recommendation
  t("findings","Acute infarct (DWI)","Restricted diffusion in the {side} MCA territory on DWI/ADC, consistent with acute infarct. No hemorrhagic transformation.",{mnemonic:"ai",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"infarct",anatomicalSection:"mca",conflictGroup:"infarct",properties:"side",impressionSentence:"Acute {side} MCA territory infarct.",recommendationSentence:"Immediate stroke team notification. If within thrombolysis window, consider IV tPA. MRA head and neck recommended."}), // report-formats-library.ts fmt("MRI Brain — Acute infarct (MCA)").recommendation
  t("findings","Basal ganglia hemorrhage","Acute {side} hemorrhage.",{mnemonic:"ah",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"hemorrhage",anatomicalSection:"basal ganglia",conflictGroup:"hemorrhage",properties:"side",impressionSentence:"Acute {side} intracranial hemorrhage.",recommendationSentence:"Immediate neurosurgical consultation. ICP monitoring if indicated. Blood pressure control. Follow-up imaging in 24-48 hours."}), // report-formats-library.ts fmt("MRI Brain — Acute Hemorrhage").recommendation
  t("findings","Fazekas 1","Few punctate T2/FLAIR hyperintense white matter lesions in bilateral deep white matter, Fazekas grade 1. No confluent lesions.",{mnemonic:"f1",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"fazekas",conflictGroup:"fazekas",impressionSentence:"Mild chronic small vessel ischemic disease (Fazekas grade 1).",recommendationSentence:"Clinical correlation. Control of vascular risk factors. Follow-up as clinically indicated."}), // report-formats-library.ts fmt("MRI Brain — Fazekas 1").recommendation
  t("findings","Fazekas 2","Confluent T2/FLAIR hyperintense white matter lesions in bilateral deep white matter, Fazekas grade 2.",{mnemonic:"f2",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"fazekas",conflictGroup:"fazekas",impressionSentence:"Moderate chronic small vessel ischemic disease (Fazekas grade 2).",recommendationSentence:"Clinical correlation. Aggressive vascular risk factor management. Follow-up as clinically indicated."}), // report-formats-library.ts fmt("MRI Brain — Fazekas 2").recommendation
  t("findings","Orbital cellulitis","Preseptal and postseptal inflammatory change in the {side} orbit, consistent with orbital cellulitis.",{mnemonic:"oc",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"orbital",conflictGroup:"orbital",properties:"side",impressionSentence:"{side} orbital cellulitis."}),
  // ── MRI Brain — comprehensive findings catalogue ──────────────────────────────
  // Ischemia
  t("findings","Chronic infarct","Area of encephalomalacia with gliosis in the {side} hemisphere.",{mnemonic:"ci",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"infarct",conflictGroup:"chronic infarct",properties:"side",impressionSentence:"Chronic {side} cerebral infarct."}),
  t("findings","Lacunar infarcts","Multiple small lacunar cavities in deep white matter.",{mnemonic:"lac",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"lacunar",conflictGroup:"lacunar",impressionSentence:"Lacunes."}),
  // Hemorrhage variants
  t("findings","Subdural hematoma","{side} subdural collection with mass effect.",{mnemonic:"sdh",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"subdural_hematoma",conflictGroup:"subdural hematoma",properties:"side",impressionSentence:"{side} subdural collection."}),
  t("findings","Epidural hematoma","{side} epidural collection.",{mnemonic:"edh",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"epidural_hematoma",conflictGroup:"epidural hematoma",properties:"side",impressionSentence:"{side} epidural collection."}),
  t("findings","Subarachnoid hemorrhage","Subarachnoid blood in the basal cisterns and sulci.",{mnemonic:"sah",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"subarachnoid_hemorrhage",conflictGroup:"subarachnoid hemorrhage",impressionSentence:"Subarachnoid blood."}),
  t("findings","Microbleeds","Multiple punctate microbleeds on GRE/SWI.",{mnemonic:"mb",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"susceptibility",conflictGroup:"microbleeds",impressionSentence:"Cerebral microbleeds."}),
  // Small vessel disease
  t("findings","Fazekas 3","Confluent T2/FLAIR hyperintense white matter lesions with involvement of deep white matter, Fazekas grade 3.",{mnemonic:"f3",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"fazekas",conflictGroup:"fazekas",impressionSentence:"Severe chronic small vessel ischemic disease (Fazekas grade 3).",recommendationSentence:"Clinical correlation. Aggressive vascular risk factor management. Follow-up as clinically indicated."}), // report-formats-library.ts fmt("MRI Brain — Fazekas 3").recommendation
  // Atrophy
  t("findings","Cerebral atrophy","Generalized cerebral atrophy with prominence of sulci.",{mnemonic:"atro",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"senile_atrophy",conflictGroup:"atrophy"}),
  // Mass effect/Edema
  t("findings","Mass lesion","{side} mass lesion with surrounding edema and mass effect.",{mnemonic:"mass",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"mass_effect",conflictGroup:"mass lesion",properties:"side",impressionSentence:"{side} mass lesion."}),
  t("findings","Cerebral edema","Diffuse cerebral edema with effacement of sulci and cisterns.",{mnemonic:"edema",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"edema",conflictGroup:"edema"}),
  t("findings","Midline shift","Midline shift of ___ mm toward the {side}.",{mnemonic:"mls",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"midline",conflictGroup:"midline shift",properties:"side",impressionSentence:"Midline shift toward {side}.",baselineReplaces:"No midline shift is seen."}),
  // Vascular
  t("findings","Aneurysm","Saccular aneurysm at the {side} posterior communicating artery, measuring approximately ___ mm.",{mnemonic:"aneur",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"aneurysm",conflictGroup:"aneurysm",properties:"side",impressionSentence:"{side} posterior communicating artery aneurysm."}),
  t("findings","Cavernoma","{side} cavernous malformation with hemosiderin rim.",{mnemonic:"cav",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"cavernoma",conflictGroup:"cavernoma",properties:"side",impressionSentence:"{side} cavernoma."}),
  t("findings","AVM","{side} arteriovenous malformation with nidus measuring approximately ___ cm.",{mnemonic:"avm",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"avm",conflictGroup:"avm",properties:"side",impressionSentence:"{side} arteriovenous malformation."}),
  // Trauma
  t("findings","Contusion","{side} cerebral contusion with hemorrhagic component.",{mnemonic:"cont",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"contusion",conflictGroup:"contusion",properties:"side",impressionSentence:"{side} cerebral contusion."}),
  t("findings","Diffuse axonal injury","Multiple foci of diffuse axonal injury.",{mnemonic:"dai",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",concept:"dai",conflictGroup:"diffuse axonal injury",impressionSentence:"Diffuse axonal injury."}),
  // Infection/Inflammation
  t("findings","Demyelinating lesion","Multiple ovoid T2/FLAIR hyperintense lesions in white matter.",{mnemonic:"dem",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"demyelinating_lesion",conflictGroup:"demyelinating",impressionSentence:"Demyelinating lesions."}),
  // Epilepsy
  t("findings","Hippocampal sclerosis","{side} hippocampal volume loss with T2/FLAIR hyperintensity.",{mnemonic:"hs",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"hippocampus_pattern",conflictGroup:"hippocampal sclerosis",properties:"side",impressionSentence:"{side} hippocampal sclerosis."}),
  // Extra-axial
  t("findings","Extra-axial collection","{side} extra-axial fluid collection with mass effect.",{mnemonic:"eac",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",concept:"extra_axial",conflictGroup:"extra-axial collection",properties:"side",impressionSentence:"{side} extra-axial collection.",baselineReplaces:"No extra-axial collection is identified."}),
  t("findings","Normal LS spine","Lumbar vertebrae show normal alignment and marrow signal. No spondylolisthesis. Disc spaces maintained.",{mnemonic:"nl",scopeModality:"MR",scopeBodyPart:"LS Spine",favorite:true,concept:"spondylolisthesis",conflictGroup:"spondylolisthesis",baselineReplaces:"No spondylolisthesis."}),
  t("findings","Disc herniation L4-L5","Broad-based disc bulge at L4-L5 with posterocentral-right paracentral protrusion causing indentation on the thecal sac and mild narrowing of bilateral neural foramina. No significant central canal stenosis.",{mnemonic:"dh",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",favorite:true,concept:"disc_contour",conflictGroup:"disc bulge",impressionSentence:"Disc herniation at L4-L5 causing indentation on the thecal sac.",recommendationSentence:"Conservative management with NSAIDs and physiotherapy. MRI if radicular symptoms persist. Surgical referral if neurological deficits develop."}), // report-formats-library.ts fmt("MRI LS Spine — Disc herniation L4-L5").recommendation
  t("findings","Disc bulge L3-L4","Disc bulge at L3-L4 without nerve root compression.",{mnemonic:"db34",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"disc_contour",conflictGroup:"disc bulge"}),
  t("findings","Disc protrusion L5-S1","Posterocentral disc protrusion at L5-S1 indenting the thecal sac.",{mnemonic:"dp51",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"disc_contour",conflictGroup:"disc protrusion"}),
  t("findings","Disc desiccation L4-L5","Loss of T2 signal (desiccation) of the L4-L5 disc.",{mnemonic:"dd45",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"disc_signal",conflictGroup:"desiccation"}),
  t("findings","Reduced disc height L4-L5","Disc height is reduced at L4-L5.",{mnemonic:"dh45",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"disc_height",conflictGroup:"disc height"}),
  t("findings","Mild canal stenosis L4-L5","Mild canal stenosis at L4-L5 without cord compression.",{mnemonic:"cs1",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"canal_stenosis",conflictGroup:"canal stenosis",impressionSentence:"Mild canal stenosis at L4-L5."}),
  t("findings","Moderate canal stenosis L4-L5","Moderate canal stenosis at L4-L5.",{mnemonic:"cs2",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"canal_stenosis",conflictGroup:"canal stenosis",impressionSentence:"Moderate canal stenosis at L4-L5."}),
  t("findings","Severe canal stenosis L4-L5","Severe canal stenosis at L4-L5 with thecal sac compression.",{mnemonic:"cs3",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"critical",concept:"canal_stenosis",conflictGroup:"canal stenosis",impressionSentence:"Severe canal stenosis at L4-L5."}),
  t("findings","Grade 1 spondylolisthesis L4-L5","Grade 1 spondylolisthesis at L4-L5.",{mnemonic:"sl1",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"spondylolisthesis",conflictGroup:"spondylolisthesis",recommendationSentence:"Clinical correlation. Conservative management. Surgical referral if neurological deficits develop."}), // report-formats-library.ts fmt("MRI LS Spine — Spondylolisthesis (Grade I)").recommendation
  t("findings","Grade 2 spondylolisthesis L4-L5","Grade 2 spondylolisthesis at L4-L5.",{mnemonic:"sl2",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"spondylolisthesis",conflictGroup:"spondylolisthesis"}),
  t("findings","Modic type 1 L4-L5","Modic type 1 endplate changes at L4-L5.",{mnemonic:"m1",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"endplate",conflictGroup:"endplate"}),
  t("findings","Modic type 2 L4-L5","Modic type 2 endplate changes at L4-L5.",{mnemonic:"m2",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"endplate",conflictGroup:"endplate"}),
  t("findings","Facet arthropathy L4-L5","Facet arthropathy at L4-L5.",{mnemonic:"fa45",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"facet_joint",conflictGroup:"facet"}),
  t("findings","Compression fracture L1","Acute compression fracture at L1 vertebral body with marrow edema on T2/STIR. Posterior wall intact.",{mnemonic:"cf",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"critical",concept:"compression_fracture",conflictGroup:"compression fracture",recommendationSentence:"Clinical correlation. Orthopaedic/neurosurgical consultation. Vertebroplasty/kyphoplasty if indicated."}), // report-formats-library.ts fmt("MRI LS Spine — Compression Fracture").recommendation
  // ── High-value additions cross-referenced from DrAbinash/mri-reports ──
  // These clinically distinct concepts coexist at the same level and must
  // NOT be collapsed into generic "degenerative changes" (PR crosswalk §12).
  t("findings","LF hypertrophy L4-L5","Ligamentum flavum hypertrophy at L4-L5.",{mnemonic:"lf45",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"ligamentum_flavum",conflictGroup:"ligamentum_flavum"}),
  t("findings","Foraminal stenosis L4-L5","{severity} {side} neural foraminal stenosis at L4-L5.",{mnemonic:"fs45",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"foraminal_stenosis",conflictGroup:"foraminal_stenosis",properties:"side"}),
  t("findings","Schmorl node L1","Schmorl node at L1 vertebral endplate.",{mnemonic:"sn1",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"schmorl",conflictGroup:"schmorl"}),
  t("findings","Vertebral hemangioma L1","Vertebral hemangioma at L1 — typical T1/T2 hyperintense signal.",{mnemonic:"vh1",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"normal",concept:"hemangioma",conflictGroup:"hemangioma"}),
  t("findings","Loss of cervical lordosis","Evidence of loss of cervical lordosis — alignment alteration, ? due to spasm.",{mnemonic:"lcl",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"alignment",conflictGroup:"alignment",recommendationSentence:"Clinical correlation. Conservative management with NSAIDs and physiotherapy."}), // report-formats-library.ts fmt("MRI Cervical Spine — Loss of Lordosis").recommendation
  // ── MRI Cervical Spine — findings catalogue ──────────────────────────────
  // The cervical strip had one findings box against the lumbar's twenty, so the
  // radiologist typed the rest and the report's own normals were left standing
  // under what they had typed.
  //
  // One concept per box, stated once, and no box names a level it does not
  // describe. The overlay retires the baseline sentence that shares a box's
  // concept and level, plus one sentence named in `baselineReplaces` — so a box
  // that also mentions a second concept leaves that concept's normal on the page
  // (this is exactly the defect the L4-L5 herniation box carries today, and
  // `cervicalQuickSelectCatalogue.test.ts` ratchets it). The advice a box writes
  // into Recommendation is copied verbatim from a shipped Report Format of the
  // same examination — one of three cervical formats, or nothing at all. The
  // Findings/Impression wording itself is new: proposed clinical content for
  // radiologist review, not a citation.
  t("findings","Cervical kyphosis","Fixed sagittal cervical kyphosis is present.",{mnemonic:"ckyp",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"alignment",conflictGroup:"kyphosis"}),
  t("findings","Atlanto-axial instability","Atlanto-axial instability with a widened atlanto-dental interval on flexion.",{mnemonic:"cai",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"critical",concept:"atlanto_axial_instability",conflictGroup:"atlanto_axial_instability",impressionSentence:"Atlanto-axial instability."}),
  t("findings","Compression fracture C5","Acute compression fracture of the C5 vertebral body with marrow oedema on STIR and preserved posterior cortex.",{mnemonic:"ccf5",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"critical",concept:"compression_fracture",conflictGroup:"compression_fracture",impressionSentence:"Acute C5 compression fracture."}),
  t("findings","Burst fracture C5","Burst fracture of the C5 vertebral body with loss of posterior vertebral body height.",{mnemonic:"cbf5",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"critical",concept:"burst_fracture",conflictGroup:"burst_fracture",baselineReplaces:"Cervical vertebral bodies demonstrate normal height and marrow signal.",impressionSentence:"C5 burst fracture."}),
  t("findings","Posterior element fracture C6","Fracture through the posterior elements of C6 — lamina and lateral mass.",{mnemonic:"cpf6",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"critical",concept:"posterior_element_fracture",conflictGroup:"posterior_element_fracture",impressionSentence:"C6 posterior element fracture."}),
  t("findings","Mid-cervical spondylolisthesis","Grade 1 spondylolisthesis at the mid-cervical level.",{mnemonic:"clis",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"spondylolisthesis",conflictGroup:"spondylolisthesis",impressionSentence:"Mid-cervical spondylolisthesis, grade 1."}),
  t("findings","Multiple cervical osseous lesions","Multiple osseous lesions with heterogeneous marrow signal throughout the cervical vertebral bodies.",{mnemonic:"cml",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"multiple_osseous_lesions",conflictGroup:"multiple osseous lesions",impressionSentence:"Multiple cervical osseous lesions."}),
  t("findings","Lytic lesion C2","Focal lytic lesion of the C2 vertebral body without cortical breach.",{mnemonic:"cly2",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"focal_lytic_lesion",conflictGroup:"focal_lytic_lesion",baselineReplaces:"Cervical vertebral bodies demonstrate normal height and marrow signal.",impressionSentence:"Lytic lesion at C2."}),
  t("findings","Disc bulge C4-C5","Diffuse disc bulge at C4-C5.",{mnemonic:"cbd45",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"disc_contour",conflictGroup:"disc bulge",impressionSentence:"Disc bulge at C4-C5.",recommendationSentence:"Clinical correlation. Conservative management with physiotherapy. Follow-up if symptoms persist."}), // report-formats-library.ts fmt("MRI Cervical Spine — Degenerative (Disc Bulge)").recommendation
  t("findings","Disc bulge C5-C6","Diffuse disc bulge at C5-C6.",{mnemonic:"cbd56",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",favorite:true,concept:"disc_contour",conflictGroup:"disc bulge",impressionSentence:"Disc bulge at C5-C6.",recommendationSentence:"Clinical correlation. Conservative management with physiotherapy. Follow-up if symptoms persist."}), // report-formats-library.ts fmt("MRI Cervical Spine — Degenerative (Disc Bulge)").recommendation
  t("findings","Disc bulge C6-C7","Diffuse disc bulge at C6-C7.",{mnemonic:"cbd67",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"disc_contour",conflictGroup:"disc bulge",impressionSentence:"Disc bulge at C6-C7.",recommendationSentence:"Clinical correlation. Conservative management with physiotherapy. Follow-up if symptoms persist."}), // report-formats-library.ts fmt("MRI Cervical Spine — Degenerative (Disc Bulge)").recommendation
  t("findings","Disc herniation C5-C6","Central disc herniation at C5-C6.",{mnemonic:"chn56",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",favorite:true,concept:"disc_contour",conflictGroup:"disc herniation",impressionSentence:"Disc herniation at C5-C6.",recommendationSentence:"Clinical correlation. Conservative management with physiotherapy. Follow-up if symptoms persist."}), // report-formats-library.ts fmt("MRI Cervical Spine — Degenerative (Disc Bulge)").recommendation
  t("findings","Disc herniation C6-C7","Paracentral disc herniation at C6-C7.",{mnemonic:"chn67",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"disc_contour",conflictGroup:"disc herniation",impressionSentence:"Disc herniation at C6-C7.",recommendationSentence:"Clinical correlation. Conservative management with physiotherapy. Follow-up if symptoms persist."}), // report-formats-library.ts fmt("MRI Cervical Spine — Degenerative (Disc Bulge)").recommendation
  t("findings","Disc extrusion C5-C6","Disc extrusion at C5-C6.",{mnemonic:"cex56",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"disc_contour",conflictGroup:"disc extrusion",impressionSentence:"Disc extrusion at C5-C6.",recommendationSentence:"Clinical correlation. Conservative management with physiotherapy. Follow-up if symptoms persist."}), // report-formats-library.ts fmt("MRI Cervical Spine — Degenerative (Disc Bulge)").recommendation
  t("findings","Disc desiccation C5-C6","Loss of T2 signal (desiccation) of the C5-C6 disc.",{mnemonic:"cds56",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"disc_signal",conflictGroup:"disc_signal"}),
  t("findings","Disc desiccation C6-C7","Loss of T2 signal (desiccation) of the C6-C7 disc.",{mnemonic:"cds67",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"disc_signal",conflictGroup:"disc_signal"}),
  t("findings","Reduced disc height C5-C6","Disc height is reduced at C5-C6.",{mnemonic:"chd56",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"disc_height",conflictGroup:"disc_height"}),
  t("findings","Modic change C5-C6","Modic type 1 endplate change at C5-C6.",{mnemonic:"cmc56",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"endplate",conflictGroup:"endplate"}),
  t("findings","Uncovertebral hypertrophy C5-C6","Uncovertebral joint hypertrophy at C5-C6.",{mnemonic:"cuh56",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"uncovertebral_arthropathy",conflictGroup:"uncovertebral_hypertrophy"}),
  t("findings","Mild canal stenosis C5-C6","Mild central canal stenosis at C5-C6.",{mnemonic:"ccs1",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"canal_stenosis",conflictGroup:"canal_stenosis",impressionSentence:"Mild canal stenosis at C5-C6."}),
  t("findings","Moderate canal stenosis C5-C6","Moderate central canal stenosis at C5-C6.",{mnemonic:"ccs2",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"canal_stenosis",conflictGroup:"canal_stenosis",impressionSentence:"Moderate canal stenosis at C5-C6."}),
  t("findings","Severe canal stenosis C5-C6","Severe central canal stenosis at C5-C6.",{mnemonic:"ccs3",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"critical",concept:"canal_stenosis",conflictGroup:"canal_stenosis",impressionSentence:"Severe canal stenosis at C5-C6."}),
  t("findings","Moderate canal stenosis C4-C5","Moderate central canal stenosis at C4-C5.",{mnemonic:"ccs4",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"canal_stenosis",conflictGroup:"canal_stenosis",impressionSentence:"Moderate canal stenosis at C4-C5."}),
  t("findings","OPLL C5-C6","Thick ossification of the posterior longitudinal ligament at C5-C6.",{mnemonic:"copll",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"ossification_posterior_longitudinal",conflictGroup:"ossification_posterior_longitudinal",impressionSentence:"Ossification of the posterior longitudinal ligament at C5-C6."}),
  t("findings","Foraminal stenosis C5-C6","{side} neural foraminal stenosis at C5-C6.",{mnemonic:"cfs56",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"foraminal_stenosis",conflictGroup:"foraminal_stenosis",properties:"side",impressionSentence:"{side} foraminal stenosis at C5-C6."}),
  t("findings","Foraminal stenosis C6-C7","Bilateral neural foraminal stenosis at C6-C7.",{mnemonic:"cfs67",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"foraminal_stenosis",conflictGroup:"foraminal_stenosis",impressionSentence:"Bilateral foraminal stenosis at C6-C7."}),
  t("findings","Nerve root compression C6","The {side} C6 nerve root shows compression by the disc-osteophyte complex.",{mnemonic:"crn6",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"root_contact",conflictGroup:"nerve_root_compression",properties:"side",impressionSentence:"{side} C6 nerve root compression."}),
  t("findings","Cord signal change","T2 hyperintense signal within the cervical cord, suggestive of myelomalacia.",{mnemonic:"ccsg",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"critical",favorite:true,concept:"cord_signal",conflictGroup:"cord_signal",impressionSentence:"Cervical cord signal change — consistent with compressive myelopathy.",recommendationSentence:"Urgent neurosurgical consultation. Clinical correlation for neurological deficits."}), // report-formats-library.ts fmt("MRI Cervical Spine — Cord Signal Change (Myelopathy)").recommendation
  t("findings","Cord compression C5-C6","Cervical cord compression at C5-C6 with effacement of the posterior subarachnoid space.",{mnemonic:"ccmp",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"critical",concept:"cord_compression",conflictGroup:"cord_compression",baselineReplaces:"C5-C6: No spinal canal or thecal sac compression is seen.",impressionSentence:"Cervical cord compression at C5-C6.",recommendationSentence:"Urgent neurosurgical consultation. Clinical correlation for neurological deficits."}), // report-formats-library.ts fmt("MRI Cervical Spine — Cord Signal Change (Myelopathy)").recommendation
  t("findings","Cervical syrinx","Focal syrinx — central cavitory fluid signal within the cervical cord.",{mnemonic:"csyr",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"syrinx",conflictGroup:"syrinx",baselineReplaces:"Cervical spinal cord signal intensity is normal.",impressionSentence:"Cervical cord syrinx."}),
  t("findings","Intramedullary cord lesion","An expansile intramedullary cervical cord lesion with surrounding oedema.",{mnemonic:"ciml",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"intramedullary_lesion",conflictGroup:"intramedullary_lesion",baselineReplaces:"Cervical spinal cord signal intensity is normal.",impressionSentence:"Cervical intramedullary lesion."}),
  t("findings","Intradural extramedullary lesion","An enhancing intradural extramedullary cervical lesion with a dural tail.",{mnemonic:"cidl",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"intradural_lesion",conflictGroup:"intradural_lesion",impressionSentence:"Cervical intradural extramedullary lesion."}),
  t("findings","Cervical epidural collection","A posterior cervical epidural collection.",{mnemonic:"cepi",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"critical",concept:"epidural_collection",conflictGroup:"epidural_collection",impressionSentence:"Cervical epidural collection."}),
  t("findings","Facet arthropathy","Advanced cervical facet joint arthropathy with joint fluid.",{mnemonic:"cfa",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"facet_joint",conflictGroup:"facet_joint"}),
  t("findings","Ligamentum flavum hypertrophy","Hypertrophy of the cervical ligamentum flavum.",{mnemonic:"clf",scopeModality:"MR",scopeBodyPart:"Cervical Spine",category:"abnormal",concept:"ligamentum_flavum",conflictGroup:"ligamentum_flavum"}),
  t("findings","Disc desiccation L5-S1","Loss of T2 signal (desiccation) of the L5-S1 disc.",{mnemonic:"dd51",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",concept:"disc_signal",conflictGroup:"disc_signal"}),
  t("findings","Normal CT brain","Brain parenchyma shows normal attenuation. No evidence of acute hemorrhage or mass lesion.",{mnemonic:"nb",scopeModality:"CT",scopeBodyPart:"Brain",favorite:true,concept:"hemorrhage",conflictGroup:"hemorrhage",baselineReplaces:"No evidence of acute hemorrhage or mass lesion."}),
  t("findings","Acute infarct (CT)","Loss of grey-white differentiation in the left MCA territory, consistent with acute infarct. Hyperdense MCA sign.",{mnemonic:"ai",scopeModality:"CT",scopeBodyPart:"Brain",category:"critical",favorite:true,concept:"infarct",conflictGroup:"infarct"}),
  t("findings","Acute ICH","Acute intraparenchymal hemorrhage in the right basal ganglia measuring ___ × ___ cm. Intraventricular extension. Mass effect with midline shift of ___ mm.",{mnemonic:"ih",scopeModality:"CT",scopeBodyPart:"Brain",category:"critical",concept:"hemorrhage",conflictGroup:"hemorrhage"}),
  t("findings","SDH","Acute subdural hematoma over the right convexity, maximum thickness ___ mm. Mass effect with midline shift of ___ mm to the left.",{mnemonic:"sd",scopeModality:"CT",scopeBodyPart:"Brain",category:"critical",concept:"subdural_hematoma",conflictGroup:"subdural hematoma",recommendationSentence:"Neurosurgical consultation. Serial imaging to monitor for expansion. Clinical correlation for signs of elevated ICP."}), // report-formats-library.ts fmt("MRI Brain — Subdural Hematoma (SDH)").recommendation
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
