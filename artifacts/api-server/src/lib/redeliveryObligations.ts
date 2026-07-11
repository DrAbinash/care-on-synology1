/**
 * redeliveryObligations.ts — Ticket BEND-1 Phase 2: the durable D10 store.
 *
 * Persists and transitions amended-report re-delivery obligations
 * (radiology_redelivery_obligations). Creation is IDEMPOTENT (a partial
 * unique index forbids a second open obligation for the same revision +
 * channel + recipient); completion follows one rule from redeliveryRules:
 * only delivery of the chain's LATEST revision completes matching open
 * obligations — old-revision deliveries never do.
 *
 * NOTHING here sends anything. Queuing an obligation enqueues a durable job
 * (radiologyJobs); the optional auto-send policy (pacs_settings key
 * radiology_redelivery_auto_send, category "ops") is DEFAULT OFF.
 * Every state transition is written to the hash-chained audit log.
 */

import { db } from "@workspace/db";
import {
  radiologyRedeliveryObligationsTable,
  radiologyPacsArchiveRevisionsTable,
  reportSharesTable,
  patientReportsTable,
  pacsSettingsTable,
} from "@workspace/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLog } from "./audit";
import { resolveReportVersion } from "./radiologyReportVersion";
import {
  decideObligationsForAmendment, deliveryCompletesObligation, recipientFingerprint,
  canTransitionObligation, OBLIGATION_ACTION_STATUS, OPEN_OBLIGATION_STATUSES,
  type ObligationStatus,
} from "./redeliveryRules";
import { getCached, setCached } from "./ttlCache";

export interface ObligationActor { userId?: number | null; userName: string; role?: string }

const SYSTEM_ACTOR: ObligationActor = { userName: "system", role: "system" };

function auditObligation(
  action: string,
  obligationId: number,
  actor: ObligationActor,
  oldValue: unknown,
  newValue: unknown,
): void {
  void auditLog({
    userId: actor.userId ?? null,
    userName: actor.userName,
    role: actor.role ?? "system",
    action,
    module: "radiology",
    entityType: "radiology_redelivery_obligation",
    entityId: String(obligationId),
    oldValue: oldValue == null ? null : JSON.stringify(oldValue),
    newValue: newValue == null ? null : JSON.stringify(newValue),
  }).catch(() => undefined);
}

/** Optional auto-send policy — DEFAULT OFF; explicit clinic opt-in only. */
export async function isRedeliveryAutoSendEnabled(): Promise<boolean> {
  const cached = getCached<boolean>("radiology_redelivery_auto_send");
  if (cached !== undefined) return cached;
  let enabled = false;
  try {
    const [row] = await db
      .select({ value: pacsSettingsTable.value })
      .from(pacsSettingsTable)
      .where(eq(pacsSettingsTable.key, "radiology_redelivery_auto_send"))
      .limit(1);
    enabled = row?.value === "true";
  } catch { /* unreadable settings → safe default OFF */ }
  setCached("radiology_redelivery_auto_send", enabled, 30_000);
  return enabled;
}

/** Create the obligations owed for an amended revision from the SENT shares
 *  of its older revisions. Idempotent: re-running creates nothing new (the
 *  partial unique index is the backstop; completed/dismissed duplicates for
 *  the same revision are also skipped). Also records the per-revision PACS
 *  re-archive duty when the study was previously archived. */
