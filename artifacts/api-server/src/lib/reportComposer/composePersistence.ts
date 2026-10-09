/**
 * Server-derived persistence evidence for the background AI Report Composer.
 *
 * WHY THIS MODULE EXISTS
 *
 * Every freshness number the Composer had before this change was computed by
 * the browser: `computeSnapshotHashes` runs over the text in the tab's own
 * store, and `POST /jobs/:id/freshness` and `/applied` compare the job against
 * hashes that same tab supplied. That proves one thing — that the tab is
 * consistent with itself — and nothing else. A tab that reloaded, a study whose
 * saved report changed on another workstation, and a tab that simply lies all
 * look identical to it.
 *
 * `loadPersistedReportToken()` already derived a token the server could trust,
 * but from `patient_reports`, and a reporting-workspace study has no
 * `patient_reports` row until it is signed — so for every live drafting session
 * it returned `token: null` and the comparison quietly never happened.
 *
 * The durable record of an unsigned study's report is one row of
 * `radiology_report_drafts`. This module reads that row, projects it the way the
 * editor does, and turns it into the three things the Apply boundary needs:
 *
 *   1. a baseline captured by the SERVER when the job was enqueued
 *      (`captureComposeBaseline`), stored on the job as `source_persisted_token`
 *      together with the `source_draft_id` it was taken from;
 *   2. a compare-and-set on the saved report at the instant the accepted text is
 *      written (`authoriseComposeSaveTx`), so a draft cannot overwrite a report
 *      that moved underneath it, plus a receipt of exactly what was written
 *      (`applied_persisted_token`);
 *   3. a durability proof before a job may be marked APPLIED
 *      (`verifyComposeDurabilityTx`): the saved report must still hold the text
 *      this server authorised, and it must still hold the AI's accepted words.
 *
 * What this deliberately is NOT
 *   * Not a second writer of clinical text. The write stays in POST /save-draft,
 *     the editor's own canonical path, with its Quick Select and structured-cache
 *     dual-writes and its `assertDraftWritable` and study-lock guards intact.
 *     #884 and #885 removed two competing authoring surfaces; adding one here
 *     would undo that, and PROMPT 4 §5 asks for the smallest option, not the
 *     most server-owned one.
 *   * Not an authority on the browser's opinion. `previous` is the only
 *     client-supplied value used here, and only as a *candidate* to compare
 *     against the row: it cannot make a write succeed unless the row itself
 *     already holds that content.
 *   * Not an authority on study identity. #905's `composeIdentity` decides whose
 *     report this is; this module only ever speaks about content.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** Drizzle transaction handle — same query shape as `db`, so every statement
 *  here can run either inside `db.transaction()` or standalone. */
export type ComposePersistenceTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ComposeNarrative = {
  findings: string;
  impression: string;
  recommendation: string;
};

/** The columns this module reads, in the snake_case the raw SQL returns. */
export type ComposeDraftRow = {
  id: number;
  studyId: number | null;
  worklistId: number | null;
  patientId: number | null;
  rawFindings: string | null;
  impression: string | null;
  recommendation: string | null;
  status: string;
  finalReportId: number | null;
  updatedAt: string;
};

/** Unit separator: cannot appear in report prose, so a narrative assembled from
 *  three fields can never collide with a different split of the same text. */
const SEPARATOR = String.fromCharCode(31);

/** Machine codes and clinician sentences for every persistence refusal, in one
 *  place so a refusal says the same thing whichever route produced it. */
export const PERSISTENCE_MESSAGES = {
  compose_persistence_unavailable:
    "CARE could not read this study's saved report, so it cannot confirm the AI draft is safe to apply. Nothing was changed.",
  compose_baseline_missing:
    "This AI draft was created before CARE could verify the saved report it was based on. Save, then generate the draft again.",
  compose_baseline_ambiguous:
    "This study has two saved versions of the report at the same instant, so CARE cannot tell which one the AI draft was based on. Nothing was changed.",
  compose_report_moved:
    "The saved report changed after this AI draft was generated, so the draft was not applied over it. Your text is unchanged — review and regenerate.",
  compose_not_persisted:
    "The accepted AI text is not in this study's saved report, so the draft was not marked applied. Nothing was changed.",
} as const;

export type ComposePersistenceCode = keyof typeof PERSISTENCE_MESSAGES;

