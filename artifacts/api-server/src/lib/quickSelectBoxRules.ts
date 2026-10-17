/**
 * quickSelectBoxRules — the pure rules behind Quick Select box authoring.
 *
 * No database, no Express, no React. The write API and the authoring editor both
 * call this, so a box the editor lets through is a box the server accepts and
 * vice versa: one rule list, two callers, no second opinion.
 *
 * WHY THE SERVER OWNS THE RULES AT ALL. The boxes used to live in the browser's
 * localStorage, where nothing could check them and nothing survived a cache
 * clear. Moving them to `radiology_quick_findings` makes them the clinic's data,
 * and clinic data that writes into a signed report has to be refused at the
 * write boundary rather than merely discouraged in a form.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DECIDE. Whether a box's clinical
 * concept is impression-worthy — that verdict lives in the ERP's concept canon
 * (`lib/conceptCanon/contentPacks.ts`, 3,300 lines of clinical content that no
 * server package imports). The editor therefore enforces that one rule with the
 * registry in hand and this module enforces everything decidable from the row
 * itself. `conceptMissingOnConcludingBox` below is the half of it a server CAN
 * see: an abnormal box that concludes but names no concept at all can never
 * retire the normal it contradicts, which is the DEF-3 shape.
 */

// ── Vocabularies ─────────────────────────────────────────────────────────────

/** The five sections of the strip, spelled as the ERP's `QuickSelectField`. */
export const QUICK_SELECT_BOX_FIELDS = [
  "clinicalHistory",
  "technique",
  "findings",
  "impression",
  "recommendation",
] as const;
export type QuickSelectBoxField = (typeof QUICK_SELECT_BOX_FIELDS)[number];

/**
 * What a son does when its father is clicked.
 *   ""        the row is a father or a standalone box
 *   "grade"   one-of-a-set; the son REPLACES the father's wording in the
 *             sections the son itself fills
 *   "include" pre-ticked; the son ADDS its own wording alongside the father's
 *   "list"    navigation only — writes nothing, so it may have no text
 */
export const QUICK_SELECT_SON_KINDS = ["", "grade", "include", "list"] as const;
export type QuickSelectSonKind = (typeof QUICK_SELECT_SON_KINDS)[number];

/**
 * Who may author boxes. `requireAdminRole` is admin + super_admin only; the
 * owner asked for the reporting doctor to author their own boxes too, so the
 * gate on the box routes is this set and nothing else. Tabs, measurements,
 * protocols and clinical-history chips stay on `requireAdminRole` — they are not
 * boxes.
 */
export const QUICK_SELECT_AUTHOR_ROLES: ReadonlySet<string> = new Set(["admin", "super_admin", "doctor"]);

/** The four prose columns a box may write, in report order. */
export const BOX_TEXT_FIELDS = [
  "findingText",
  "impressionText",
  "techniqueText",
  "recommendationText",
] as const;
export type BoxTextField = (typeof BOX_TEXT_FIELDS)[number];

/** Every authored column the audit trail records a before/after for. */
export const BOX_AUDITED_FIELDS = [
  ...BOX_TEXT_FIELDS,
  "label",
  "studyType",
  "field",
  "sonKind",
  "parentId",
  "category",
  "concept",
  "mnemonic",
  "scopeModality",
  "anatomicalSection",
  "conflictGroup",
  "baselineReplaces",
  "icdCode",
  "tags",
  "suggests",
  "properties",
  "questionsJson",
  "sortOrder",
  "isActive",
] as const;
export type BoxAuditedField = (typeof BOX_AUDITED_FIELDS)[number];

export function normalizeBoxField(raw: unknown): QuickSelectBoxField | "" {
  const v = String(raw ?? "").trim();
  return (QUICK_SELECT_BOX_FIELDS as readonly string[]).includes(v) ? (v as QuickSelectBoxField) : "";
}

export function normalizeSonKind(raw: unknown): QuickSelectSonKind | null {
  const v = String(raw ?? "").trim();
  return (QUICK_SELECT_SON_KINDS as readonly string[]).includes(v) ? (v as QuickSelectSonKind) : null;
}