export async function createObligationsForAmendment(
  amendedReportId: number,
  actor: ObligationActor = SYSTEM_ACTOR,
): Promise<{ created: number; skipped: number; pacsPending: boolean }> {
  const version = await resolveReportVersion(amendedReportId, { mode: "specific", includeChain: true });
  if (!version || version.sequenceNumber <= 1) return { created: 0, skipped: 0, pacsPending: false };

  const olderIds = (version.chain ?? [])
    .filter((c) => c.sequenceNumber < version.sequenceNumber)
    .map((c) => c.reportId);
  if (olderIds.length === 0) return { created: 0, skipped: 0, pacsPending: false };

  const priorSentShares = await db
    .select({ id: reportSharesTable.id, reportId: reportSharesTable.reportId, channel: reportSharesTable.channel, recipient: reportSharesTable.recipient })
    .from(reportSharesTable)
    .where(and(inArray(reportSharesTable.reportId, olderIds), eq(reportSharesTable.status, "sent")));

  const seeds = decideObligationsForAmendment({
    amendedReportId,
    sequenceNumber: version.sequenceNumber,
    rootReportId: version.rootReportId,
    priorSentShares,
  });

  let created = 0;
  let skipped = 0;
  for (const seed of seeds) {
    // Skip when ANY obligation (open or closed) already exists for this exact
    // revision+channel+recipient — re-creating a duty someone already
    // completed/dismissed would resurrect it.
    const [existing] = await db
      .select({ id: radiologyRedeliveryObligationsTable.id })
      .from(radiologyRedeliveryObligationsTable)
      .where(and(
        eq(radiologyRedeliveryObligationsTable.reportId, seed.reportId),
        eq(radiologyRedeliveryObligationsTable.channel, seed.channel),
        eq(radiologyRedeliveryObligationsTable.recipientFingerprint, seed.recipientFingerprint),
      ))
      .limit(1);
    if (existing) { skipped += 1; continue; }
    try {
      const [row] = await db.insert(radiologyRedeliveryObligationsTable).values(seed).returning();
      created += 1;
      auditObligation("redelivery_obligation_created", row.id, actor, null, {
        reportId: seed.reportId, channel: seed.channel, recipient: seed.recipientMasked,
        sourceReportId: seed.sourceReportId,
      });
    } catch {
      skipped += 1; // partial unique index raced — another creator won; fine
    }
  }

  // PACS re-archive duty PER REVISION: if the study was archived before, the
  // amended revision needs its own (pending) archive record.
  let pacsPending = false;
  const [reportRow] = await db
    .select({ studyId: patientReportsTable.studyId })
    .from(patientReportsTable)
    .where(eq(patientReportsTable.id, amendedReportId));
  if (reportRow?.studyId != null) {
    const [prior] = await db
      .select({ id: radiologyPacsArchiveRevisionsTable.id })
      .from(radiologyPacsArchiveRevisionsTable)
      .where(and(
        eq(radiologyPacsArchiveRevisionsTable.studyId, reportRow.studyId),
        eq(radiologyPacsArchiveRevisionsTable.status, "success"),
      ))
      .limit(1);
    if (prior) {
      await db.insert(radiologyPacsArchiveRevisionsTable)
        .values({
          studyId: reportRow.studyId,
          reportId: amendedReportId,
          rootReportId: version.rootReportId,
          sequenceNumber: version.sequenceNumber,
          status: "pending",
        })
        .onConflictDoNothing({ target: radiologyPacsArchiveRevisionsTable.reportId });
      pacsPending = true;
    }
  }
  return { created, skipped, pacsPending };
}

/** Manual transition (acknowledge / dismiss / queue) — audited; illegal
 *  transitions are refused, not coerced. */
export async function transitionObligation(
  id: number,
  action: "acknowledge" | "dismiss" | "queue",
  actor: ObligationActor,
): Promise<{ ok: boolean; status?: ObligationStatus; error?: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(radiologyRedeliveryObligationsTable)
      .where(eq(radiologyRedeliveryObligationsTable.id, id))
      .for("update");
    if (!row) return { ok: false, error: "not_found" };
    const current = row.status as ObligationStatus;
    if (!canTransitionObligation(action, current)) {
      return { ok: false, error: `cannot ${action} an obligation in status ${current}` };
    }
    const next = OBLIGATION_ACTION_STATUS[action];
    await tx
      .update(radiologyRedeliveryObligationsTable)
      .set({ status: next, actedBy: actor.userName, actedAt: new Date(), updatedAt: new Date() })
      .where(eq(radiologyRedeliveryObligationsTable.id, id));
    auditObligation(`redelivery_obligation_${action}`, id, actor, { status: current }, { status: next });
    return { ok: true, status: next };
  });
}

