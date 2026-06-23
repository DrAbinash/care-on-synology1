/**
 * AI Prompt Templates routes (Phase 1: AI Prompt Template Engine)
 *
 * Security model:
 *  - All routes require requireStaffAuth (enforced at mount in routes/index.ts)
 *  - Read (GET) allowed to any authenticated staff (used by the AI report drawer)
 *  - Mutations (POST/PUT/DELETE) + seeding require canConfigure
 *    (admin/superadmin or "ai_reporting.configure" permission)
 *
 * Templates are modality-aware, versioned, and fully editable without code
 * changes. They drive AI radiology draft generation: Study Type → matching
 * prompt selected → AI report generated.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { aiPromptTemplatesTable } from "@workspace/db";
import { eq, asc, and, ne, sql } from "drizzle-orm";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";

export const aiPromptTemplatesRouter = Router();

const VALID_MODALITIES = ["MRI", "CT", "USG", "X-Ray", "OTHER"] as const;

function canConfigure(req: StaffAuthRequest): boolean {
  const u = req.staffSession ?? null;
  if (!u) return false;
  if (FULL_ACCESS_ROLES.has(u.role)) return true;
  return u.permissions.includes("ai_reporting.configure");
}

function normalizeModality(input: unknown): string {
  const m = String(input ?? "").trim();
  const found = VALID_MODALITIES.find((v) => v.toLowerCase() === m.toLowerCase());
  return found ?? "OTHER";
}

// ─── Seed presets (the curated Care Diagnostics template library) ─────────────
// Used to populate the table the first time. After seeding, everything is
// edited from the UI; re-seeding only inserts templates that are missing (by
// name), it never overwrites user edits.
const SEED_TEMPLATES: Array<{ name: string; modality: string; promptContent: string }> = [
  // ── MRI ──────────────────────────────────────────────────────────────────
  {
    name: "MRI Brain",
    modality: "MRI",
    promptContent:
      "Provide a detailed radiology report for this MRI Brain study. Report findings sequence by sequence (T1W, T2W, FLAIR, DWI/ADC, T1W+Contrast if available, SWI/GRE). Comment on parenchyma, white matter, ventricles, sulci, basal ganglia, thalami, brainstem, cerebellum, extra-axial spaces and vascular structures. Conclude with an Impression.",
  },
  {
    name: "MRI Pituitary",
    modality: "MRI",
    promptContent:
      "Provide a dedicated MRI Pituitary report. Comment on the size, shape and signal of the pituitary gland, gland height, infundibulum position, optic chiasm, cavernous sinuses and ICA flow voids. Describe any focal lesion (micro/macroadenoma) with size, signal and enhancement pattern on dynamic post-contrast sequences. Conclude with an Impression.",
  },
  {
    name: "MRI Cervical Spine",
    modality: "MRI",
    promptContent:
      "Provide a detailed MRI Cervical Spine report. Comment on vertebral alignment and marrow signal, craniovertebral junction, each disc level (C2-3 to C7-T1) for disc desiccation/height/herniation, neural foramina, spinal canal diameter, and cord signal/calibre. Summarise significant stenosis or cord compression. Conclude with an Impression.",
  },
  {
    name: "MRI Dorsal Spine",
    modality: "MRI",
    promptContent:
      "Provide a detailed MRI Dorsal (Thoracic) Spine report. Comment on alignment, vertebral body height and marrow signal, each disc level for desiccation/herniation, neural foramina, spinal canal diameter, and cord signal/calibre. Note any compression fracture, lesion or cord signal abnormality. Conclude with an Impression.",
  },
  {
    name: "MRI LS Spine",
    modality: "MRI",
    promptContent:
      "Provide a detailed MRI Lumbosacral Spine report. For each level (L1-2 to L5-S1) comment on disc height/signal, disc bulge/protrusion/extrusion, facet arthropathy, ligamentum flavum, neural foramina, thecal sac and traversing/exiting nerve roots. Note conus position and signal. Summarise canal/foraminal stenosis. Conclude with an Impression.",
  },
  {
    name: "MRI Whole Spine Screening",
    modality: "MRI",
    promptContent:
      "Provide an MRI Whole Spine Screening report. Survey the entire spinal column (cervical, dorsal, lumbosacral) for alignment, vertebral marrow signal, disc disease at each region, cord signal abnormality, drop metastases, syrinx, and any focal lesion. Highlight any level requiring dedicated imaging. Conclude with an Impression.",
  },
  {
    name: "MRI Knee",
    modality: "MRI",
    promptContent:
      "Provide a detailed MRI Knee report. Systematically assess the menisci (medial/lateral, body/horns), cruciate ligaments (ACL/PCL), collateral ligaments (MCL/LCL), articular cartilage of all compartments, patellofemoral joint, bone marrow (oedema/contusion/fracture), extensor mechanism, and joint effusion or cysts. Conclude with an Impression.",
  },
  {
    name: "MRI Shoulder",
    modality: "MRI",
    promptContent:
      "Provide a detailed MRI Shoulder report. Assess the rotator cuff tendons (supraspinatus, infraspinatus, subscapularis, teres minor) for tendinosis/partial/full-thickness tears, the long head of biceps tendon, glenoid labrum, glenohumeral and AC joints, articular cartilage, bone marrow, and any effusion or bursitis. Conclude with an Impression.",
  },
  {
    name: "MRI Hip",
    modality: "MRI",
    promptContent:
      "Provide a detailed MRI Hip report. Assess the femoral head and neck for avascular necrosis (with staging if present), acetabulum, labrum, articular cartilage, joint effusion, bone marrow oedema, and surrounding muscles/tendons. Comment on both hips comparatively if imaged. Conclude with an Impression.",
  },
  {
    name: "MRI Orbit",
    modality: "MRI",
    promptContent:
      "Provide a detailed MRI Orbit report. Assess the globes, lens, optic nerves and sheaths, extraocular muscles, retro-orbital fat, lacrimal glands, orbital apex, cavernous sinuses, and any mass, inflammation or enhancement on post-contrast sequences. Conclude with an Impression.",
  },
  // ── CT ───────────────────────────────────────────────────────────────────
  {
    name: "CT Brain",
    modality: "CT",
    promptContent:
      "Provide a structured CT Brain report. Comment on parenchymal density, grey-white differentiation, ventricles and CSF spaces, sulci, midline shift, basal cisterns, bone windows (calvarium, skull base) and any hemorrhage, infarct, mass or oedema. Conclude with an Impression.",
  },
  {
    name: "CT PNS",
    modality: "CT",
    promptContent:
      "Provide a structured CT Paranasal Sinuses report. Comment on each sinus group (maxillary, ethmoid, frontal, sphenoid) for mucosal thickening, fluid, polyps or opacification, the osteomeatal complexes, nasal septum, turbinates, and bony walls. Note any anatomical variant relevant to surgery. Conclude with an Impression.",
  },
  {
    name: "CT Chest",
    modality: "CT",
    promptContent:
      "Provide a structured CT Chest report. Comment on lung parenchyma (nodules, consolidation, ground-glass, fibrosis, emphysema), airways, pleura and pleural spaces, mediastinum and lymph nodes, heart and great vessels, and visualised bones and upper abdomen. Conclude with an Impression.",
  },
  {
    name: "CT Abdomen",
    modality: "CT",
    promptContent:
      "Provide a structured CT Abdomen and Pelvis report. Systematically evaluate liver, gallbladder and biliary tree, pancreas, spleen, adrenals, kidneys and ureters, bowel, mesentery, peritoneum, vasculature, lymph nodes, pelvic organs and visualised bones. Note any free fluid or collection. Conclude with an Impression.",
  },
  // ── USG ──────────────────────────────────────────────────────────────────
  {
    name: "USG Whole Abdomen",
    modality: "USG",
    promptContent:
      "Provide a structured Ultrasound Whole Abdomen report. Systematically evaluate liver (size, echotexture, focal lesions, biliary radicles), gallbladder, CBD, portal vein, pancreas, spleen, both kidneys (size, parenchyma, PCS, calculi), urinary bladder, prostate/uterus and adnexa as applicable, aorta, and any free fluid or lymphadenopathy. Conclude with an Impression.",
  },
  {
    name: "USG KUB",
    modality: "USG",
    promptContent:
      "Provide a structured Ultrasound KUB report. Assess both kidneys for size, cortical thickness, echotexture, hydronephrosis, calculi and any mass; the ureters for dilatation; and the urinary bladder for wall thickness, contents, calculi and post-void residual volume. Conclude with an Impression.",
  },
  {
    name: "USG Pelvis",
    modality: "USG",
    promptContent:
      "Provide a structured Ultrasound Pelvis report. In females assess the uterus (size, endometrial thickness, myometrium, fibroids), both ovaries (volume, follicles, cysts), adnexa and pouch of Douglas. In males assess the urinary bladder and prostate. Conclude with an Impression.",
  },
  {
    name: "USG Breast",
    modality: "USG",
    promptContent:
      "Provide a structured Ultrasound Breast report. Assess both breasts by quadrant and the axillae. Describe any mass (size, shape, margin, orientation, echogenicity, posterior features, vascularity), cysts, ductal changes and lymph nodes. Assign a BI-RADS category. Conclude with an Impression.",
  },
  {
    name: "USG Thyroid",
    modality: "USG",
    promptContent:
      "Provide a structured Ultrasound Thyroid report. Assess both lobes and isthmus for size, echotexture and vascularity. Describe any nodule (size, composition, echogenicity, shape, margin, echogenic foci) and assign a TI-RADS category. Comment on cervical lymph nodes. Conclude with an Impression.",
  },
  {
    name: "USG Soft Tissue",
    modality: "USG",
    promptContent:
      "Provide a structured Ultrasound Soft Tissue report for the region of interest. Describe any lesion (location, depth, size, shape, margin, echogenicity, vascularity, compressibility) and its relation to adjacent muscle, fascia, vessels and bone. Conclude with an Impression.",
  },
  // ── X-Ray ──────────────────────────────────────────────────────────────────
  {
    name: "X-Ray Chest",
    modality: "X-Ray",
    promptContent:
      "Provide a structured Chest X-ray report. Comment on technical adequacy, cardiomediastinal silhouette and cardiothoracic ratio, lung fields and vascularity, hila, costophrenic angles, pleura, diaphragm, bones and soft tissues. Conclude with an Impression.",
  },
  {
    name: "X-Ray Spine",
    modality: "X-Ray",
    promptContent:
      "Provide a structured Spine X-ray report for the imaged region. Comment on alignment and curvature, vertebral body heights, disc spaces, pedicles, posterior elements, and any fracture, listhesis, degenerative change or congenital anomaly. Conclude with an Impression.",
  },
  {
    name: "X-Ray Extremity",
    modality: "X-Ray",
    promptContent:
      "Provide a structured Extremity X-ray report. Comment on bones (cortex, medulla, alignment, any fracture or lesion), joints (space, alignment, effusion), and soft tissues. Specify the views obtained and laterality. Conclude with an Impression.",
  },
];

/**
 * GET /api/ai-prompt-templates
 * Lists templates. Optional ?modality=MRI filter and ?activeOnly=1.
 * Available to any authenticated staff (consumed by the AI report drawer).
 */
