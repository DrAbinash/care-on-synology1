/**
 * Item 23 — the read-time drift check for a report that is already open.
 *
 * The billing desk and the acquisition machine both keep writing to the worklist
 * row after a radiologist has opened the study: a plain test re-billed as
 * contrast, a name corrected on the patients master, a DICOM re-import that
 * restamps accession/UID/age from the machine's tags. Until now the workspace
 * only found out at write time, when the save or the sign came back 409
 * (`hooks/radiology-workspace/useDraftPersistence.ts`) — after the report had
 * been typed against values that no longer exist.
 *
 * So this is the read-time half: capture the upstream record when the report
 * opens, and name every field that moved under it. Deliberately a WARNING and
 * nothing more — it never changes the draft, never overwrites clinical text,
 * and never blocks the signature. The radiologist's own edits to the row (the
 * referring-doctor control in the composer is the only one that writes a field
 * compared here) are folded into the baseline through `withUpstreamSelfWrite`,
 * so the strip reports what happened TO this console, not what this console did.
 * The default when a future local writer forgets to fold itself in is a redundant
 * warning, not a missed one — noise is recoverable, silence is not.
 *
 * `status` / `reportId` / `deliveryStatus` are NOT compared: a signature applied
 * elsewhere is already handled by the study lock and by
 * `lib/reportSignatureWithdrawal.ts`, and warning about it here would restate a
 * control that already fires.
 */

/** The shape `GET /api/radiology/pacs-worklist/:id` returns for these columns. */
export interface UpstreamDetailSource {
  patientName?: string | null;
  uhid?: string | null;
  age?: string | null;
  sex?: string | null;
  testName?: string | null;
  billedTestName?: string | null;
  studyDescription?: string | null;
  modality?: string | null;
  studyDate?: string | null;
  accessionNumber?: string | null;
  studyInstanceUID?: string | null;
  referringDoctor?: string | null;
}

export interface UpstreamStudyState {
  patientName: string;
  uhid: string;
  age: string;
  sex: string;
  billedTest: string;
  examination: string;
  modality: string;
  studyDate: string;
  accessionNumber: string;
  studyInstanceUID: string;
  referringDoctor: string;
}

export type UpstreamDriftKey = keyof UpstreamStudyState;

export interface UpstreamDriftField {
  key: UpstreamDriftKey;
  label: string;
  from: string;
  to: string;
}

/**
 * Display order, and the radiologist-facing name for each column. Patient
 * identity leads because it decides whose report this is; the billed test
 * follows because it decides plain vs contrast and which sections are in scope;
 * the identifiers come last because they are the ones a re-import moves.
 */
const UPSTREAM_DRIFT_FIELDS: ReadonlyArray<{ key: UpstreamDriftKey; label: string }> = [
  { key: "patientName", label: "Patient name" },
  { key: "uhid", label: "UHID" },
  { key: "age", label: "Age" },
  { key: "sex", label: "Sex" },
  { key: "billedTest", label: "Billed test" },
  { key: "examination", label: "Examination" },
  { key: "modality", label: "Modality" },
  { key: "studyDate", label: "Study date" },
  { key: "accessionNumber", label: "Accession number" },
  { key: "studyInstanceUID", label: "Study UID" },
  { key: "referringDoctor", label: "Referring doctor" },
];

/**
 * One comparison value per cell. Trimming and inner-whitespace collapsing keeps
 * a re-save that only reformatted the string from raising a warning; null,
 * undefined and "" are the same state to the database, so a column that was
 * already blank and stays blank is never drift.
 */
export function normalizeUpstreamValue(value: unknown): string {
  if (value == null) return "";
  return String(value).trim().replace(/\s+/g, " ");
}

/**
 * The upstream record to compare against. Returns null with no read yet, so a
 * caller can never build a baseline out of nothing — an empty baseline would
 * report every field as drift the moment the first read landed.
 */
export function readUpstreamStudyState(
  detail: UpstreamDetailSource | null | undefined,
): UpstreamStudyState | null {
  if (!detail) return null;
  return {
    patientName: normalizeUpstreamValue(detail.patientName),
    uhid: normalizeUpstreamValue(detail.uhid),
    age: normalizeUpstreamValue(detail.age),
    sex: normalizeUpstreamValue(detail.sex),
    // The by-id read returns the joined catalogue test under both column names
    // (`pacsWorklistDetailFields.ts`); read them in the same order as the
    // billed-test hint everywhere else in the workspace.
    billedTest: normalizeUpstreamValue(detail.testName ?? detail.billedTestName),
    examination: normalizeUpstreamValue(detail.studyDescription),
    modality: normalizeUpstreamValue(detail.modality),
    studyDate: normalizeUpstreamValue(detail.studyDate),
    accessionNumber: normalizeUpstreamValue(detail.accessionNumber),
    studyInstanceUID: normalizeUpstreamValue(detail.studyInstanceUID),
    referringDoctor: normalizeUpstreamValue(detail.referringDoctor),
  };
}