export type ComposePersistenceRefusal = {
  ok: false;
  code: ComposePersistenceCode;
  message: string;
};

/**
 * Mirror of `normalizeImpressionLines` in
 * `artifacts/diagnostic-erp/src/lib/workspaceReportState.ts` — the function the
 * reporting workspace uses to turn the stored `impression` column into what the
 * radiologist actually reads on screen.
 *
 * It has to be mirrored rather than imported (the SPA cannot be imported by the
 * API) and it has to agree exactly, because a token computed over a *different*
 * projection than the one the editor displays is a token for a report nobody is
 * looking at. `composePersistence.contract.test.ts` pins the same table of
 * hostile inputs against both implementations for that reason: the stored column
 * keeps whitespace the display throws away (`["  Line one.  \n  Line two.  "]`
 * projects to `Line one.  \n  Line two.` — only the outer edges of the whole
 * element are trimmed), and an impression that merely *looks* like a JSON array
 * must stay intact.
 */
export function projectStoredImpression(impression: string | null): string {
  const lines: string[] = [];
  const raw = impression ?? "";
  const trimmedOuter = raw.trim();
  if (trimmedOuter.startsWith("[")) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(trimmedOuter);
    } catch {
      parsed = null;
    }
    if (Array.isArray(parsed)) {
      for (const line of parsed) {
        if (typeof line !== "string") continue;
        const t = line.trim();
        if (t) lines.push(t);
      }
      return lines.join("\n");
    }
  }
  return trimmedOuter;
}

/**
 * The report as the radiologist sees it, from the columns that hold it.
 *
 * Findings and recommendation round-trip byte-for-byte through POST /save-draft
 * (measured: leading blank lines and an interior tab come back identical), so
 * they are taken verbatim. Impression goes through the display projection above.
 * A study with no draft row has the empty narrative — a defined value with a
 * defined token, which is NOT the same thing as a job whose baseline column is
 * NULL, and nothing here conflates the two.
 */
export function projectComposeNarrative(row: ComposeDraftRow | null): ComposeNarrative {
  return {
    findings: row?.rawFindings ?? "",
    impression: projectStoredImpression(row?.impression ?? null),
    recommendation: row?.recommendation ?? "",
  };
}

/** Stable content fingerprint of a narrative. */
export function composeNarrativeToken(n: ComposeNarrative): string {
  return createHash("sha256")
    .update([n.findings, n.impression, n.recommendation].join(SEPARATOR))
    .digest("hex")
    .slice(0, 32);
}

/** Baseline for a study that has no saved draft yet: the empty narrative. */
export const EMPTY_REPORT_TOKEN = composeNarrativeToken({ findings: "", impression: "", recommendation: "" });

function asDraftRow(r: Record<string, unknown>): ComposeDraftRow {
  return {
    id: Number(r.id),
    studyId: r.study_id == null ? null : Number(r.study_id),
    worklistId: r.worklist_id == null ? null : Number(r.worklist_id),
    patientId: r.patient_id == null ? null : Number(r.patient_id),
    rawFindings: r.raw_findings == null ? null : String(r.raw_findings),
    impression: r.impression == null ? null : String(r.impression),
    recommendation: r.recommendation == null ? null : String(r.recommendation),
    status: String(r.status ?? "DRAFT"),
    finalReportId: r.final_report_id == null ? null : Number(r.final_report_id),
    updatedAt: String(r.updated_at ?? ""),
  };
}

export type AuthoritativeDraft =
  /** A single current row and the token of what it holds. */
  | { kind: "row"; row: ComposeDraftRow; token: string }
  /** No draft row for this study: a real state with a real token, not a failure. */
  | { kind: "none"; token: string }
  /** Two rows share one `updated_at`, so "the newest" is undefined. The browser's
   *  own pick (`drafts[0]` of `ORDER BY updated_at DESC`) is nondeterministic in
   *  exactly this case, so neither side can be believed. */
  | { kind: "ambiguous" }
  /** The newest row names a different worklist than the study resolved to —
   *  `study_id` and `worklist_id` disagree, so which report this is cannot be
   *  established from the row alone. */
  | { kind: "conflict" }
  /** The read failed. An unreadable report is NOT an unchanged report. */
  | { kind: "error" };