aiPromptTemplatesRouter.get("/", async (req, res): Promise<void> => {
  const modality = req.query.modality ? normalizeModality(req.query.modality) : null;
  const activeOnly = req.query.activeOnly === "1" || req.query.activeOnly === "true";

  const conditions = [];
  if (modality) conditions.push(eq(aiPromptTemplatesTable.modality, modality));
  if (activeOnly) conditions.push(eq(aiPromptTemplatesTable.isActive, true));

  const rows = await db
    .select()
    .from(aiPromptTemplatesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(aiPromptTemplatesTable.modality), asc(aiPromptTemplatesTable.name));

  res.json({ templates: rows });
});

/**
 * POST /api/ai-prompt-templates/seed
 * Inserts any missing curated presets (idempotent — never overwrites edits).
 */
aiPromptTemplatesRouter.post("/seed", async (req, res): Promise<void> => {
  if (!canConfigure(req as StaffAuthRequest)) {
    res.status(403).json({ error: "Only administrators can seed prompt templates." });
    return;
  }
  const existing = await db
    .select({ name: aiPromptTemplatesTable.name })
    .from(aiPromptTemplatesTable);
  const existingNames = new Set(existing.map((r) => r.name.toLowerCase()));

  const toInsert = SEED_TEMPLATES.filter((t) => !existingNames.has(t.name.toLowerCase()));
  if (toInsert.length > 0) {
    await db.insert(aiPromptTemplatesTable).values(
      toInsert.map((t) => ({
        name: t.name,
        modality: t.modality,
        promptContent: t.promptContent,
        version: 1,
        createdBy: "system",
        isActive: true,
        isSystem: true,
      })),
    );
  }
  res.json({ success: true, inserted: toInsert.length, skipped: SEED_TEMPLATES.length - toInsert.length });
});

