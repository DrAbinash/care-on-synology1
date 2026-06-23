/**
 * AI Model Routing routes (Phase 4: Model Routing)
 *
 * Maps each logical AI task (clinical_notes, billing_insights, radiology_draft,
 * ...) to a specific provider + optional model. Tasks with no active route fall
 * back to the global default provider, so this is purely additive.
 *
 * Security model:
 *  - All routes require requireStaffAuth (enforced at mount in routes/index.ts)
 *  - Read (GET) allowed to any authenticated staff
 *  - Mutations (PUT/DELETE) require canConfigure
 *    (admin/superadmin or "ai_reporting.configure" permission)
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { aiModelRoutesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  AI_TASK_CATALOG,
  AI_TASK_KEYS,
  BUILTIN_PROVIDER_NAMES,
  BUILTIN_PROVIDER_CONFIGS,
} from "@workspace/ai-providers";
import { type StaffAuthRequest, FULL_ACCESS_ROLES } from "../middleware/requireStaffAuth";

export const aiModelRoutesRouter = Router();

function canConfigure(req: StaffAuthRequest): boolean {
  const u = req.staffSession ?? null;
  if (!u) return false;
  if (FULL_ACCESS_ROLES.has(u.role)) return true;
  return u.permissions.includes("ai_reporting.configure");
}

/**
 * GET / — return the task catalog, the available providers (with their models),
 * and any routes currently configured. The UI joins these to render one row per
 * task with a provider/model picker.
 */
aiModelRoutesRouter.get("/", async (req, res): Promise<void> => {
  const rows = await db.select().from(aiModelRoutesTable);
  const routesByTask: Record<string, { provider: string; model: string | null; isActive: boolean }> = {};
  for (const r of rows) {
    routesByTask[r.taskKey] = {
      provider: r.provider,
      model: r.model ?? null,
      isActive: r.isActive ?? true,
    };
  }

  const providers = BUILTIN_PROVIDER_NAMES.map((name) => ({
    name,
    label: BUILTIN_PROVIDER_CONFIGS[name]?.label ?? name,
    models: BUILTIN_PROVIDER_CONFIGS[name]?.defaultModels ?? [],
  }));

  res.json({
    tasks: AI_TASK_CATALOG,
    providers,
    routes: routesByTask,
  });
});

/**
 * PUT /:taskKey — upsert the route for a task. Body: { provider, model?, isActive? }.
 */
aiModelRoutesRouter.put("/:taskKey", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) {
    res.status(403).json({ error: "Insufficient permissions." });
    return;
  }

  const taskKey = String(req.params.taskKey ?? "").trim();
  if (!AI_TASK_KEYS.includes(taskKey)) {
    res.status(400).json({ error: "Unknown task." });
    return;
  }

  const { provider, model, isActive } = req.body as {
    provider?: string;
    model?: string | null;
    isActive?: boolean;
  };

  if (!provider || !BUILTIN_PROVIDER_NAMES.includes(provider)) {
    res.status(400).json({ error: "A valid provider is required." });
    return;
  }

  const cleanModel = model?.trim() ? model.trim() : null;
  const updatedBy = sReq.staffSession?.subjectName ?? "staff";

  const [existing] = await db
    .select({ id: aiModelRoutesTable.id })
    .from(aiModelRoutesTable)
    .where(eq(aiModelRoutesTable.taskKey, taskKey))
    .limit(1);

  if (existing) {
    await db
      .update(aiModelRoutesTable)
      .set({
        provider,
        model: cleanModel,
        isActive: isActive ?? true,
        updatedBy,
      })
      .where(eq(aiModelRoutesTable.id, existing.id));
  } else {
    await db.insert(aiModelRoutesTable).values({
      taskKey,
      provider,
      model: cleanModel,
      isActive: isActive ?? true,
      updatedBy,
    });
  }

  res.json({ success: true });
});

/**
 * DELETE /:taskKey — remove a task's route, reverting it to the default provider.
 */
aiModelRoutesRouter.delete("/:taskKey", async (req, res): Promise<void> => {
  const sReq = req as StaffAuthRequest;
  if (!canConfigure(sReq)) {
    res.status(403).json({ error: "Insufficient permissions." });
    return;
  }
  const taskKey = String(req.params.taskKey ?? "").trim();
  await db.delete(aiModelRoutesTable).where(eq(aiModelRoutesTable.taskKey, taskKey));
  res.json({ success: true });
});