/** Every field that moved between two reads, in display order. */
export function diffUpstreamStudyState(
  before: UpstreamStudyState | null,
  after: UpstreamStudyState | null,
): UpstreamDriftField[] {
  if (!before || !after) return [];
  const out: UpstreamDriftField[] = [];
  for (const { key, label } of UPSTREAM_DRIFT_FIELDS) {
    const from = before[key];
    const to = after[key];
    if (from === to) continue;
    out.push({ key, label, from, to });
  }
  return out;
}

/**
 * Fold a value this console just wrote into the baseline, so the server's answer
 * to our own request is not reported as somebody else changing the study.
 * Returns the same object when nothing moved.
 */
export function withUpstreamSelfWrite(
  state: UpstreamStudyState,
  key: UpstreamDriftKey,
  value: unknown,
): UpstreamStudyState {
  const next = normalizeUpstreamValue(value);
  if (state[key] === next) return state;
  return { ...state, [key]: next };
}

/** The record captured when a study was opened, and the study it belongs to. */
export interface UpstreamBaseline {
  studyId: number;
  state: UpstreamStudyState;
}

export interface UpstreamDriftStep {
  studyId: number | null | undefined;
  baseline: UpstreamBaseline | null;
  /** The current read, or null when there is none yet (switch, error, in flight). */
  read: UpstreamStudyState | null;
  /** The warning on screen, so a failed re-read can leave it standing. */
  drift: UpstreamDriftField[];
  /** This console's own writes, as [field, the value it asked for]. */
  selfWrites: ReadonlyArray<readonly [UpstreamDriftKey, string]>;
}

export interface UpstreamDriftStepResult {
  baseline: UpstreamBaseline | null;
  drift: UpstreamDriftField[];
  /** Self-writes the server has not confirmed yet — still pending next time. */
  selfWrites: Array<[UpstreamDriftKey, string]>;
}

/**
 * One step of the drift check, as a pure function so its four decisions can be
 * tested without a query cache:
 *
 * 1. No study open → nothing is remembered. A baseline kept across a close
 *    would be minutes old and would report everything the desk did in between
 *    as if it had just happened.
 * 2. A different study (or the first read of this one) → capture it and clear
 *    the warning the previous study raised.
 * 3. No read yet for the SAME study → keep the last known answer. A failed or
 *    in-flight re-read must not erase a warning that is already on screen.
 * 4. Otherwise → fold in this console's own writes once the server has agreed
 *    with them, then diff. Folding is what keeps the referring-doctor control
 *    from being reported as somebody else changing the study; folding only at
 *    confirmation (rather than at click time) is what keeps an in-flight GET of
 *    the older row from reporting the radiologist's own edit backwards.
 */
export function stepUpstreamDrift(step: UpstreamDriftStep): UpstreamDriftStepResult {
  const { studyId, baseline, read, drift, selfWrites } = step;
  if (typeof studyId !== "number" || !Number.isFinite(studyId) || studyId <= 0) {
    return { baseline: null, drift: [], selfWrites: [] };
  }
  if (!baseline || baseline.studyId !== studyId) {
    return {
      baseline: read ? { studyId, state: read } : null,
      drift: [],
      selfWrites: [],
    };
  }
  if (!read) return { baseline, drift, selfWrites: selfWrites.map(([k, v]) => [k, v]) };
  const pending: Array<[UpstreamDriftKey, string]> = selfWrites.map(([k, v]) => [k, v]);
  let state = baseline.state;
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    const [key, wanted] = pending[i];
    if (read[key] !== wanted) continue;
    state = withUpstreamSelfWrite(state, key, wanted);
    pending.splice(i, 1);
  }
  const next = diffUpstreamStudyState(state, read);
  return {
    baseline: state === baseline.state ? baseline : { studyId, state },
    drift: sameUpstreamDrift(drift, next) ? drift : next,
    selfWrites: pending,
  };
}

/**
 * Structural equality for a drift list. Every re-read produces a fresh array,
 * and the strip is mounted in the composer chrome — handing back a new reference
 * on each poll would re-render the reporting pane every 30 seconds while a
 * warning is standing, over whatever the radiologist is typing.
 */
export function sameUpstreamDrift(a: UpstreamDriftField[], b: UpstreamDriftField[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((field, i) => field.key === b[i].key && field.from === b[i].from && field.to === b[i].to);
}

/** The baseline after the radiologist says they have read the warning: now. */
export function acknowledgedUpstreamBaseline(baseline: UpstreamBaseline, read: UpstreamStudyState): UpstreamBaseline {
  return { studyId: baseline.studyId, state: read };
}

/** Heading line for the strip: how much moved, phrased for a counting number. */
export function upstreamDriftHeading(fields: UpstreamDriftField[]): string {
  if (fields.length === 0) return "";
  if (fields.length === 1) return "1 detail on this study changed while the report was open";
  return `${fields.length} details on this study changed while the report was open`;
}

/** One old→new line. A blank side reads as the state it is: never set, or cleared. */
export function upstreamDriftLine(field: UpstreamDriftField): string {
  const from = field.from || "not set";
  const to = field.to || "cleared";
  return `${field.label}: ${from} → ${to}`;
}
