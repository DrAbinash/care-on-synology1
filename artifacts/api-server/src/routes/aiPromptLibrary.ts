/**
 * AI Prompt Library routes (Phase 7A: Advanced Multi-AI Radiology Assistant)
 *
 * Security:
 *  - All routes require requireStaffAuth
 *  - Read allowed to any authenticated staff
 *  - Mutations (POST/PUT/DELETE/restore/clone/test) require canConfigure
 *
 * Features:
 *  - CRUD for prompt library entries (JSON prompts per category)
 *  - Version history (create, restore, clone, compare)
 *  - Prompt testing against any provider
 *  - JSON import/export
 *  - Doctor-specific library filtering
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { aiPromptLibraryTable, aiPromptLibraryVersionsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";
import { generateAiResponse, BUILTIN_PROVIDER_NAMES } from "@workspace/ai-providers";

export const aiPromptLibraryRouter = Router();

function canConfigure(req: StaffAuthRequest): boolean {
  const u = req.staffSession ?? null;
  if (!u) return false;
  if (FULL_ACCESS_ROLES.has(u.role)) return true;
  return u.permissions.includes("ai_reporting.configure");
}

const VALID_MODALITIES = ["MRI", "CT", "USG", "X-Ray", "OTHER", "Mammography", "Doppler", "HRCT"] as const;
const VALID_PROMPT_TYPES = [
  "system", "image_review", "findings", "impression", "differential",
  "followup", "quality", "polish", "formatting",
] as const;
const VALID_OWNERS = ["care_diagnostics", "dr_sugandha", "dr_abinash", "hope_hospital"] as const;

function normalizeModality(input: unknown): string {
  const m = String(input ?? "").trim();
  const found = VALID_MODALITIES.find((v) => v.toLowerCase() === m.toLowerCase());
  return found ?? "OTHER";
}

function normalizeOwner(input: unknown): string {
  const o = String(input ?? "").trim().toLowerCase();
  const found = VALID_OWNERS.find((v) => v === o);
  return found ?? "care_diagnostics";
}

function validatePromptsJson(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null) return {};
  const result: Record<string, string> = {};
  for (const key of VALID_PROMPT_TYPES) {
    const val = (input as Record<string, unknown>)[key];
    if (typeof val === "string") result[key] = val.trim();
  }
  return result;
}

// ── GET /api/ai-prompt-library ──
aiPromptLibraryRouter.get("/", async (req, res): Promise<void> => {
  const modality = req.query["modality"] as string | undefined;
  const owner = req.query["owner"] as string | undefined;

  const conditions = [
    eq(aiPromptLibraryTable.isActive, true),
  ];
  if (modality) conditions.push(eq(aiPromptLibraryTable.modality, normalizeModality(modality)));
  if (owner) conditions.push(eq(aiPromptLibraryTable.libraryOwner, normalizeOwner(owner)));

  const rows = await db
    .select()
    .from(aiPromptLibraryTable)
    .where(and(...conditions))
    .orderBy(aiPromptLibraryTable.name);

  res.json({
    entries: rows.map((r) => ({
      ...r,
      prompts: r.promptsJson,
    })),
  });
});

// ── GET /api/ai-prompt-library/:id ──
aiPromptLibraryRouter.get("/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select()
    .from(aiPromptLibraryTable)
    .where(eq(aiPromptLibraryTable.id, id))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  // Fetch versions
  const versions = await db
    .select({ id: aiPromptLibraryVersionsTable.id, version: aiPromptLibraryVersionsTable.version, changeNotes: aiPromptLibraryVersionsTable.changeNotes, createdBy: aiPromptLibraryVersionsTable.createdBy, createdAt: aiPromptLibraryVersionsTable.createdAt })
    .from(aiPromptLibraryVersionsTable)
    .where(eq(aiPromptLibraryVersionsTable.libraryId, id))
    .orderBy(desc(aiPromptLibraryVersionsTable.version));

  res.json({
    ...row,
    prompts: row.promptsJson,
    versions,
  });
});

// ── POST /api/ai-prompt-library ──
aiPromptLibraryRouter.post("/", async (req, res): Promise<void> => {
  if (!canConfigure(req as StaffAuthRequest)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const { name, modality, prompts, libraryOwner, isActive } = req.body as {
    name?: string;
    modality?: string;
    prompts?: unknown;
    libraryOwner?: string;
    isActive?: boolean;
  };

  if (!name?.trim()) { res.status(400).json({ error: "Name is required." }); return; }

  const promptsJson = validatePromptsJson(prompts);
  const owner = normalizeOwner(libraryOwner);

  // Check for duplicate name+owner
  const existing = await db
    .select({ id: aiPromptLibraryTable.id })
    .from(aiPromptLibraryTable)
    .where(and(eq(aiPromptLibraryTable.name, name.trim()), eq(aiPromptLibraryTable.libraryOwner, owner)))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "A prompt library entry with this name already exists for this owner." }); return;
  }

  const [row] = await db
    .insert(aiPromptLibraryTable)
    .values({
      name: name.trim(),
      modality: normalizeModality(modality),
      promptsJson,
      libraryOwner: owner,
      isActive: isActive !== false,
      version: 1,
      createdBy: (req as StaffAuthRequest).staffSession?.subjectName ?? null,
    })
    .returning();

  // Save initial version
  await db.insert(aiPromptLibraryVersionsTable).values({
    libraryId: row.id,
    version: 1,
    promptsJson,
    changeNotes: "Initial creation",
    createdBy: (req as StaffAuthRequest).staffSession?.subjectName ?? null,
  });

  res.json({ entry: { ...row, prompts: row.promptsJson } });
});

// ── PUT /api/ai-prompt-library/:id ──
aiPromptLibraryRouter.put("/:id", async (req, res): Promise<void> => {
  if (!canConfigure(req as StaffAuthRequest)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { name, modality, prompts, libraryOwner, isActive, changeNotes } = req.body as {
    name?: string;
    modality?: string;
    prompts?: unknown;
    libraryOwner?: string;
    isActive?: boolean;
    changeNotes?: string;
  };

  const [existing] = await db
    .select()
    .from(aiPromptLibraryTable)
    .where(eq(aiPromptLibraryTable.id, id))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const promptsJson = prompts !== undefined ? validatePromptsJson(prompts) : existing.promptsJson;
  const newVersion = (existing.version ?? 1) + 1;

  const update: Partial<typeof aiPromptLibraryTable.$inferInsert> = {
    version: newVersion,
    promptsJson,
    updatedBy: (req as StaffAuthRequest).staffSession?.subjectName ?? null,
  };
  if (name !== undefined) update.name = name.trim();
  if (modality !== undefined) update.modality = normalizeModality(modality);
  if (libraryOwner !== undefined) update.libraryOwner = normalizeOwner(libraryOwner);
  if (isActive !== undefined) update.isActive = isActive;

  const [row] = await db
    .update(aiPromptLibraryTable)
    .set(update)
    .where(eq(aiPromptLibraryTable.id, id))
    .returning();

  // Save version
  await db.insert(aiPromptLibraryVersionsTable).values({
    libraryId: id,
    version: newVersion,
    promptsJson,
    changeNotes: changeNotes?.trim() || "Updated via prompt manager",
    createdBy: (req as StaffAuthRequest).staffSession?.subjectName ?? null,
  });

  res.json({ entry: { ...row, prompts: row.promptsJson } });
});

// ── POST /api/ai-prompt-library/:id/restore ──
aiPromptLibraryRouter.post("/:id/restore", async (req, res): Promise<void> => {
  if (!canConfigure(req as StaffAuthRequest)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const id = Number(req.params.id);
  const { version } = req.body as { version?: number };
  if (!Number.isFinite(id) || !Number.isFinite(version ?? 0)) {
    res.status(400).json({ error: "Invalid id or version." }); return;
  }

  const [ver] = await db
    .select()
    .from(aiPromptLibraryVersionsTable)
    .where(and(eq(aiPromptLibraryVersionsTable.libraryId, id), eq(aiPromptLibraryVersionsTable.version, version!)))
    .limit(1);
  if (!ver) { res.status(404).json({ error: "Version not found." }); return; }

  const [existing] = await db
    .select()
    .from(aiPromptLibraryTable)
    .where(eq(aiPromptLibraryTable.id, id))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Library entry not found." }); return; }

  const newVersion = (existing.version ?? 1) + 1;
  const [row] = await db
    .update(aiPromptLibraryTable)
    .set({
      promptsJson: ver.promptsJson,
      version: newVersion,
      updatedBy: (req as StaffAuthRequest).staffSession?.subjectName ?? null,
    })
    .where(eq(aiPromptLibraryTable.id, id))
    .returning();

  await db.insert(aiPromptLibraryVersionsTable).values({
    libraryId: id,
    version: newVersion,
    promptsJson: ver.promptsJson,
    changeNotes: `Restored from version ${version}`,
    createdBy: (req as StaffAuthRequest).staffSession?.subjectName ?? null,
  });

  res.json({ entry: { ...row, prompts: row.promptsJson } });
});

// ── POST /api/ai-prompt-library/:id/clone ──
aiPromptLibraryRouter.post("/:id/clone", async (req, res): Promise<void> => {
  if (!canConfigure(req as StaffAuthRequest)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const id = Number(req.params.id);
  const { newName, newOwner } = req.body as { newName?: string; newOwner?: string };
  if (!Number.isFinite(id) || !newName?.trim()) {
    res.status(400).json({ error: "Invalid id or newName." }); return;
  }

  const [existing] = await db
    .select()
    .from(aiPromptLibraryTable)
    .where(eq(aiPromptLibraryTable.id, id))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Not found." }); return; }

  const owner = normalizeOwner(newOwner);
  const dup = await db
    .select({ id: aiPromptLibraryTable.id })
    .from(aiPromptLibraryTable)
    .where(and(eq(aiPromptLibraryTable.name, newName.trim()), eq(aiPromptLibraryTable.libraryOwner, owner)))
    .limit(1);
  if (dup.length > 0) {
    res.status(409).json({ error: "A prompt library entry with this name already exists for this owner." }); return;
  }

  const [row] = await db
    .insert(aiPromptLibraryTable)
    .values({
      name: newName.trim(),
      modality: existing.modality,
      promptsJson: existing.promptsJson,
      libraryOwner: owner,
      isActive: true,
      isSystem: false,
      version: 1,
      createdBy: (req as StaffAuthRequest).staffSession?.subjectName ?? null,
    })
    .returning();

  await db.insert(aiPromptLibraryVersionsTable).values({
    libraryId: row.id,
    version: 1,
    promptsJson: existing.promptsJson,
    changeNotes: `Cloned from "${existing.name}" (id ${id})`,
    createdBy: (req as StaffAuthRequest).staffSession?.subjectName ?? null,
  });

  res.json({ entry: { ...row, prompts: row.promptsJson } });
});

// ── POST /api/ai-prompt-library/test ──
aiPromptLibraryRouter.post("/test", async (req, res): Promise<void> => {
  if (!canConfigure(req as StaffAuthRequest)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const { promptText, provider, model } = req.body as {
    promptText?: string;
    provider?: string;
    model?: string;
  };

  if (!promptText?.trim()) { res.status(400).json({ error: "promptText is required." }); return; }
  const providerName = (provider && BUILTIN_PROVIDER_NAMES.includes(provider)) ? provider : "gemini";

  const start = Date.now();
  const result = await generateAiResponse(providerName, promptText, [], { model: model || undefined });
  const elapsedMs = Date.now() - start;

  res.json({
    provider: providerName,
    model: model || null,
    response: result.text,
    success: result.success,
    error: result.error || null,
    elapsedMs,
    aiSafetyLabel: "AI Draft – Requires Radiologist Review",
  });
});

// ── POST /api/ai-prompt-library/compare-versions ──
aiPromptLibraryRouter.post("/compare-versions", async (req, res): Promise<void> => {
  const { libraryId, versionA, versionB } = req.body as {
    libraryId?: number;
    versionA?: number;
    versionB?: number;
  };
  if (!libraryId || !versionA || !versionB) {
    res.status(400).json({ error: "libraryId, versionA, versionB required." }); return;
  }

  const [va] = await db
    .select()
    .from(aiPromptLibraryVersionsTable)
    .where(and(eq(aiPromptLibraryVersionsTable.libraryId, libraryId), eq(aiPromptLibraryVersionsTable.version, versionA)))
    .limit(1);
  const [vb] = await db
    .select()
    .from(aiPromptLibraryVersionsTable)
    .where(and(eq(aiPromptLibraryVersionsTable.libraryId, libraryId), eq(aiPromptLibraryVersionsTable.version, versionB)))
    .limit(1);

  if (!va || !vb) { res.status(404).json({ error: "One or both versions not found." }); return; }

  const aPrompts = va.promptsJson as Record<string, string>;
  const bPrompts = vb.promptsJson as Record<string, string>;
  const allKeys = [...new Set([...Object.keys(aPrompts), ...Object.keys(bPrompts)])];

  const diff = allKeys.map((k) => ({
    key: k,
    a: aPrompts[k] || "",
    b: bPrompts[k] || "",
    changed: (aPrompts[k] || "") !== (bPrompts[k] || ""),
  }));

  res.json({
    versionA: va.version,
    versionB: vb.version,
    createdAtA: va.createdAt,
    createdAtB: vb.createdAt,
    diff,
  });
});

// ── POST /api/ai-prompt-library/export ──
aiPromptLibraryRouter.post("/export", async (req, res): Promise<void> => {
  if (!canConfigure(req as StaffAuthRequest)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const { owner } = req.body as { owner?: string };
  const conditions = [eq(aiPromptLibraryTable.isActive, true)];
  if (owner) conditions.push(eq(aiPromptLibraryTable.libraryOwner, normalizeOwner(owner)));

  const rows = await db
    .select()
    .from(aiPromptLibraryTable)
    .where(and(...conditions))
    .orderBy(aiPromptLibraryTable.name);

  const exportData = {
    exportedAt: new Date().toISOString(),
    exportedBy: (req as StaffAuthRequest).staffSession?.subjectName ?? null,
    version: 1,
    entries: rows.map((r) => ({
      name: r.name,
      modality: r.modality,
      libraryOwner: r.libraryOwner,
      prompts: r.promptsJson,
    })),
  };

  res.json(exportData);
});

// ── POST /api/ai-prompt-library/import ──
aiPromptLibraryRouter.post("/import", async (req, res): Promise<void> => {
  if (!canConfigure(req as StaffAuthRequest)) {
    res.status(403).json({ error: "Insufficient permissions." }); return;
  }

  const { entries, overwrite } = req.body as {
    entries?: Array<{ name: string; modality?: string; libraryOwner?: string; prompts?: unknown }>;
    overwrite?: boolean;
  };

  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ error: "No entries provided." }); return;
  }

  const imported: Array<{ id: number; name: string }> = [];
  const skipped: string[] = [];

  for (const e of entries) {
    const name = e.name?.trim();
    if (!name) continue;
    const owner = normalizeOwner(e.libraryOwner);
    const promptsJson = validatePromptsJson(e.prompts);

    const existing = await db
      .select({ id: aiPromptLibraryTable.id })
      .from(aiPromptLibraryTable)
      .where(and(eq(aiPromptLibraryTable.name, name), eq(aiPromptLibraryTable.libraryOwner, owner)))
      .limit(1);

    if (existing.length > 0 && !overwrite) {
      skipped.push(name);
      continue;
    }

    if (existing.length > 0 && overwrite) {
      await db
        .update(aiPromptLibraryTable)
        .set({
          promptsJson,
          modality: normalizeModality(e.modality),
          version: sql`${aiPromptLibraryTable.version} + 1`,
          updatedBy: (req as StaffAuthRequest).staffSession?.subjectName ?? null,
        })
        .where(eq(aiPromptLibraryTable.id, existing[0].id));
      imported.push({ id: existing[0].id, name });
    } else {
      const [row] = await db
        .insert(aiPromptLibraryTable)
        .values({
          name,
          modality: normalizeModality(e.modality),
          promptsJson,
          libraryOwner: owner,
          isActive: true,
          version: 1,
          createdBy: (req as StaffAuthRequest).staffSession?.subjectName ?? null,
        })
        .returning();
      imported.push({ id: row.id, name });
    }
  }

  res.json({ imported, skipped, count: imported.length });
});
