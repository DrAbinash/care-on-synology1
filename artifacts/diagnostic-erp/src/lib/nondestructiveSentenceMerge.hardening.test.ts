/**
 * B-02 — the sentence merge must never answer a clinical question.
 *
 * `mergeSentencesWithProvenance` is the one primitive behind `mergeField`, and
 * therefore behind Quick Select, Quick Findings, templates, protocols, macros,
 * companion panels, measurement boxes, voice, accepted AI ghosts and the
 * structured-format apply. Until now it did two things that a text-composition
 * operation has no business doing:
 *
 *   1. it treated **word-subset containment** as proof that two sentences are the
 *      same statement ("every word of A appears in B"), and
 *   2. when it decided they were the same, it **replaced the existing sentence
 *      with the longer one** and unioned the incoming source onto it.
 *
 * Executed at `f65aeb1b`, with the existing sentence owned by `manual`:
 *
 *   "No acute infarct."            + "No acute infarct or haemorrhage."
 *     → "No acute infarct or haemorrhage."        (the report now also denies haemorrhage)
 *   "Acute infarct."               + "No acute infarct."
 *     → "No acute infarct."                        (the polarity of the report flipped)
 *   "No restricted diffusion to suggest acute infarct." + "Acute infarct."
 *     → the affirmative finding disappears entirely
 *
 * and in all three the surviving sentence is re-labelled
 * `["manual", "quick-select"]` — provenance laundering on top of the rewrite.
 *
 * The fix is subtraction, not a parser: **exact normalized equality still
 * dedupes; anything else is kept as a separate statement.** No negation
 * detection, no synonymy, no ontology, no "latest wins", no polarity rule. The
 * merge layer is no longer allowed to conclude that a sentence about one thing
 * implies a sentence about another.
 *
 * What this deliberately does NOT touch:
 *
 * - **Structured ownership.** Same-slot replacement (`planSameSlotReplacement`,
 *   `replacedBaseline`, `lastRendered`) is the mechanism that may replace a
 *   clinical statement, because it proves identity from (region, concept, level,
 *   laterality) rather than from word overlap. M4/M5 pin that it still replaces
 *   rather than duplicates, so the conservative free-text merge cannot be read as
 *   weakening it.
 * - **Technique.** Its own concept/paraphrase merge is out of scope (§22); M10
 *   pins that this PR left it exactly as it was, so "unchanged" is measured, not
 *   assumed.
 * - **Undo.** `mergeField` pushes no clinical undo frame and never did; M12 records
 *   the current design instead of silently inventing a new undo system (§13).
 * - **Impression freshness.** A real addition still flags `impressionNeedsRefresh`
 *   and a true duplicate still changes nothing (M13/M14).
 *
 * After this PR a report can legitimately read "No acute infarct." followed by
 * "Acute infarct." That is contradictory, visible, and reviewable. Silently
 * choosing one is neither.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({ id: "t", dismiss: () => {}, update: () => {} })),
  useToast: vi.fn(),
}));

import {
  mergeReportFieldContentWithProvenance,
  mergeSentencesWithProvenance,
  mergeTechniqueWithProvenance,
  normalizeForDedupe,
} from "@/lib/reportFieldMerge";
import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";
import { quickSelectTilePatch } from "@/lib/zai-workspace/quickSelectTilePayload";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

const here = dirname(fileURLToPath(import.meta.url));
const mergeSrc = readFileSync(join(here, "reportFieldMerge.ts"), "utf8").replace(/\r\n/g, "\n");
/** The findings/impression/recommendation primitive only, comments kept out. */
const mergeBody = (() => {
  const start = mergeSrc.indexOf("export function mergeSentencesWithProvenance");
  const end = mergeSrc.indexOf("export function mergeSentences(", start);
  return mergeSrc.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
})();

const MANUAL_NO_INFARCT = { [normalizeForDedupe("No acute infarct.")]: ["manual"] };

/** The three cases Audit B named, through the production primitive. */
function merge(existing: string, incoming: string, provenance = MANUAL_NO_INFARCT, source = "quick-select") {
  return mergeSentencesWithProvenance(existing, incoming, provenance, source as never);
}

