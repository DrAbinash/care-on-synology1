// ─────────────────────────────────────────────────────────────────────────────
// Content Pack Tiles API — serves YAML content-pack findings as QuickSelectTiles
// to the frontend reporting workspace.
//
// Unlike /api/radiology/catalog (which is gated behind ff_radiology_catalog and
// requires the full import pipeline), this route reads the YAML content packs
// directly from seeds/radiology/content-packs/v1/ and transforms them into the
// QuickSelectTile shape the frontend already understands.
//
// This is the bridge between the rich per-study clinical content in the YAML
// packs and the reporting workspace's quick-select strip. It runs WITHOUT
// requiring the catalog feature flag — the YAML packs are seed data, not
// mutable catalog state.
//
// Mounted at /api/radiology/content-pack-tiles behind requireStaffAuth.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from "express";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const router = Router();

// ── Path resolution ────────────────────────────────────────────────────────────
// The content packs live in seeds/radiology/content-packs/v1/. We resolve
// relative to the server's module location so it works in both dev and the
// Docker container (where the seeds directory is COPYd into the image).
const SEEDS_DIR = process.env.RADIOLOGY_SEEDS_DIR || findSeedsDir();

function findSeedsDir(): string {
  // Try several known locations relative to the server root.
  const candidates = [
    // Dev: artifacts/api-server/dist/../../seeds/radiology/content-packs/v1
    join(process.cwd(), "seeds", "radiology", "content-packs", "v1"),
    // Docker: /app/seeds/radiology/content-packs/v1
    "/app/seeds/radiology/content-packs/v1",
    // Relative to this module when bundled
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "seeds", "radiology", "content-packs", "v1"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]; // fall through; will 404 gracefully
}

// ── Types matching the frontend QuickSelectTile ───────────────────────────────
interface PackTile {
  id: string;
  field: "clinicalHistory" | "technique" | "findings" | "impression" | "recommendation";
  scopeModality?: string;
  scopeBodyPart?: string;
  label: string;
  mnemonic?: string;
  category: "normal" | "abnormal" | "variant" | "critical";
  sentence: string;
  impressionSentence?: string;
  favorite?: boolean;
  anatomicalSection?: string;
  conflictGroup?: string;
  // Extended fields from the YAML packs that the current tile type doesn't carry
  // but future enhancements (per-study AI rules, differentials) will use.
  packId?: string;
  findingId?: string;
  differentials?: string[];
  followUps?: string[];
  recommendations?: string[];
  criticality?: string;
  // Per-study AI rules (completeness + contradiction) for the gutter
  completenessRules?: Array<{ id: string; glyph: string; rule: string; message: string }>;
  contradictionRules?: Array<{ id: string; severity: "block" | "warn"; glyph: string; rule: string; message: string }>;
}

// ── YAML pack loading + caching ───────────────────────────────────────────────
interface LoadedYamlPack {
  packId: string;
  modality: string;
  study: string;
  aliases: string[];
  findings: any[];
  quickSelectGroups?: any[];
  normalTemplate?: string;
  loadedAt: number;
}

let packCache: LoadedYamlPack[] | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — reload picks up new packs without restart

function loadYamlPacks(): LoadedYamlPack[] {
  if (packCache && Date.now() - packCache[0]?.loadedAt < CACHE_TTL_MS) {
    return packCache;
  }
  const packs: LoadedYamlPack[] = [];
  if (!existsSync(SEEDS_DIR)) {
    return packs;
  }
  const files = readdirSync(SEEDS_DIR).filter(f => f.endsWith(".yaml") && !f.startsWith("_"));
  for (const file of files) {
    try {
      const raw = readFileSync(join(SEEDS_DIR, file), "utf-8");
      const parsed = yaml.load(raw) as any;
      if (!parsed?.pack?.pack_id || !parsed?.findings) continue;
      packs.push({
        packId: parsed.pack.pack_id,
        modality: parsed.study?.modality || "",
        study: parsed.study?.study || parsed.study?.display_name || parsed.pack.pack_id,
        aliases: parsed.study?.aliases || [],
        findings: parsed.findings,
        quickSelectGroups: parsed.study?.quick_select_groups,
        normalTemplate: parsed.normal_template,
        loadedAt: Date.now(),
      });
    } catch (err) {
      console.error(`[content-pack-tiles] Failed to load ${file}:`, err);
    }
  }
  packCache = packs;
  return packs;
}

