/**
 * The rules a Quick Select box has to satisfy before the clinic's database will
 * take it, and the deploy contract that decides whether shipped content may
 * overwrite a row.
 *
 * These are the cases that were previously undecidable anywhere: the boxes lived
 * in localStorage, so a wording template with a hole in it, a button that wrote
 * no sentence, and a three-level ownership tree the strip cannot render were all
 * savable and only surfaced later as a gap in a signed report.
 */
import { describe, expect, it } from "vitest";
import {
  BOX_PROVENANCE_LABEL,
  boxHistoryDiff,
  boxProvenance,
  definedButUnusedQuestions,
  factoryRefreshDecision,
  normalizeBoxField,
  normalizeSonKind,
  questionKeys,
  QUICK_SELECT_AUTHOR_ROLES,
  rowMatchesFactorySnapshot,
  unmatchedTemplateKeys,
  validateBoxDraft,
  type BoxDraft,
  type ExistingBoxRow,
} from "./quickSelectBoxRules";

/** A box that passes every rule, so each case below changes exactly one thing. */
function validDraft(over: Partial<BoxDraft> = {}): BoxDraft {
  return {
    label: "Cerebral atrophy",
    studyType: "Brain",
    field: "findings",
    sonKind: "",
    parentId: null,
    category: "abnormal",
    concept: "cerebral_atrophy",
    findingText: "Generalized cerebral atrophy with prominence of sulci.",
    impressionText: "Generalized cerebral atrophy.",
    techniqueText: "",
    recommendationText: "",
    anatomicalSection: "Brain parenchyma",
    questionsJson: "[]",
    ...over,
  };
}

const codes = (r: { blocking: { code: string }[] }) => r.blocking.map((b) => b.code);
const warningCodes = (r: { warnings: { code: string }[] }) => r.warnings.map((w) => w.code);

describe("the provenance badge never advertises a restore that cannot happen", () => {
  it("reads built-in only when a factory snapshot exists and nothing was customized", () => {
    expect(boxProvenance({ factoryDefinition: '{"label":"x"}', customizedAt: null })).toBe("built-in");
  });

  it("reads your-version once the clinic has diverged from the snapshot", () => {
    expect(boxProvenance({ factoryDefinition: '{"label":"x"}', customizedAt: new Date() })).toBe("your-version");
  });

  it("reads your-box with no snapshot — a clinic box has no defaults to go back to", () => {
    expect(boxProvenance({ factoryDefinition: "", customizedAt: null })).toBe("your-box");
    // A customized_at with nothing to restore to would be a dead button; the
    // badge must not claim built-in provenance from that state alone.
    expect(boxProvenance({ factoryDefinition: "", customizedAt: new Date() })).toBe("your-box");
  });

  it("labels all three in plain English", () => {
    expect(BOX_PROVENANCE_LABEL).toEqual({
      "built-in": "Built-in",
      "your-version": "Your version",
      "your-box": "Your box",
    });
  });
});

describe("who may author", () => {
  it("is the owner's admin accounts plus the reporting doctor", () => {
    expect([...QUICK_SELECT_AUTHOR_ROLES].sort()).toEqual(["admin", "doctor", "super_admin"]);
  });

  it("does not widen to the roles that stay narrow by request", () => {
    for (const role of ["pharmacist", "cashier", "nurse", "radiologist", "receptionist"]) {
      expect(QUICK_SELECT_AUTHOR_ROLES.has(role), role).toBe(false);
    }
  });
});