// ── Provenance badge ─────────────────────────────────────────────────────────

export type BoxProvenance = "built-in" | "your-version" | "your-box";

/**
 * The badge, derived from the three provenance columns and nothing else.
 *
 * `factory_definition` empty means there is no shipped wording to restore, so
 * the box is the clinic's own — and "Built-in" on it would advertise a Restore
 * defaults button that could not do anything. A snapshot with no customization
 * is untouched shipped content. A snapshot that has been customized is the
 * clinic's version of a built-in box, and it is the state a deploy must never
 * overwrite.
 */
export function boxProvenance(row: {
  factoryDefinition?: string | null;
  customizedAt?: Date | string | null;
}): BoxProvenance {
  const hasSnapshot = String(row.factoryDefinition ?? "").trim().length > 0;
  if (!hasSnapshot) return "your-box";
  return row.customizedAt ? "your-version" : "built-in";
}

export const BOX_PROVENANCE_LABEL: Record<BoxProvenance, string> = {
  "built-in": "Built-in",
  "your-version": "Your version",
  "your-box": "Your box",
};

// ── Template placeholders ────────────────────────────────────────────────────

/**
 * `{key}` tokens in a box's prose that no question defines.
 *
 * `fillStructuredTemplate` substitutes an undefined key with the empty string,
 * so an unmatched token is not an error the doctor ever sees — it is a silent
 * hole in the sentence that reaches the report. "Mass effect with midline shift
 * of {value} mm." signs out as "…shift of  mm." Blocking it here is the only
 * place it can still be caught.
 *
 * The five property tokens side/severity/chronicity/level/value are excluded:
 * `abnormalityEngine.fillTemplate` substitutes those from the property chips,
 * not from `questionsJson`, so a tile may legitimately carry one with no
 * question behind it.
 */
export const PROPERTY_TOKENS: ReadonlySet<string> = new Set(["side", "severity", "chronicity", "level", "value"]);

export function questionKeys(questionsJson: string | null | undefined): Set<string> {
  let arr: unknown;
  try {
    arr = JSON.parse(questionsJson || "[]");
  } catch {
    return new Set();
  }
  if (!Array.isArray(arr)) return new Set();
  return new Set(
    arr
      .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
      .map((q) => String(q.key ?? "").trim())
      .filter(Boolean),
  );
}

export function unmatchedTemplateKeys(
  texts: Record<string, string | null | undefined>,
  questionsJson: string | null | undefined,
): string[] {
  const keys = questionKeys(questionsJson);
  const found = new Set<string>();
  for (const text of Object.values(texts)) {
    for (const m of String(text ?? "").matchAll(/\{(\w+)\}/g)) {
      const k = m[1];
      if (PROPERTY_TOKENS.has(k) || keys.has(k)) continue;
      found.add(k);
    }
  }
  return [...found].sort();
}

export function definedButUnusedQuestions(
  texts: Record<string, string | null | undefined>,
  questionsJson: string | null | undefined,
): string[] {
  const keys = questionKeys(questionsJson);
  if (keys.size === 0) return [];
  const used = new Set<string>();
  for (const text of Object.values(texts)) {
    for (const m of String(text ?? "").matchAll(/\{(\w+)\}/g)) used.add(m[1]);
  }
  return [...keys].filter((k) => !used.has(k)).sort();
}

/**
 * `[` / `]` that do not form a matched pair.
 *
 * The optional-clause regex is `\[([^[\]]*)\]`; an unbalanced bracket simply
 * fails to match and the literal bracket is printed into the report. Counted per
 * text rather than per box so the message can name the section.
 */
export function unbalancedClauses(texts: Record<string, string | null | undefined>): string[] {
  const out: string[] = [];
  for (const [name, text] of Object.entries(texts)) {
    const s = String(text ?? "");
    const open = (s.match(/\[/g) ?? []).length;
    const close = (s.match(/\]/g) ?? []).length;
    if (open !== close) out.push(name);
  }
  return out;
}

// ── Draft validation ─────────────────────────────────────────────────────────

