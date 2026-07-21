import { Router } from "express";
import { db } from "@workspace/db";
import { structuredReportTemplatesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import { USG_STRUCTURED_TEMPLATE_PRESETS } from "../lib/usgReportTemplates";

export const structuredReportTemplatesRouter = Router();

// ─── Preset templates ─────────────────────────────────────────────────────────
const PRESETS = [
  {
    templateName: "MRI Brain Plain",
    modality: "MRI",
    bodyPart: "BRAIN",
    studyType: "PLAIN",
    sectionsJson: JSON.stringify({
      technique: "MRI Brain was performed on a high-field scanner using standard brain protocol including T1W sagittal, T2W axial, FLAIR axial, DWI with ADC mapping, and T2* / SWI sequences.",
      findingsItems: [
        { label: "Brain Parenchyma", normal: "Normal in size, signal and morphology. No focal signal abnormality." },
        { label: "White Matter", normal: "No abnormal T2/FLAIR hyperintense signal change. No periventricular or subcortical white matter lesions." },
        { label: "Ventricles & CSF Spaces", normal: "Ventricles are normal in size and configuration. Sylvian fissures and sulci are appropriate for age. No hydrocephalus." },
        { label: "Basal Ganglia & Thalami", normal: "Normal in size, signal and morphology bilaterally." },
        { label: "Brainstem", normal: "Normal in size and signal. No focal lesion." },
        { label: "Cerebellum", normal: "Normal in size and signal. No tonsillar herniation." },
        { label: "Extra-Axial Spaces", normal: "No extra-axial collection. No subdural or epidural collection." },
        { label: "Diffusion (DWI/ADC)", normal: "No restricted diffusion to suggest acute infarct." },
        { label: "Vascular Structures", normal: "Flow voids are seen in major intracranial arteries." },
        { label: "Skull & Calvarium", normal: "Intact. No osseous lesion." },
      ],
    }),
    defaultFindings: "Brain parenchyma is normal in size, signal and morphology. No focal intraparenchymal signal abnormality. Ventricles are normal in caliber. No periventricular white matter signal change. No restricted diffusion. Posterior fossa structures are normal. Extra-axial spaces are normal. No midline shift.",
    defaultImpression: "Normal MRI Brain study. No significant intracranial abnormality detected.",
    macrosJson: JSON.stringify([
      { key: "acute_infarct", label: "Acute Infarct", text: "Area of restricted diffusion (DWI hyperintense, ADC hypointense) noted in the [LOCATION] territory, consistent with acute cerebral infarct." },
      { key: "white_matter_lesions", label: "White Matter Lesions", text: "Multiple T2/FLAIR hyperintense white matter lesions noted in the periventricular and subcortical regions. Differential includes small vessel ischaemic change vs. demyelination." },
      { key: "midline_shift", label: "Midline Shift", text: "Midline shift of approximately [X] mm to the [SIDE] noted." },
      { key: "no_midline_shift", label: "No Midline Shift", text: "No midline shift or mass effect. Basal cisterns are patent." },
    ]),
    isPreset: true,
  },
  {
    templateName: "MRI Brain With Contrast",
    modality: "MRI",
    bodyPart: "BRAIN",
    studyType: "CONTRAST",
    sectionsJson: JSON.stringify({
      technique: "MRI Brain was performed with IV gadolinium contrast enhancement. Pre- and post-contrast T1W images obtained.",
      findingsItems: [
        { label: "Pre-Contrast Findings", normal: "Brain parenchyma normal in signal and morphology." },
        { label: "Post-Contrast Enhancement", normal: "No abnormal parenchymal, meningeal or leptomeningeal enhancement." },
        { label: "Ventricles & Sulci", normal: "Normal in size and configuration." },
        { label: "Extra-Axial Spaces", normal: "No enhancing extra-axial collection or mass." },
      ],
    }),
    defaultFindings: "Brain parenchyma shows no abnormal signal on pre-contrast sequences. Following gadolinium administration, no abnormal parenchymal, leptomeningeal or pachymeningeal enhancement is demonstrated. Ventricles are normal. No mass effect or midline shift.",
    defaultImpression: "Normal contrast-enhanced MRI Brain. No evidence of abnormal blood-brain barrier breakdown.",
    macrosJson: JSON.stringify([
      { key: "ring_enhancing", label: "Ring-Enhancing Lesion", text: "Ring-enhancing lesion with central necrosis noted in the [LOCATION], measuring approximately [SIZE] cm. Surrounding vasogenic oedema present. Differential includes glioblastoma multiforme, brain abscess or metastasis." },
      { key: "meningeal_enhancement", label: "Meningeal Enhancement", text: "Diffuse pachymeningeal/leptomeningeal enhancement noted. Correlation with CSF analysis and clinical history advised." },
    ]),
    isPreset: true,
  },
  {
    templateName: "MRI Stroke Protocol",
    modality: "MRI",
    bodyPart: "BRAIN",
    studyType: "STROKE_PROTOCOL",
    sectionsJson: JSON.stringify({
      technique: "MRI Brain Stroke Protocol: DWI, ADC, FLAIR, T2*, SWI, and MRA (TOF) of brain and neck vessels.",
      findingsItems: [
        { label: "DWI / ADC", normal: "No restricted diffusion. No acute infarct demonstrated." },
        { label: "FLAIR", normal: "No FLAIR signal change to suggest subacute infarct or haemorrhage. No leukoaraiosis." },
        { label: "T2* / SWI", normal: "No haemorrhagic transformation. No microbleeds." },
        { label: "MRA Brain", normal: "Patent anterior and posterior circulations. No significant stenosis or occlusion." },
        { label: "MRA Neck Vessels", normal: "No significant stenosis of carotid or vertebral arteries." },
      ],
    }),
    defaultFindings: "DWI shows no restricted diffusion. ADC map normal. No FLAIR hyperintensity to suggest established infarct. No haemorrhagic transformation on SWI. Intracranial MRA demonstrates patent circle of Willis without significant stenosis or aneurysm.",
    defaultImpression: "No acute infarct on MRI Stroke Protocol. No haemorrhage. No significant intracranial or extracranial vessel disease.",
    macrosJson: JSON.stringify([
      { key: "acute_mca_infarct", label: "Acute MCA Infarct", text: "Acute DWI restriction with ADC hypointensity in the [RIGHT/LEFT] MCA territory. ASPECTS score estimated at [SCORE]/10. No haemorrhagic transformation on SWI. MRA demonstrates [occlusion/stenosis] at the [M1/M2/ICA]." },
      { key: "tia_negative", label: "TIA — Negative DWI", text: "No restricted diffusion identified. Clinical TIA remains possible without MRI correlate." },
    ]),
    isPreset: true,
  },
  {
    templateName: "MRI LS Spine",
    modality: "MRI",
    bodyPart: "SPINE_LS",
    studyType: "PLAIN",
    sectionsJson: JSON.stringify({
      technique: "MRI Lumbo-sacral Spine: T1W and T2W sagittal, T2W axial at disc levels.",
      findingsItems: [
        { label: "Alignment & Curvature", normal: "Normal lumbar lordosis maintained. No scoliosis." },
        { label: "L1-L2", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent. No spinal canal stenosis." },
        { label: "L2-L3", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent." },
        { label: "L3-L4", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent." },
        { label: "L4-L5", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent." },
        { label: "L5-S1", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent." },
        { label: "Vertebral Bodies", normal: "Normal height, signal and morphology throughout. No marrow infiltration or compression fracture." },
        { label: "Cord / Cauda Equina", normal: "Cord terminates at L1-L2 level. Normal signal. Cauda equina nerve roots appear normal." },
      ],
    }),
    defaultFindings: "Lumbar lordosis is preserved. Vertebral body heights and marrow signal are maintained throughout. Disc heights and signal intensity are preserved at all levels. No disc herniation, bulge or extrusion. Neural foramina are patent bilaterally at all levels. Spinal canal of adequate dimensions. Cauda equina nerve roots appear normal.",
    defaultImpression: "Normal MRI Lumbo-sacral Spine. No disc herniation, nerve root compression or spinal canal stenosis.",
    macrosJson: JSON.stringify([
      { key: "disc_prolapse", label: "Disc Prolapse/HNP", text: "Posterior disc prolapse/herniation at [LEVEL] causing [mild/moderate/severe] [central/paracentral/foraminal] canal stenosis with [RIGHT/LEFT/bilateral] nerve root compression." },
      { key: "canal_stenosis", label: "Spinal Canal Stenosis", text: "Moderate to severe spinal canal stenosis at [LEVEL] due to disc bulge, ligamentum flavum hypertrophy and facet joint arthropathy." },
      { key: "listhesis", label: "Spondylolisthesis", text: "[Grade I/II/III] spondylolisthesis of [LEVEL] over [LEVEL+1], associated with [bilateral pars defects/degenerative facet disease]." },
    ]),
    isPreset: true,
  },
  {
    templateName: "MRI Cervical Spine",
    modality: "MRI",
    bodyPart: "SPINE_CERVICAL",
    studyType: "PLAIN",
    sectionsJson: JSON.stringify({
      technique: "MRI Cervical Spine: T1W and T2W sagittal, T2W axial at disc levels.",
      findingsItems: [
        { label: "Alignment & Curvature", normal: "Normal cervical lordosis. No subluxation." },
        { label: "C2-C3 to C6-C7", normal: "Normal disc heights and signal. No herniation. Neural foramina patent. No cord compression." },
        { label: "Vertebral Bodies", normal: "Normal height and marrow signal. No fracture or infiltration." },
        { label: "Spinal Cord", normal: "Normal calibre and signal throughout. No myelopathic signal." },
      ],
    }),
    defaultFindings: "Cervical lordosis maintained. Vertebral body heights and marrow signal normal. Disc heights and T2 signal preserved. No disc herniation or significant spondylotic change. Neural foramina patent bilaterally. Spinal cord normal in calibre and signal. No myelopathic signal change.",
    defaultImpression: "Normal MRI Cervical Spine. No cord compression or significant spondylosis.",
    macrosJson: JSON.stringify([
      { key: "myelopathy", label: "Cervical Myelopathy", text: "T2 hyperintense signal within the spinal cord at [LEVEL], consistent with myelopathic change secondary to [canal stenosis/disc herniation]." },
      { key: "cervical_spondylosis", label: "Cervical Spondylosis", text: "Multilevel cervical spondylosis with disc-osteophyte complexes at [LEVELS], causing [mild/moderate/severe] canal stenosis." },
    ]),
    isPreset: true,
  },
  {
    templateName: "MRI Dorsal Spine",
    modality: "MRI",
    bodyPart: "SPINE_DORSAL",
    studyType: "PLAIN",
    sectionsJson: JSON.stringify({
      technique: "MRI Dorsal (Thoracic) Spine: T1W and T2W sagittal, axial at selected levels.",
      findingsItems: [
        { label: "Alignment", normal: "Normal dorsal kyphosis. No scoliosis." },
        { label: "Vertebral Bodies", normal: "Normal height, signal and morphology. No compression fracture or infiltration." },
        { label: "Discs", normal: "Preserved disc heights and signal at all levels. No herniation." },
        { label: "Spinal Cord", normal: "Normal calibre and signal throughout." },
      ],
    }),
    defaultFindings: "Normal dorsal kyphosis. Vertebral body heights and marrow signal are maintained. Disc heights and signal preserved. No disc herniation. Spinal cord normal in calibre and signal. No epidural collection or mass.",
    defaultImpression: "Normal MRI Dorsal Spine. No focal pathology identified.",
    macrosJson: JSON.stringify([
      { key: "compression_fracture", label: "Compression Fracture", text: "Wedge compression fracture of [VERTEBRAL LEVEL] with [X]% loss of height. [Acute / Subacute / Chronic] based on signal characteristics." },
    ]),
    isPreset: true,
  },
  {
    templateName: "MRI LS Spine with Whole Spine Screening",
    modality: "MRI",
    bodyPart: "SPINE_LS",
    studyType: "SCREENING_WHOLE_SPINE",
    sectionsJson: JSON.stringify({
      technique: "MRI Lumbo-sacral Spine with whole spine screening: T1W and T2W sagittal of the lumbosacral spine with axial T2W at the disc levels, together with sagittal T1W/T2W screening sequences of the cervical and dorsal spine.",
      findingsItems: [
        { label: "Alignment & Curvature", normal: "Normal lumbar lordosis maintained. No scoliosis or listhesis." },
        { label: "L1-L2", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent. No spinal canal stenosis." },
        { label: "L2-L3", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent." },
        { label: "L3-L4", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent." },
        { label: "L4-L5", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent." },
        { label: "L5-S1", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent." },
        { label: "Lumbar Vertebral Bodies", normal: "Normal height, signal and morphology. No marrow infiltration or compression fracture." },
        { label: "Conus & Cauda Equina", normal: "Conus medullaris terminates at the L1-L2 level with normal signal. Cauda equina nerve roots appear normal." },
        { label: "Screening — Craniovertebral Junction", normal: "Normal. No Chiari malformation or abnormal signal." },
        { label: "Screening — Cervical Spine", normal: "Normal alignment and vertebral marrow signal. No significant disc herniation or cord compression on screening sagittals." },
        { label: "Screening — Dorsal Spine", normal: "Normal alignment and vertebral marrow signal. No significant disc herniation or cord compression on screening sagittals." },
        { label: "Screening — Cord Signal", normal: "Spinal cord shows normal calibre and signal from the cervicomedullary junction to the conus. No syrinx, demyelination or intramedullary lesion." },
        { label: "Screening — Sacrum & SI Joints", normal: "No focal sacral marrow lesion. Sacroiliac joints are unremarkable." },
        { label: "Paraspinal Soft Tissues", normal: "Unremarkable." },
      ],
    }),
    defaultFindings: "Lumbar lordosis is preserved. Vertebral body heights and marrow signal are maintained. Disc heights and signal are preserved at all lumbosacral levels with no herniation or canal stenosis. Neural foramina are patent bilaterally. Conus and cauda equina are normal. Whole spine screening sagittals of the cervical and dorsal spine show normal alignment, marrow signal and cord signal, with no significant disc herniation or cord compression.",
    defaultImpression: "Normal MRI Lumbo-sacral Spine. Whole spine screening is unremarkable — no cord compression, significant disc herniation or marrow abnormality.",
    macrosJson: JSON.stringify([
      { key: "disc_prolapse", label: "Disc Prolapse/HNP", text: "Posterior disc prolapse/herniation at [LEVEL] causing [mild/moderate/severe] [central/paracentral/foraminal] canal stenosis with [RIGHT/LEFT/bilateral] nerve root compression." },
      { key: "canal_stenosis", label: "Spinal Canal Stenosis", text: "Moderate to severe spinal canal stenosis at [LEVEL] due to disc bulge, ligamentum flavum hypertrophy and facet joint arthropathy." },
      { key: "listhesis", label: "Spondylolisthesis", text: "[Grade I/II/III] spondylolisthesis of [LEVEL] over [LEVEL+1], associated with [bilateral pars defects/degenerative facet disease]." },
      { key: "screening_lesion", label: "Screening — Focal Lesion", text: "Screening sagittals reveal a focal [signal abnormality/marrow lesion/disc herniation] at the [LEVEL] of the [cervical/dorsal] spine. Dedicated regional imaging of this segment is advised for further characterisation." },
    ]),
    isPreset: true,
  },
  {
    templateName: "MRI Cervical Spine with Whole Spine Screening",
    modality: "MRI",
    bodyPart: "SPINE_CERVICAL",
    studyType: "SCREENING_WHOLE_SPINE",
    sectionsJson: JSON.stringify({
      technique: "MRI Cervical Spine with whole spine screening: T1W and T2W sagittal of the cervical spine with axial T2W at the disc levels, together with sagittal T1W/T2W screening sequences of the dorsal and lumbosacral spine.",
      findingsItems: [
        { label: "Alignment & Curvature", normal: "Normal cervical lordosis. No subluxation or listhesis." },
        { label: "C2-C3", normal: "Normal disc height and signal. No herniation. Neural foramina patent. No cord compression." },
        { label: "C3-C4", normal: "Normal disc height and signal. No herniation. Neural foramina patent." },
        { label: "C4-C5", normal: "Normal disc height and signal. No herniation. Neural foramina patent." },
        { label: "C5-C6", normal: "Normal disc height and signal. No herniation. Neural foramina patent." },
        { label: "C6-C7", normal: "Normal disc height and signal. No herniation. Neural foramina patent." },
        { label: "C7-D1", normal: "Normal disc height and signal. No herniation. Neural foramina patent." },
        { label: "Cervical Vertebral Bodies", normal: "Normal height and marrow signal. No fracture or infiltration." },
        { label: "Craniovertebral Junction", normal: "Normal. No Chiari malformation or abnormal signal." },
        { label: "Cervical Cord", normal: "Normal calibre and signal. No myelopathic signal change." },
        { label: "Screening — Dorsal Spine", normal: "Normal alignment and vertebral marrow signal. No significant disc herniation or cord compression on screening sagittals." },
        { label: "Screening — Lumbosacral Spine", normal: "Normal alignment and vertebral marrow signal. No significant disc herniation. Conus and cauda equina normal on screening sagittals." },
        { label: "Screening — Cord Signal", normal: "Spinal cord shows normal calibre and signal throughout its screened length. No syrinx, demyelination or intramedullary lesion." },
        { label: "Screening — Sacrum", normal: "No focal sacral marrow lesion." },
        { label: "Paraspinal Soft Tissues", normal: "Unremarkable." },
      ],
    }),
    defaultFindings: "Cervical lordosis is maintained. Vertebral body heights and marrow signal are normal. Disc heights and T2 signal are preserved with no herniation or significant spondylotic change. Neural foramina are patent bilaterally. Cervical cord is normal in calibre and signal. Whole spine screening sagittals of the dorsal and lumbosacral spine show normal alignment, marrow signal and cord signal, with no significant disc herniation or cord compression.",
    defaultImpression: "Normal MRI Cervical Spine. Whole spine screening is unremarkable — no cord compression, significant disc herniation or marrow abnormality.",
    macrosJson: JSON.stringify([
      { key: "myelopathy", label: "Cervical Myelopathy", text: "T2 hyperintense signal within the spinal cord at [LEVEL], consistent with myelopathic change secondary to [canal stenosis/disc herniation]." },
      { key: "cervical_spondylosis", label: "Cervical Spondylosis", text: "Multilevel cervical spondylosis with disc-osteophyte complexes at [LEVELS], causing [mild/moderate/severe] canal stenosis." },
      { key: "screening_lesion", label: "Screening — Focal Lesion", text: "Screening sagittals reveal a focal [signal abnormality/marrow lesion/disc herniation] at the [LEVEL] of the [dorsal/lumbosacral] spine. Dedicated regional imaging of this segment is advised for further characterisation." },
    ]),
    isPreset: true,
  },
  {
    templateName: "CT Brain",
    modality: "CT",
    bodyPart: "BRAIN",
    studyType: "PLAIN",
    sectionsJson: JSON.stringify({
      technique: "NCCT Brain: 5 mm axial sections from base to vertex, with bone and soft tissue windows.",
      findingsItems: [
        { label: "Grey-White Differentiation", normal: "Maintained." },
        { label: "Parenchyma", normal: "No focal hypo- or hyperdensity. No haemorrhage or infarct." },
        { label: "Ventricles", normal: "Normal in size and configuration." },
        { label: "Sulci & Cisterns", normal: "Appropriate for age. Basal cisterns patent." },
        { label: "Midline", normal: "No shift." },
        { label: "Bone Windows", normal: "No fracture or destructive lesion." },
      ],
    }),
    defaultFindings: "No focal intraparenchymal hypo/hyperdensity. Grey-white differentiation maintained. Ventricles normal. Sulci and basal cisterns patent. No midline shift. No haemorrhage or herniation. Calvarium and skull base intact.",
    defaultImpression: "Normal CT Brain. No acute intracranial pathology.",
    macrosJson: JSON.stringify([
      { key: "ich", label: "Intracerebral Haematoma", text: "Hyperdense collection consistent with intracerebral haematoma in the [LOCATION], measuring [DIMENSIONS]. Surrounding vasogenic oedema. [Midline shift of X mm / No midline shift]." },
      { key: "acute_sah", label: "Subarachnoid Haemorrhage", text: "Hyperdensity within the basal cisterns and Sylvian fissures bilaterally, consistent with subarachnoid haemorrhage." },
      { key: "early_ischaemia", label: "Early Ischaemia", text: "Subtle loss of grey-white differentiation and cortical ribbon sign in the [LOCATION] territory, raising concern for early ischaemic change. MRI DWI advised." },
    ]),
    isPreset: true,
  },
  {
    templateName: "CT Trauma Brain",
    modality: "CT",
    bodyPart: "BRAIN",
    studyType: "TRAUMA",
    sectionsJson: JSON.stringify({
      technique: "NCCT Brain (Trauma protocol): Axial sections with bone and soft tissue reconstruction.",
      findingsItems: [
        { label: "Scalp & Soft Tissues", normal: "No scalp haematoma or laceration." },
        { label: "Skull & Calvarium", normal: "No fracture." },
        { label: "Epidural Space", normal: "No epidural haematoma." },
        { label: "Subdural Space", normal: "No subdural collection." },
        { label: "Subarachnoid Space", normal: "No traumatic SAH." },
        { label: "Brain Parenchyma", normal: "No contusion or haemorrhagic injury." },
        { label: "Ventricles", normal: "Normal. No blood in ventricles." },
        { label: "Midline", normal: "No shift." },
        { label: "Skull Base & Facial Bones", normal: "No fracture of skull base or facial bones." },
      ],
    }),
    defaultFindings: "No scalp haematoma. No skull fracture. No epidural or subdural haematoma. No subarachnoid haemorrhage. No brain contusion or intraparenchymal injury. Ventricles normal. No midline shift.",
    defaultImpression: "Normal CT Brain — no acute traumatic intracranial injury.",
    macrosJson: JSON.stringify([
      { key: "acute_sdh", label: "Acute Subdural Haematoma", text: "Crescentic hyperdense extra-axial collection along the [RIGHT/LEFT] cerebral convexity consistent with acute subdural haematoma, measuring [X] mm at maximum thickness. Associated midline shift of [X] mm." },
      { key: "extradural", label: "Extradural Haematoma", text: "Biconvex hyperdense epidural haematoma in the [LOCATION] temporal region, associated with overlying [temporal bone] fracture." },
      { key: "depressed_skull_fx", label: "Depressed Skull Fracture", text: "Depressed fracture of the [LOCATION] with inward displacement of [X] mm. [No / Underlying] brain parenchymal injury." },
    ]),
    isPreset: true,
  },
  {
    templateName: "CT Chest",
    modality: "CT",
    bodyPart: "CHEST",
    studyType: "PLAIN",
    sectionsJson: JSON.stringify({
      technique: "CECT/HRCT Chest: Axial sections from apex to base, with lung and mediastinal window reconstructions.",
      findingsItems: [
        { label: "Lungs", normal: "Clear. No consolidation, ground-glass opacity, nodule or mass." },
        { label: "Pleura", normal: "No pleural effusion, thickening or pneumothorax." },
        { label: "Mediastinum", normal: "Not widened. No mediastinal lymphadenopathy." },
        { label: "Heart & Pericardium", normal: "Normal cardiac size. No pericardial effusion." },
        { label: "Hilar Structures", normal: "Not enlarged. No hilar lymphadenopathy." },
        { label: "Major Vessels", normal: "Aorta and pulmonary vasculature normal." },
        { label: "Bones", normal: "No lytic or sclerotic bony lesion. No fracture." },
        { label: "Visualised Abdomen", normal: "Unremarkable on visualised upper abdominal structures." },
      ],
    }),
    defaultFindings: "Lungs are clear bilaterally. No consolidation, effusion or pneumothorax. Mediastinum not widened. No lymphadenopathy. Heart size normal. Bony thorax intact.",
    defaultImpression: "Normal CT Chest. No significant pulmonary or mediastinal pathology.",
    macrosJson: JSON.stringify([
      { key: "consolidation", label: "Consolidation", text: "Homogeneous consolidation with air bronchograms in the [LOBE/SEGMENT], consistent with pneumonia." },
      { key: "ground_glass", label: "Ground-Glass Opacity", text: "Bilateral ground-glass opacities in a [peripheral / peribronchovascular / random] distribution." },
      { key: "pe", label: "Pulmonary Embolism", text: "Filling defects in the [RIGHT/LEFT/bilateral] pulmonary arteries consistent with pulmonary embolism." },
    ]),
    isPreset: true,
  },
  {
    templateName: "CT Abdomen & Pelvis",
    modality: "CT",
    bodyPart: "ABDOMEN",
    studyType: "CONTRAST",
    sectionsJson: JSON.stringify({
      technique: "CECT Abdomen & Pelvis: Oral and IV contrast with axial and coronal reconstructions.",
      findingsItems: [
        { label: "Liver", normal: "Normal size. Homogeneous enhancement. No focal lesion." },
        { label: "Gallbladder & CBD", normal: "GB: Normal wall, no calculi. CBD not dilated." },
        { label: "Spleen", normal: "Normal size and enhancement." },
        { label: "Pancreas", normal: "Normal size, contour and enhancement. Pancreatic duct not dilated." },
        { label: "Kidneys & Ureters", normal: "Normal size, position and enhancement bilaterally. No calculus or hydronephrosis." },
        { label: "Adrenal Glands", normal: "Normal bilaterally." },
        { label: "Bowel", normal: "Small and large bowel loops normal in calibre. No obstruction. Adequate mucosal enhancement." },
        { label: "Mesentery & Lymph Nodes", normal: "No mesenteric fat stranding. No lymphadenopathy." },
        { label: "Peritoneum", normal: "No free fluid. No peritoneal deposits." },
        { label: "Pelvis", normal: "Urinary bladder normal. Pelvic organs normal (age-appropriate)." },
        { label: "Aorta & Vessels", normal: "Aorta normal in calibre. No aneurysm." },
        { label: "Bones", normal: "No lytic or sclerotic bony lesion." },
      ],
    }),
    defaultFindings: "Liver, spleen, pancreas and adrenals are normal. Gallbladder normal without calculi. Kidneys show normal size, position and enhancement. No calculus or hydronephrosis. Bowel loops normal in calibre. No free fluid or lymphadenopathy. Aorta normal.",
    defaultImpression: "Normal CT Abdomen & Pelvis. No significant intra-abdominal pathology.",
    macrosJson: JSON.stringify([
      { key: "liver_lesion", label: "Liver Lesion", text: "[Hypodense/hyperdense/cystic] lesion in the [SEGMENT] of liver, measuring [DIMENSIONS]. Enhancement pattern: [arterial/portal/washout]. Differential: [hepatocellular carcinoma/metastasis/haemangioma/cyst]." },
      { key: "appendicitis", label: "Appendicitis", text: "Distended appendix with periappendiceal fat stranding, consistent with acute appendicitis. No perforation demonstrated." },
    ]),
    isPreset: true,
  },
  {
    templateName: "X-Ray Chest PA View",
    modality: "X-RAY",
    bodyPart: "CHEST",
    studyType: "PA_VIEW",
    sectionsJson: JSON.stringify({
      technique: "PA view of chest in full inspiration.",
      findingsItems: [
        { label: "Technical Quality", normal: "Adequate inspiration. No rotation." },
        { label: "Cardiomediastinal Silhouette", normal: "Normal in size and configuration. Cardiac size within normal limits (CTR < 50%). Mediastinum not widened. Aortic knuckle normal." },
        { label: "Lung Fields", normal: "Clear bilaterally. No opacity, consolidation or collapse. Normal pulmonary vascularity." },
        { label: "Costophrenic Angles", normal: "Acute bilaterally. No pleural effusion." },
        { label: "Hilae", normal: "Normally positioned. No hilar enlargement." },
        { label: "Bones", normal: "Visible ribs, clavicles and scapulae are intact. No fracture." },
        { label: "Soft Tissues", normal: "Unremarkable." },
      ],
    }),
    defaultFindings: "Adequate inspiratory effort. Cardiomediastinal silhouette is normal. Lung fields are clear bilaterally. Costophrenic angles are acute. Hilae are normally positioned and not enlarged. Visible bony structures intact.",
    defaultImpression: "Normal PA chest X-ray. No active pulmonary disease.",
    macrosJson: JSON.stringify([
      { key: "bilateral_pleural_effusion", label: "Bilateral Pleural Effusion", text: "Blunting of bilateral costophrenic angles with basal opacification, consistent with bilateral pleural effusion." },
      { key: "cardiomegaly", label: "Cardiomegaly", text: "Cardiomegaly with CTR > 50%. Pulmonary vascularity [normal/increased]. [No/Bilateral basal] pleural effusion." },
      { key: "pn", label: "Pneumonia", text: "Patchy airspace opacity in the [LOBE/ZONE], consistent with consolidation/pneumonia." },
    ]),
    isPreset: true,
  },
  {
    templateName: "X-Ray Spine",
    modality: "X-RAY",
    bodyPart: "SPINE_LS",
    studyType: "AP_LATERAL",
    sectionsJson: JSON.stringify({
      technique: "AP and lateral views of the [LS/Cervical/Dorsal] spine.",
      findingsItems: [
        { label: "Alignment & Curvature", normal: "Normal physiological curvature. No scoliosis or kyphotic deformity." },
        { label: "Vertebral Bodies", normal: "Normal in height, morphology and density. No compression fracture or destructive lesion." },
        { label: "Disc Spaces", normal: "Maintained at all levels." },
        { label: "Facet Joints & Pedicles", normal: "Normal." },
        { label: "Paravertebral Soft Tissues", normal: "Unremarkable." },
      ],
    }),
    defaultFindings: "Normal vertebral body heights. Disc spaces preserved. No fracture or destructive lesion. Alignment normal. Soft tissues unremarkable.",
    defaultImpression: "Normal radiograph of the spine. No acute bony pathology.",
    macrosJson: JSON.stringify([
      { key: "compression_fx", label: "Compression Fracture", text: "Anterior wedge compression deformity of [LEVEL] with approximately [X]% loss of anterior height. Posterior vertebral height maintained." },
      { key: "spondylosis", label: "Spondylosis", text: "Degenerative spondylotic changes with endplate osteophyte formation and disc space reduction at [LEVELS]." },
    ]),
    isPreset: true,
  },
  {
    templateName: "USG Abdomen",
    modality: "USG",
    bodyPart: "ABDOMEN",
    studyType: "GREY_SCALE",
    sectionsJson: JSON.stringify({
      technique: "Ultrasonography of the abdomen using high-frequency transducer. Patient fasted for 4–6 hours.",
      findingsItems: [
        { label: "Liver", normal: "Normal size (AP diameter < 15 cm). Homogeneous echotexture. No focal lesion. Intrahepatic biliary radicles not dilated." },
        { label: "Gallbladder", normal: "Normal size and wall thickness (< 3 mm). No calculi or polyps. No pericholecystic fluid." },
        { label: "Common Bile Duct", normal: "Not dilated (diameter < 6 mm)." },
        { label: "Spleen", normal: "Normal size (< 12 cm). Homogeneous echotexture. No focal lesion." },
        { label: "Pancreas", normal: "Normal size and echotexture. Main pancreatic duct not dilated." },
        { label: "Right Kidney", normal: "Normal size (9–12 cm), position and echotexture. PCS not dilated. No calculus." },
        { label: "Left Kidney", normal: "Normal size (9–12 cm), position and echotexture. PCS not dilated. No calculus." },
        { label: "Urinary Bladder", normal: "Adequate distension. Wall normal. No calculus or mass." },
        { label: "Aorta & IVC", normal: "Normal calibre." },
        { label: "Free Fluid", normal: "No free fluid in abdomen or pelvis." },
      ],
    }),
    defaultFindings: "Liver is normal in size and echotexture. Gallbladder is normal; no calculi. CBD not dilated. Spleen normal. Pancreas normal. Both kidneys are normal in size, position and echotexture without hydronephrosis or calculi. Urinary bladder normal. No free fluid.",
    defaultImpression: "Normal ultrasound examination of the abdomen. No significant intra-abdominal pathology.",
    macrosJson: JSON.stringify([
      { key: "cholelithiasis", label: "Cholelithiasis", text: "Multiple/solitary echogenic calculi with posterior acoustic shadowing within the gallbladder, the largest measuring approximately [SIZE] cm." },
      { key: "fatty_liver", label: "Fatty Liver", text: "Increased hepatic echogenicity with poor sound transmission, consistent with fatty liver / hepatic steatosis (Grade [I/II/III])." },
      { key: "hydronephrosis", label: "Hydronephrosis", text: "[Mild/Moderate/Severe] hydronephrosis of the [RIGHT/LEFT] kidney with pelvi-calyceal system dilation." },
      { key: "ascites", label: "Ascites", text: "Free fluid noted in Morrison's pouch, perihepatic, perisplenic and pelvic regions, consistent with ascites." },
    ]),
    isPreset: true,
  },
  {
    templateName: "Doppler Carotid",
    modality: "DOPPLER",
    bodyPart: "CAROTID",
    studyType: "COLOUR_DOPPLER",
    sectionsJson: JSON.stringify({
      technique: "Colour Doppler ultrasound of bilateral carotid and vertebral arteries in grey-scale, colour flow and pulse-wave Doppler modes.",
      findingsItems: [
        { label: "Right CCA", normal: "Normal calibre and flow. IMT within normal limits (< 0.9 mm)." },
        { label: "Right Carotid Bifurcation", normal: "No plaque or stenosis." },
        { label: "Right ICA", normal: "Normal luminal diameter and flow. PSV within normal limits." },
        { label: "Right ECA", normal: "Normal." },
        { label: "Left CCA", normal: "Normal calibre and flow. IMT within normal limits (< 0.9 mm)." },
        { label: "Left Carotid Bifurcation", normal: "No plaque or stenosis." },
        { label: "Left ICA", normal: "Normal luminal diameter and flow. PSV within normal limits." },
        { label: "Left ECA", normal: "Normal." },
        { label: "Vertebral Arteries", normal: "Bilateral vertebral arteries show antegrade flow. Normal PSV." },
      ],
    }),
    defaultFindings: "Bilateral common carotid arteries show normal calibre with smooth intima. Intima-media thickness within normal limits bilaterally. No atherosclerotic plaque at bifurcations. Internal and external carotid arteries patent with normal spectral waveform. Vertebral arteries show antegrade flow bilaterally.",
    defaultImpression: "Normal Doppler study of bilateral carotid and vertebral arteries. No haemodynamically significant stenosis.",
    macrosJson: JSON.stringify([
      { key: "atherosclerotic_plaque", label: "Atherosclerotic Plaque", text: "Heterogeneous/soft/calcified plaque at the [RIGHT/LEFT] carotid bifurcation causing [mild (<50%)/moderate (50–70%)/severe (>70%)] luminal stenosis. PSV [VALUE] cm/s, EDV [VALUE] cm/s." },
      { key: "increased_imt", label: "Increased IMT", text: "Increased intima-media thickness of [VALUE] mm on the [RIGHT/LEFT/bilateral] CCA (normal < 0.9 mm), consistent with early atherosclerotic change." },
    ]),
    isPreset: true,
  },
] as const;

// ─── Routes ───────────────────────────────────────────────────────────────────
structuredReportTemplatesRouter.get("/", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { modality, bodyPart } = req.query as { modality?: string; bodyPart?: string };
  let query = db.select().from(structuredReportTemplatesTable).$dynamic();
  if (modality) query = query.where(eq(structuredReportTemplatesTable.modality, modality));

  const rows = await query.orderBy(
    structuredReportTemplatesTable.modality,
    structuredReportTemplatesTable.bodyPart,
    structuredReportTemplatesTable.templateName,
  );
  res.json(rows);
});

structuredReportTemplatesRouter.get("/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = Number(req.params["id"]);
  const [row] = await db.select().from(structuredReportTemplatesTable)
    .where(eq(structuredReportTemplatesTable.id, id));
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(row);
});

structuredReportTemplatesRouter.post("/", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { templateName, modality, bodyPart, studyType, sectionsJson, defaultFindings, defaultImpression, macrosJson } = req.body as Partial<typeof structuredReportTemplatesTable.$inferInsert>;
  if (!templateName || !modality || !bodyPart) {
    res.status(400).json({ error: "templateName, modality and bodyPart are required" }); return;
  }
  const [row] = await db.insert(structuredReportTemplatesTable).values({
    templateName, modality, bodyPart,
    studyType: studyType ?? null,
    sectionsJson: sectionsJson ?? null,
    defaultFindings: defaultFindings ?? null,
    defaultImpression: defaultImpression ?? null,
    macrosJson: macrosJson ?? null,
    isPreset: false,
    createdBy: sReq.staffSession.subjectName,
  }).returning();
  res.status(201).json(row);
});

structuredReportTemplatesRouter.patch("/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = Number(req.params["id"]);
  const { templateName, modality, bodyPart, studyType, sectionsJson, defaultFindings, defaultImpression, macrosJson, isActive } = req.body as Partial<typeof structuredReportTemplatesTable.$inferInsert>;
  const updates: Partial<typeof structuredReportTemplatesTable.$inferInsert> = { updatedAt: new Date(), updatedBy: sReq.staffSession.subjectName };
  if (templateName !== undefined) updates.templateName = templateName;
  if (modality !== undefined) updates.modality = modality;
  if (bodyPart !== undefined) updates.bodyPart = bodyPart;
  if (studyType !== undefined) updates.studyType = studyType;
  if (sectionsJson !== undefined) updates.sectionsJson = sectionsJson;
  if (defaultFindings !== undefined) updates.defaultFindings = defaultFindings;
  if (defaultImpression !== undefined) updates.defaultImpression = defaultImpression;
  if (macrosJson !== undefined) updates.macrosJson = macrosJson;
  if (isActive !== undefined) updates.isActive = isActive;

  const [row] = await db.update(structuredReportTemplatesTable).set(updates).where(eq(structuredReportTemplatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

structuredReportTemplatesRouter.delete("/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession || !FULL_ACCESS_ROLES.has(sReq.staffSession.role)) {
    res.status(403).json({ error: "Only admin can delete templates" }); return;
  }
  const id = Number(req.params["id"]);
  const [existing] = await db.select().from(structuredReportTemplatesTable).where(eq(structuredReportTemplatesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.isPreset) { res.status(400).json({ error: "Preset templates cannot be deleted" }); return; }
  await db.delete(structuredReportTemplatesTable).where(eq(structuredReportTemplatesTable.id, id));
  res.json({ ok: true });
});

/** POST /api/structured-report-templates/seed — load built-in presets:
 *  the MRI/CT/X-ray/USG/Doppler structured presets above, plus the 13 USG
 *  auto-generate skeletons from lib/usgReportTemplates.ts (modality "USG",
 *  studyType = UsgTemplateId). Once seeded, the rows here — not the code —
 *  are what /api/usg-reports renders from; edits apply on the next
 *  auto-generate/regenerate. Idempotent: existing preset names are skipped. */
structuredReportTemplatesRouter.post("/seed", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!sReq.staffSession || !FULL_ACCESS_ROLES.has(sReq.staffSession.role)) {
    res.status(403).json({ error: "Only admin can seed templates" }); return;
  }

  const allPresets = [...PRESETS, ...USG_STRUCTURED_TEMPLATE_PRESETS];
  let inserted = 0;
  for (const preset of allPresets) {
    const existing = await db.select({ id: structuredReportTemplatesTable.id })
      .from(structuredReportTemplatesTable)
      .where(and(
        eq(structuredReportTemplatesTable.templateName, preset.templateName),
        eq(structuredReportTemplatesTable.isPreset, true),
      ))
      .limit(1);
    if (existing.length > 0) continue; // already seeded
    await db.insert(structuredReportTemplatesTable).values({
      ...preset,
      createdBy: "system",
    });
    inserted++;
  }
  res.json({ inserted, total: allPresets.length });
});
