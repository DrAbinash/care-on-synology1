/**
 * workspaceReportState.ts — Ticket M1.4
 *
 * The canonical Reporting Workspace's report-state RULES, extracted as pure,
 * fully-testable functions. The workspace keeps its existing local state
 * (this deliberately is NOT a second store); these functions own the
 * decisions that must be exact:
 *
 *  - dirty detection (serialized snapshot comparison)
 *  - local-backup recovery gating (only when NEWER than the server draft AND
 *    actually different from it)
 *  - Quick Select selection restore from persisted finding instances
 *  - D8/D9 lifecycle badge derivation
 *  - verify-permission mirroring of the D9 server rules (UI gating only —
 *    the server re-enforces everything)
 *  - keyboard shortcut matching
 */

import type { AbnormalityInstance } from "./abnormalityEngine";

// ─── Snapshot / dirty state ──────────────────────────────────────────────────

export interface ReportSnapshotFields {
  clinicalHistory: string;
  technique: string;
  rawFindings: string;
  impression: string[];
  recommendation: string;
  /** Sorted Quick Select ids so selection changes count as dirty. */
  quickSelectIds: number[];
}

/** Stable serialization — the single definition of "the report content". */
export function serializeReportSnapshot(f: ReportSnapshotFields): string {
  return JSON.stringify({
    ch: f.clinicalHistory.trim(),
    t: f.technique.trim(),
    rf: f.rawFindings.trim(),
    im: f.impression.map((l) => l.trim()).filter(Boolean),
    re: f.recommendation.trim(),
    qs: [...f.quickSelectIds].sort((a, b) => a - b),
  });
}

export function isReportDirty(current: ReportSnapshotFields, lastSavedSerialized: string | null): boolean {
  if (lastSavedSerialized === null) {
    // Never saved in this session: dirty only when there is actual content.
    const s = serializeReportSnapshot(current);
    return s !== serializeReportSnapshot({ clinicalHistory: "", technique: "", rawFindings: "", impression: [], recommendation: "", quickSelectIds: [] });
  }
  return serializeReportSnapshot(current) !== lastSavedSerialized;
}

// ─── Local backup recovery (Phase 3 rule 7) ──────────────────────────────────

export interface BackupEnvelope {
  at?: number; // epoch ms the backup was written
  clinicalHistory?: string;
  technique?: string;
  rawFindings?: string;
  impression?: string[];
  recommendation?: string;
}

/**
 * Offer the "restore unsaved work" banner ONLY when the local backup is
 * strictly newer than the server draft AND its content differs from what the
 * server already has — a backup that merely echoes the saved draft (the
 * normal state after every successful save) must never nag.
 *
 * Only server-PERSISTED fields participate (clinicalHistory, rawFindings,
 * impression, recommendation). Technique deliberately does not: the drafts
 * table has no technique column, so the backup's technique would differ from
 * "the server" forever and re-trigger the banner after every save. Technique
 * still rides along in the envelope and is restored when the user accepts.
 */
export function shouldOfferBackupRestore(
  backup: BackupEnvelope | null,
  serverUpdatedAt: string | null,
  serverContent: Pick<ReportSnapshotFields, "clinicalHistory" | "rawFindings" | "impression" | "recommendation"> | null,
): boolean {
  if (!backup) return false;
  const hasContent = Boolean(
    backup.clinicalHistory?.trim() || backup.rawFindings?.trim() ||
    (backup.impression ?? []).some((l) => l.trim()) || backup.recommendation?.trim(),
  );
  if (!hasContent) return false;

  if (serverUpdatedAt) {
    if (!backup.at) return false; // legacy backup without a timestamp: server state wins
    if (backup.at <= new Date(serverUpdatedAt).getTime()) return false;
  }
  if (serverContent) {
    const same =
      (backup.clinicalHistory ?? "").trim() === serverContent.clinicalHistory.trim() &&
      (backup.rawFindings ?? "").trim() === serverContent.rawFindings.trim() &&
      JSON.stringify((backup.impression ?? []).map((l) => l.trim()).filter(Boolean)) ===
        JSON.stringify(serverContent.impression.map((l) => l.trim()).filter(Boolean)) &&
      (backup.recommendation ?? "").trim() === serverContent.recommendation.trim();
    if (same) return false;
  }
  return true;
}