export interface BoxDraft {
  id?: number | null;
  label?: unknown;
  studyType?: unknown;
  studyTabId?: number | null;
  field?: unknown;
  sonKind?: unknown;
  /** A JSON body may send `null`, `""` or a number for "no parent". */
  parentId?: number | string | null;
  category?: unknown;
  concept?: unknown;
  mnemonic?: unknown;
  scopeModality?: unknown;
  conflictGroup?: unknown;
  anatomicalSection?: unknown;
  questionsJson?: unknown;
  findingText?: unknown;
  impressionText?: unknown;
  techniqueText?: unknown;
  recommendationText?: unknown;
}

/** The rows the rules need but cannot read themselves. */
export interface BoxFacts {
  /** The row `parentId` names, or null when no row has that id. */
  parent?: { id: number; label: string; parentId: number | null; studyType: string } | null;
  /** Rows already parented to the box being saved. */
  sons?: { id: number; label: string }[];
  /** Another box in the same study already carrying this label. */
  labelClash?: { id: number; label: string } | null;
}

export interface BoxIssue {
  code: string;
  /** One sentence, in plain English, naming the remedy. */
  message: string;
}

export interface BoxValidation {
  blocking: BoxIssue[];
  warnings: BoxIssue[];
}

const text = (v: unknown): string => (typeof v === "string" ? v : String(v ?? "")).trim();

/**
 * Everything a box must satisfy before it may be written.
 *
 * Split in two on purpose. `blocking` is what the server refuses with a 422 and
 * the editor refuses to save — a box that would print a hole, a button that
 * writes nothing, or an ownership shape the strip cannot render. `warnings` is
 * what the editor shows and lets the doctor accept with one checkbox: clinical
 * judgements this module can see the shape of but must not decide.
 */
