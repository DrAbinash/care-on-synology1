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
  impression: string[] | string;
  recommendation: string;
  /** Sorted Quick Select ids so selection changes count as dirty. */
  quickSelectIds: number[];
  /** Structured findings cards (Normal/Abnormal sections). Optional: the
   *  legacy callers that never had cards hash byte-identically to before. */
  findingsSections?: Record<string, { normal: boolean; text: string }> | null;
}

/** Coerce impression from string, string[], or legacy JSON string to string[]. */
export function normalizeImpressionLines(impression: unknown): string[] {
  if (Array.isArray(impression)) {
    return impression
      .filter((l): l is string => typeof l === "string")
      .map((l) => l.trim())
      .filter(Boolean);
  }
  if (typeof impression === "string") {
    const trimmed = impression.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed
            .filter((l): l is string => typeof l === "string")
            .map((l) => l.trim())
            .filter(Boolean);
        }
      } catch {
        /* fall through — treat as plain text */
      }
    }
    return [trimmed];
  }
  return [];
}

/** Stable serialization — the single definition of "the report content". */
export function serializeReportSnapshot(f: ReportSnapshotFields): string {
  return JSON.stringify({
    ch: f.clinicalHistory.trim(),
    t: f.technique.trim(),
    rf: f.rawFindings.trim(),
    im: normalizeImpressionLines(f.impression),
    re: f.recommendation.trim(),
    qs: [...f.quickSelectIds].sort((a, b) => a - b),
    // Structured cards are report content too — a card toggle is an edit
    // even when its flattened text momentarily matches the prose. Key-sorted
    // so the hash is stable regardless of section insertion order. An EMPTY
    // map is treated as absent (opening structured mode without touching a
    // card is not an edit), so legacy callers — and empty structured sessions —
    // hash unchanged.
    ...(f.findingsSections && Object.keys(f.findingsSections).length > 0
      ? { fs: stableFindingsSections(f.findingsSections) }
      : {}),
  });
}

/** Canonical form of one findings-card map: section names sorted, values
 *  trimmed, so two maps that render the same report hash the same. */
function stableFindingsSections(
  sections: Record<string, { normal: boolean; text: string }>,
): Record<string, { normal: boolean; text: string }> {
  const out: Record<string, { normal: boolean; text: string }> = {};
  for (const key of Object.keys(sections).sort()) {
    const v = sections[key]!;
    out[key] = { normal: v.normal === true, text: typeof v.text === "string" ? v.text.trim() : "" };
  }
  return out;
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
  /** Structured findings cards, captured since a card toggle is real unsaved
   *  work even when its flattened prose happens to match the saved draft. */
  findingsSections?: Record<string, { normal: boolean; text: string }>;
  /** Whether the cards were driving the report when the backup was written;
   *  restored alongside them so the workspace reopens in the same mode. */
  useStructured?: boolean;
}

/**
 * Offer the "restore unsaved work" banner ONLY when the local backup is
 * strictly newer than the server draft AND its content differs from what the
 * server already has — a backup that merely echoes the saved draft (the
 * normal state after every successful save) must never nag.
 *
 * Server-PERSISTED fields participate (clinicalHistory, rawFindings,
 * impression, recommendation, and the structured findings cards the drafts
 * table stores in findings_sections). Technique deliberately does not: the
 * drafts table has no technique column, so the backup's technique would
 * differ from "the server" forever and re-trigger the banner after every
 * save. Technique still rides along in the envelope and is restored when the
 * user accepts.
 */