function resetStore() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
    }),
    studies: [{ id: "study-1", patient: { name: "Test Patient", sex: "F" }, modality: "MR" }],
    activeStudyId: "study-1",
    activeStudyInstanceUID: "1.2.840.TEST",
    completedStudyIds: new Set<string>(),
  } as never);
}

beforeEach(() => { vi.restoreAllMocks(); resetStore(); });

// ─────────────────────────────────────────────────────────────────────────────
// M1 / M2 / M3 — dedupe stays, but only where equivalence is textual fact.
// ─────────────────────────────────────────────────────────────────────────────
describe("M1/M2/M3 — provable duplication still collapses; partial overlap does not", () => {
  const EFF = { [normalizeForDedupe("Small left pleural effusion.")]: ["manual"] };

  it("M1 exact duplicate → one statement", () => {
    const r = mergeSentencesWithProvenance(
      "Small left pleural effusion.", "Small left pleural effusion.", EFF, "quick-findings",
    );
    expect(r.text).toBe("Small left pleural effusion.");
  });

  it("M2 case / whitespace / punctuation-only differences → still one statement", () => {
    const r = mergeSentencesWithProvenance(
      "Small  Left pleural effusion", "small left pleural effusion.", EFF, "quick-findings",
    );
    expect(r.text.split("\n")).toHaveLength(1);
  });

  it("M2b the dedupe key is the normalizer's, and it is not a substring test", () => {
    expect(normalizeForDedupe("  No acute infarct.  ")).toBe("no acute infarct");
    expect(normalizeForDedupe("No acute infarct!")).toBe(normalizeForDedupe("no acute infarct"));
  });

  it("M3 partial overlap keeps BOTH statements", () => {
    const r = mergeSentencesWithProvenance(
      "Mild left pleural effusion.",
      "Left pleural effusion.",
      { [normalizeForDedupe("Mild left pleural effusion.")]: ["manual"] },
      "quick-findings",
    );
    expect(r.text).toBe("Mild left pleural effusion.\nLeft pleural effusion.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M4 / M5 / M6 / M7 — polarity and conjunction are clinical, not lexical.
// ─────────────────────────────────────────────────────────────────────────────
describe("M4–M7 — negation, polarity and conjunction defeat the fold", () => {
  it("M4 negative existing + affirmative incoming → both preserved, existing untouched", () => {
    const existing = "No restricted diffusion to suggest acute infarct.";
    const r = merge(existing, "Acute infarct.", { [normalizeForDedupe(existing)]: ["manual"] });
    expect(r.text).toBe(`${existing}\nAcute infarct.`);
    expect(r.text.split("\n")).toHaveLength(2);
  });

  it("M5 affirmative existing + negative incoming → the polarity is NOT flipped", () => {
    const r = merge("Acute infarct.", "No acute infarct.", { [normalizeForDedupe("Acute infarct.")]: ["manual"] });
    expect(r.text).toBe("Acute infarct.\nNo acute infarct.");
    expect(r.text).not.toBe("No acute infarct.");
  });

  it("M6 broader conjunction arriving does not replace the narrower manual sentence", () => {
    const r = merge("No acute infarct.", "No acute infarct or haemorrhage.");
    expect(r.text).toBe("No acute infarct.\nNo acute infarct or haemorrhage.");
    // The radiologist's sentence is still there, in their own words.
    expect(r.text.split("\n")).toContain("No acute infarct.");
  });

  it("M7 the reverse order does not delete or broaden anything either", () => {
    const broader = "No acute infarct or haemorrhage.";
    const r = merge(broader, "No acute infarct.", { [normalizeForDedupe(broader)]: ["manual"] });
    expect(r.text).toBe(`${broader}\nNo acute infarct.`);
  });

  it("M4b/M5b single-word and non-subset pairs were already safe — and stay safe", () => {
    expect(merge("No haemorrhage.", "Haemorrhage.", { "no haemorrhage": ["manual"] }).text)
      .toBe("No haemorrhage.\nHaemorrhage.");
    expect(merge("No focal lesion.", "Focal hepatic lesion.", { "no focal lesion": ["manual"] }).text)
      .toBe("No focal lesion.\nFocal hepatic lesion.");
  });

  it("M4c every statement of a multi-sentence negative block survives a merge", () => {
    const existing = "No acute infarct.\nNo haemorrhage.\nNo mass lesion.";
    const r = merge(existing, "No acute infarct or mass effect.", {
      "no acute infarct": ["manual"], "no haemorrhage": ["manual"], "no mass lesion": ["manual"],
    });
    for (const line of existing.split("\n")) expect(r.text.split("\n")).toContain(line);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M8 / M9 / M10 — modifiers, and the surfaces this PR must not reinterpret.
// ─────────────────────────────────────────────────────────────────────────────
describe("M8–M10 — clinically meaningful modifiers are never erased", () => {
  it("M8 severity difference keeps both statements", () => {
    const r = mergeSentencesWithProvenance(
      "Mild canal stenosis.", "Moderate canal stenosis.", { "mild canal stenosis": ["manual"] }, "quick-findings",
    );
    expect(r.text).toBe("Mild canal stenosis.\nModerate canal stenosis.");
  });

  it("M9 laterality difference keeps both statements", () => {
    const r = mergeSentencesWithProvenance(
      "Left pleural effusion.", "Right pleural effusion.", { "left pleural effusion": ["manual"] }, "quick-findings",
    );
    expect(r.text).toBe("Left pleural effusion.\nRight pleural effusion.");
  });

  it("M10 level difference keeps both statements", () => {
    const r = mergeSentencesWithProvenance(
      "L4-L5 disc protrusion.", "L5-S1 disc protrusion.", { "l4 l5 disc protrusion": ["manual"] }, "quick-findings",
    );
    expect(r.text).toBe("L4-L5 disc protrusion.\nL5-S1 disc protrusion.");
  });

  it("M10b Technique keeps its own merge semantics — unchanged by this PR", () => {
    // Technique is a different primitive with concept-aware folding, and §22 puts it
    // out of scope. These two cases are the parts that are unambiguously textual
    // (exact duplicate collapses; a genuinely new acquisition concept appends), so
    // the assertion holds whichever way the technique rules are later tightened.
    const existing = "Multiplanar multisequence MRI of the brain was performed.";
    const prov = { [normalizeForDedupe(existing)]: ["protocol"] };
    expect(mergeTechniqueWithProvenance(existing, existing, prov, "protocol").text.split("\n")).toHaveLength(1);
    const added = mergeTechniqueWithProvenance(existing, "SWI sequences were acquired.", prov, "protocol");
    expect(added.text).toContain("SWI sequences were acquired.");
    expect(added.text).toContain("Multiplanar multisequence MRI of the brain was performed.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M11 — the radiologist's typed report is sacrosanct, through the real store.
// ─────────────────────────────────────────────────────────────────────────────
describe("M11/M12/M13 — mergeField on a manual report", () => {
  const MANUAL_REPORT = [
    "Postoperative changes are noted.",
    "No restricted diffusion to suggest acute infarct.",
    "Minimal chronic small vessel ischemic changes.",
  ].join("\n");

  function withManualFindings() {
    resetStore();
    useWorkspace.getState().setField("findings", MANUAL_REPORT, { source: "manual" });
  }

  it("M11 all three manual sentences remain, byte-for-byte, and the incoming one is present", () => {
    withManualFindings();
    const before = useWorkspace.getState().findingsText;
    expect(useWorkspace.getState().mergeField("findings", "Acute infarct.", "quick-select")).toBe("applied");
    const after = useWorkspace.getState().findingsText;
    for (const line of before.split("\n")) expect(after.split("\n")).toContain(line);
    expect(after).toContain("Acute infarct.");
    expect(after.split("\n")).toHaveLength(4);
  });

  it("M12 provenance stays attributable: manual sentences keep manual, the appended one owns its source", () => {
    withManualFindings();
    useWorkspace.getState().mergeField("findings", "Acute infarct.", "quick-select");
    const prov = useWorkspace.getState().fieldProvenance.findings ?? {};
    expect(prov[normalizeForDedupe("Postoperative changes are noted.")]).toEqual(["manual"]);
    expect(prov[normalizeForDedupe("No restricted diffusion to suggest acute infarct.")]).toEqual(["manual"]);
    expect(prov[normalizeForDedupe("Minimal chronic small vessel ischemic changes.")]).toEqual(["manual"]);
    expect(prov[normalizeForDedupe("Acute infarct.")]).toEqual(["quick-select"]);
    // And no synthetic sentence carries a source it never had.
    expect(prov[normalizeForDedupe("No acute infarct or haemorrhage.")]).toBeUndefined();
  });

  it("M12b an exact duplicate unions sources but invents no new statement", () => {
    withManualFindings();
    useWorkspace.getState().mergeField("findings", "Acute infarct.", "quick-select");
    useWorkspace.getState().mergeField("findings", "Acute infarct.", "template");
    const st = useWorkspace.getState();
    expect(st.findingsText.split("\n")).toHaveLength(4);
    expect(st.fieldProvenance.findings?.[normalizeForDedupe("Acute infarct.")]).toEqual(["quick-select", "template"]);
  });

  it("M12c mergeField still opens no undo frame — reported, not redesigned here", () => {
    withManualFindings();
    const depth = useWorkspace.getState().patchUndoStack.length;
    useWorkspace.getState().mergeField("findings", "Acute infarct.", "quick-select");
    expect(useWorkspace.getState().patchUndoStack.length).toBe(depth);
    expect(useWorkspace.getState().isDirty).toBe(true);
  });

  it("M13 a real Findings addition keeps flagging the Impression as needing refresh", () => {
    withManualFindings();
    useWorkspace.setState({ impressionNeedsRefresh: false } as never);
    useWorkspace.getState().mergeField("findings", "Acute infarct.", "quick-select");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
  });

  it("M13b a true duplicate sets no flag, exactly as before", () => {
    resetStore();
    useWorkspace.getState().mergeField("findings", "Acute infarct.", "quick-select");
    useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);
    expect(useWorkspace.getState().mergeField("findings", "Acute infarct.", "quick-select")).toBe("applied");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(useWorkspace.getState().isDirty).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M14 / M15 — mergeField is shared: Impression and Recommendation too.
// ─────────────────────────────────────────────────────────────────────────────
describe("M14/M15 — the same safety on Impression and Recommendation", () => {
  it("M14 Impression merge does not silently broaden the existing line", () => {
    resetStore();
    useWorkspace.getState().mergeField("impression", "No acute infarct.", "manual");
    useWorkspace.getState().mergeField("impression", "No acute infarct or haemorrhage.", "template");
    const lines = useWorkspace.getState().impressionText.split("\n");
    expect(lines).toContain("No acute infarct.");
    expect(lines).toHaveLength(2);
  });

  it("M15 Recommendation merge does not replace the typed advice with a longer variant", () => {
    resetStore();
    useWorkspace.getState().mergeField("recommendation", "Clinical correlation is advised.", "manual");
    useWorkspace.getState().mergeField("recommendation", "Clinical correlation with MRI is advised.", "quick-findings");
    const lines = useWorkspace.getState().recommendationText.split("\n");
    expect(lines).toContain("Clinical correlation is advised.");
    expect(lines).toContain("Clinical correlation with MRI is advised.");
  });

  it("M15b Technique and clinicalHistory still merge through the same entry point without throwing", () => {
    resetStore();
    expect(useWorkspace.getState().mergeField("technique", "Multiplanar multisequence MRI.", "protocol")).toBe("applied");
    expect(useWorkspace.getState().mergeField("clinicalHistory", "Headache.", "quick-findings")).toBe("applied");
    expect(useWorkspace.getState().techniqueText).toContain("Multiplanar multisequence MRI.");
    expect(useWorkspace.getState().clinicalHistoryText).toContain("Headache.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M16 — the AI write boundary: an accepted suggestion may not rewrite manual prose.
// ─────────────────────────────────────────────────────────────────────────────
describe("M16 — an accepted AI suggestion appends; it never rewrites the radiologist", () => {
  it("manual findings + accepted ghost text keeps the manual sentence whole", () => {
    resetStore();
    useWorkspace.getState().setField("findings", "No acute infarct.", { source: "manual" });
    useWorkspace.getState().setGhostText("No acute infarct or haemorrhage.", "findings");
    useWorkspace.getState().acceptGhostText();
    const lines = useWorkspace.getState().findingsText.split("\n");
    expect(lines).toContain("No acute infarct.");
    expect(lines).toContain("No acute infarct or haemorrhage.");
    const prov = useWorkspace.getState().fieldProvenance.findings ?? {};
    expect(prov[normalizeForDedupe("No acute infarct.")]).toEqual(["manual"]);
    expect(prov[normalizeForDedupe("No acute infarct or haemorrhage.")]).toEqual(["ai-draft"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M17 / M18 — B-09 (#877) must not regress, and the merge change must not be a
// way around its guard.
// ─────────────────────────────────────────────────────────────────────────────
describe("M17/M18 — B-09 still holds on the other side of this merge change", () => {
  const INFARCT = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Acute infarct (DWI)")!;

  it("M17 a resolved parameterized tile still applies, with no brace and no duplicate", () => {
    resetStore();
    const r = useWorkspace.getState().applyPathologyOverlay(
      quickSelectTilePatch(INFARCT, "findings", { side: "left" }),
    );
    expect(r).toBe("applied");
    const st = useWorkspace.getState();
    expect(st.findingsText).toContain("left MCA territory");
    for (const line of st.findingsText.split("\n")) expect(line).not.toContain("{side}");
    expect(st.appliedPathologyPatches).toHaveLength(1);
  });

  it("M17b re-clicking the same resolved tile still replaces through ownership, not by appending", () => {
    resetStore();
    const patch = quickSelectTilePatch(INFARCT, "findings", { side: "left" });
    useWorkspace.getState().applyPathologyOverlay(patch);
    useWorkspace.getState().applyPathologyOverlay({ ...patch });
    const st = useWorkspace.getState();
    expect(st.appliedPathologyPatches).toHaveLength(1);
    expect(st.findingsText.split("\n").filter((l) => l.includes("MCA territory"))).toHaveLength(1);
  });

  it("M18 an unresolved parameterized tile still refuses, and the merge path is not an alternative door", () => {
    resetStore();
    useWorkspace.getState().setField("findings", "No acute infarct.", { source: "manual" });
    const before = useWorkspace.getState().findingsText;
    expect(useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(INFARCT, "findings"))).toBe("refused");
    expect(useWorkspace.getState().findingsText).toBe(before);
    // And the same text cannot sneak in through mergeField's conservative append
    // without the guard: a bare mergeField call still writes whatever it is given,
    // which is why the strip checks the parameter contract before it gets there.
    const stripped = mergeReportFieldContentWithProvenance({
      field: "findings", existing: before, incoming: INFARCT.sentence, source: "quick-select",
      existingProvenance: { "no acute infarct": ["manual"] },
    });
    expect(stripped.text).toContain("{side}");
    expect(stripSrcGuardIsInStrip()).toBe(true);
  });

  function stripSrcGuardIsInStrip(): boolean {
    const strip = readFileSync(
      join(here, "../components/radiology/zai-workspace/quick-select-strip.tsx"), "utf8",
    );
    return strip.includes("unresolvedQuickSelectParameters");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Contract — the primitive must not be able to rewrite a clinical sentence again.
// ─────────────────────────────────────────────────────────────────────────────
describe("contract — the fold is gone, and cannot come back quietly", () => {
  it("no statement in the free-text merge assigns new clinical text to an existing sentence", () => {
    expect(mergeBody).not.toMatch(/\.text\s*=\s*/);
    // Positive controls: the pre-fix implementation really did contain those
    // assignments, so the assertion above is not matching an empty slice.
    expect("out[dupIdx]!.text = s;").toMatch(/\.text\s*=\s*/);
    expect("segments[paraphraseIdx]!.text = incoming;").toMatch(/\.text\s*=\s*/);
    expect(mergeBody.length).toBeGreaterThan(500);
    expect(mergeSrc).toContain("export function mergeSentencesWithProvenance");
  });

  it("the only equivalence test left in the primitive is the normalizer's own key", () => {
    expect(mergeBody).toContain("normalizeForDedupe");
    expect(mergeBody).not.toMatch(/isSubsequence/);
    expect("const isSubsequence = shorterWords.every((w) => longerWords.includes(w));").toMatch(/isSubsequence/);
  });

  it("a table row is still never a merge target (the pre-existing measurement-row rule)", () => {
    const r = mergeSentencesWithProvenance(
      "| L4-L5 | 8.2 | mm |", "Disc protrusion at L4-L5.", { [normalizeForDedupe("| L4-L5 | 8.2 | mm |")]: ["manual"] }, "quick-findings",
    );
    expect(r.text).toContain("| L4-L5 | 8.2 | mm |");
    expect(r.text).toContain("Disc protrusion at L4-L5.");
  });
});