/**
 * Read the one draft row that IS the study's current editable report.
 *
 * The rule is deliberately the same rule the reporting workspace applies when it
 * hydrates the editor — `radiology_report_drafts` rows whose `study_id` equals
 * the worklist id, newest first — because a baseline computed over a different
 * row than the one on screen would refuse honest applies. GET /drafts
 * (`radiology-report-generator.ts:1972`) is that query, and
 * `useRadiologyDraftId.ts:36` takes `drafts[0]` of it. Measured against real
 * Postgres: the route's first row and a direct newest-first read agree, and the
 * token computed from the route's JSON equals the token computed from the row,
 * which is what lets the browser hold a server-issued token at all.
 *
 * `forUpdate` takes the row lock, so an authorised write and its receipt cannot
 * interleave with another session's save of the same row.
 */
export async function loadAuthoritativeDraft(
  executor: ComposePersistenceTx | typeof db,
  worklistId: number,
  opts: { forUpdate?: boolean; patientId?: number | null } = {},
): Promise<AuthoritativeDraft> {
  try {
    const result = await executor.execute(sql`
      SELECT id, study_id, worklist_id, patient_id, raw_findings, impression,
             recommendation, status, final_report_id, updated_at
        FROM radiology_report_drafts
       WHERE study_id = ${worklistId}
       ORDER BY updated_at DESC
       LIMIT 2
       ${opts.forUpdate ? sql`FOR UPDATE` : sql``}`);
    const rawRows = (result as { rows?: Record<string, unknown>[] }).rows
      ?? (Array.isArray(result) ? (result as Record<string, unknown>[]) : []);
    const rows = rawRows.map(asDraftRow);
    if (rows.length === 0) return { kind: "none", token: EMPTY_REPORT_TOKEN };

    // Mirror GET /drafts' patient filter: a row that names no patient is the
    // writer's own unsaved stub and still counts, a row that names someone else
    // does not.
    const scoped = opts.patientId
      ? rows.filter((r) => r.patientId == null || r.patientId === opts.patientId)
      : rows;
    if (scoped.length === 0) return { kind: "none", token: EMPTY_REPORT_TOKEN };

    const top = scoped[0];
    if (scoped.length > 1 && String(scoped[1].updatedAt) === String(top.updatedAt)) {
      return { kind: "ambiguous" };
    }
    // `study_id` is the worklist id by construction (POST /save-draft overwrites
    // it with the resolved worklist row), but a row written before that rule, or
    // a number that collides across the two independent id sequences, can name a
    // different worklist. Refuse rather than guess whose report this is.
    if (top.worklistId != null && top.worklistId !== worklistId) return { kind: "conflict" };

    return { kind: "row", row: top, token: composeNarrativeToken(projectComposeNarrative(top)) };
  } catch {
    return { kind: "error" };
  }
}

/** Server-side baseline: what the saved report held at the instant the AI was
 *  asked to draft. Stored on the job, never supplied by the browser. */
export type ComposeBaseline =
  | { ok: true; token: string; draftId: number | null }
  | { ok: false; code: ComposePersistenceCode; message: string };

export async function captureComposeBaseline(
  worklistId: number,
  patientId: number | null,
): Promise<ComposeBaseline> {
  const found = await loadAuthoritativeDraft(db, worklistId, { patientId });
  switch (found.kind) {
    case "row":
      return { ok: true, token: found.token, draftId: found.row.id };
    case "none":
      // A study with no saved draft still has a baseline: the empty report. The
      // difference between "empty" and "we never looked" is the job's
      // `source_draft_id IS NULL AND token = EMPTY_REPORT_TOKEN` pair, and it is
      // what makes `compose_baseline_missing` mean "legacy job" and not "blank
      // report".
      return { ok: true, token: found.token, draftId: null };
    case "ambiguous":
      return { ok: false, code: "compose_baseline_ambiguous", message: PERSISTENCE_MESSAGES.compose_baseline_ambiguous };
    case "conflict":
      return { ok: false, code: "compose_persistence_unavailable", message: PERSISTENCE_MESSAGES.compose_persistence_unavailable };
    case "error":
    default:
      return { ok: false, code: "compose_persistence_unavailable", message: PERSISTENCE_MESSAGES.compose_persistence_unavailable };
  }
}