// ── Shared templates (technique + clinical details) ───────────────────────────
interface SharedTemplates {
  technique: Array<{ key: string; label: string; sentence: string; modality?: string; bodyPart?: string }>;
  clinicalDetails: Array<{ key: string; label: string; sentence: string; modality?: string; bodyPart?: string }>;
}

let sharedTemplatesCache: SharedTemplates | null = null;

function loadSharedTemplates(): SharedTemplates {
  if (sharedTemplatesCache) return sharedTemplatesCache;
  const empty: SharedTemplates = { technique: [], clinicalDetails: [] };
  if (!existsSync(SEEDS_DIR)) return empty;
  const sharedFile = join(SEEDS_DIR, "_shared_libraries.yaml");
  if (!existsSync(sharedFile)) return empty;
  try {
    const raw = readFileSync(sharedFile, "utf-8");
    const parsed = yaml.load(raw) as any;
    const technique: SharedTemplates["technique"] = [];
    const clinicalDetails: SharedTemplates["clinicalDetails"] = [];

    if (parsed?.technique_templates) {
      for (const [key, sentence] of Object.entries(parsed.technique_templates)) {
        // Extract modality/bodyPart from the key: tpl.technique.mri_brain → MR, Brain
        const parts = key.split(".");
        if (parts.length < 3) continue;
        const studyPart = parts[2]; // e.g. "mri_brain"
        const label = studyPart.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        const modality = modalityCode(studyPart.startsWith("mri") ? "MR" : studyPart.startsWith("ct") ? "CT" : studyPart.startsWith("usg") || studyPart.startsWith("us") ? "US" : studyPart.startsWith("cxr") || studyPart.startsWith("xr") ? "XR" : studyPart.startsWith("mammog") ? "MG" : studyPart.startsWith("doppler") ? "DOPPLER" : "");
        const bodyPart = bodyPartFromStudy(studyPart.replace(/_/g, " "));
        technique.push({ key, label: `Technique: ${label}`, sentence: sentence as string, modality, bodyPart });
      }
    }

    if (parsed?.clinical_details_templates) {
      for (const [key, sentence] of Object.entries(parsed.clinical_details_templates)) {
        const parts = key.split(".");
        if (parts.length < 3) continue;
        const clinicalPart = parts[2]; // e.g. "mri_brain_headache"
        const label = clinicalPart.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        const modality = modalityCode(clinicalPart.startsWith("mri") ? "MR" : clinicalPart.startsWith("ct") ? "CT" : clinicalPart.startsWith("usg") || clinicalPart.startsWith("us") ? "US" : clinicalPart.startsWith("cxr") || clinicalPart.startsWith("xr") ? "XR" : clinicalPart.startsWith("mammog") ? "MG" : clinicalPart.startsWith("doppler") ? "DOPPLER" : "");
        const bodyPart = bodyPartFromStudy(clinicalPart.replace(/_/g, " "));
        clinicalDetails.push({ key, label, sentence: sentence as string, modality, bodyPart });
      }
    }

    sharedTemplatesCache = { technique, clinicalDetails };
    return sharedTemplatesCache;
  } catch (err) {
    console.error("[content-pack-tiles] Failed to load shared templates:", err);
    return empty;
  }
}