export function shouldOfferBackupRestore(
  backup: BackupEnvelope | null,
  serverUpdatedAt: string | null,
  serverContent: (Pick<ReportSnapshotFields, "clinicalHistory" | "rawFindings" | "impression" | "recommendation"> & {
    /** The server draft's structured cards. `radiology_report_drafts.findings_sections`
     *  arrives as a JSON string; the backup holds the object — both accepted.
     *  null/undefined = the caller has no server draft, so the comparison is
     *  skipped exactly like the prose fields are. */
    findingsSections?: Record<string, { normal: boolean; text: string }> | string | null;
  }) | null,
): boolean {
  if (!backup) return false;
  const backupImpression = normalizeImpressionLines(backup.impression);
  const backupSections = backup.findingsSections ?? null;
  const hasContent = Boolean(
    backup.clinicalHistory?.trim() || backup.rawFindings?.trim() ||
    backupImpression.length > 0 || backup.recommendation?.trim() ||
    (backupSections && Object.keys(backupSections).length > 0),
  );
  if (!hasContent) return false;

  if (serverUpdatedAt) {
    if (!backup.at) return false; // legacy backup without a timestamp: server state wins
    if (backup.at <= new Date(serverUpdatedAt).getTime()) return false;
  }
  if (serverContent) {
    const serverImpression = normalizeImpressionLines(serverContent.impression);
    const same =
      (backup.clinicalHistory ?? "").trim() === serverContent.clinicalHistory.trim() &&
      (backup.rawFindings ?? "").trim() === serverContent.rawFindings.trim() &&
      JSON.stringify(backupImpression) === JSON.stringify(serverImpression) &&
      (backup.recommendation ?? "").trim() === serverContent.recommendation.trim() &&
      findingsSectionsEqual(backupSections, serverContent.findingsSections);
    if (same) return false;
  }
  return true;
}

/**
 * The localStorage key holding a study's rolling draft backup. One definition,
 * shared by `useLocalDraftBackup`'s debounced write and the pre-redirect rescue
 * flush — the flush used to build its own key for a different store entirely,
 * so the two could drift apart silently and the rescued text was never found.
 */
export function radiologyReportBackupKey(studyId: number | string | null | undefined): string {
  return `radiology_report_backup_${studyId ?? "new"}`;
}

/** The five clinical texts a rescue flush preserves. Deliberately narrower than
 *  `WorkspaceClinicalTexts`: the provenance maps are editor-isolation state and
 *  are never persisted anywhere, same rule as the draft save payload. */
export type RescueBackupTexts = {
  clinicalHistoryText: string;
  techniqueText: string;
  findingsText: string;
  impressionText: string;
  recommendationText: string;
  /** Structured findings cards + the mode flag that made them the report. */
  findingsSections?: Record<string, { normal: boolean; text: string }> | null;
  useStructured?: boolean | null;
};

/**
 * Build the envelope a session-expiry rescue writes, or null when it must not
 * write at all.
 *
 * Two refusals, both load-bearing:
 *  - `signed` — `useStudyFinalize` calls `draftBackup.clear()` after signing
 *    precisely so signed report text never lingers on a shared workstation, and
 *    `useLocalDraftBackup` disables its own writes on the same condition. This
 *    covers a report signed in another session too, where the local
 *    `isFinalized` flag is still false but the text is equally not ours to copy.
 *  - no content — the flush fires on a 401, which can land before hydration.
 *    Writing five empty strings would clobber a backup that still holds real
 *    work, and `shouldOfferBackupRestore` would then refuse to offer anything.
 */
export function rescueBackupEnvelope(
  texts: RescueBackupTexts,
  opts: { signed: boolean },
  now: () => number = Date.now,
): BackupEnvelope | null {
  if (opts.signed) return null;
  const sections = texts.findingsSections ?? null;
  const hasContent = Boolean(
    texts.clinicalHistoryText.trim()
    || texts.techniqueText.trim()
    || texts.findingsText.trim()
    || texts.impressionText.trim()
    || texts.recommendationText.trim()
    // Cards alone are content: in structured mode they are the report.
    || (sections && Object.keys(sections).length > 0),
  );
  if (!hasContent) return null;
  return {
    at: now(),
    clinicalHistory: texts.clinicalHistoryText,
    technique: texts.techniqueText,
    rawFindings: texts.findingsText,
    impression: [texts.impressionText],
    recommendation: texts.recommendationText,
    ...(sections ? { findingsSections: sections } : {}),
    ...(texts.useStructured != null ? { useStructured: texts.useStructured } : {}),
  };
}

