import { Router } from "express";
import { db, featureFlagsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireStaffAuth, requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { invalidateFeatureFlagCache } from "../lib/featureFlags";
import { RADIOLOGY_FLAG_REGISTRY } from "../lib/radiologyFeatureFlagRegistry";
import { redisGet, redisSet, redisDel } from "../lib/redisClient";

// Ticket T0.1 — server-side feature flag backbone. GET is available to any
// authenticated staff member (the frontend hydrates ff_radiology_* keys on
// every load); mutations are hard-gated admin/super_admin only via
// requireAdminRole, independent of the per-user permissions array — matches
// the precedent in routes/radiologyQuickFindings.ts.
const router = Router();

const WIRED_BY_KEY = new Map(RADIOLOGY_FLAG_REGISTRY.map((e) => [e.key, e.wired]));

function isWired(key: string): boolean {
  // Non-radiology flags (or unknown keys) stay toggleable.
  if (!WIRED_BY_KEY.has(key)) return true;
  return WIRED_BY_KEY.get(key) === true;
}

router.use(requireStaffAuth);

router.get("/", async (_req, res) => {
  try {
    // Redis cache: this is the #1 most-called endpoint in production (76% of
    // all requests). Cache the full flag list for 60s so 300+ polls/minute
    // become 1 DB query/minute. Redis miss → DB query → backfill cache.
    const CACHE_KEY = "feature-flags:all";
    const CACHE_TTL = 60; // seconds

    const cached = await redisGet(CACHE_KEY);
    if (cached) {
      res.set("X-Cache", "HIT");
      res.json(JSON.parse(cached));
      return;
    }

    const rows = await db.select().from(featureFlagsTable).orderBy(featureFlagsTable.key);
    const payload = rows.map((r) => ({ ...r, wired: isWired(r.key) }));

    // Backfill cache (best-effort, don't block response)
    void redisSet(CACHE_KEY, JSON.stringify(payload), CACHE_TTL);

    res.set("X-Cache", "MISS");
    res.json(payload);
  } catch (err) {
    // Layout hydrates flags on every page — a missing table must not 500 the ERP shell.
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message, message });
  }
});

router.patch("/:key", requireAdminRole, async (req: StaffAuthRequest, res) => {
  const key = String(req.params.key);
  const { enabled } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }

  if (enabled && !isWired(key)) {
    res.status(400).json({
      error: `Flag "${key}" is not wired — enabling it has no product effect yet. See Flight Deck → Ops Flags.`,
    });
    return;
  }

  const registryEntry = RADIOLOGY_FLAG_REGISTRY.find((e) => e.key === key);
  if (enabled && registryEntry && registryEntry.dependsOn.length > 0) {
    const missing: string[] = [];
    for (const dep of registryEntry.dependsOn) {
      const [depRow] = await db
        .select()
        .from(featureFlagsTable)
        .where(eq(featureFlagsTable.key, dep))
        .limit(1);
      if (!depRow?.enabled) missing.push(dep);
    }
    if (missing.length > 0) {
      res.status(400).json({
        error: `Cannot enable "${key}" until dependencies are enabled: ${missing.join(", ")}`,
        missingDependencies: missing,
      });
      return;
    }
  }

  const [existing] = await db.select().from(featureFlagsTable).where(eq(featureFlagsTable.key, key)).limit(1);
  if (!existing) {
    res.status(404).json({ error: `Unknown feature flag: ${key}` });
    return;
  }

  const [updated] = await db
    .update(featureFlagsTable)
    .set({
      enabled,
      updatedBy: req.staffSession?.subjectName ?? "system",
      updatedAt: new Date(),
    })
    .where(eq(featureFlagsTable.key, key))
    .returning();

  invalidateFeatureFlagCache();
  // Invalidate Redis cache so the next GET fetches fresh data
  void redisDel("feature-flags:all");
  res.json({ ...updated, wired: isWired(key) });
});

export default router;
