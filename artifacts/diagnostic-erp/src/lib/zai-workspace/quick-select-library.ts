import type { Modality } from "./types";
import type { QuickSelectTile, QuickSelectField } from "./types";
import { canonicalContentRegion, contentStudyTypes, type ReportingStudyContext } from "@/lib/reportingStudyContext";
const now = () => new Date().toISOString();
const uid = () => `qs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
function t(f: QuickSelectField, l: string, s: string, o: Partial<QuickSelectTile> = {}): QuickSelectTile { return { id: uid(), field: f, label: l, sentence: s, category: "normal", createdAt: now(), updatedAt: now(), ...o }; }

// ─────────────────────────────────────────────────────────────────────────────
// Content-pack tile merging — fetches per-study YAML content-pack tiles from the
// backend and merges them with the hardcoded defaults below. The catalog tiles
// take precedence (they're clinically authored per-study), but user-customized
// tiles (saved in localStorage) always win.
//
// The fetch is lazy and cached for 5 minutes. On failure, falls back to defaults.
// ─────────────────────────────────────────────────────────────────────────────
let catalogTilesCache: QuickSelectTile[] | null = null;
let catalogTilesFetchPromise: Promise<QuickSelectTile[]> | null = null;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let catalogFetchAt = 0;

interface CatalogTileResponse {
  tiles: Array<{
    id: string; field: string; scopeModality?: string; scopeBodyPart?: string;
    label: string; mnemonic?: string; category: string; sentence: string;
    impressionSentence?: string; packId?: string; findingId?: string;
  }>;
  count: number;
  packCount: number;
}

async function fetchCatalogTiles(): Promise<QuickSelectTile[]> {
  if (catalogTilesCache && Date.now() - catalogFetchAt < CATALOG_CACHE_TTL_MS) {
    return catalogTilesCache;
  }
  if (catalogTilesFetchPromise) return catalogTilesFetchPromise;
  catalogTilesFetchPromise = (async () => {
    try {
      const res = await fetch("/api/radiology/content-pack-tiles", { credentials: "include" });
      if (!res.ok) return catalogTilesCache || [];
      const data: CatalogTileResponse = await res.json();
      catalogTilesCache = (data.tiles || []).map((t) => ({
        id: t.id,
        field: t.field as QuickSelectField,
        scopeModality: t.scopeModality as Modality | undefined,
        scopeBodyPart: t.scopeBodyPart,
        label: t.label,
        mnemonic: t.mnemonic,
        category: (t.category as "normal" | "abnormal" | "variant" | "critical") || "normal",
        sentence: t.sentence,
        impressionSentence: t.impressionSentence,
        createdAt: now(),
        updatedAt: now(),
        // Mark as catalog-sourced so the UI can show a badge if needed
        custom: false,
      }));
      catalogFetchAt = Date.now();
      return catalogTilesCache;
    } catch {
      // Network error or server not ready — fall back to defaults silently
      return catalogTilesCache || [];
    } finally {
      catalogTilesFetchPromise = null;
    }
  })();
  return catalogTilesFetchPromise;
}

/**
 * Get all tiles: user-saved (localStorage) merged with catalog tiles merged
 * with defaults. User tiles take precedence, then catalog tiles, then defaults.
 */
export async function getAllTilesWithCatalog(): Promise<QuickSelectTile[]> {
  const [userTiles, catalogTiles] = await Promise.all([
    Promise.resolve(loadTiles()),
    fetchCatalogTiles(),
  ]);
  // Deduplicate by label+field — user tiles win, then catalog, then defaults.
  // We don't dedupe defaults against catalog by label because the catalog tiles
  // have richer content (impression fragments, AI rules) and should replace
  // the simpler hardcoded ones for the same study type.
  const seen = new Set<string>();
  const merged: QuickSelectTile[] = [];
  // User tiles first (highest priority)
  for (const t of userTiles) {
    const key = `${t.field}:${t.label.toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); merged.push(t); }
  }
  // Catalog tiles next
  for (const t of catalogTiles) {
    const key = `${t.field}:${t.label.toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); merged.push(t); }
  }
  // Defaults last (lowest priority — only fill gaps not covered by catalog)
  for (const t of DEFAULT_QUICK_SELECT_TILES) {
    const key = `${t.field}:${t.label.toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); merged.push(t); }
  }
  return merged;
}