/**
 * POST /api/ai-prompt-templates
 * Creates a new template. Admin/configure only.
 */
aiPromptTemplatesRouter.post("/", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) {
    res.status(403).json({ error: "Only administrators can create prompt templates." });
    return;
  }
  const { name, modality, promptContent, isActive } = req.body as {
    name?: string;
    modality?: string;
    promptContent?: string;
    isActive?: boolean;
  };
  if (!name?.trim() || !promptContent?.trim()) {
    res.status(400).json({ error: "Name and prompt content are required." });
    return;
  }
  const trimmedName = name.trim();
  // Case-insensitive uniqueness so prompt resolution by name stays deterministic.
  const dup = await db
    .select({ id: aiPromptTemplatesTable.id })
    .from(aiPromptTemplatesTable)
    .where(sql`lower(${aiPromptTemplatesTable.name}) = ${trimmedName.toLowerCase()}`)
    .limit(1);
  if (dup[0]) {
    res.status(409).json({ error: `A template named "${trimmedName}" already exists.` });
    return;
  }
  const [row] = await db
    .insert(aiPromptTemplatesTable)
    .values({
      name: trimmedName,
      modality: normalizeModality(modality),
      promptContent: promptContent.trim(),
      version: 1,
      createdBy: sReq.staffSession?.subjectName ?? "staff",
      isActive: isActive ?? true,
      isSystem: false,
    })
    .returning();
  res.json({ template: row });
});

