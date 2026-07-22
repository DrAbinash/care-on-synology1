/**
 * usgAudit — meaningful-action audit events for the USG Companion (P2.10).
 *
 * Reuses the CANONICAL audit trail: events map to the existing
 * `/api/radiology/report-generator/log-action` payload — no parallel audit
 * store. Only structural metadata is recorded (organ, finding type, counts,
 * decision) — never report prose / PHI. Keystroke-level logging is out of
 * scope by design. Pure + testable.
 */

export type UsgAuditAction =
  | "finding_added"
  | "finding_removed"
  | "parameter_changed"
  | "organ_status_changed"
  | "normal_all_remaining"
  | "measurement_accepted"
  | "measurement_rejected"
  | "measurement_reconciled"
  | "manual_override_accepted"
  | "report_saved"
  | "report_finalized"
  | "pcpndt_block";

export type AuditDetailValue = string | number | boolean | null;

export interface UsgAuditContext {
  studyId?: number | null;
  organ?: string;
  findingType?: string;
  detail?: Record<string, AuditDetailValue>;
  actor?: string | null;
  at?: string | null;
}

export interface UsgAuditEvent {
  action: UsgAuditAction;
  studyId: number | null;
  organ: string | null;
  findingType: string | null;
  detail: Record<string, AuditDetailValue>;
  actor: string | null;
  at: string | null;
}

/** Detail values longer than this are treated as possible prose/PHI and dropped. */
const MAX_DETAIL_LEN = 64;

/** Strip anything that looks like free text / PHI from the structural detail. */
function scrubDetail(detail?: Record<string, AuditDetailValue>): Record<string, AuditDetailValue> {
  const out: Record<string, AuditDetailValue> = {};
  for (const [k, v] of Object.entries(detail ?? {})) {
    if (typeof v === "string" && (v.length > MAX_DETAIL_LEN || /\s\S+\s\S+\s\S+/.test(v))) continue; // long/multi-word → drop
    out[k] = v;
  }
  return out;
}

export function buildAuditEvent(action: UsgAuditAction, ctx: UsgAuditContext = {}): UsgAuditEvent {
  return {
    action,
    studyId: ctx.studyId ?? null,
    organ: ctx.organ ?? null,
    findingType: ctx.findingType ?? null,
    detail: scrubDetail(ctx.detail),
    actor: ctx.actor ?? null,
    at: ctx.at ?? null,
  };
}

/** Map to the canonical log-action endpoint payload (no new transport). */
export function toLogActionPayload(e: UsgAuditEvent): {
  studyId: number | null;
  action: string;
  newValue: string;
  details: Record<string, AuditDetailValue>;
} {
  return {
    studyId: e.studyId,
    action: `USG_${e.action.toUpperCase()}`,
    newValue: [e.organ, e.findingType].filter(Boolean).join(":") || e.action,
    details: { ...e.detail, ...(e.organ ? { organ: e.organ } : {}), ...(e.actor ? { actor: e.actor } : {}) },
  };
}