describe("the vocabularies are closed", () => {
  it("accepts the five strip sections and nothing else", () => {
    for (const f of ["clinicalHistory", "technique", "findings", "impression", "recommendation"]) {
      expect(normalizeBoxField(f)).toBe(f);
    }
    expect(normalizeBoxField("conclusion")).toBe("");
    expect(normalizeBoxField("")).toBe("");
    expect(normalizeBoxField(undefined)).toBe("");
  });

  it("accepts the three son behaviours plus none", () => {
    for (const k of ["", "grade", "include", "list"]) expect(normalizeSonKind(k)).toBe(k);
    expect(normalizeSonKind("child")).toBeNull();
    // An omitted sonKind is a top-level box, not an invalid one — a create
    // request that never mentions sub-boxes must not be refused for it.
    expect(normalizeSonKind(undefined)).toBe("");
    expect(normalizeSonKind(null)).toBe("");
  });
});

describe("a box that cannot write is refused", () => {
  it("refuses a box with no wording in any section", () => {
    const r = validateBoxDraft(validDraft({
      findingText: "", impressionText: "", techniqueText: "", recommendationText: "",
    }));
    expect(codes(r)).toContain("writes-nothing");
  });

  it("accepts a box that writes only a Technique", () => {
    const r = validateBoxDraft(validDraft({
      field: "technique", findingText: "", impressionText: "", recommendationText: "",
      techniqueText: "MRI of the brain was performed without contrast.",
    }));
    expect(codes(r)).not.toContain("writes-nothing");
  });

  it("accepts whitespace-only wording as no wording", () => {
    const r = validateBoxDraft(validDraft({
      findingText: "   ", impressionText: "\n\t", techniqueText: "", recommendationText: "",
    }));
    expect(codes(r)).toContain("writes-nothing");
  });

  it("exempts a 'list' son, which is navigation and writes nothing by design", () => {
    const r = validateBoxDraft(validDraft({
      sonKind: "list", findingText: "", impressionText: "", techniqueText: "", recommendationText: "",
    }));
    expect(codes(r)).not.toContain("writes-nothing");
  });

  it("refuses an empty name", () => {
    expect(codes(validateBoxDraft(validDraft({ label: "  " })))).toContain("label-empty");
  });

  it("refuses an unknown section or son behaviour, naming the allowed values", () => {
    const f = validateBoxDraft(validDraft({ field: "conclusion" }));
    expect(codes(f)).toContain("field-unknown");
    expect(f.blocking.find((b) => b.code === "field-unknown")!.message).toContain("findings");
    expect(codes(validateBoxDraft(validDraft({ sonKind: "child" })))).toContain("son-kind-unknown");
  });

  it("a clean draft passes with no blocking issue at all", () => {
    expect(validateBoxDraft(validDraft()).blocking).toEqual([]);
  });
});

