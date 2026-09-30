/**
 * CARE business-time integrity — the cutover reader and the append-only evidence
 * writer (final policy, PR 3a).
 *
 * Two responsibilities, both deliberately small:
 *
 *   1. Answer "has enforcement started?" from the Postgres-stamped cutover row,
 *      cached like every other authenticated lookup. The row lives in
 *      `care_time_integrity_policy`; SQL guards make sure it cannot be moved
 *      backwards or deleted. Nothing here decides the policy — it only reads
 *      where the line is, so the same answer serves every route in a request.
 *   2. Write evidence about a business-date decision into
 *      `care_time_integrity_events`, which SQL makes append-only. The writer
 *      NEVER throws: an evidence failure must not turn a correct 400 into a 500,
 *      and must not be able to block a legitimate save.
 *
 * Fail-closed on purpose: if the policy row cannot be read or does not exist,
 * enforcement is treated as ACTIVE. A missing table is a deployment problem,
 * not a licence to post backdated entries.
 *
 * Nothing here reads or rewrites history. It records what happens from now on.
 */

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { careTimeIntegrityEventsTable, careTimeIntegrityPolicyTable } from "@workspace/db/schema";
import { getCached, setCached } from "./ttlCache";
import type { BusinessDateRejection } from "./careBusinessDatePolicy";

const POLICY_CACHE_KEY = "time-integrity:cutover";
const POLICY_CACHE_TTL_MS = 60_000;

export type CareCutoverState = {
  /** The trusted Postgres instant enforcement began, or null when unknown. */
  cutoverAtIso: string | null;
  source: string | null;
  active: boolean;
  /** Why — kept machine-readable so the Admin view can show the truth rather
   *  than a reassuring "active". */
  reason: "post-cutover" | "pre-cutover" | "policy-row-missing-fail-closed" | "policy-unreadable-fail-closed";
};

type CachedCutover = { cutoverAtIso: string | null; source: string | null; missing: boolean; unreadable: boolean };

export async function readCutoverState(now: Date = new Date()): Promise<CareCutoverState> {
  let cached = getCached<CachedCutover>(POLICY_CACHE_KEY);
  if (!cached) {
    try {
      const [row] = await db
        .select({ cutoverAt: careTimeIntegrityPolicyTable.enforcementCutoverAt, source: careTimeIntegrityPolicyTable.cutoverSource })
        .from(careTimeIntegrityPolicyTable)
        .where(eq(careTimeIntegrityPolicyTable.id, 1))
        .limit(1);
      cached = row
        ? { cutoverAtIso: row.cutoverAt.toISOString(), source: row.source, missing: false, unreadable: false }
        : { cutoverAtIso: null, source: null, missing: true, unreadable: false };
    } catch {
      cached = { cutoverAtIso: null, source: null, missing: true, unreadable: true };
    }
    setCached(POLICY_CACHE_KEY, cached, POLICY_CACHE_TTL_MS);
  }

  if (cached.cutoverAtIso == null) {
    return {
      cutoverAtIso: null,
      source: null,
      active: true,
      reason: cached.unreadable ? "policy-unreadable-fail-closed" : "policy-row-missing-fail-closed",
    };
  }
  const active = now.getTime() >= Date.parse(cached.cutoverAtIso);
  return { cutoverAtIso: cached.cutoverAtIso, source: cached.source, active, reason: active ? "post-cutover" : "pre-cutover" };
}

/** The single question every Class-A write path asks before it judges a date. */
export async function businessDateEnforcementActive(now: Date = new Date()): Promise<boolean> {
  return (await readCutoverState(now)).active;
}

export type TimeIntegrityActor = {
  subjectId?: number | null;
  role?: string | null;
  subjectName?: string | null;
};

export type TimeIntegrityEventInput = {
  event: string;
  outcome: string;
  trustedClinicDate: string;
  code?: string | null;
  attemptedBusinessDate?: string | null;
  endpoint?: string;
  method?: string;
  module?: string;
  entityType?: string;
  entityId?: string | number | null;
  actor?: TimeIntegrityActor | null;
  reason?: string | null;
  requestId?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * Insert one evidence row. Never throws, never returns a value the caller is
 * allowed to branch on — recording failure must not change the user's outcome.
 */
export async function recordTimeIntegrityEvent(input: TimeIntegrityEventInput): Promise<boolean> {
  try {
    await db.insert(careTimeIntegrityEventsTable).values({
      trustedClinicDate: input.trustedClinicDate,
      event: input.event,
      outcome: input.outcome,
      code: input.code ?? null,
      attemptedBusinessDate: input.attemptedBusinessDate ?? null,
      endpoint: input.endpoint ?? null,
      method: input.method ?? null,
      module: input.module ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId == null ? null : String(input.entityId),
      actorSubjectId: input.actor?.subjectId ?? null,
      actorRole: input.actor?.role ?? null,
      actorDisplayName: input.actor?.subjectName ?? null,
      identitySource: "authenticated-session",
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
      metaJson: input.meta ?? null,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The standard rejection record. Built from the guard's verdict and the session
 * actor only — no request body, so a rejected payload cannot smuggle patient
 * data or a credential into the evidence table.
 */
export async function recordBusinessDateRejection(args: {
  rejection: BusinessDateRejection;
  authority: { clinicDate: string; instantIso: string };
  actor: TimeIntegrityActor | null;
  endpoint: string;
  method: string;
  module: string;
  entityType: string;
  entityId?: string | number | null;
  reason?: unknown;
  /** Anything else worth keeping, already free of payloads — e.g. how many rows
   *  a rejected bulk import carried. */
  meta?: Record<string, unknown>;
}): Promise<boolean> {
  const { rejection } = args;
  return recordTimeIntegrityEvent({
    event: "business_date_rejected",
    outcome: "rejected",
    code: rejection.code,
    trustedClinicDate: args.authority.clinicDate,
    attemptedBusinessDate: rejection.attempted,
    endpoint: args.endpoint,
    method: args.method,
    module: args.module,
    entityType: args.entityType,
    entityId: args.entityId ?? null,
    actor: args.actor,
    // A caller-supplied reason is retained as text, trimmed and capped, because
    // it is the operator's own explanation and part of what makes a rejection
    // reviewable. It is never interpreted.
    reason: typeof args.reason === "string" ? args.reason.trim().slice(0, 500) : null,
    meta: {
      field: rejection.field,
      direction: rejection.direction,
      trustedInstant: args.authority.instantIso,
      zone: rejection.zone,
      ...(args.meta ?? {}),
    },
  });
}

/** For the Admin view (PR 5) and for deployment verification. Aggregated in SQL
 *  because the evidence table only ever grows. */
export async function timeIntegrityStatus(now: Date = new Date()): Promise<{
  cutover: CareCutoverState;
  events: { total: number; rejected: number; lastOccurredAtIso: string | null };
}> {
  const cutover = await readCutoverState(now);
  const [totals] = await db
    .select({
      total: sql<number>`count(*)`,
      rejected: sql<number>`count(*) filter (where ${careTimeIntegrityEventsTable.outcome} = 'rejected')`,
    })
    .from(careTimeIntegrityEventsTable);
  const [latest] = await db
    .select({ occurredAt: careTimeIntegrityEventsTable.occurredAt })
    .from(careTimeIntegrityEventsTable)
    .orderBy(desc(careTimeIntegrityEventsTable.occurredAt))
    .limit(1);
  return {
    cutover,
    events: {
      total: Number(totals?.total ?? 0),
      rejected: Number(totals?.rejected ?? 0),
      lastOccurredAtIso: latest?.occurredAt?.toISOString() ?? null,
    },
  };
}