/** The three evidence columns, read raw. They are read with SQL rather than
 *  through the Drizzle model because they are only ever touched inside a locked
 *  transaction — see the note in `lib/db/src/schema/aiReportComposer.ts`. */
export type JobPersistenceEvidence = {
  sourceToken: string | null;
  sourceDraftId: number | null;
  receiptToken: string | null;
  worklistId: number | null;
  status: string;
};

export async function readJobPersistenceEvidence(
  executor: ComposePersistenceTx | typeof db,
  jobId: number,
): Promise<JobPersistenceEvidence | { unreadable: true }> {
  try {
    const result = await executor.execute(sql`
      SELECT status, worklist_id, source_persisted_token, source_draft_id,
             applied_persisted_token
        FROM ai_report_compose_jobs
       WHERE id = ${jobId}
       LIMIT 1`);
    const rows = (result as { rows?: Record<string, unknown>[] }).rows
      ?? (Array.isArray(result) ? (result as Record<string, unknown>[]) : []);
    const row = rows[0];
    if (!row) return { unreadable: true };
    return {
      sourceToken: row.source_persisted_token == null ? null : String(row.source_persisted_token),
      sourceDraftId: row.source_draft_id == null ? null : Number(row.source_draft_id),
      receiptToken: row.applied_persisted_token == null ? null : String(row.applied_persisted_token),
      worklistId: row.worklist_id == null ? null : Number(row.worklist_id),
      status: String(row.status),
    };
  } catch {
    return { unreadable: true };
  }
}

export function sameNarrative(a: ComposeNarrative, b: ComposeNarrative): boolean {
  return a.findings === b.findings && a.impression === b.impression && a.recommendation === b.recommendation;
}

/** An editor-side narrative projected the way a stored one projects: the
 *  impression element is trimmed and an all-whitespace impression becomes empty,
 *  while interior blank lines survive — measured against POST /save-draft plus
 *  the workspace's own reload, which behave the same way. Findings and
 *  recommendation are stored verbatim, so they pass through untouched. */
export function projectEditorNarrative(n: ComposeNarrative): ComposeNarrative {
  return { findings: n.findings, impression: n.impression.trim(), recommendation: n.recommendation };
}

/**
 * The compare-and-set rule for one composer-tagged save.
 *
 * The write is authorised when the saved report is in one of exactly two states:
 *
 *   `source`   — it still holds what the server read when the AI was asked to
 *                draft. Nothing moved, so the draft describes it.
 *   `previous` — it holds the text this editor says it is replacing. This is not
 *                trust in the browser: the value is compared against the row, and
 *                it can only match if the row already contains it. The arm exists
 *                because the editor's own 30-second autosave legitimately persists
 *                what the radiologist typed between drafting and applying, and a
 *                rule that refused that would refuse the common case — type a
 *                finding, ask for an AI impression, accept it 40 seconds later.
 *                After that autosave the row and the editor agree, which is
 *                precisely the state in which applying is safe.
 *
 * Anything else — a second workstation's save, another reader's edit, a
 * hydration that replaced the tab — matches neither arm and is refused.
 */
export function composeSaveAuthorisation(opts: {
  sourceToken: string | null;
  currentToken: string;
  current: ComposeNarrative;
  previous: ComposeNarrative | null;
}): { ok: true } | { ok: false; code: ComposePersistenceCode; message: string } {
  if (opts.sourceToken == null) {
    return { ok: false, code: "compose_baseline_missing", message: PERSISTENCE_MESSAGES.compose_baseline_missing };
  }
  if (opts.currentToken === opts.sourceToken) return { ok: true };
  if (opts.previous && sameNarrative(opts.current, opts.previous)) return { ok: true };
  return { ok: false, code: "compose_report_moved", message: PERSISTENCE_MESSAGES.compose_report_moved };
}

export type ComposeSaveGate =
  /** Honour the tag: the caller may write, and must then record the receipt. */
  | { proceed: "composer"; currentToken: string }
  /** The tag cannot be honoured (a job from before this change, or a job whose
   *  study is not the study being saved). The save goes ahead as an ordinary
   *  draft save and nothing is recorded on the job: a malformed tag must never
   *  cost the radiologist their typing. The AI apply is refused later, by
   *  `/applied`, which is where the evidence actually gates anything. */
  | { proceed: "ordinary"; reason: "baseline_missing" | "tag_study_conflict" }
  /** The saved report moved underneath the draft. Nothing is written. */
  | { refuse: ComposePersistenceRefusal }
  /** A read failed. Fails closed: no write, no receipt. */
  | { refuse: { ok: false; code: "compose_persistence_unavailable"; message: string } };

