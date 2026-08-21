/**
 * AI clinical config service — DB layer (Phase P3 / G10/G11).
 *
 * Composes the existing feature_flags master switch (ff_radiology_ai) with the
 * per-scope AI policies to answer "is AI on for THIS user/modality, and visible?"
 * Also loads/saves the scheduler config, modality policies, and preferences.
 * Everything defaults OFF (isFeatureEnabledServer returns false for the unseeded
 * master flag), so a fresh deployment shows AI to nobody.
 */
import { db } from "@workspace/db";
import {
  aiFeaturePoliciesTable, aiSchedulerConfigTable, aiModalityPoliciesTable, aiRadiologistPreferencesTable,
  featureFlagsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { isFeatureEnabledServer, invalidateFeatureFlagCache } from "../featureFlags";
import { resolveAiEnablement, type AiPolicyRow, type Enablement } from "./aiPolicy";
import type { SchedulerConfig, ModalityMode, DraftTiming } from "./aiScheduler";
import { normalizeAiModality } from "./modalityNormalize";
import { parseStudyAgeWindow, type StudyAgeWindow } from "./studyAgeWindow";
import {
  DEFAULT_OVERNIGHT_OPS,
  addLegacyReleasedJobIds,
  initializeLegacyBacklogCutover,
  mergeOvernightOpsPatch,
  parseOvernightOpsJson,
  releaseAllLegacyBacklog,
  serializeOvernightOps,
  type OvernightOpsControls,
} from "./overnightOpsControls";

export { normalizeAiModality } from "./modalityNormalize";

/** The single global master flag. Unseeded ⇒ false ⇒ AI off for everyone. */
export const AI_MASTER_FLAG = "ff_radiology_ai";

/** Upsert the master radiology AI flag and pilot visibility policy. */
export async function setMasterAiFlag(enabled: boolean, updatedBy?: string): Promise<void> {
  const by = updatedBy ?? "clinical-config";
  await db
    .insert(featureFlagsTable)
    .values({ key: AI_MASTER_FLAG, enabled, updatedBy: by })
    .onConflictDoUpdate({
      target: featureFlagsTable.key,
      set: { enabled, updatedBy: by, updatedAt: new Date() },
    });
  invalidateFeatureFlagCache();
  if (enabled) {
    await setFeaturePolicy("global", "*", true, "pilot", by);
  }
}

export interface EnablementQuery {
  staffId?: number | null;
  modality?: string | null;
  studyType?: string | null;
  hospitalKey?: string | null;
}

export async function resolveAiEnablementForUser(q: EnablementQuery): Promise<Enablement> {
  const globalMasterOn = await isFeatureEnabledServer(AI_MASTER_FLAG);
  if (!globalMasterOn) {
    return { enabled: false, mode: "shadow", visibleToRadiologist: false, reason: "master flag off" };
  }
  const rows = await db.select().from(aiFeaturePoliciesTable);
  const policies: AiPolicyRow[] = rows.map((r) => ({
    scope: r.scope as AiPolicyRow["scope"],
    scopeKey: r.scopeKey,
    enabled: r.enabled,
    mode: r.mode as AiPolicyRow["mode"],
  }));
  return resolveAiEnablement(policies, { globalMasterOn, ...q });
}

// ── Scheduler config (singleton id=1, with safe defaults) ───────────────────
export const DEFAULT_SCHEDULER: SchedulerConfig = {
  draftTiming: "scheduled",
  // Clinical overnight window: 5 PM → 10 AM next morning (crosses midnight).
  nightStart: "17:00", nightEnd: "10:00", quietStart: "10:00", quietEnd: "17:00",
  maxConcurrentJobs: 1, gpuLimitPercent: 90, cpuLimitPercent: 80,
  skipFinalizedReports: true, skipUnchangedStudies: true,
  studyAgeWindow: "all", studyAgeCustomFrom: null, studyAgeCustomTo: null,
  overnightOps: { ...DEFAULT_OVERNIGHT_OPS },
};

function asDraftTiming(v: unknown): DraftTiming {
  return v === "scheduled" ? "scheduled" : "on_arrival";
}

function readOpsFromRow(row: Record<string, unknown> | null | undefined): OvernightOpsControls {
  if (!row) return { ...DEFAULT_OVERNIGHT_OPS };
  return parseOvernightOpsJson(row.overnightOpsJson ?? row.overnight_ops_json ?? "{}");
}

async function persistOvernightOpsPayload(
  next: OvernightOpsControls,
  updatedBy?: string | null,
): Promise<void> {
  const payload = serializeOvernightOps(next);
  const [existing] = await db.select({ id: aiSchedulerConfigTable.id }).from(aiSchedulerConfigTable).limit(1);
  if (existing) {
    await db
      .update(aiSchedulerConfigTable)
      .set({
        overnightOpsJson: payload,
        updatedBy: updatedBy ?? null,
      } as Partial<typeof aiSchedulerConfigTable.$inferInsert>)
      .where(eq(aiSchedulerConfigTable.id, existing.id));
  } else {
    await db.insert(aiSchedulerConfigTable).values({
      overnightOpsJson: payload,
      updatedBy: updatedBy ?? undefined,
    } as typeof aiSchedulerConfigTable.$inferInsert);
  }
}

/**
 * Load overnight ops. On first deployment of legacy-hold (no cutover marker),
 * auto-initialize hold ON at NOW so pre-existing pending/retrying jobs do not
 * compete with post-deploy validation. Restart-safe: cutover timestamp persists.
 */
export async function getOvernightOpsControls(): Promise<OvernightOpsControls> {
  try {
    const [row] = await db.select().from(aiSchedulerConfigTable).limit(1);
    const current = readOpsFromRow(row as unknown as Record<string, unknown>);
    const { ops, initialized } = initializeLegacyBacklogCutover(current);
    if (initialized) {
      try {
        await persistOvernightOpsPayload(ops, "legacy-cutover-init");
        console.log(
          "[ai] legacy backlog cutover initialized",
          JSON.stringify({ legacyHoldBefore: ops.legacyHoldBefore, legacyBacklogHold: ops.legacyBacklogHold }),
        );
      } catch (err) {
        // Column may be missing before db:push — still return in-memory cutover for this process.
        console.warn(
          "[ai] legacy backlog cutover init persist failed (run pnpm db:push if overnight_ops_json missing):",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return ops;
  } catch {
    // Column may be missing before db:push — preserve production defaults.
    return { ...DEFAULT_OVERNIGHT_OPS };
  }
}

export async function saveOvernightOpsControls(
  patch: Partial<OvernightOpsControls>,
  updatedBy?: string,
): Promise<OvernightOpsControls> {
  const current = await getOvernightOpsControls();
  const next = mergeOvernightOpsPatch(current, patch, updatedBy ?? null);
  try {
    await persistOvernightOpsPayload(next, updatedBy ?? null);
  } catch (err) {
    throw new Error(
      `Failed to persist overnight ops controls (run pnpm db:push if overnight_ops_json is missing): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return next;
}

/** Selective release: allowlist job ids (no row deletes). */
export async function releaseLegacyBacklogSelected(
  jobIds: number[],
  updatedBy?: string,
): Promise<OvernightOpsControls> {
  const current = await getOvernightOpsControls();
  const next = {
    ...addLegacyReleasedJobIds(current, jobIds),
    updatedBy: updatedBy ?? current.updatedBy,
  };
  await persistOvernightOpsPayload(next, updatedBy ?? null);
  return next;
}

/** Add the N newest held (pre-cutover, not yet released) pending/retrying shadow jobs to allowlist. */
export async function releaseLegacyBacklogRecent(
  limit = 5,
  updatedBy?: string,
): Promise<{ ops: OvernightOpsControls; releasedJobIds: number[] }> {
  const current = await getOvernightOpsControls();
  const { listNewestHeldLegacyShadowJobIds } = await import("./legacyBacklogHold");
  const ids = await listNewestHeldLegacyShadowJobIds(current, Math.max(1, Math.min(50, limit)));
  const next = {
    ...addLegacyReleasedJobIds(current, ids),
    updatedBy: updatedBy ?? current.updatedBy,
  };
  await persistOvernightOpsPayload(next, updatedBy ?? null);
  return { ops: next, releasedJobIds: ids };
}

/** Explicit confirmation required by caller — turns hold OFF; keeps cutover marker; no deletes. */
export async function releaseAllLegacyBacklogHold(
  updatedBy?: string,
): Promise<OvernightOpsControls> {
  const current = await getOvernightOpsControls();
  const next = {
    ...releaseAllLegacyBacklog(current),
    updatedBy: updatedBy ?? current.updatedBy,
  };
  await persistOvernightOpsPayload(next, updatedBy ?? null);
  return next;
}

export async function getSchedulerConfig(): Promise<SchedulerConfig> {
  const [row] = await db.select().from(aiSchedulerConfigTable).limit(1);
  if (!row) return DEFAULT_SCHEDULER;
  return {
    draftTiming: asDraftTiming((row as { draftTiming?: string }).draftTiming),
    nightStart: row.nightStart, nightEnd: row.nightEnd, quietStart: row.quietStart, quietEnd: row.quietEnd,
    maxConcurrentJobs: row.maxConcurrentJobs, gpuLimitPercent: row.gpuLimitPercent, cpuLimitPercent: row.cpuLimitPercent,
    skipFinalizedReports: row.skipFinalizedReports, skipUnchangedStudies: row.skipUnchangedStudies,
    studyAgeWindow: parseStudyAgeWindow((row as { studyAgeWindow?: string }).studyAgeWindow),
    studyAgeCustomFrom: (row as { studyAgeCustomFrom?: Date | null }).studyAgeCustomFrom ?? null,
    studyAgeCustomTo: (row as { studyAgeCustomTo?: Date | null }).studyAgeCustomTo ?? null,
    overnightOps: readOpsFromRow(row as unknown as Record<string, unknown>),
  };
}

export async function saveSchedulerConfig(patch: Partial<typeof aiSchedulerConfigTable.$inferInsert>, updatedBy?: string): Promise<void> {
  const [existing] = await db.select({ id: aiSchedulerConfigTable.id }).from(aiSchedulerConfigTable).limit(1);
  if (existing) {
    await db.update(aiSchedulerConfigTable).set({ ...patch, updatedBy }).where(eq(aiSchedulerConfigTable.id, existing.id));
  } else {
    await db.insert(aiSchedulerConfigTable).values({ ...patch, updatedBy });
  }
}

// ── Modality policies ───────────────────────────────────────────────────────
export async function getModalityPolicies(): Promise<Array<{ modality: string; mode: ModalityMode }>> {
  const rows = await db.select().from(aiModalityPoliciesTable);
  return rows.map((r) => ({ modality: r.modality, mode: r.mode as ModalityMode }));
}

export async function getModalityMode(modality: string | null | undefined): Promise<ModalityMode> {
  if (!modality) return "disabled";
  const key = normalizeAiModality(modality);
  const [row] = await db.select().from(aiModalityPoliciesTable).where(eq(aiModalityPoliciesTable.modality, key)).limit(1);
  if (row) return row.mode as ModalityMode;
  // Fall back to raw code if a legacy row used a non-normalized key.
  const [raw] = await db.select().from(aiModalityPoliciesTable).where(eq(aiModalityPoliciesTable.modality, modality.trim().toUpperCase())).limit(1);
  return (raw?.mode as ModalityMode) ?? "disabled";
}

export async function setModalityPolicy(modality: string, mode: ModalityMode, updatedBy?: string): Promise<void> {
  const key = normalizeAiModality(modality);
  await db
    .insert(aiModalityPoliciesTable)
    .values({ modality: key, mode, updatedBy })
    .onConflictDoUpdate({ target: aiModalityPoliciesTable.modality, set: { mode, updatedBy } });
}

/**
 * Batch-set draft modalities for the selected automation timing.
 * - Selected → mode (immediate for on_arrival, night_batch for scheduled)
 * - Existing immediate/night_batch not selected → disabled
 * - manual left untouched
 */
export async function setOvernightModalities(
  selected: string[],
  opts: { updatedBy?: string; mode?: ModalityMode } = {},
): Promise<Array<{ modality: string; mode: ModalityMode }>> {
  const mode = opts.mode ?? "night_batch";
  const wanted = new Set(selected.map(normalizeAiModality));
  const known = ["MR", "CT", "CR", "US", "MG", "Doppler"];
  const existing = await getModalityPolicies();
  const byMod = new Map(existing.map((p) => [normalizeAiModality(p.modality), p.mode as ModalityMode]));

  for (const modality of known) {
    const current = byMod.get(modality);
    if (wanted.has(modality)) {
      await setModalityPolicy(modality, mode, opts.updatedBy);
      continue;
    }
    if (!current || current === "night_batch" || current === "immediate" || current === "disabled") {
      await setModalityPolicy(modality, "disabled", opts.updatedBy);
    }
  }
  for (const modality of wanted) {
    if (!known.includes(modality)) await setModalityPolicy(modality, mode, opts.updatedBy);
  }
  return getModalityPolicies();
}

/** Persist full DICOM→draft automation from Settings → Radiology → AI. */
export async function saveDraftAutomation(opts: {
  draftTiming: DraftTiming;
  modalities: string[];
  nightStart?: string;
  nightEnd?: string;
  quietStart?: string;
  quietEnd?: string;
  studyAgeWindow?: StudyAgeWindow;
  studyAgeCustomFrom?: Date | string | null;
  studyAgeCustomTo?: Date | string | null;
  enableAi?: boolean;
  updatedBy?: string;
}): Promise<{
  scheduler: SchedulerConfig;
  policies: Array<{ modality: string; mode: ModalityMode }>;
  masterEnabled: boolean;
}> {
  if (opts.enableAi !== false) {
    await setMasterAiFlag(true, opts.updatedBy ?? "ai-draft-settings");
  }

  const mode: ModalityMode = opts.draftTiming === "on_arrival" ? "immediate" : "night_batch";
  const customFrom = opts.studyAgeCustomFrom
    ? (opts.studyAgeCustomFrom instanceof Date ? opts.studyAgeCustomFrom : new Date(opts.studyAgeCustomFrom))
    : opts.studyAgeCustomFrom === null ? null : undefined;
  const customTo = opts.studyAgeCustomTo
    ? (opts.studyAgeCustomTo instanceof Date ? opts.studyAgeCustomTo : new Date(opts.studyAgeCustomTo))
    : opts.studyAgeCustomTo === null ? null : undefined;
  await saveSchedulerConfig({
    draftTiming: opts.draftTiming,
    nightStart: opts.nightStart,
    nightEnd: opts.nightEnd,
    quietStart: opts.quietStart,
    quietEnd: opts.quietEnd,
    ...(opts.studyAgeWindow ? { studyAgeWindow: parseStudyAgeWindow(opts.studyAgeWindow) } : {}),
    ...(customFrom !== undefined ? { studyAgeCustomFrom: customFrom } : {}),
    ...(customTo !== undefined ? { studyAgeCustomTo: customTo } : {}),
    // Overnight MRI default: one concurrent study (configurable later).
    maxConcurrentJobs: 1,
  }, opts.updatedBy);
  const policies = await setOvernightModalities(opts.modalities, { mode, updatedBy: opts.updatedBy });
  return {
    scheduler: await getSchedulerConfig(),
    policies,
    masterEnabled: await isFeatureEnabledServer(AI_MASTER_FLAG),
  };
}

// ── Feature policies (admin enable/disable per scope) ───────────────────────
export async function setFeaturePolicy(scope: string, scopeKey: string, enabled: boolean, mode: string, updatedBy?: string): Promise<void> {
  await db
    .insert(aiFeaturePoliciesTable)
    .values({ scope, scopeKey, enabled, mode, updatedBy })
    .onConflictDoUpdate({ target: [aiFeaturePoliciesTable.scope, aiFeaturePoliciesTable.scopeKey], set: { enabled, mode, updatedBy } });
}

export async function listFeaturePolicies() {
  return db.select().from(aiFeaturePoliciesTable);
}

// ── Radiologist preferences ─────────────────────────────────────────────────
export async function getPreferences(staffId: number) {
  const [row] = await db.select().from(aiRadiologistPreferencesTable).where(eq(aiRadiologistPreferencesTable.staffId, staffId)).limit(1);
  return row ?? null;
}

export async function savePreferences(staffId: number, patch: Partial<typeof aiRadiologistPreferencesTable.$inferInsert>): Promise<void> {
  await db
    .insert(aiRadiologistPreferencesTable)
    .values({ staffId, ...patch })
    .onConflictDoUpdate({ target: aiRadiologistPreferencesTable.staffId, set: patch });
}
