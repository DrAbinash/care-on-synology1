/**
 * radiologyConsistency.ts — Ticket BEND-1 Phase 5: read-only consistency
 * checks over the radiology linkage graph.
 *
 * Every report link in this schema is a bare integer (no DB foreign keys), so
 * orphans are structurally possible everywhere — these checks make them
 * VISIBLE. Detection only: nothing here writes anything; unambiguous repairs
 * live behind the separate admin repair endpoint (Phase 6), everything
 * ambiguous stays detection-only forever.
 *
 * Severity: ERROR = broken clinical linkage/integrity; WARNING = operational
 * debt needing attention; INFO = explainable/legacy state.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { verifyContentSha256 } from "./structuredReport/hash";
import type { StructuredReportDocument } from "./structuredReport/types";

export type ConsistencySeverity = "ERROR" | "WARNING" | "INFO";

export interface ConsistencyFinding {
  check: string;
  severity: ConsistencySeverity;
  count: number;
  sampleIds: number[];
  detail: string;
}

interface SqlCheck {
  check: string;
  severity: ConsistencySeverity;
  detail: string;
  /** Must select `id` (sample key); the finding counts all rows. */
  query: ReturnType<typeof sql>;
}

const LOCK_TTL_DEFAULT = 300;

function sqlChecks(): SqlCheck[] {
  return [
    {
      check: "draft_final_report_orphan",
      severity: "ERROR",
      detail: "radiology_report_drafts.final_report_id points at a patient_reports row that does not exist",
      query: sql`SELECT d.id FROM radiology_report_drafts d
        WHERE d.final_report_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM patient_reports p WHERE p.id = d.final_report_id)`,
    },
    {
      check: "draft_final_without_link",
      severity: "WARNING",
      detail: "draft status FINAL but final_report_id is NULL (promotion did not link back)",
      query: sql`SELECT id FROM radiology_report_drafts WHERE status = 'FINAL' AND final_report_id IS NULL`,
    },
    {
      check: "finding_instance_orphan_draft",
      severity: "ERROR",
      detail: "report_finding_instances.draft_id points at a missing draft",
      query: sql`SELECT i.id FROM report_finding_instances i
        WHERE i.draft_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM radiology_report_drafts d WHERE d.id = i.draft_id)`,
    },
    {
      check: "finding_instance_orphan_report",
      severity: "ERROR",
      detail: "report_finding_instances.report_id points at a missing patient_reports row",
      query: sql`SELECT i.id FROM report_finding_instances i
        WHERE i.report_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM patient_reports p WHERE p.id = i.report_id)`,
    },
    {
      check: "finding_instance_both_parents",
      severity: "ERROR",
      detail: "a finding instance claims BOTH a draft and a report parent (must be exactly one)",
      query: sql`SELECT id FROM report_finding_instances WHERE draft_id IS NOT NULL AND report_id IS NOT NULL`,
    },
    {
      check: "finding_instance_no_parent",
      severity: "WARNING",
      detail: "a finding instance has neither a draft nor a report parent",
      query: sql`SELECT id FROM report_finding_instances WHERE draft_id IS NULL AND report_id IS NULL`,
    },
    {
      check: "signed_report_missing_stamps",
      severity: "ERROR",
      detail: "structured-signed report missing signature state/hash/version stamps (signed_at, signed_content_sha256 = content_sha256, revision agreement, document_id)",
      query: sql`SELECT id FROM patient_reports
        WHERE structured_json IS NOT NULL AND type = 'radiology'
          AND (
            signed_at IS NULL OR signed_by_name IS NULL
            OR structured_json->'audit'->'signature'->>'state' IS NULL
            OR structured_json->'audit'->'signature'->>'signed_content_sha256' IS DISTINCT FROM structured_json->'audit'->>'content_sha256'
            OR structured_json->'audit'->>'revision' IS DISTINCT FROM structured_json->'provenance'->>'revision'
            OR length(coalesce(structured_json->>'document_id', '')) <> 26
          )`,
    },
    {
      check: "amendment_dangling_endpoint",
      severity: "ERROR",
      detail: "patient_report_amendments references a missing original/amended/root report row",
      query: sql`SELECT a.id FROM patient_report_amendments a
        WHERE NOT EXISTS (SELECT 1 FROM patient_reports p WHERE p.id = a.original_report_id)
           OR NOT EXISTS (SELECT 1 FROM patient_reports p WHERE p.id = a.amended_report_id)
           OR NOT EXISTS (SELECT 1 FROM patient_reports p WHERE p.id = a.root_report_id)`,
    },
    {
      check: "amendment_self_cycle",
      severity: "ERROR",
      detail: "an amendment claims to amend itself",
      query: sql`SELECT id FROM patient_report_amendments WHERE original_report_id = amended_report_id`,
    },
    {
      check: "amendment_fork_or_merge",
      severity: "ERROR",
      detail: "duplicate original_report_id (fork) or amended_report_id (merge) — the unique indexes should make this impossible; any hit is corruption",
      query: sql`SELECT a.id FROM patient_report_amendments a
        WHERE EXISTS (SELECT 1 FROM patient_report_amendments b WHERE b.id <> a.id AND b.original_report_id = a.original_report_id)
           OR EXISTS (SELECT 1 FROM patient_report_amendments b WHERE b.id <> a.id AND b.amended_report_id = a.amended_report_id)`,
    },
    {
      check: "amendment_root_mismatch",
      severity: "ERROR",
      detail: "an amendment's root_report_id disagrees with its parent link's root (chain must share one root)",
      query: sql`SELECT child.id FROM patient_report_amendments child
        JOIN patient_report_amendments parent ON parent.amended_report_id = child.original_report_id
        WHERE child.root_report_id <> parent.root_report_id`,
    },
    {
      check: "amendment_document_id_mismatch",
      severity: "ERROR",
      detail: "amendment linkage document ids disagree with the stored structured documents",
      query: sql`SELECT a.id FROM patient_report_amendments a
        JOIN patient_reports po ON po.id = a.original_report_id
        JOIN patient_reports pa ON pa.id = a.amended_report_id
        WHERE (po.structured_json IS NOT NULL AND po.structured_json->>'document_id' IS DISTINCT FROM a.original_document_id)
           OR (pa.structured_json IS NOT NULL AND pa.structured_json->>'document_id' IS DISTINCT FROM a.amended_document_id)`,
    },
    {
      check: "worklist_completed_without_report",
      severity: "WARNING",
      detail: "worklist row REPORT_FINAL/DELIVERED but report_id is NULL (unbilled-study finalize is a documented cause — verify)",
      query: sql`SELECT id FROM radiology_worklist WHERE status IN ('REPORT_FINAL','DELIVERED') AND report_id IS NULL`,
    },
    {
      check: "worklist_report_orphan",
      severity: "ERROR",
      detail: "worklist.report_id points at a missing patient_reports row",
      query: sql`SELECT w.id FROM radiology_worklist w
        WHERE w.report_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM patient_reports p WHERE p.id = w.report_id)`,
    },
    {
      check: "stale_expired_locks",
      severity: "WARNING",
      detail: "worklist rows still carrying a lock whose derived expiry has long passed (release is a safe repair)",
      query: sql`SELECT w.id FROM radiology_worklist w
        WHERE w.lock_user_id IS NOT NULL
          AND COALESCE(w.lock_last_activity_at, w.lock_time) IS NOT NULL
          AND COALESCE(w.lock_last_activity_at, w.lock_time)
              + (COALESCE((SELECT value::int FROM pacs_settings WHERE key = 'radiology_lock_ttl_seconds' LIMIT 1), ${LOCK_TTL_DEFAULT}) * interval '1 second')
              < NOW() - interval '1 hour'`,
    },
    {
      check: "corrupt_lock_row",
      severity: "ERROR",
      detail: "a lock owner is set but both lock timestamps are NULL (expiry underivable)",
      query: sql`SELECT id FROM radiology_worklist
        WHERE lock_user_id IS NOT NULL AND lock_time IS NULL AND lock_last_activity_at IS NULL`,
    },
    {
      check: "assignment_inactive_or_missing_user",
      severity: "WARNING",
      detail: "assigned_radiologist_id does not reference an ACTIVE users row (legacy name-only rows are INFO, not this)",
      query: sql`SELECT w.id FROM radiology_worklist w
        WHERE w.assigned_radiologist_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = w.assigned_radiologist_id AND u.is_active = true)`,
    },
    {
      check: "assignment_legacy_name_only",
      severity: "INFO",
      detail: "legacy assignment by name only (no id) — documented M1.6B1 compatibility state",
      query: sql`SELECT id FROM radiology_worklist
        WHERE assigned_radiologist IS NOT NULL AND assigned_radiologist <> '' AND assigned_radiologist_id IS NULL`,
    },
    {
      check: "patient_identity_mismatch",
      severity: "ERROR",
      detail: "patient_id disagrees across draft ↔ final report ↔ worklist for the same chain",
      query: sql`SELECT d.id FROM radiology_report_drafts d
        JOIN patient_reports p ON p.id = d.final_report_id
        WHERE d.patient_id IS NOT NULL AND p.patient_id IS NOT NULL AND d.patient_id <> p.patient_id
        UNION
        SELECT w.id FROM radiology_worklist w
        JOIN patient_reports p ON p.id = w.report_id
        WHERE w.patient_id IS NOT NULL AND p.patient_id IS NOT NULL AND w.patient_id <> p.patient_id`,
    },
    {
      check: "duplicate_open_redelivery_obligation",
      severity: "ERROR",
      detail: "two OPEN obligations for the same revision+channel+recipient (the partial unique index should forbid this)",
      query: sql`SELECT a.id FROM radiology_redelivery_obligations a
        WHERE a.status IN ('pending','acknowledged','queued','failed')
          AND EXISTS (SELECT 1 FROM radiology_redelivery_obligations b
            WHERE b.id <> a.id AND b.report_id = a.report_id AND b.channel = a.channel
              AND b.recipient_fingerprint = a.recipient_fingerprint
              AND b.status IN ('pending','acknowledged','queued','failed'))`,
    },
    {
      check: "redelivery_obligation_report_orphan",
      severity: "ERROR",
      detail: "a re-delivery obligation references a missing report revision",
      query: sql`SELECT o.id FROM radiology_redelivery_obligations o
        WHERE NOT EXISTS (SELECT 1 FROM patient_reports p WHERE p.id = o.report_id)`,
    },
    {
      check: "pacs_archive_revision_orphan",
      severity: "ERROR",
      detail: "a PACS archive revision record references a missing report revision",
      query: sql`SELECT r.id FROM radiology_pacs_archive_revisions r
        WHERE NOT EXISTS (SELECT 1 FROM patient_reports p WHERE p.id = r.report_id)`,
    },
    {
      check: "latest_amendment_not_deliverable",
      severity: "WARNING",
      detail: "a chain's LATEST amendment is not yet verified (deliverable) while an older revision is — recipients can only be served the old one",
      query: sql`SELECT a.id FROM patient_report_amendments a
        JOIN patient_reports latest ON latest.id = a.amended_report_id
        WHERE NOT EXISTS (SELECT 1 FROM patient_report_amendments c WHERE c.original_report_id = a.amended_report_id)
          AND latest.status NOT IN ('verified','delivered')
          AND EXISTS (SELECT 1 FROM patient_reports older
            WHERE older.id = a.original_report_id AND older.status IN ('verified','delivered'))`,
    },
  ];
}

