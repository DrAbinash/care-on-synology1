/**
 * radiologyDraftRevision.ts — the server-derived fingerprint of one draft row's
 * savable content, and the compare-and-set rule POST /save-draft applies to it.
 *
 * WHY A FINGERPRINT AND NOT `updated_at`
 *
 * A timestamp looks like the obvious revision token and is not usable here.
 * `radiology_report_drafts.updated_at` carries `.$onUpdate(() => new Date())`,
 * and one save writes the row more than once: `writeDraftRow` runs `.returning()`
 * FIRST, then the A3.2 findings dual-write, the A4 cache regeneration, the D3
 * writer and `persistCareStructuredJsonPatch` each update the same row again. So
 * the timestamp in the response the client was handed is not the timestamp the
 * row carries a moment later — a CAS on it would refuse honest saves at random.
 * Drizzle also returns a JS Date, whose ISO form drops the microsecond the column
 * stores, so the value cannot even round-trip exactly.
 *
 * Content is the honest answer: two writers hold the same revision exactly when
 * they are looking at the same report.
 *
 * WHY THE ENVELOPE IS INSIDE IT
 *
 * The audit's reproduced loss was narrative — one console's sentence erased by
 * another's — and the narrative columns alone would catch that. They are not
 * enough: a save also replaces the Quick Select ledger, the viewer measurements,
 * the canal AP provenance, the spine capture state and the applied format
 * identity, all of it merged into `structured_json` AFTER the row write. A
 * revision over the prose only would let a console that changed a measurement be
 * overwritten by another console that changed no prose at all, which is the same
 * defect wearing different clothes. So `structured_json` participates.
 *
 * One leaf of it does not: `careReportFormatIdentity.appliedAt` is a clock this
 * route rewrites on every save, and a save-time clock is the same disqualifier
 * as `updated_at`. See ENVELOPE_WRITE_STAMPS for the measurement and the exact
 * path.
 *
 * What deliberately does NOT participate: `status` and `final_report_id`. Those
 * are lifecycle-owned (finalize, withdrawal #1236) and move without changing what
 * the editor holds; guarding them would refuse a radiologist's next autosave for
 * a reason they cannot act on. Whether a draft may be written at all stays
 * `assertDraftWritable`'s question, answered before this one.
 *
 * The browser never computes this. It receives the token from GET /drafts or
 * from its own save response and echoes it back, exactly as
 * `composePersistence.ts` does for the AI Apply boundary — a client-supplied
 * fingerprint is an opinion, and only the row decides.
 */
import { createHash } from "node:crypto";

/**
 * The revision a client sends when it read the study and there was NO draft row.
 * A defined value, not a hole: without it, two consoles opening an unbilled study
 * both take the INSERT branch and the study ends up with two reports — the
 * `compose_baseline_ambiguous` state `loadAuthoritativeDraft` already refuses to
 * guess its way out of.
 */
export const ABSENT_DRAFT_REVISION = "absent";

/** Columns a draft save writes, as the Drizzle model names them. */
export type DraftRevisionSource = {
  templateId?: string | null;
  modality?: string | null;
  studyName?: string | null;
  clinicalHistory?: string | null;
  rawFindings?: string | null;
  findingsSections?: string | null;
  impression?: string | null;
  recommendation?: string | null;
  formattedReportHtml?: string | null;
  formattedReportText?: string | null;
  structuredJson?: unknown;
  /**
   * The canonical structured document (`radiology_report_drafts.structured_json_d1`), written by the
   * D3 writer on the same save as the narrative. It is report content — the D1 document is what the
   * archive, the amendment chain and the D2 renderer read — so a row whose structured document moved
   * under this editor is a changed report, exactly like a row whose Findings moved.
   */
  structuredJsonD1?: unknown;
};

/** Unit separator: cannot appear in report prose, so a fingerprint assembled
 *  from several columns cannot collide with a different split of the same text.
 *  Same reasoning as `composePersistence.ts`. */
const SEPARATOR = String.fromCharCode(31);

const text = (value: string | null | undefined): string => value ?? "";

const json = (value: unknown): string => (value === undefined ? "null" : JSON.stringify(value) ?? "null");

/**
 * Envelope paths this route rewrites on EVERY save, whatever the radiologist did.
 *
 * Measured in the browser rather than reasoned about: pressing Save twice with
 * no edit in between produced three different revisions
 * (`tmp/evidence/noop-churn-keys.json`), and exactly one leaf of the 48,855 byte
 * envelope differed — `careReportFormatIdentity.appliedAt`. The client builds
 * that object inside the save body itself, so `buildCareReportFormatIdentity`
 * runs `new Date().toISOString()` afresh on every save, and
 * `structuredJsonColumn` substitutes `now()` whenever the client leaves it out.
 *
 * It is the envelope's own `updated_at`, and the reasoning at the top of this
 * file applies one level down: a value that moves every time this route writes
 * cannot be evidence that the report changed. While it churned, the refusal said
 * "the saved report changed since this editor last read it" about a report no
 * window had changed — console A leaving a study was enough, because the
 * pre-leave flush rewrote the stamp. A guard that fires on an unchanged report
 * trains the radiologist to distrust the one case it exists for.
 *
 * Only the clock is removed. The identity it is attached to — `name`,
 * `reportTitle`, `formatId`, `formatRevision`, the baseline manifest — all stay
 * in the projection, so a console that rolled the applied format back over
 * another's is still refused. The list is by exact path on purpose: an
 * `appliedAt` anywhere else in the envelope (the abnormal-pattern markers record
 * when a pattern was genuinely applied) is report content and stays guarded.
 *
 * Anything added to this list is a promise that the named value is a write stamp
 * and nothing else. `noop-revision-churn.mjs` in the rig re-measures that
 * promise against the running app.
 */