// ── Transform: YAML finding → QuickSelectTile ────────────────────────────────
function modalityCode(yamlModality: string): string | undefined {
  const m = (yamlModality || "").toUpperCase();
  // Map YAML modality names to the frontend Modality type
  if (["MR", "MRI"].includes(m)) return "MR";
  if (["CT"].includes(m)) return "CT";
  if (["US", "USG", "ULTRASOUND"].includes(m)) return "US";
  if (["XR", "XRAY", "X-RAY"].includes(m)) return "XR";
  if (["MG", "MAMMO", "MAMMOGRAPHY"].includes(m)) return "MG";
  if (["DOPPLER"].includes(m)) return "DOPPLER";
  return undefined;
}

function bodyPartFromStudy(studyName: string): string | undefined {
  const s = studyName.toLowerCase();
  if (s.includes("brain")) return "Brain";
  if (s.includes("ls spine") || s.includes("lumbo-sacral")) return "LS Spine";
  if (s.includes("c spine") || s.includes("cervical spine")) return "C Spine";
  if (s.includes("dorsal spine") || s.includes("thoracic spine")) return "Dorsal Spine";
  if (s.includes("whole spine")) return "Whole Spine";
  if (s.includes("chest") || s.includes("hrct")) return "Chest";
  if (s.includes("abdomen")) return "Abdomen";
  if (s.includes("kub")) return "KUB";
  if (s.includes("knee")) return "Knee";
  if (s.includes("shoulder")) return "Shoulder";
  if (s.includes("wrist")) return "Wrist";
  if (s.includes("ankle")) return "Ankle";
  if (s.includes("breast") || s.includes("mammog")) return "Breast";
  if (s.includes("orbits")) return "Orbits";
  if (s.includes("pituitary")) return "Pituitary";
  if (s.includes("posterior fossa") || s.includes("cp angle")) return "Posterior Fossa";
  if (s.includes("trigeminal")) return "Trigeminal";
  if (s.includes("epilepsy")) return "Brain";
  if (s.includes("doppler")) return "Lower Limb";
  return undefined;
}

function categoryFromFinding(f: any): "normal" | "abnormal" | "variant" | "critical" {
  if (f.normal_variant) return "variant";
  if (f.criticality && typeof f.criticality === "object" && f.criticality.critical) return "critical";
  if (f.criticality === "none" || !f.criticality) return "normal";
  return "abnormal";
}

function extractAiRules(f: any): {
  completenessRules?: Array<{ id: string; glyph: string; rule: string; message: string }>;
  contradictionRules?: Array<{ id: string; severity: "block" | "warn"; glyph: string; rule: string; message: string }>;
} {
  // Handle both v1.1 nested format (ai.completeness_checks) and v1 flat format (ai_completeness_rules)
  const ai = f.ai;
  if (ai) {
    return {
      completenessRules: (ai.completeness_checks || []).map((r: any) => ({
        id: r.id, glyph: r.glyph || "circle", rule: r.rule || "", message: r.message || "",
      })),
      contradictionRules: (ai.contradiction_checks || []).map((r: any) => ({
        id: r.id, severity: r.severity || "warn", glyph: r.glyph || "triangle",
        rule: r.rule || "", message: r.message || "",
      })),
    };
  }
  // Flat v1 format
  const completenessRules = (f.ai_completeness_rules || []).map((r: any) => ({
    id: r.id, glyph: r.glyph || "circle", rule: r.rule || "", message: r.message || "",
  }));
  const contradictionRules = (f.ai_contradiction_rules || []).map((r: any) => ({
    id: r.id, severity: r.severity || "warn", glyph: r.glyph || "triangle",
    rule: r.rule || "", message: r.message || "",
  }));
  return { completenessRules, contradictionRules };
}