describe("ownership is exactly two levels", () => {
  const parent = { id: 7, label: "Senile changes", parentId: null, studyType: "Brain" };

  it("accepts a son of a top-level box in the same region", () => {
    const r = validateBoxDraft(validDraft({ parentId: 7 }), { parent, sons: [] });
    expect(r.blocking).toEqual([]);
  });

  it("refuses a box parented to itself", () => {
    const r = validateBoxDraft(validDraft({ id: 7, parentId: 7 }), { parent, sons: [] });
    expect(codes(r)).toContain("self-parent");
  });

  it("refuses a parent that no longer exists", () => {
    const r = validateBoxDraft(validDraft({ parentId: 99 }), { parent: null });
    expect(codes(r)).toContain("parent-missing");
  });

  it("refuses a third level, and names the grandparent to attach to instead", () => {
    const r = validateBoxDraft(validDraft({ parentId: 8 }), {
      parent: { id: 8, label: "Fazekas 2", parentId: 7, studyType: "Brain" },
      sons: [],
    });
    expect(codes(r)).toContain("three-levels");
    expect(r.blocking.find((b) => b.code === "three-levels")!.message).toContain("two levels deep");
  });

  it("refuses to demote a box that already has sons", () => {
    const r = validateBoxDraft(validDraft({ id: 3, parentId: 7 }), {
      parent,
      sons: [{ id: 11, label: "Fazekas 1" }, { id: 12, label: "Fazekas 2" }],
    });
    expect(codes(r)).toContain("son-of-a-son");
    expect(r.blocking.find((b) => b.code === "son-of-a-son")!.message).toContain("Fazekas 1");
  });

  it("refuses a son in a different region from its parent", () => {
    const r = validateBoxDraft(validDraft({ parentId: 7, studyType: "Knee" }), { parent, sons: [] });
    expect(codes(r)).toContain("parent-region-mismatch");
  });

  it("region matching ignores case, since study_type is denormalized display text", () => {
    const r = validateBoxDraft(validDraft({ parentId: 7, studyType: "brain" }), { parent, sons: [] });
    expect(codes(r)).not.toContain("parent-region-mismatch");
  });

  it("refuses a second box with the same label in the same region", () => {
    const r = validateBoxDraft(validDraft(), { labelClash: { id: 42, label: "Cerebral atrophy" } });
    expect(codes(r)).toContain("label-clash");
  });

  // A parent id that is not a box id must be refused here. Left alone it skips
  // every ownership check above (Number("abc") is NaN, which is not finite) and
  // then fails at the database, where the caller is told the LABEL clashes.
  it.each(["abc", 0, -1, NaN, 7.5])("refuses a parent id that is not a box: %s", (parentId) => {
    const r = validateBoxDraft(validDraft({ parentId: parentId as never }), { parent: null });
    expect(codes(r)).toContain("parent-missing");
  });

  it("accepts a numeric string, which is what a form field sends", () => {
    const r = validateBoxDraft(validDraft({ parentId: "7" }), { parent, sons: [] });
    expect(codes(r)).not.toContain("parent-missing");
  });

  it("treats an omitted, null or empty parent as a top-level box", () => {
    for (const parentId of [undefined, null, ""]) {
      const r = validateBoxDraft(validDraft({ parentId: parentId as never }), {});
      expect(codes(r)).toEqual([]);
    }
  });
});

describe("a template hole is refused before it can reach a report", () => {
  it("refuses a brace no question defines, and names it", () => {
    const r = validateBoxDraft(validDraft({
      findingText: "Mass effect with midline shift of {shift} mm.",
      impressionText: "",
    }));
    expect(codes(r)).toContain("placeholder-unknown");
    expect(r.blocking.find((b) => b.code === "placeholder-unknown")!.message).toContain("{shift}");
  });

  it("accepts the same brace once a question defines it", () => {
    const r = validateBoxDraft(validDraft({
      findingText: "Mass effect with midline shift of {shift} mm.",
      impressionText: "",
      questionsJson: '[{"key":"shift","label":"Shift","type":"text","options":[],"default":"","required":true,"sortOrder":1}]',
    }));
    expect(codes(r)).not.toContain("placeholder-unknown");
  });

  it("leaves the five property tokens alone — the chips fill those, not the questions", () => {
    const r = validateBoxDraft(validDraft({
      findingText: "{severity} disc bulge at {level} with {side} foraminal narrowing.",
      impressionText: "",
    }));
    expect(codes(r)).not.toContain("placeholder-unknown");
    expect(unmatchedTemplateKeys(
      { findingText: "{side} {severity} {chronicity} {level} {value}" }, "[]",
    )).toEqual([]);
  });

  it("finds a hole in any of the four sections, not only Findings", () => {
    expect(unmatchedTemplateKeys({ recommendationText: "Repeat {interval}." }, "[]")).toEqual(["interval"]);
    expect(unmatchedTemplateKeys({ impressionText: "{grade} atrophy." }, "[]")).toEqual(["grade"]);
  });

  it("refuses an unbalanced bracket, which would print the bracket itself", () => {
    const r = validateBoxDraft(validDraft({
      findingText: "Mild [atrophy with prominence of sulci.",
      impressionText: "",
    }));
    expect(codes(r)).toContain("unbalanced-clause");
  });

  it("accepts a matched optional clause", () => {
    const r = validateBoxDraft(validDraft({
      findingText: "Disc bulge [with {shift} mm shift].",
      impressionText: "",
      questionsJson: '[{"key":"shift"}]',
    }));
    expect(codes(r)).not.toContain("unbalanced-clause");
  });

  it("warns, without refusing, when a question is asked and its answer discarded", () => {
    const r = validateBoxDraft(validDraft({
      questionsJson: '[{"key":"shift"},{"key":"side2"}]',
      findingText: "Shift of {shift} mm.",
      impressionText: "",
    }));
    expect(warningCodes(r)).toContain("question-unused");
    expect(codes(r)).not.toContain("question-unused");
    expect(definedButUnusedQuestions({ findingText: "{shift}" }, '[{"key":"shift"},{"key":"grade"}]'))
      .toEqual(["grade"]);
  });

  it("tolerates malformed questions JSON rather than throwing on a save", () => {
    expect(questionKeys("not json").size).toBe(0);
    expect(questionKeys('{"key":"x"}').size).toBe(0);
    expect(questionKeys('[{"key":"x"},{"n key":1},{"key":""}]')).toEqual(new Set(["x"]));
  });
});