/**
 * PUT /api/ai-prompt-templates/:id
 * Updates a template and bumps its version. Admin/configure only.
 */
aiPromptTemplatesRouter.put("/:id", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) {
    res.status(403).json({ error: "Only administrators can edit prompt templates." });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  const existing = await db
    .select()
    .from(aiPromptTemplatesTable)
    .where(eq(aiPromptTemplatesTable.id, id))
    .limit(1);
  if (!existing[0]) {
    res.status(404).json({ error: "Template not found." });
    return;
  }
  const { name, modality, promptContent, isActive } = req.body as {
    name?: string;
    modality?: string;
    promptContent?: string;
    isActive?: boolean;
  };

  // Reject blank/whitespace-only values that would degrade data quality.
  if (name !== undefined && !name.trim()) {
    res.status(400).json({ error: "Name cannot be empty." });
    return;
  }
  if (promptContent !== undefined && !promptContent.trim()) {
    res.status(400).json({ error: "Prompt content cannot be empty." });
    return;
  }
  // Enforce case-insensitive name uniqueness (excluding this row).
  if (name !== undefined) {
    const dup = await db
      .select({ id: aiPromptTemplatesTable.id })
      .from(aiPromptTemplatesTable)
      .where(
        and(
          sql`lower(${aiPromptTemplatesTable.name}) = ${name.trim().toLowerCase()}`,
          ne(aiPromptTemplatesTable.id, id),
        ),
      )
      .limit(1);
    if (dup[0]) {
      res.status(409).json({ error: `A template named "${name.trim()}" already exists.` });
      return;
    }
  }

  const update: Partial<typeof aiPromptTemplatesTable.$inferInsert> = {};
  if (name !== undefined) update.name = name.trim();
  if (modality !== undefined) update.modality = normalizeModality(modality);
  if (promptContent !== undefined) update.promptContent = promptContent.trim();
  if (isActive !== undefined) update.isActive = isActive;
  // Bump version whenever the prompt content itself changes.
  if (promptContent !== undefined && promptContent.trim() !== existing[0].promptContent) {
    update.version = (existing[0].version ?? 1) + 1;
  }

  const [row] = await db
    .update(aiPromptTemplatesTable)
    .set(update)
    .where(eq(aiPromptTemplatesTable.id, id))
    .returning();
  res.json({ template: row });
});

/**
 * DELETE /api/ai-prompt-templates/:id
 * Removes a template. Admin/configure only.
 */
aiPromptTemplatesRouter.delete("/:id", async (req, res): Promise<void> => {
  if (!canConfigure(req as StaffAuthRequest)) {
    res.status(403).json({ error: "Only administrators can delete prompt templates." });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid template id." });
    return;
  }
  await db.delete(aiPromptTemplatesTable).where(eq(aiPromptTemplatesTable.id, id));
  res.json({ success: true });
});