/**
 * Decide whether a composer-tagged save may write, inside the caller's
 * transaction and under the row lock.
 *
 * Locked read first, CAS second, write third — in that order in one transaction,
 * so another session's save of the same row waits for this one and cannot slip
 * between the check and the write. `previous` is projected through the same
 * display normalizer as the row, so an editor showing the trimmed impression is
 * compared against the trimmed impression rather than against the stored JSON.
 */
export async function authoriseComposeSaveTx(
  tx: ComposePersistenceTx,
  opts: {
    jobId: number;
    worklistId: number;
    patientId: number | null;
    previous: ComposeNarrative | null;
  },
): Promise<ComposeSaveGate> {
  const evidence = await readJobPersistenceEvidence(tx, opts.jobId);
  if ("unreadable" in evidence) {
    return {
      refuse: {
        ok: false,
        code: "compose_persistence_unavailable",
        message: PERSISTENCE_MESSAGES.compose_persistence_unavailable,
      },
    };
  }
  if (evidence.worklistId !== opts.worklistId) {
    return { proceed: "ordinary", reason: "tag_study_conflict" };
  }
  if (evidence.sourceToken == null) {
    return { proceed: "ordinary", reason: "baseline_missing" };
  }

  const found = await loadAuthoritativeDraft(tx, opts.worklistId, {
    forUpdate: true,
    patientId: opts.patientId,
  });
  if (found.kind === "error") {
    return {
      refuse: {
        ok: false,
        code: "compose_persistence_unavailable",
        message: PERSISTENCE_MESSAGES.compose_persistence_unavailable,
      },
    };
  }
  if (found.kind === "ambiguous" || found.kind === "conflict") {
    return {
      refuse: {
        ok: false,
        code: found.kind === "ambiguous" ? "compose_baseline_ambiguous" : "compose_persistence_unavailable",
        message:
          found.kind === "ambiguous"
            ? PERSISTENCE_MESSAGES.compose_baseline_ambiguous
            : PERSISTENCE_MESSAGES.compose_persistence_unavailable,
      },
    };
  }

  const current = found.kind === "row" ? projectComposeNarrative(found.row) : { findings: "", impression: "", recommendation: "" };
  const gate = composeSaveAuthorisation({
    sourceToken: evidence.sourceToken,
    currentToken: found.token,
    current,
    previous: opts.previous ? projectEditorNarrative(opts.previous) : null,
  });
  if (!gate.ok) return { refuse: gate };
  return { proceed: "composer", currentToken: found.token };
}

/**
 * Record on the job what the authorised write actually produced.
 *
 * Read back after the draft save, inside the same transaction and while this
 * transaction still holds the row lock, so the receipt is a fact about committed
 * storage rather than about the values the caller intended to send. `/applied`
 * later requires the row to still carry this token: an APPLIED job can then only
 * mean "the server wrote this text and nothing has replaced it since".
 */
export async function recordComposeReceiptTx(
  tx: ComposePersistenceTx,
  opts: { jobId: number; worklistId: number; patientId: number | null },
): Promise<{ ok: true; token: string } | { ok: false; code: ComposePersistenceCode; message: string }> {
  const found = await loadAuthoritativeDraft(tx, opts.worklistId, { forUpdate: true, patientId: opts.patientId });
  if (found.kind !== "row" && found.kind !== "none") {
    return {
      ok: false,
      code: "compose_persistence_unavailable",
      message: PERSISTENCE_MESSAGES.compose_persistence_unavailable,
    };
  }
  try {
    await tx.execute(sql`
      UPDATE ai_report_compose_jobs
         SET applied_persisted_token = ${found.token},
             source_draft_id = COALESCE(source_draft_id, ${found.kind === "row" ? found.row.id : null})
       WHERE id = ${opts.jobId}`);
  } catch {
    return {
      ok: false,
      code: "compose_persistence_unavailable",
      message: PERSISTENCE_MESSAGES.compose_persistence_unavailable,
    };
  }
  return { ok: true, token: found.token };
}