export function validateBoxDraft(draft: BoxDraft, facts: BoxFacts = {}): BoxValidation {
  const blocking: BoxIssue[] = [];
  const warnings: BoxIssue[] = [];

  const label = text(draft.label);
  const field = normalizeBoxField(draft.field ?? "findings");
  const sonKindRaw = draft.sonKind === undefined ? "" : text(draft.sonKind);
  const sonKind = normalizeSonKind(sonKindRaw);
  const parentId = draft.parentId == null || draft.parentId === "" ? null : Number(draft.parentId);
  const id = draft.id == null ? null : Number(draft.id);
  const texts: Record<string, string> = {
    findingText: text(draft.findingText),
    impressionText: text(draft.impressionText),
    techniqueText: text(draft.techniqueText),
    recommendationText: text(draft.recommendationText),
  };
  const questionsJson = typeof draft.questionsJson === "string" ? draft.questionsJson : "[]";
  const category = text(draft.category).toLowerCase();
  const concept = text(draft.concept);

  if (!label) {
    blocking.push({ code: "label-empty", message: "The box needs a name — it is what the button prints." });
  }

  if (!field) {
    blocking.push({
      code: "field-unknown",
      message: `Section must be one of ${QUICK_SELECT_BOX_FIELDS.join(", ")}.`,
    });
  }

  if (sonKind === null) {
    blocking.push({
      code: "son-kind-unknown",
      message: `Sub-box behaviour must be one of ${QUICK_SELECT_SON_KINDS.filter(Boolean).join(", ")} (or none for a top-level box).`,
    });
  }

  // A 'list' son is navigation and legitimately writes nothing. Every other box
  // is a button, and a button that writes no sentence is a dead control.
  if (sonKind !== "list" && !Object.values(texts).some(Boolean)) {
    blocking.push({
      code: "writes-nothing",
      message: "This box writes no sentence into any section, so clicking it would do nothing. Give it Findings, Impression, Technique or Recommendation wording.",
    });
  }

  // ── Ownership: exactly two levels, never self-parented, never cross-region ──
  if (parentId != null) {
    // `parentId: "abc"` would otherwise skip every check below and then fail at
    // the database, where the caller is told the label clashes. Refuse it here.
    if (!Number.isInteger(parentId) || parentId <= 0) {
      blocking.push({
        code: "parent-missing",
        message: "The parent box is not a valid box. Choose one from the list, or leave this box at the top level.",
      });
    } else if (id != null && parentId === id) {
      blocking.push({ code: "self-parent", message: "A box cannot be a sub-box of itself." });
    } else if (!facts.parent) {
      blocking.push({ code: "parent-missing", message: "The parent box no longer exists. Choose another, or leave this box at the top level." });
    } else {
      if (facts.parent.parentId != null) {
        blocking.push({
          code: "three-levels",
          message: `"${facts.parent.label}" is itself a sub-box. Boxes go two levels deep — attach this one to "${facts.parent.label}"'s parent instead.`,
        });
      }
      const parentStudy = text(facts.parent.studyType).toLowerCase();
      const thisStudy = text(draft.studyType).toLowerCase();
      if (parentStudy && thisStudy && parentStudy !== thisStudy) {
        blocking.push({
          code: "parent-region-mismatch",
          message: `A sub-box must belong to the same region as its parent ("${facts.parent.label}" is ${facts.parent.studyType}). The strip groups one region's tree under one tab.`,
        });
      }
      const sons = facts.sons ?? [];
      if (sons.length > 0) {
        blocking.push({
          code: "son-of-a-son",
          message: `This box already has ${sons.length} sub-box${sons.length === 1 ? "" : "es"} (${sons.slice(0, 3).map((s) => s.label).join(", ")}${sons.length > 3 ? ", …" : ""}). Move them to the top level before making this one a sub-box.`,
        });
      }
    }
  }

  if (facts.labelClash) {
    blocking.push({
      code: "label-clash",
      message: `"${facts.labelClash.label}" already exists in this region. Rename one of them — two buttons with the same name cannot be told apart in the audit trail.`,
    });
  }

  // ── Templates ──────────────────────────────────────────────────────────────
  const unmatched = unmatchedTemplateKeys(texts, questionsJson);
  if (unmatched.length > 0) {
    blocking.push({
      code: "placeholder-unknown",
      message: `{${unmatched.join("}, {")}} appears in the wording but no question defines ${unmatched.length === 1 ? "it" : "them"}. It would print as a silent gap in the report. Add the question or remove the brace.`,
    });
  }
  const unbalanced = unbalancedClauses(texts);
  if (unbalanced.length > 0) {
    blocking.push({
      code: "unbalanced-clause",
      message: `${unbalanced.join(", ")} has an unmatched [ or ]. Optional clauses drop out whole only when the brackets pair up; otherwise the bracket itself is printed into the report.`,
    });
  }

  // ── Warnings: clinical shapes this module can see but must not decide ──────
  const isAbnormal = category === "abnormal" || category === "critical";
  if (isAbnormal && texts.impressionText && !concept) {
    warnings.push({
      code: "concept-missing-on-concluding-box",
      message: "This box writes a Conclusion but names no clinical concept. Without one nothing in the report engine can retire the normal it contradicts, so the report can read as both normal and abnormal. Pick the concept this finding is about.",
    });
  }
  if (sonKind === "grade" && !text(draft.conflictGroup)) {
    warnings.push({
      code: "grade-without-conflict-group",
      message: "A graded sub-box usually needs a conflict group, so choosing one grade retires the last. Without it two grades can sit in the same report.",
    });
  }
  const unused = definedButUnusedQuestions(texts, questionsJson);
  if (unused.length > 0) {
    warnings.push({
      code: "question-unused",
      message: `The question${unused.length === 1 ? "" : "s"} ${unused.map((k) => `{${k}}`).join(", ")} ${unused.length === 1 ? "is" : "are"} asked but never used in any wording — the answer is collected and thrown away.`,
    });
  }
  if (isAbnormal && texts.findingText && !text(draft.anatomicalSection)) {
    warnings.push({
      code: "no-anatomical-section",
      message: "No anatomical section, so in a structured report this box appends to free text instead of replacing its section's normal.",
    });
  }

  return { blocking, warnings };
}

// ── Factory refresh ──────────────────────────────────────────────────────────

