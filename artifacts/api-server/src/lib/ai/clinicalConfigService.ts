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
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { isFeatureEnabledServer } from "../featureFlags";
import { resolveAiEnablement, type AiPolicyRow, type Enablement } from "./aiPolicy";
import type { SchedulerConfig, ModalityMode } from "./aiScheduler";

/** The single global master flag. Unseeded ⇒ false ⇒ AI off for everyone. */
export const AI_MASTER_FLAG = "ff_radiology_ai";

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
const DEFAULT_SCHEDULER: SchedulerConfig = {
  nightStart: "23:00", nightEnd: "06:00", quietStart: "08:00", quietEnd: "20:00",
  maxConcurrentJobs: 2, gpuLimitPercent: 90, cpuLimitPercent: 80,
  skipFinalizedReports: true, skipUnchangedStudies: true,
};

export async function getSchedulerConfig(): Promise<SchedulerConfig> {
  const [row] = await db.select().from(aiSchedulerConfigTable).limit(1);
  if (!row) return DEFAULT_SCHEDULER;
  return {
    nightStart: row.nightStart, nightEnd: row.nightEnd, quietStart: row.quietStart, quietEnd: row.quietEnd,
    maxConcurrentJobs: row.maxConcurrentJobs, gpuLimitPercent: row.gpuLimitPercent, cpuLimitPercent: row.cpuLimitPercent,
    skipFinalizedReports: row.skipFinalizedReports, skipUnchangedStudies: row.skipUnchangedStudies,
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
  const [row] = await db.select().from(aiModalityPoliciesTable).where(eq(aiModalityPoliciesTable.modality, modality)).limit(1);
  return (row?.mode as ModalityMode) ?? "disabled";
}

export async function setModalityPolicy(modality: string, mode: ModalityMode, updatedBy?: string): Promise<void> {
  await db
    .insert(aiModalityPoliciesTable)
    .values({ modality, mode, updatedBy })
    .onConflictDoUpdate({ target: aiModalityPoliciesTable.modality, set: { mode, updatedBy } });
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
