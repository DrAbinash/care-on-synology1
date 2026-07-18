/**
 * AI version comparison — Phase P4 / Gate G20 (pure).
 *
 * Diffs two immutable provisional report VERSIONS (rows from ai_shadow_drafts,
 * which are append-only and versioned per study — regeneration inserts a new
 * version, never overwrites). The result drives the radiologist-facing
 * "what changed between AI runs" view: added / removed / changed findings,
 * measurement deltas, impression change, and prompt/model provenance change.
 *
 * Pure + unit-tested. The service layer loads the two versions by (studyUid,
 * version) and hands their draftJson + provenance here; nothing here reads the
 * DB. It compares AI-vs-AI only — it never diffs against patient_reports.
 */

// ── The subset of the draft JSON this diff needs (see shadowPipeline persist). ─
export interface ComparableFinding {
  key: string;
  text: string;
  laterality?: string | null;
  negated?: boolean | null;
}
export interface ComparableMeasurement {
  id: string;
  value: number;
  unit: string;
}
export interface ComparableDraft {
  findings?: ComparableFinding[];
  measurements?: ComparableMeasurement[];
  impression?: string[];
  qualityScore?: number | null;
  degraded?: boolean | null;
}

export interface ComparableVersion {
  version: number;
  modelDigest?: string | null;
  promptVersion?: string | null;
  draft: ComparableDraft;
}

// ── Diff result ──────────────────────────────────────────────────────────────
export interface FindingChange {
  key: string;
  before: { text: string; laterality?: string | null; negated?: boolean | null };
  after: { text: string; laterality?: string | null; negated?: boolean | null };
  textChanged: boolean;
  lateralityChanged: boolean;
  negationChanged: boolean;
}
export interface MeasurementChange {
  id: string;
  beforeValue: number;
  afterValue: number;
  unit: string;
  delta: number;
}
export interface AiComparisonResult {
  fromVersion: number;
  toVersion: number;
  findings: {
    added: ComparableFinding[];
    removed: ComparableFinding[];
    changed: FindingChange[];
    unchanged: string[];
  };
  measurements: {
    added: ComparableMeasurement[];
    removed: ComparableMeasurement[];
    changed: MeasurementChange[];
  };
  impression: {
    changed: boolean;
    before: string[];
    after: string[];
  };
  provenance: {
    modelChanged: boolean;
    promptChanged: boolean;
    fromModelDigest?: string | null;
    toModelDigest?: string | null;
    fromPromptVersion?: string | null;
    toPromptVersion?: string | null;
  };
  /** True when nothing material differs between the two versions. */
  identical: boolean;
}

function indexByKey<T extends { key: string }>(items: T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items ?? []) if (it.key) m.set(it.key, it);
  return m;
}
function indexById<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items ?? []) if (it.id) m.set(it.id, it);
  return m;
}
const norm = (v: string | null | undefined) => (v ?? "").trim();

/**
 * Compare two provisional versions. `from` should be the earlier version and
 * `to` the later one; the function does not assume ordering beyond labelling
 * the result. Finding identity is the stable `key`; measurement identity is
 * `id`. A finding whose key exists in both but whose text/laterality/negation
 * differs is a *change*, not an add+remove.
 */
export function compareAiVersions(from: ComparableVersion, to: ComparableVersion): AiComparisonResult {
  const fromF = indexByKey(from.draft.findings);
  const toF = indexByKey(to.draft.findings);

  const added: ComparableFinding[] = [];
  const removed: ComparableFinding[] = [];
  const changed: FindingChange[] = [];
  const unchanged: string[] = [];

  for (const [key, f] of toF) {
    const prev = fromF.get(key);
    if (!prev) {
      added.push(f);
      continue;
    }
    const textChanged = norm(prev.text) !== norm(f.text);
    const lateralityChanged = norm(prev.laterality) !== norm(f.laterality);
    const negationChanged = Boolean(prev.negated) !== Boolean(f.negated);
    if (textChanged || lateralityChanged || negationChanged) {
      changed.push({
        key,
        before: { text: prev.text, laterality: prev.laterality, negated: prev.negated },
        after: { text: f.text, laterality: f.laterality, negated: f.negated },
        textChanged,
        lateralityChanged,
        negationChanged,
      });
    } else {
      unchanged.push(key);
    }
  }
  for (const [key, f] of fromF) if (!toF.has(key)) removed.push(f);

  const fromM = indexById(from.draft.measurements);
  const toM = indexById(to.draft.measurements);
  const mAdded: ComparableMeasurement[] = [];
  const mRemoved: ComparableMeasurement[] = [];
  const mChanged: MeasurementChange[] = [];
  for (const [id, m] of toM) {
    const prev = fromM.get(id);
    if (!prev) mAdded.push(m);
    else if (prev.value !== m.value || norm(prev.unit) !== norm(m.unit)) {
      mChanged.push({ id, beforeValue: prev.value, afterValue: m.value, unit: m.unit, delta: m.value - prev.value });
    }
  }
  for (const [id, m] of fromM) if (!toM.has(id)) mRemoved.push(m);

  const beforeImp = from.draft.impression ?? [];
  const afterImp = to.draft.impression ?? [];
  const impressionChanged = beforeImp.join("\n").trim() !== afterImp.join("\n").trim();

  const modelChanged = norm(from.modelDigest) !== norm(to.modelDigest);
  const promptChanged = norm(from.promptVersion) !== norm(to.promptVersion);

  const identical =
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    mAdded.length === 0 &&
    mRemoved.length === 0 &&
    mChanged.length === 0 &&
    !impressionChanged;

  return {
    fromVersion: from.version,
    toVersion: to.version,
    findings: { added, removed, changed, unchanged },
    measurements: { added: mAdded, removed: mRemoved, changed: mChanged },
    impression: { changed: impressionChanged, before: beforeImp, after: afterImp },
    provenance: {
      modelChanged,
      promptChanged,
      fromModelDigest: from.modelDigest,
      toModelDigest: to.modelDigest,
      fromPromptVersion: from.promptVersion,
      toPromptVersion: to.promptVersion,
    },
    identical,
  };
}