function findingToTile(pack: LoadedYamlPack, f: any): PackTile {
  const aiRules = extractAiRules(f);
  const modality = modalityCode(pack.modality);
  const bodyPart = bodyPartFromStudy(pack.study);
  const aliases = f.keyboard_aliases || f.keyboard_alias || [];
  const mnemonic = Array.isArray(aliases) ? aliases[0] : aliases;

  return {
    id: `pack_${pack.packId}_${f.id_key}`,
    field: "findings", // content-pack findings map to the findings field
    scopeModality: modality,
    scopeBodyPart: bodyPart,
    label: f.display_name || f.id_key,
    mnemonic,
    category: categoryFromFinding(f),
    sentence: f.default_sentence || "",
    impressionSentence: f.impression_fragment || undefined,
    favorite: false, // packs don't set favorite; user can pin manually
    packId: pack.packId,
    findingId: f.id_key,
    differentials: f.ai?.differential || f.differential || [],
    followUps: f.ai?.follow_up || f.follow_up || [],
    recommendations: f.recommendation || [],
    criticality: typeof f.criticality === "object" ? f.criticality?.critical : f.criticality,
    ...aiRules,
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/radiology/content-pack-tiles
// Returns all content-pack findings as QuickSelectTiles, optionally filtered by modality.
router.get("/", (req: Request, res: Response) => {
  try {
    const packs = loadYamlPacks();
    const modalityFilter = (req.query.modality as string)?.toUpperCase();
    const studyFilter = req.query.study as string;

    const tiles: PackTile[] = [];
    for (const pack of packs) {
      if (modalityFilter && modalityCode(pack.modality) !== modalityFilter) continue;
      if (studyFilter && !pack.study.toLowerCase().includes(studyFilter.toLowerCase())) continue;
      for (const f of pack.findings) {
        tiles.push(findingToTile(pack, f));
      }
    }

    // Also load technique and clinical details templates from shared libraries
    const sharedTemplates = loadSharedTemplates();

    res.json({
      tiles,
      count: tiles.length,
      packCount: packs.length,
      techniqueTemplates: sharedTemplates.technique,
      clinicalDetailsTemplates: sharedTemplates.clinicalDetails,
    });
  } catch (err) {
    console.error("[content-pack-tiles] Error:", err);
    res.status(500).json({ error: "Failed to load content-pack tiles", tiles: [], count: 0, packCount: 0 });
  }
});

// GET /api/radiology/content-pack-tiles/studies
// Returns the list of study types covered by content packs (for the UI to show coverage).
router.get("/studies", (_req: Request, res: Response) => {
  try {
    const packs = loadYamlPacks();
    const studies = packs.map(p => ({
      packId: p.packId,
      study: p.study,
      modality: modalityCode(p.modality),
      bodyPart: bodyPartFromStudy(p.study),
      aliases: p.aliases,
      findingCount: p.findings.length,
      hasQuickSelectGroups: !!p.quickSelectGroups?.length,
    }));
    res.json({ studies, count: studies.length });
  } catch (err) {
    console.error("[content-pack-tiles/studies] Error:", err);
    res.status(500).json({ error: "Failed to load studies", studies: [], count: 0 });
  }
});

// GET /api/radiology/content-pack-tiles/:packId
// Returns tiles for a single content pack (by pack_id, e.g. "mri_brain").
router.get("/:packId", (req: Request, res: Response) => {
  try {
    const packs = loadYamlPacks();
    const pack = packs.find(p => p.packId === req.params.packId);
    if (!pack) {
      return res.status(404).json({ error: `Pack '${req.params.packId}' not found` });
    }
    const tiles = pack.findings.map((f: any) => findingToTile(pack, f));
    res.json({
      packId: pack.packId,
      study: pack.study,
      modality: modalityCode(pack.modality),
      bodyPart: bodyPartFromStudy(pack.study),
      tiles,
      quickSelectGroups: pack.quickSelectGroups,
    });
  } catch (err) {
    console.error(`[content-pack-tiles/${req.params.packId}] Error:`, err);
    res.status(500).json({ error: "Failed to load pack" });
  }
});

export default router;