const ENVELOPE_WRITE_STAMPS: ReadonlyArray<readonly string[]> = [
  ["careReportFormatIdentity", "appliedAt"],
];

/**
 * Copy one object with a single leaf path removed, without touching the row the
 * caller passed in — the route reads this row again after the check.
 */
function omitPath(value: unknown, path: readonly string[]): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const [head, ...rest] = path;
  if (!(head in source)) return value;
  if (rest.length === 0) {
    const copy = { ...source };
    delete copy[head];
    return copy;
  }
  return { ...source, [head]: omitPath(source[head], rest) };
}

function envelopeForRevision(structuredJson: unknown): string {
  let stripped = structuredJson;
  if (stripped !== null && typeof stripped === "object" && !Array.isArray(stripped)) {
    for (const path of ENVELOPE_WRITE_STAMPS) stripped = omitPath(stripped, path);
  }
  return json(stripped);
}

/**
 * The structured document as revision evidence, with its own write stamp removed.
 *
 * `audit.last_modified_at` is the draft row's `updated_at` carried into the document
 * (`radiologyD1DraftWriter.ts:258`), so it moves on every save whatever the radiologist did —
 * including it whole would make a no-op save look like a conflict, the exact failure
 * `ENVELOPE_WRITE_STAMPS` exists to prevent one level up. Everything else in the document is
 * report content: findings, measurements, provenance, and `created_at`, which does not move per
 * save. Absent (the D3 writer is flag-gated and skips on validation failure) serializes as `null`,
 * so a draft that has never had a structured document keeps the token it had before this field
 * existed only in the sense that it now also changes when one appears.
 */
function d1ForRevision(structuredJsonD1: unknown): string {
  let stripped = structuredJsonD1;
  if (stripped !== null && typeof stripped === "object" && !Array.isArray(stripped)) {
    stripped = omitPath(stripped, ["audit", "last_modified_at"]);
  }
  return json(stripped);
}

/**
 * The revision of a draft row as it stands in storage.
 *
 * `null`/absent is a defined state and returns `ABSENT_DRAFT_REVISION`, so
 * "there is no report yet" is a token the client can hold and name, rather than
 * an absence that quietly disables the check.
 *
 * The jsonb column is keyed in the order PostgreSQL hands it back (jsonb sorts
 * keys deterministically on store), so the same stored value serializes the same
 * way on every read — which is what lets the token from GET /drafts and the
 * token from a save response be the same string for the same row.
 */
export function draftRevisionOf(row: DraftRevisionSource | null | undefined): string {
  if (!row) return ABSENT_DRAFT_REVISION;
  const digest = createHash("sha256")
    .update([
      text(row.templateId),
      text(row.modality),
      text(row.studyName),
      text(row.clinicalHistory),
      text(row.rawFindings),
      text(row.findingsSections),
      text(row.impression),
      text(row.recommendation),
      text(row.formattedReportHtml),
      text(row.formattedReportText),
      envelopeForRevision(row.structuredJson),
      d1ForRevision(row.structuredJsonD1),
    ].join(SEPARATOR))
    .digest("hex")
    .slice(0, 32);
  return `dr1:${digest}`;
}

/**
 * Advisory-lock namespace for the draft CAS. `pg_advisory_xact_lock(class, obj)`
 * takes the class half so a study id can never collide with another subsystem's
 * advisory keys, and is released by the transaction that took it — a crashed
 * connection cannot strand a study.
 */
export const DRAFT_REVISION_LOCK_CLASS = 761_001;

export type DraftRevisionDecision =
  /** The client may write: either it named the revision the row holds, or it
   *  named nothing and keeps the behavior it has always had. */
  | { proceed: true; guarded: boolean }
  /** The row moved. Nothing was written. */
  | { proceed: false; current: string };

/**
 * The CAS rule, kept apart from the SQL so it can be read — and tested — as one
 * decision: the caller's token must equal the row's, and absence is a token too.
 */
export function decideDraftRevision(
  expected: string | null | undefined,
  currentRow: DraftRevisionSource | null,
): DraftRevisionDecision {
  if (expected == null) return { proceed: true, guarded: false };
  const current = draftRevisionOf(currentRow);
  if (current === expected) return { proceed: true, guarded: true };
  return { proceed: false, current };
}

/** Refusal identity — one code, one sentence, whichever path produced it. */
export const DRAFT_REVISION_CONFLICT = "DRAFT_REVISION_CONFLICT";

export function draftRevisionConflictMessage(): string {
  return "The saved report changed since this editor last read it, so this save was not written. Your text is still in the editor; saving again replaces the other window's version.";
}