export interface FactoryBoxDefinition {
  factoryKey: string;
  label: string;
  studyType: string;
  field: string;
  sonKind?: string;
  factoryKeyOfParent?: string;
  mnemonic?: string;
  concept?: string;
  category?: string;
  scopeModality?: string;
  findingText?: string;
  impressionText?: string;
  techniqueText?: string;
  recommendationText?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  properties?: string;
  sortOrder?: number;
}

export interface ExistingBoxRow {
  id: number;
  label: string;
  studyType: string;
  factoryKey: string;
  factoryDefinition: string;
  customizedAt: Date | string | null;
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
}

export type FactoryRefreshDecision =
  /** No row carries this key — the box is new to this clinic. */
  | "insert"
  /** The row carries the key and nobody has edited it — take the new wording. */
  | "refresh"
  /** The clinic edited this box. Shipping new content must not undo that. */
  | "keep";

/**
 * The deploy contract, as one decidable function: a factory box is written over
 * only when nobody in the clinic has changed it.
 *
 * Matching is on `factory_key`, never on the label — a box the doctor renames
 * must not be resurrected under its old name by the next deploy, and a box he
 * writes from scratch must never be mistaken for a shipped one.
 */
export function factoryRefreshDecision(
  existing: Pick<ExistingBoxRow, "factoryKey" | "customizedAt"> | null | undefined,
  definition: Pick<FactoryBoxDefinition, "factoryKey">,
): FactoryRefreshDecision {
  if (!existing || !existing.factoryKey) return "insert";
  if (existing.factoryKey !== definition.factoryKey) return "insert";
  return existing.customizedAt ? "keep" : "refresh";
}

/**
 * Whether a factory row's prose still equals its snapshot — the test that decides
 * if an edit happened outside the API and so was never stamped.
 */
export function rowMatchesFactorySnapshot(row: ExistingBoxRow): boolean {
  if (!row.factoryDefinition) return true;
  let snapshot: Partial<Record<BoxTextField | "label", string>>;
  try {
    snapshot = JSON.parse(row.factoryDefinition);
  } catch {
    return false;
  }
  return BOX_TEXT_FIELDS.every((f) => String(snapshot[f] ?? "") === String(row[f] ?? ""));
}

/** The columns a factory refresh may write, so `keep` cannot leak into an update. */
export const FACTORY_REFRESH_COLUMNS = [
  "label",
  "field",
  "sonKind",
  "mnemonic",
  "concept",
  "category",
  "scopeModality",
  "findingText",
  "impressionText",
  "techniqueText",
  "recommendationText",
  "anatomicalSection",
  "conflictGroup",
  "baselineReplaces",
  "properties",
  "sortOrder",
  "isActive",
] as const;

// ── Audit trail ──────────────────────────────────────────────────────────────

export type BoxHistoryAction =
  | "create"
  | "edit"
  | "disable"
  | "enable"
  | "re-parent"
  | "restore-defaults"
  | "delete";

export interface BoxHistoryEntry {
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
}

const auditValue = (v: unknown): string | null => {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
};

/**
 * One entry per changed column, so the history view can show the wording before
 * and after rather than only "someone edited this".
 *
 * `isActive` is split out by the caller into disable/enable because "box went
 * dark" is the one change a clinic needs to find fast, and it reads better as an
 * action than as a column diff.
 */
export function boxHistoryDiff(
  before: Partial<Record<BoxAuditedField, unknown>> | null,
  after: Partial<Record<BoxAuditedField, unknown>>,
): BoxHistoryEntry[] {
  const out: BoxHistoryEntry[] = [];
  for (const f of BOX_AUDITED_FIELDS) {
    if (!(f in after)) continue;
    const next = auditValue(after[f]);
    const prev = before ? auditValue(before[f]) : null;
    if (before === null) {
      if (next !== null && next !== "") out.push({ fieldName: f, oldValue: null, newValue: next });
      continue;
    }
    if (prev !== next) out.push({ fieldName: f, oldValue: prev, newValue: next });
  }
  return out;
}