/** Structured-cards equality between a backup object and a server draft's
 *  JSON-stringified column. Absent on either side counts as equal only when
 *  absent on BOTH — a backup with cards vs a server draft without them is a
 *  difference the radiologist has to see. */
function findingsSectionsEqual(
  backup: Record<string, { normal: boolean; text: string }> | null | undefined,
  server: Record<string, { normal: boolean; text: string }> | string | null | undefined,
): boolean {
  let serverSections: Record<string, { normal: boolean; text: string }> | null = null;
  if (typeof server === "string") {
    try {
      const parsed = JSON.parse(server) as Record<string, { normal?: boolean; text?: string }> | null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        serverSections = {};
        for (const [k, v] of Object.entries(parsed)) {
          serverSections[k] = { normal: v?.normal === true, text: typeof v?.text === "string" ? v.text : "" };
        }
      }
    } catch {
      serverSections = null;
    }
  } else if (server && typeof server === "object") {
    serverSections = server;
  }
  const a = backup ?? null;
  const b = serverSections;
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(stableFindingsSections(a)) === JSON.stringify(stableFindingsSections(b));
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

// ─── Keyboard shortcuts (M1.4 Phase 11 + M1.5 Phase 8) ──────────────────────

export type WorkspaceShortcut =
  | "save" | "finalize" | "quickselect" | "open-study" | "escape"
  | "print"
  | "next-study" | "previous-study" | "park-study"
  // R2.0 — USG practical-template quick-select (Ctrl+1..6).
  | "select-template-1" | "select-template-2" | "select-template-3"
  | "select-template-4" | "select-template-5" | "select-template-6"
  // Layout redesign — collapse/expand the two side panels and toggle the
  // embedded viewer without leaving the keyboard. Alt-based so they never
  // produce text and are safe to fire while the findings editor is focused
  // (a radiologist commonly wants more editor width mid-dictation).
  | "toggle-left-panel" | "toggle-right-panel" | "toggle-viewer"
  | "focus-mode";

export function matchWorkspaceShortcut(e: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}): WorkspaceShortcut | null {
  const mod = Boolean(e.ctrlKey || e.metaKey);
  const shift = Boolean(e.shiftKey);
  const key = e.key.toLowerCase();
  // M1.5 workflow combos — matched FIRST so Ctrl+Shift+K never falls through
  // to the plain Ctrl+K quick-select rule.
  if (mod && shift && key === "n") return "next-study";
  if (mod && shift && key === "p") return "previous-study";
  if (mod && shift && key === "k") return "park-study";
  if (mod && shift && key === "f") return "focus-mode";
  // Plain combos are shift-exclusive: Ctrl+Shift+S (browser screenshot on
  // some platforms) must not save, Ctrl+Shift+Enter must not finalize.
  if (mod && !shift && key === "s") return "save";
  if (mod && !shift && key === "enter") return "finalize";
  // Ctrl+K is deliberately NOT claimed here. The command palette binds it in
  // useWorkspaceCommands, below this matrix's dispatch, and both the top-bar
  // button ("⌘K") and ReportingShortcutHelp advertise it as the palette. While
  // this line returned "quickselect" the dispatcher returned first and the
  // palette could not be opened from the keyboard at all. "/" below still
  // focuses the Quick Findings search, which is what that help row advertises.
  // Few-clicks — Ctrl+P prints like final from the keyboard (the top-bar
  // Print button's own handler). Shift-exclusive like the rest of the plain
  // combos: Ctrl+Shift+P is "previous study" and must keep meaning that.
  // mod+P produces no text, so it is allowed while an editor is focused —
  // a radiologist mid-dictation must not reach for the mouse to print.
  if (mod && !shift && key === "p") return "print";
  // R2.0 — Ctrl+1..6: digit keys are otherwise unused by this matrix. The
  // handler overwrites rawFindings wholesale (applyUsgTemplate), so — same
  // as "/" below — it must NOT fire while the user is typing in the
  // findings/impression editor, only while the browser default (Ctrl+1..8
  // often reserved for tab-switching at the OS/chrome level, so this may
  // never even reach the page — see
  // R2_0_CANONICAL_ULTRASOUND_IMPLEMENTATION.md) doesn't already intercept it.
  {
    const tag = e.target?.tagName?.toUpperCase() ?? "";
    if (mod && !shift && /^[1-6]$/.test(key) && tag !== "INPUT" && tag !== "TEXTAREA") {
      return (`select-template-${key}` as WorkspaceShortcut);
    }
  }
  if (e.altKey && !mod && key === "o") return "open-study";
  // Layout redesign — Alt+[ / Alt+] collapse-toggle the left (patient) and
  // right (tools) panels; Alt+\ toggles the embedded viewer. Alt combos
  // produce no text, so (unlike "/" and Ctrl+1..6 below) they are allowed
  // even while an INPUT/TEXTAREA is focused.
  if (e.altKey && !mod && key === "[") return "toggle-left-panel";
  if (e.altKey && !mod && key === "]") return "toggle-right-panel";
  if (e.altKey && !mod && key === "\\") return "toggle-viewer";
  if (key === "escape") return "escape";
  // Bare N/P/Q (and "/") only outside text entry — typing in findings must
  // never navigate or toggle chrome. Ctrl+Shift+N/P remain as aliases above.
  const tag = e.target?.tagName?.toUpperCase() ?? "";
  const inText = tag === "INPUT" || tag === "TEXTAREA" || Boolean(e.target?.isContentEditable);
  if (!mod && !e.altKey && !shift && !inText) {
    if (key === "n") return "next-study";
    if (key === "p") return "previous-study";
    if (key === "q") return "toggle-left-panel";
  }
  // "/" focuses quick-select search ONLY outside text inputs — typing a
  // slash into the findings editor must never steal focus.
  if (key === "/" && !mod && !e.altKey && !inText) return "quickselect";
  return null;
}