/**
 * After a selection restore lands, fold the restored ids into an
 * already-captured saved-baseline snapshot so the workspace stays CLEAN
 * (the restored selections ARE the saved state, not an edit). Pure inverse
 * of serializeReportSnapshot's `qs` field — kept here so no caller depends
 * on the serialized internals.
 */
export function withQuickIdsInSnapshot(serialized: string | null, quickSelectIds: number[]): string | null {
  if (serialized === null) return null;
  try {
    const obj = JSON.parse(serialized) as Record<string, unknown>;
    obj.qs = [...quickSelectIds].sort((a, b) => a - b);
    return JSON.stringify(obj);
  } catch {
    return serialized;
  }
}

// ─── Quick Select restore (Phase 4) ──────────────────────────────────────────

export interface PersistedInstanceRow {
  findingId: number;
  structuredJson: unknown;
}

/** Sanitize persisted finding-instance rows into restorable selections. */
export function restorableSelections(rows: PersistedInstanceRow[]): Array<{ findingId: number; params: Record<string, unknown> }> {
  const seen = new Set<number>();
  const out: Array<{ findingId: number; params: Record<string, unknown> }> = [];
  for (const row of rows) {
    if (!Number.isInteger(row.findingId) || row.findingId <= 0 || seen.has(row.findingId)) continue;
    seen.add(row.findingId);
    const params =
      row.structuredJson && typeof row.structuredJson === "object" && !Array.isArray(row.structuredJson)
        ? (row.structuredJson as Record<string, unknown>)
        : {};
    out.push({ findingId: row.findingId, params });
  }
  return out;
}

/**
 * Fallback selection source (Phase 3 rule 3): the draft's canonical D1
 * document (`structured_json_d1`) carries the raw Quick Select selections in
 * its sanctioned extension channel — `extensions.x_care_draft` with
 * `quick_select_findings[]` (D3, nothing materialized) or `skipped_findings[]`
 * (D3.5, only the UN-materialized remainder). Both use snake_case
 * `finding_id`. Read-only extraction; the primary source is always the
 * report_finding_instances rows.
 */
export function extractD1QuickSelections(structuredJsonD1: unknown): PersistedInstanceRow[] {
  if (!structuredJsonD1 || typeof structuredJsonD1 !== "object") return [];
  const ext = (structuredJsonD1 as { extensions?: { x_care_draft?: unknown } }).extensions?.x_care_draft;
  if (!ext || typeof ext !== "object") return [];
  const draftExt = ext as { quick_select_findings?: unknown; skipped_findings?: unknown };
  const rows: PersistedInstanceRow[] = [];
  for (const list of [draftExt.quick_select_findings, draftExt.skipped_findings]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { finding_id?: unknown; findingId?: unknown; params?: unknown };
      const findingId = Number(rec.finding_id ?? rec.findingId);
      if (!Number.isInteger(findingId) || findingId <= 0) continue;
      rows.push({ findingId, structuredJson: rec.params ?? {} });
    }
  }
  return rows;
}

/**
 * Coerce persisted params (opaque JSON) back into the exact 5-field
 * AbnormalityInstance shape the render engine expects. Unknown keys and
 * out-of-vocabulary enum values are dropped (never fabricated) — a corrupt
 * row degrades to an unadorned instance, not a crash.
 */
export function toInstanceParams(params: Record<string, unknown>): AbnormalityInstance {
  const str = (key: string): string => (typeof params[key] === "string" ? (params[key] as string) : "");
  const oneOf = <V extends string>(key: string, allowed: readonly V[]): V | "" => {
    const v = str(key);
    return (allowed as readonly string[]).includes(v) ? (v as V) : "";
  };
  return {
    side: oneOf("side", ["left", "right", "bilateral"] as const),
    severity: oneOf("severity", ["mild", "moderate", "severe"] as const),
    chronicity: oneOf("chronicity", ["acute", "chronic"] as const),
    level: str("level"),
    value: str("value"),
  };
}

// ─── Lifecycle badges (Phase 9, D8/D9 metadata) ──────────────────────────────