/** Mark the outcome of an attempted re-delivery send (job handler). */
export async function recordObligationSendOutcome(
  id: number,
  outcome: { ok: true } | { ok: false; reason: string },
  actor: ObligationActor = SYSTEM_ACTOR,
): Promise<void> {
  const [row] = await db.select().from(radiologyRedeliveryObligationsTable).where(eq(radiologyRedeliveryObligationsTable.id, id));
  if (!row) return;
  const next: ObligationStatus = outcome.ok ? "sent" : "failed";
  await db
    .update(radiologyRedeliveryObligationsTable)
    .set({
      status: next,
      failureReason: outcome.ok ? null : outcome.reason.slice(0, 500),
      actedBy: actor.userName,
      actedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(radiologyRedeliveryObligationsTable.id, id));
  auditObligation(`redelivery_obligation_${next}`, id, actor, { status: row.status }, { status: next, ...(outcome.ok ? {} : { reason: outcome.reason.slice(0, 200) }) });
}

/** Delivery hook: a SENT share of the chain's LATEST revision completes every
 *  matching open (or just-sent) obligation in that chain. Old-revision
 *  deliveries complete nothing (rule in redeliveryRules). */
export async function completeObligationsForDelivery(args: {
  deliveredReportId: number;
  latestReportId: number;
  rootReportId: number;
  channel: string;
  recipient: string | null;
  actor?: ObligationActor;
}): Promise<number> {
  if (!args.recipient) return 0;
  if (args.deliveredReportId !== args.latestReportId) return 0;
  const fp = recipientFingerprint(args.channel, args.recipient);
  const candidates = await db
    .select()
    .from(radiologyRedeliveryObligationsTable)
    .where(and(
      eq(radiologyRedeliveryObligationsTable.rootReportId, args.rootReportId),
      eq(radiologyRedeliveryObligationsTable.channel, args.channel),
      eq(radiologyRedeliveryObligationsTable.recipientFingerprint, fp),
    ));
  let completed = 0;
  for (const row of candidates) {
    const matches = deliveryCompletesObligation({
      deliveredReportId: args.deliveredReportId,
      latestReportId: args.latestReportId,
      deliveredChannel: args.channel,
      deliveredFingerprint: fp,
      deliveredRootReportId: args.rootReportId,
      obligation: {
        status: row.status as ObligationStatus,
        channel: row.channel,
        recipientFingerprint: row.recipientFingerprint,
        rootReportId: row.rootReportId,
      },
    });
    if (!matches) continue;
    await db
      .update(radiologyRedeliveryObligationsTable)
      .set({ status: "completed", actedAt: new Date(), updatedAt: new Date() })
      .where(eq(radiologyRedeliveryObligationsTable.id, row.id));
    auditObligation("redelivery_obligation_completed", row.id, args.actor ?? SYSTEM_ACTOR,
      { status: row.status }, { status: "completed", deliveredReportId: args.deliveredReportId });
    completed += 1;
  }
  return completed;
}

/** Masked listing for the ops surface — never exposes raw recipients (they
 *  are not even stored here). */
export async function listObligations(filter: { status?: string; limit?: number } = {}) {
  const rows = await db
    .select()
    .from(radiologyRedeliveryObligationsTable)
    .where(filter.status ? eq(radiologyRedeliveryObligationsTable.status, filter.status) : undefined)
    .orderBy(radiologyRedeliveryObligationsTable.id)
    .limit(Math.min(filter.limit ?? 200, 500));
  return rows.map((r) => ({
    id: r.id, rootReportId: r.rootReportId, reportId: r.reportId, sequenceNumber: r.sequenceNumber,
    channel: r.channel, recipient: r.recipientMasked, status: r.status,
    sourceReportId: r.sourceReportId, failureReason: r.failureReason,
    actedBy: r.actedBy, actedAt: r.actedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
  }));
}

/** Backlog counts for ops health. */
export async function redeliveryBacklog(): Promise<{ open: number; failed: number; oldestOpenAgeHours: number | null; pacsPending: number }> {
  const [counts] = await db
    .select({
      open: sql<number>`count(*) FILTER (WHERE status IN ('pending','acknowledged','queued'))::int`,
      failed: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`,
      oldest: sql<string | null>`min(created_at) FILTER (WHERE status IN ('pending','acknowledged','queued','failed'))`,
    })
    .from(radiologyRedeliveryObligationsTable);
  const [pacs] = await db
    .select({ pending: sql<number>`count(*) FILTER (WHERE status IN ('pending','failed'))::int` })
    .from(radiologyPacsArchiveRevisionsTable);
  const oldest = counts?.oldest ? new Date(counts.oldest) : null;
  return {
    open: counts?.open ?? 0,
    failed: counts?.failed ?? 0,
    oldestOpenAgeHours: oldest ? Math.round((Date.now() - oldest.getTime()) / 3600_000 * 10) / 10 : null,
    pacsPending: pacs?.pending ?? 0,
  };
}

export { OPEN_OBLIGATION_STATUSES };
