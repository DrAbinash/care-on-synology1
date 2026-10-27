/**
 * openStudyIdentity.ts — which study the OPEN report is about.
 *
 * The reading queue is filtered server-side (modality + date preset), so
 * `workflow.currentRow` goes null the moment a radiologist changes that filter,
 * and it was already null for a report opened by link (Report Hub, a shared URL,
 * Next across modalities). Identity used to ride on that row, so the embedded
 * viewer lost its study and the key-images rail — the only way to attach a PACS
 * image — disappeared from a report that was still open, still locked to this
 * user, and still being written.
 *
 * This separates the two things the queue was doing at once:
 *   • navigation: Prev/Next/position over the FILTERED list — unchanged, still
 *     `workflow.queue`;
 *   • identity: what this report is about — resolved here, from the by-id worklist
 *     read, which is the same authoritative row the study lock and the signed
 *     status already use.
 *
 * No second source of patient or study truth is introduced: the fields are the
 * worklist row's own columns, and a row that names a different study is refused
 * rather than borrowed.
 */

export type StudyIdentity = {
  /** radiology_worklist.id — the anchor the lock, the draft and the bill all use. */
  worklistId: number;
  studyId: number | null;
  patientId: number | null;
  patientName: string | null;
  accessionNumber: string | null;
  studyInstanceUID: string | null;
  modality: string | null;
  status: string | null;
  /** Where this identity came from, so a caller can tell "loaded" from "guessed". */
  source: "detail" | "queue" | "merged";
};

type IdentitySource = {
  id?: number | null;
  studyId?: number | null;
  patientId?: number | null;
  patientName?: string | null;
  accessionNumber?: string | null;
  studyInstanceUID?: string | null;
  modality?: string | null;
  status?: string | null;
} | null | undefined;

const positiveId = (n: unknown): number | null => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** Trim "" and null to one shape, so a blank queue field cannot mask a real one. */
const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return s || null;
};

/**
 * Resolve the open report's study. `detail` is the by-id worklist read (the
 * authority); `queueRow` is the filtered-queue row, used only to fill fields while
 * the detail read is in flight. A row that names another study is never used.
 */
export function resolveOpenStudyIdentity(opts: {
  studyId: number | null | undefined;
  detail?: IdentitySource;
  queueRow?: IdentitySource;
}): StudyIdentity | null {
  const anchor = positiveId(opts.studyId);
  if (!anchor) return null;

  // `id` is absent on some projections; absent means "the row you asked for".
  const detail = opts.detail && (opts.detail.id == null || Number(opts.detail.id) === anchor)
    ? opts.detail
    : null;
  const queueRow = opts.queueRow && (opts.queueRow.id == null || Number(opts.queueRow.id) === anchor)
    ? opts.queueRow
    : null;
  if (!detail && !queueRow) return null;

  const normalize = (row: NonNullable<IdentitySource>) => ({
    studyId: positiveId(row.studyId),
    patientId: positiveId(row.patientId),
    patientName: text(row.patientName),
    accessionNumber: text(row.accessionNumber),
    studyInstanceUID: text(row.studyInstanceUID),
    modality: text(row.modality),
    status: text(row.status),
  });
  const d = detail ? normalize(detail) : null;
  const q = queueRow ? normalize(queueRow) : null;
  // A blank field on the authority is missing, not an answer: fall through to the
  // other row rather than dropping a real identifier.
  const pick = <K extends keyof ReturnType<typeof normalize>>(k: K): ReturnType<typeof normalize>[K] =>
    (d?.[k] ?? q?.[k] ?? null) as ReturnType<typeof normalize>[K];

  return {
    worklistId: anchor,
    /** The linked bill/study row, which may legitimately be null. */
    studyId: pick("studyId"),
    patientId: pick("patientId"),
    patientName: pick("patientName"),
    accessionNumber: pick("accessionNumber"),
    studyInstanceUID: pick("studyInstanceUID"),
    modality: pick("modality"),
    status: pick("status"),
    source: d && q ? "merged" : d ? "detail" : "queue",
  };
}