export interface FinalReportMeta {
  status?: string;
  lifecycle?: {
    state?: string;
    structuredSigned?: boolean;
    amendmentPendingVerification?: boolean;
    pendingVerification?: boolean;
    deliverable?: boolean;
    superseded?: boolean;
    verifiedBy?: string | null;
    recipientNotificationPending?: boolean;
  } | null;
  version?: {
    sequenceNumber?: number;
    totalVersions?: number;
    superseded?: boolean;
    amendmentReason?: string | null;
    latestAmendmentReason?: string | null;
  } | null;
}

export interface LifecycleBadge {
  label: string;
  tone: "green" | "amber" | "red" | "blue" | "slate";
}

export function deriveLifecycleBadges(report: FinalReportMeta | null): LifecycleBadge[] {
  if (!report) return [];
  const badges: LifecycleBadge[] = [];
  const lc = report.lifecycle ?? null;
  const v = report.version ?? null;
  const state = lc?.state ?? report.status ?? "";

  if (v?.superseded || lc?.superseded) {
    badges.push({ label: "SUPERSEDED — newer amendment exists", tone: "red" });
  } else {
    switch (state) {
      case "pending_verification":
        badges.push({ label: lc?.amendmentPendingVerification ? "Amendment pending verification" : "Pending verification", tone: "amber" });
        break;
      case "verified":
        badges.push({ label: lc?.verifiedBy ? `Verified by ${lc.verifiedBy}` : "Verified", tone: "green" });
        break;
      case "delivered":
        badges.push({ label: "Delivered", tone: "green" });
        break;
      case "amendment_created":
        badges.push({ label: "Amendment created", tone: "amber" });
        break;
      default:
        if (state) badges.push({ label: state.replace(/_/g, " "), tone: "slate" });
    }
  }
  if (v && (v.totalVersions ?? 1) > 1) {
    badges.push({ label: `Revision ${v.sequenceNumber ?? "?"} of ${v.totalVersions}`, tone: "blue" });
    const reason = v.amendmentReason ?? v.latestAmendmentReason;
    if (reason) badges.push({ label: `Amendment: ${reason}`, tone: "slate" });
  }
  if (lc?.recipientNotificationPending) {
    badges.push({ label: "Re-delivery pending", tone: "amber" });
  }
  return badges;
}

// ─── Verify permission mirror (Phase 9; server re-enforces via D9) ──────────

const VERIFY_DENY_ROLES = new Set(["typist", "ai", "system", "bot"]);
const FULL_ACCESS = new Set(["admin", "super_admin"]);

export function canVerifyReport(
  session: { subjectName?: string; role?: string; permissions?: string[] } | null,
  report: { signedByName?: string | null } | null,
): { allowed: boolean; reason: string | null } {
  if (!session?.subjectName?.trim()) return { allowed: false, reason: "not signed in" };
  const role = (session.role ?? "").toLowerCase();
  if (VERIFY_DENY_ROLES.has(role)) return { allowed: false, reason: "role cannot verify" };
  const granted =
    FULL_ACCESS.has(role) ||
    (session.permissions ?? []).includes("/reports:verify") ||
    (session.permissions ?? []).includes("/reports:sign");
  if (!granted) return { allowed: false, reason: "missing verify permission" };
  const signer = (report?.signedByName ?? "").trim().toLowerCase();
  if (signer && signer === session.subjectName.trim().toLowerCase()) {
    return { allowed: false, reason: "verifier must differ from signer" };
  }
  return { allowed: true, reason: null };
}

// ─── Keyboard shortcuts (Phase 11) ───────────────────────────────────────────

export type WorkspaceShortcut = "save" | "finalize" | "quickselect" | "open-study" | "escape";

export function matchWorkspaceShortcut(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string } | null;
}): WorkspaceShortcut | null {
  const mod = Boolean(e.ctrlKey || e.metaKey);
  const key = e.key.toLowerCase();
  if (mod && key === "s") return "save";
  if (mod && key === "enter") return "finalize";
  if (mod && key === "k") return "quickselect";
  if (e.altKey && key === "o") return "open-study";
  if (key === "escape") return "escape";
  // "/" focuses quick-select search ONLY outside text inputs — typing a
  // slash into the findings editor must never steal focus.
  const tag = e.target?.tagName?.toUpperCase() ?? "";
  if (key === "/" && !mod && !e.altKey && tag !== "INPUT" && tag !== "TEXTAREA") return "quickselect";
  return null;
}
