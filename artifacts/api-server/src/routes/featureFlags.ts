import { Router } from "express";
import { db, featureFlagsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireStaffAuth, requireAdminRole, type StaffAuthRequest } from "../middleware/requireStaffAuth";
import { invalidateFeatureFlagCache } from "../lib/featureFlags";
import { RADIOLOGY_FLAG_REGISTRY } from "../lib/radiologyFeatureFlagRegistry";

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
  const rows = await db.select().from(featureFlagsTable).orderBy(featureFlagsTable.key);
  res.json(rows.map((r) => ({ ...r, wired: isWired(r.key) })));
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
  res.json({ ...updated, wired: isWired(key) });
});

export default router;