/** Prefetch catalog tiles so they're warm when the workspace mounts. */
export function prefetchCatalogTiles(): void {
  void fetchCatalogTiles();
}

export const DEFAULT_QUICK_SELECT_TILES: QuickSelectTile[] = [
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
  t("findings","Normal ventricles","Ventricular system and cisternal spaces are normal in size and configuration. No midline shift.",{mnemonic:"nv",scopeModality:"MR",scopeBodyPart:"Brain",favorite:true}),
  t("findings","Glioma recurrence","Heterogeneously enhancing area in the right frontal operculum at the post-resection cavity, measuring approximately ___ × ___ × ___ cm, with surrounding T2/FLAIR hyperintensity suggestive of edema. Findings are concerning for tumor recurrence.",{mnemonic:"gr",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal",favorite:true}),
  t("findings","Acute infarct (DWI)","Restricted diffusion in the {side} MCA territory on DWI/ADC, consistent with acute infarct. No hemorrhagic transformation.",{mnemonic:"ai",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",anatomicalSection:"mca",conflictGroup:"infarct",impressionSentence:"Acute {side} MCA territory infarct."}),
  t("findings","Basal ganglia hemorrhage","Acute intraparenchymal hemorrhage in the {side} basal ganglia with intraventricular extension. Mass effect with midline shift of ___ mm.",{mnemonic:"ah",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",anatomicalSection:"basal ganglia",conflictGroup:"hemorrhage",impressionSentence:"Acute {side} basal ganglia hemorrhage."}),
  t("findings","Acute hemorrhage","Acute intraparenchymal hemorrhage in the {side} basal ganglia with intraventricular extension. Mass effect with midline shift of ___ mm to the contralateral side.",{mnemonic:"ah2",scopeModality:"MR",scopeBodyPart:"Brain",category:"critical",anatomicalSection:"basal ganglia",conflictGroup:"hemorrhage",impressionSentence:"Acute {side} basal ganglia hemorrhage."}),
  t("findings","Fazekas 1","Few punctate T2/FLAIR hyperintense white matter lesions in bilateral periventricular and deep white matter, Fazekas grade 1. No confluent lesions.",{mnemonic:"f1",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal"}),
  t("findings","Fazekas 2","Confluent T2/FLAIR hyperintense white matter lesions in bilateral periventricular and deep white matter, Fazekas grade 2.",{mnemonic:"f2",scopeModality:"MR",scopeBodyPart:"Brain",category:"abnormal"}),
  t("findings","Normal LS spine","Lumbar vertebrae show normal alignment and marrow signal. No spondylolisthesis. Disc spaces maintained.",{mnemonic:"nl",scopeModality:"MR",scopeBodyPart:"LS Spine",favorite:true}),
  t("findings","Disc herniation L4-L5","Broad-based disc bulge at L4-L5 with posterocentral-right paracentral protrusion causing indentation on the thecal sac and mild narrowing of bilateral neural foramina. No significant central canal stenosis.",{mnemonic:"dh",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"abnormal",favorite:true}),
  t("findings","Compression fracture L1","Acute compression fracture at L1 vertebral body with marrow edema on T2/STIR. Posterior wall intact.",{mnemonic:"cf",scopeModality:"MR",scopeBodyPart:"LS Spine",category:"critical"}),
  t("findings","Normal CT brain","Brain parenchyma shows normal attenuation. No evidence of acute hemorrhage or mass lesion.",{mnemonic:"nb",scopeModality:"CT",scopeBodyPart:"Brain",favorite:true}),
  t("findings","Acute infarct (CT)","Loss of grey-white differentiation in the left MCA territory, consistent with acute infarct. Hyperdense MCA sign.",{mnemonic:"ai",scopeModality:"CT",scopeBodyPart:"Brain",category:"critical",favorite:true}),
  t("findings","Acute ICH","Acute intraparenchymal hemorrhage in the right basal ganglia measuring ___ × ___ cm. Intraventricular extension. Mass effect with midline shift of ___ mm.",{mnemonic:"ih",scopeModality:"CT",scopeBodyPart:"Brain",category:"critical"}),
  t("findings","SDH","Acute subdural hematoma over the right convexity, maximum thickness ___ mm. Mass effect with midline shift of ___ mm to the left.",{mnemonic:"sd",scopeModality:"CT",scopeBodyPart:"Brain",category:"critical"}),
  t("findings","Normal lungs","Lung fields are clear. No focal consolidation or mass lesion. No pleural effusion.",{mnemonic:"nl",scopeModality:"CT",scopeBodyPart:"Chest",favorite:true}),
  t("findings","Pulmonary nodule","Spiculated soft tissue nodule measuring ___ × ___ × ___ cm in the right upper lobe. Surrounding ground-glass opacities. Findings are highly suspicious for malignancy.",{mnemonic:"pn",scopeModality:"CT",scopeBodyPart:"Chest",category:"abnormal",favorite:true}),
  t("findings","Pneumothorax","Tension pneumothorax on the right with mediastinal shift to the left.",{mnemonic:"px",scopeModality:"CT",scopeBodyPart:"Chest",category:"critical"}),
  t("findings","Normal gallbladder","Gallbladder is normal in size and wall thickness. No calculi or sludge. Common bile duct is unremarkable.",{mnemonic:"ng",scopeModality:"US",scopeBodyPart:"Abdomen",favorite:true}),
  t("findings","Gallstones","Multiple echogenic foci with acoustic shadowing in the gallbladder lumen, largest measuring ___ mm, suggestive of cholelithiasis. Gallbladder wall thickness normal.",{mnemonic:"gs",scopeModality:"US",scopeBodyPart:"Abdomen",category:"abnormal",favorite:true}),
  t("findings","Normal breast","No suspicious masses or calcifications. Bilateral breast parenchyma is symmetric.",{mnemonic:"nb",scopeModality:"MG",scopeBodyPart:"Breast",favorite:true}),
  t("findings","Spiculated mass","Spiculated mass in the right upper outer quadrant measuring ___ × ___ cm with associated skin retraction. Highly suspicious for malignancy.",{mnemonic:"sm",scopeModality:"MG",scopeBodyPart:"Breast",category:"critical"}),
  t("impression","Normal study","No acute abnormality detected. Clinical correlation advised.",{mnemonic:"no",favorite:true}),
  t("impression","BI-RADS 1","BI-RADS 1: Negative. No abnormalities. Routine screening recommended.",{mnemonic:"b1",scopeModality:"MG",scopeBodyPart:"Breast"}),
  t("impression","BI-RADS 4","BI-RADS 4: Suspicious for malignancy. Image-guided biopsy recommended.",{mnemonic:"b4",scopeModality:"MG",scopeBodyPart:"Breast",category:"abnormal"}),
  t("impression","BI-RADS 5","BI-RADS 5: Highly suggestive of malignancy. Biopsy mandatory. Surgical referral advised.",{mnemonic:"b5",scopeModality:"MG",scopeBodyPart:"Breast",category:"critical"}),
  t("recommendation","Clinical correlation","Clinical correlation advised. Follow-up as clinically indicated.",{mnemonic:"cc",favorite:true}),
  t("recommendation","Follow-up scan","Follow-up scan recommended in ___ weeks.",{mnemonic:"fu"}),
  t("recommendation","Biopsy","Image-guided biopsy recommended for tissue diagnosis.",{mnemonic:"bx",scopeModality:"MG",scopeBodyPart:"Breast",category:"abnormal"}),
  t("recommendation","Stroke team","Immediate stroke team notification advised. If within thrombolysis window, consider IV tPA per protocol. CTA head and neck recommended.",{mnemonic:"st",scopeModality:"CT",scopeBodyPart:"Brain",category:"critical",favorite:true}),
];

/** @deprecated Use lookupTilesForContext with ReportingStudyContext. DICOM bodyPart is provenance only. */
export function lookupTiles(tiles: QuickSelectTile[], field: QuickSelectField, modality: Modality | undefined, bodyPart: string | undefined): QuickSelectTile[] {
  return tiles.filter(t => t.field === field).map(t => ({ t, s: t.scopeModality === modality && t.scopeBodyPart === bodyPart ? 100 : t.scopeModality === modality && !t.scopeBodyPart ? 50 : !t.scopeModality ? 10 : -1 })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s || a.t.label.localeCompare(b.t.label)).map(x => x.t);
}

/** Scope tiles by the resolved ReportingStudyContext, not DICOM bodyPart. */
export function lookupTilesForContext(
  tiles: QuickSelectTile[],
  field: QuickSelectField,
  modality: Modality | undefined,
  ctx: ReportingStudyContext | null | undefined,
): QuickSelectTile[] {
  if (!ctx?.region) {
    return tiles.filter((tile) => tile.field === field && !tile.scopeBodyPart && !tile.scopeModality);
  }
  const allowed = new Set(contentStudyTypes(ctx.regions.length > 0 ? ctx.regions : [ctx.region]).map((s) => s.toLowerCase()));
  return tiles
    .filter((tile) => tile.field === field)
    .map((tile) => {
      if (tile.scopeModality && tile.scopeModality !== modality) return { tile, s: -1 };
      if (tile.scopeBodyPart && !allowed.has((canonicalContentRegion(tile.scopeBodyPart) || tile.scopeBodyPart).toLowerCase())) return { tile, s: -1 };
      const exact = tile.scopeBodyPart && (canonicalContentRegion(tile.scopeBodyPart) || tile.scopeBodyPart).toLowerCase() === ctx.region!.toLowerCase();
      const s = exact ? 100 : tile.scopeBodyPart ? 80 : tile.scopeModality === modality ? 50 : 10;
      return { tile, s };
    })
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.tile.label.localeCompare(b.tile.label))
    .map((x) => x.tile);
}
const SK = "zai-rad-quickselect-v1";
export function loadTiles(): QuickSelectTile[] { try { const r = localStorage.getItem(SK); return r ? JSON.parse(r) : DEFAULT_QUICK_SELECT_TILES; } catch { return DEFAULT_QUICK_SELECT_TILES; } }
export function saveTiles(t: QuickSelectTile[]) { try { localStorage.setItem(SK, JSON.stringify(t)); } catch {} }
export function createTile(i: Omit<QuickSelectTile, "id" | "createdAt" | "updatedAt">): QuickSelectTile { return { ...i, id: uid(), createdAt: now(), updatedAt: now(), custom: true }; }
export function resetToDefaults(): QuickSelectTile[] { localStorage.removeItem(SK); return DEFAULT_QUICK_SELECT_TILES; }
export const MODALITIES: Record<string, string[]> = { MR: ["Brain","Cervical Spine","C Spine","LS Spine","Dorsal Spine","Thoracic Spine","Whole Spine","Shoulder","Knee"], CT: ["Brain","Chest","Abdomen","Neck","LS Spine","PNS","Pelvis"], XR: ["LS Spine","C Spine","Cervical Spine","Chest","Abdomen","Skull","PNS","Pelvis","KUB","Knee"], US: ["Abdomen","OB","KUB","Pelvis","Thyroid","Scrotum","Breast","Doppler"], MG: ["Breast"], DX: ["Chest","Abdomen"], NM: ["Whole Body","Bone"], PT: ["Whole Body"], DOPPLER: ["Carotid","Lower Limb","Upper Limb","Renal"], ECHO: ["Heart"], USG_OB: ["OB"] };
