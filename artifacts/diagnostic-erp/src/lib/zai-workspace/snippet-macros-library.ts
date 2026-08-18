import type { Modality, SnippetMacro } from "./types";
import { expandMacro, detectMacroTrigger } from "./types";
import { contentStudyTypes, type ReportingStudyContext } from "@/lib/reportingStudyContext";
const now = () => new Date().toISOString();
const uid = () => `sm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
function m(trig: string, label: string, tmpl: string, vars: { name: string; label: string; default?: string; options?: string[] }[], opts: { scopeModality?: Modality; scopeBodyPart?: string } = {}): SnippetMacro { return { id: uid(), trigger: trig, label, template: tmpl, variables: vars, createdAt: now(), updatedAt: now(), ...opts }; }

export const DEFAULT_SNIPPET_MACROS: SnippetMacro[] = [
  m("discbulge","Disc bulge with protrusion","Broad-based disc bulge at {level} with {side} paracentral protrusion causing indentation on the thecal sac and mild narrowing of bilateral neural foramina. No significant central canal stenosis.",[{name:"level",label:"Level",default:"L4-L5",options:["L3-L4","L4-L5","L5-S1","L2-L3"]},{name:"side",label:"Side",default:"right",options:["right","left","central","bilateral"]}],{scopeModality:"MR",scopeBodyPart:"LS Spine"}),
  m("fazekas","White matter changes (Fazekas)","{grade} T2/FLAIR hyperintense white matter lesions in bilateral periventricular and deep white matter, Fazekas grade {gradenum}. {confluence}",[{name:"grade",label:"Severity",default:"Few punctate",options:["Few punctate","Confluent","Multiple confluent"]},{name:"gradenum",label:"Fazekas grade",default:"1",options:["1","2","3"]},{name:"confluence",label:"Confluence",default:"No confluent white matter lesions.",options:["No confluent white matter lesions.","Beginning confluence.","Confluent lesions present."]}],{scopeModality:"MR",scopeBodyPart:"Brain"}),
  m("infarct","Acute infarct","Restricted diffusion in the {territory} territory on DWI/ADC, consistent with acute infarct. No hemorrhagic transformation. {mass}",[{name:"territory",label:"Territory",default:"left MCA",options:["left MCA","right MCA","left ACA","right ACA","left PCA","right PCA","pons","cerebellum"]},{name:"mass",label:"Mass effect",default:"Mass effect minimal.",options:["Mass effect minimal.","Mass effect with midline shift.","No mass effect."]}],{scopeModality:"MR",scopeBodyPart:"Brain"}),
  m("ich","Intracranial hemorrhage","Acute intraparenchymal hemorrhage in the {location} measuring ___ × ___ cm. {extension} Mass effect with midline shift of ___ mm to the {shift}.",[{name:"location",label:"Location",default:"right basal ganglia",options:["right basal ganglia","left basal ganglia","right thalamus","left thalamus","right frontal lobe","left frontal lobe","right parietal lobe","left parietal lobe","pons","cerebellum"]},{name:"extension",label:"Extension",default:"Intraventricular extension into the lateral ventricles.",options:["Intraventricular extension into the lateral ventricles.","No intraventricular extension.","Intraventricular extension with hydrocephalus."]},{name:"shift",label:"Midline shift",default:"left",options:["left","right","none"]}],{scopeModality:"CT",scopeBodyPart:"Brain"}),
  m("nodule","Pulmonary nodule","Spiculated soft tissue nodule measuring ___ × ___ × ___ cm in the {lobe}. {surrounding} Findings are {suspicion}.",[{name:"lobe",label:"Lobe",default:"right upper lobe",options:["right upper lobe","right middle lobe","right lower lobe","left upper lobe","lingula","left lower lobe"]},{name:"surrounding",label:"Surrounding",default:"Surrounding ground-glass opacities.",options:["Surrounding ground-glass opacities.","No surrounding changes.","Pleural retraction."]},{name:"suspicion",label:"Suspicion",default:"highly suspicious for malignancy",options:["highly suspicious for malignancy","indeterminate","likely benign"]}],{scopeModality:"CT",scopeBodyPart:"Chest"}),
  m("gallstones","Gallstones","Multiple echogenic foci with acoustic shadowing in the gallbladder lumen, largest measuring ___ mm, suggestive of cholelithiasis. {wall}",[{name:"wall",label:"Wall",default:"Gallbladder wall thickness is normal.",options:["Gallbladder wall thickness is normal.","Gallbladder wall thickened (___ mm).","Gallbladder wall thickened with layered edema."]}],{scopeModality:"US",scopeBodyPart:"Abdomen"}),
  m("birads","BI-RADS assessment","BI-RADS {category}: {assessment}. {management}",[{name:"category",label:"Category",default:"4",options:["0","1","2","3","4","5","6"]},{name:"assessment",label:"Assessment",default:"Suspicious for malignancy",options:["Incomplete","Negative","Benign","Probably benign","Suspicious for malignancy","Highly suggestive of malignancy","Known biopsy-proven malignancy"]},{name:"management",label:"Management",default:"Image-guided biopsy recommended.",options:["Image-guided biopsy recommended.","Routine screening.","Short-interval follow-up.","Biopsy mandatory. Surgical referral advised."]}],{scopeModality:"MG",scopeBodyPart:"Breast"}),
  m("normalbrain","Normal brain MRI","Brain parenchyma shows normal signal intensity on all pulse sequences. No evidence of acute infarct, hemorrhage, or mass lesion. Ventricular system and cisternal spaces are normal in size and configuration. No midline shift. Cortical sulci and gyral pattern are normal for age. Basal cisterns are unremarkable. No evidence of restricted diffusion on DWI/ADC. Flow voids in major intracranial vessels are normal.",[],{scopeModality:"MR",scopeBodyPart:"Brain"}),
  m("normallssp","Normal LS spine MRI","Lumbar vertebrae show normal alignment and marrow signal. No evidence of spondylolisthesis. Disc spaces are maintained. No evidence of acute fracture. Conus medullaris is at L1 level with normal appearance. Cauda equina nerve roots are normally distributed. Paraspinal soft tissues are unremarkable. Sacroiliac joints are normal.",[],{scopeModality:"MR",scopeBodyPart:"LS Spine"}),
];

/** @deprecated Use lookupMacrosForContext with ReportingStudyContext. */
export function lookupMacros(macros: SnippetMacro[], m: Modality | undefined, b: string | undefined): SnippetMacro[] {
  return macros.filter(mc => { if (!mc.scopeModality) return true; if (mc.scopeModality !== m) return false; if (mc.scopeBodyPart && mc.scopeBodyPart !== b) return false; return true; });
}

/** Scope macros by the resolved ReportingStudyContext, not DICOM bodyPart. */
export function lookupMacrosForContext(
  macros: SnippetMacro[],
  m: Modality | undefined,
  ctx: ReportingStudyContext | null | undefined,
): SnippetMacro[] {
  if (!ctx?.region) {
    return macros.filter((mc) => !mc.scopeModality && !mc.scopeBodyPart);
  }
  const allowed = new Set(contentStudyTypes(ctx.regions.length > 0 ? ctx.regions : [ctx.region]).map((s) => s.toLowerCase()));
  return macros.filter((mc) => {
    if (mc.scopeModality && mc.scopeModality !== m) return false;
    if (mc.scopeBodyPart && !allowed.has(mc.scopeBodyPart.toLowerCase())) return false;
    return true;
  });
}
const SK = "zai-rad-snippetmacros-v1";
export function loadMacros(): SnippetMacro[] { try { const r = localStorage.getItem(SK); if (!r) return DEFAULT_SNIPPET_MACROS; const c = JSON.parse(r) as SnippetMacro[]; return [...DEFAULT_SNIPPET_MACROS, ...c.filter(x => x.custom)]; } catch { return DEFAULT_SNIPPET_MACROS; } }
export function saveMacros(m: SnippetMacro[]) { try { localStorage.setItem(SK, JSON.stringify(m.filter(x => x.custom))); } catch {} }
export function createMacro(i: Omit<SnippetMacro, "id" | "createdAt" | "updatedAt">): SnippetMacro { return { ...i, id: uid(), createdAt: now(), updatedAt: now(), custom: true }; }
export { expandMacro, detectMacroTrigger };