describe("the clinical shapes a server can see are warned, not refused", () => {
  it("warns when an abnormal box concludes with no concept behind it", () => {
    const r = validateBoxDraft(validDraft({ concept: "" }));
    expect(warningCodes(r)).toContain("concept-missing-on-concluding-box");
    expect(codes(r)).not.toContain("concept-missing-on-concluding-box");
  });

  it("warns for a critical box too", () => {
    expect(warningCodes(validateBoxDraft(validDraft({ category: "critical", concept: "" }))))
      .toContain("concept-missing-on-concluding-box");
  });

  it("does not warn when the box writes no Conclusion, or names a concept", () => {
    expect(warningCodes(validateBoxDraft(validDraft({ concept: "", impressionText: "" }))))
      .not.toContain("concept-missing-on-concluding-box");
    expect(warningCodes(validateBoxDraft(validDraft()))).not.toContain("concept-missing-on-concluding-box");
  });

  it("does not warn about worthiness for a normal or variant box", () => {
    for (const category of ["normal", "variant", ""]) {
      expect(warningCodes(validateBoxDraft(validDraft({ category, concept: "" }))), category)
        .not.toContain("concept-missing-on-concluding-box");
    }
  });

  it("warns when a graded son has no conflict group to retire the last grade", () => {
    const r = validateBoxDraft(validDraft({ sonKind: "grade", conflictGroup: "" }), {
      parent: { id: 7, label: "Senile changes", parentId: null, studyType: "Brain" },
      sons: [],
    });
    expect(warningCodes(r)).toContain("grade-without-conflict-group");
    expect(warningCodes(validateBoxDraft(validDraft({
      sonKind: "grade", conflictGroup: "fazekas",
    }), { parent: { id: 7, label: "Senile changes", parentId: null, studyType: "Brain" }, sons: [] })))
      .not.toContain("grade-without-conflict-group");
  });

  it("warns when an abnormal box has no anatomical section to replace", () => {
    expect(warningCodes(validateBoxDraft(validDraft({ anatomicalSection: "" }))))
      .toContain("no-anatomical-section");
  });
});