/** Which field an accepted change writes, in the editor's own vocabulary. */
export type ComposeAcceptedField = "findings" | "impression" | "recommendation";

/** One accepted AI change, as the Apply boundary has to see it. */
export type ComposeAcceptedChange = {
  field: ComposeAcceptedField;
  /** The text the radiologist accepted into that field. */
  text: string;
  /** The text the change replaced — needed to prove a deletion was persisted. */
  originalText: string;
};

/**
 * The durability proof that must pass before a job may be marked APPLIED.
 *
 * Three things have to be true of storage, all read by the server under the row
 * lock, none of them supplied by the browser:
 *
 *   1. the job has a baseline — a job enqueued before this evidence existed
 *      cannot be shown to describe the current report, so it is refused rather
 *      than assumed unchanged ("missing token must not mean unchanged");
 *   2. the saved report still holds the receipt token this server wrote when it
 *      authorised the accepted text — so an apply cannot be recorded over a
 *      report that has since been replaced;
 *   3. the accepted words are actually in the fields they were written to, which
 *      is the difference between "the AI draft was marked applied" and "the
 *      accepted text is the study's report".
 *
 * (3) is containment, not equality, on purpose: a radiologist who accepts a
 * sentence and then adds their own clause before saving has persisted the
 * accepted text too, and refusing that would punish the behaviour the product
 * wants. An accepted change whose text is empty proves nothing by containment
 * and is refused, because "the report contains nothing" is not evidence.
 */
export async function verifyComposeDurabilityTx(
  tx: ComposePersistenceTx,
  opts: {
    jobId: number;
    worklistId: number;
    patientId: number | null;
    accepted: ComposeAcceptedChange[];
  },
): Promise<{ ok: true; token: string } | { ok: false; code: ComposePersistenceCode; message: string }> {
  const evidence = await readJobPersistenceEvidence(tx, opts.jobId);
  if ("unreadable" in evidence) {
    return { ok: false, code: "compose_persistence_unavailable", message: PERSISTENCE_MESSAGES.compose_persistence_unavailable };
  }
  if (evidence.sourceToken == null) {
    return { ok: false, code: "compose_baseline_missing", message: PERSISTENCE_MESSAGES.compose_baseline_missing };
  }
  if (evidence.receiptToken == null) {
    return { ok: false, code: "compose_not_persisted", message: PERSISTENCE_MESSAGES.compose_not_persisted };
  }

  const found = await loadAuthoritativeDraft(tx, opts.worklistId, { forUpdate: true, patientId: opts.patientId });
  if (found.kind === "error") {
    return { ok: false, code: "compose_persistence_unavailable", message: PERSISTENCE_MESSAGES.compose_persistence_unavailable };
  }
  if (found.kind === "ambiguous") {
    return { ok: false, code: "compose_baseline_ambiguous", message: PERSISTENCE_MESSAGES.compose_baseline_ambiguous };
  }
  if (found.kind === "conflict") {
    return { ok: false, code: "compose_persistence_unavailable", message: PERSISTENCE_MESSAGES.compose_persistence_unavailable };
  }
  if (found.token !== evidence.receiptToken) {
    return { ok: false, code: "compose_report_moved", message: PERSISTENCE_MESSAGES.compose_report_moved };
  }

  const narrative = found.kind === "row" ? projectComposeNarrative(found.row) : { findings: "", impression: "", recommendation: "" };
  for (const change of opts.accepted) {
    const expected = change.text.trim();
    if (expected) {
      // Containment, not equality: see the docstring above.
      if (!narrative[change.field].includes(expected)) {
        return { ok: false, code: "compose_not_persisted", message: PERSISTENCE_MESSAGES.compose_not_persisted };
      }
      continue;
    }
    // `changeType: "DELETE"` accepts an empty proposal, so containment would be
    // vacuously true of every report. A deletion is proven by its absence: the
    // text the radiologist removed must actually be gone.
    const removed = change.originalText.trim();
    if (!removed || narrative[change.field].includes(removed)) {
      return { ok: false, code: "compose_not_persisted", message: PERSISTENCE_MESSAGES.compose_not_persisted };
    }
  }
  return { ok: true, token: found.token };
}