/** Structured-document hash sweep — verifies every signed structured report's
 *  content hash with the real JCS canonicalizer (bounded batch). */
async function structuredHashCheck(limit: number): Promise<ConsistencyFinding> {
  const raw = await db.execute(sql`
    SELECT id, structured_json FROM patient_reports
    WHERE structured_json IS NOT NULL AND type = 'radiology'
    ORDER BY id DESC LIMIT ${limit}`);
  const bad: number[] = [];
  let checked = 0;
  for (const row of raw.rows as Array<{ id: number; structured_json: unknown }>) {
    checked += 1;
    try {
      const verdict = verifyContentSha256(row.structured_json as StructuredReportDocument);
      if (!verdict.ok) bad.push(Number(row.id));
    } catch {
      bad.push(Number(row.id));
    }
  }
  return {
    check: "structured_report_hash",
    severity: bad.length > 0 ? "ERROR" : "INFO",
    count: bad.length,
    sampleIds: bad.slice(0, 10),
    detail: bad.length > 0
      ? `content_sha256 verification FAILED for ${bad.length} of ${checked} signed structured reports`
      : `content_sha256 verified for all ${checked} signed structured reports checked (newest ${limit})`,
  };
}

export interface ConsistencyReport {
  ranAt: string;
  errorCount: number;
  warningCount: number;
  findings: ConsistencyFinding[];
}

/** Run every check (read-only). Findings with count 0 are omitted except the
 *  hash sweep, which always reports what it checked. */
export async function runConsistencyChecks(opts: { hashSweepLimit?: number } = {}): Promise<ConsistencyReport> {
  const findings: ConsistencyFinding[] = [];
  for (const check of sqlChecks()) {
    const raw = await db.execute(sql`SELECT id FROM (${check.query}) q LIMIT 10000`);
    const ids = (raw.rows as Array<{ id: number }>).map((r) => Number(r.id));
    if (ids.length === 0) continue;
    findings.push({
      check: check.check,
      severity: check.severity,
      count: ids.length,
      sampleIds: ids.slice(0, 10),
      detail: check.detail,
    });
  }
  findings.push(await structuredHashCheck(opts.hashSweepLimit ?? 200));
  return {
    ranAt: new Date().toISOString(),
    errorCount: findings.filter((f) => f.severity === "ERROR" && f.count > 0).length,
    warningCount: findings.filter((f) => f.severity === "WARNING" && f.count > 0).length,
    findings,
  };
}