// ── Escape ownership (Priority 3 — browser-demo defect, 2026-10-21) ──────────

/** Who a bare Escape keypress belongs to in the reporting workspace. */
export type EscapeKeyOwner = "popup" | "quick-select-strip" | "workspace";

/**
 * The bare-Escape "collapse the tools panel" shortcut must yield to whoever
 * actually owns the key, and the listener must NOT preventDefault when it
 * yields or it would swallow the key from the owner too.
 *
 *   1. An OPEN popup layer owns Escape first. Every Radix Dialog AND Popover
 *      mounted in this workspace renders [role=dialog] (menus render
 *      [role=menu]), so one key press over the ask-first confirm dialog or a
 *      tile review popover dismisses THAT and nothing else — the old
 *      unconditional collapse made the tools rail vanish "along with the
 *      popup", and when focus sat outside the dialog the dialog itself stayed
 *      open with the panel gone under it.
 *   2. The Quick Select strip owns Escape second: its documented contract
 *      (quickSelectKeyboardNavigation) is "Escape leaves the tile rail (back
 *      to the search field)", a contract that cannot run when the panel
 *      behind the rail just collapsed — and a strip whose inline review panel
 *      ([data-testid^="qs-review-…"]) is open owns the key wherever focus
 *      happens to sit, because a mouse click on a chip never focuses it: the
 *      radiologist dismissing a review with Escape must not lose the rail the
 *      review was floating over.
 *   3. Otherwise the key falls through to the intentional workspace shortcut
 *      (Escape collapses the Reporting Tools panel) unchanged.
 *
 * Pure on purpose: the hook passes the live target and document; the tests
 * pass fakes and pin the matrix. `doc` is nullable so non-browser (SSR)
 * callers read "workspace" instead of throwing.
 */
export function escapeKeyOwner(
  target: Element | null,
  doc: Pick<Document, "querySelector"> | null,
): EscapeKeyOwner {
  if (doc?.querySelector('[role="dialog"], [role="menu"]')) return "popup";
  if (
    target?.closest?.('[data-testid^="quick-select-strip"]')
    || doc?.querySelector('[data-testid^="qs-review-"]')
  ) return "quick-select-strip";
  return "workspace";
}