describe("the deploy contract: shipped content never overwrites an edit", () => {
  const definition = { factoryKey: "tile:cerebral-atrophy" };

  it("inserts a key the clinic has no row for", () => {
    expect(factoryRefreshDecision(null, definition)).toBe("insert");
    expect(factoryRefreshDecision(undefined, definition)).toBe("insert");
    expect(factoryRefreshDecision({ factoryKey: "", customizedAt: null }, definition)).toBe("insert");
  });

  it("refreshes an untouched factory row", () => {
    expect(factoryRefreshDecision({ factoryKey: "tile:cerebral-atrophy", customizedAt: null }, definition))
      .toBe("refresh");
  });

  it("keeps a factory row the clinic has customized", () => {
    expect(factoryRefreshDecision(
      { factoryKey: "tile:cerebral-atrophy", customizedAt: new Date("2026-10-16T00:00:00Z") },
      definition,
    )).toBe("keep");
  });

  it("keeps a row whose key differs, so a rename cannot resurrect the old box", () => {
    expect(factoryRefreshDecision({ factoryKey: "tile:something-else", customizedAt: null }, definition))
      .toBe("insert");
  });

  const snapshot = JSON.stringify({
    label: "Cerebral atrophy",
    findingText: "Generalized cerebral atrophy with prominence of sulci.",
    impressionText: "",
    techniqueText: "",
    recommendationText: "",
  });

  function row(over: Partial<ExistingBoxRow> = {}): ExistingBoxRow {
    return {
      id: 1,
      label: "Cerebral atrophy",
      studyType: "Brain",
      factoryKey: "tile:cerebral-atrophy",
      factoryDefinition: snapshot,
      customizedAt: null,
      findingText: "Generalized cerebral atrophy with prominence of sulci.",
      impressionText: "",
      techniqueText: "",
      recommendationText: "",
      ...over,
    };
  }

  it("recognises a row that still matches its snapshot", () => {
    expect(rowMatchesFactorySnapshot(row())).toBe(true);
  });

  it("recognises a row edited outside the API, which was therefore never stamped", () => {
    expect(rowMatchesFactorySnapshot(row({
      findingText: "Generalized cerebral atrophy with prominent sulci and ventricles.",
    }))).toBe(false);
  });

  it("treats a corrupt snapshot as not matching rather than as free to overwrite", () => {
    expect(rowMatchesFactorySnapshot(row({ factoryDefinition: "{not json" }))).toBe(false);
  });

  it("treats a row with no snapshot as nothing to compare", () => {
    expect(rowMatchesFactorySnapshot(row({ factoryDefinition: "" }))).toBe(true);
  });
});

describe("the audit trail records the wording, not only the fact of a change", () => {
  it("on create, records every field that has a value", () => {
    const entries = boxHistoryDiff(null, { label: "Cerebral atrophy", findingText: "Atrophy.", isActive: true });
    expect(entries).toContainEqual({ fieldName: "label", oldValue: null, newValue: "Cerebral atrophy" });
    expect(entries).toContainEqual({ fieldName: "findingText", oldValue: null, newValue: "Atrophy." });
    expect(entries).toContainEqual({ fieldName: "isActive", oldValue: null, newValue: "yes" });
  });

  it("on create, records nothing for fields left empty", () => {
    expect(boxHistoryDiff(null, { label: "x", impressionText: "" })).toEqual([
      { fieldName: "label", oldValue: null, newValue: "x" },
    ]);
  });

  it("on edit, records only what changed, with the wording before and after", () => {
    const entries = boxHistoryDiff(
      { label: "Cerebral atrophy", impressionText: "", findingText: "Atrophy." },
      { label: "Cerebral atrophy", impressionText: "Generalized cerebral atrophy.", findingText: "Atrophy." },
    );
    expect(entries).toEqual([
      { fieldName: "impressionText", oldValue: "", newValue: "Generalized cerebral atrophy." },
    ]);
  });

  it("records a re-parenting as a change with both ids", () => {
    expect(boxHistoryDiff({ parentId: null }, { parentId: 7 })).toEqual([
      { fieldName: "parentId", oldValue: null, newValue: "7" },
    ]);
  });

  it("records a disabling as a readable value, not a boolean literal", () => {
    expect(boxHistoryDiff({ isActive: true }, { isActive: false })).toEqual([
      { fieldName: "isActive", oldValue: "yes", newValue: "no" },
    ]);
  });

  it("ignores fields the request did not carry", () => {
    expect(boxHistoryDiff({ label: "a", findingText: "b" }, { label: "a" })).toEqual([]);
  });
});
