/**
 * Item 3 — wording accepted from an AI draft must not be retired by a Quick Select
 * click without asking.
 *
 * REPRODUCED on `ba207aa62` by running the two steps a radiologist actually does
 * (read the draft, press Accept, then press a tile) against the shipped tile
 * catalogue. What main does today, with the accepted sentence still on the page:
 *
 *   accepted "The ventricular system is dilated."
 *   + press "Normal ventricles"
 *     → verdict "applied", sentence GONE, replaced by
 *       "Ventricular system and cisternal spaces are normal in size and
 *        configuration."          (a polarity flip, unsignalled)
 *
 *   accepted "No acute infarction is seen."
 *   + press "Acute infarct (CT)"  → verdict "applied", his denial deleted.
 *
 *   accepted "There is generalized cerebral atrophy."
 *   + press "Cerebral atrophy"    → verdict "applied", wording he adopted swapped
 *                                   for the catalogue's, silently.
 *
 * The cause is one predicate. `isProtectedManualSentence` is the signal that asks
 * the overlay walk to withhold a sentence instead of replacing it, and it reads
 * only `manual` and `radiologist-voice`. `ai-draft` is absent — so every sentence
 * the walk reaches is judged by WHO WROTE it, and an adopted AI sentence has no
 * author in that test. It is not an oversight in the vocabulary either: this
 * repository already rules the other way, everywhere else. `applyAiComposerAccepted`
 * (store.ts:5866) says "Accepting the draft IS the radiologist adopting that
 * wording — they read it and pressed Accept", and when that reading failed to
 * protect a Conclusion the fix recorded a field-level flag rather than disputing
 * the sentence's authorship. `preserveAcceptedAi`, `observationLedger`'s
 * ai-draft credit and the Copilot contract all treat it as adopted; this one
 * predicate did not, and it is the one the overwrite dialog listens to.
 *
 * So the fix is one term in one signal, not a new mechanism: the ask-first HOLD
 * already exists, already writes nothing until he answers, and already names the
 * at-risk words in its REMOVE list (`confirm-overwrite-dialog.tsx:79` reads
 * `pendingPatch.manualKept`). Accepted AI prose now travels that same road.
 *
 * What stays exactly as it was, and is pinned below:
 *  - Replace still replaces. The hold asks once; `force` is the answer, and it is
 *    the same one click he already makes for manual text.
 *  - Text with NO recorded author is still overwritten silently. Protection is
 *    keyed on authorship, so widening it to `ai-draft` must not turn "untracked"
 *    into "protected" — that would stop the tile flow on most of the report.
 *  - Catalogue-owned sources (quick-select, quick-findings, structured-template,
 *    macro) keep yielding to the ledger. They are the ledger's own wording.
 *  - The two escapes that keep the common flow uninterrupted: a tile writing his
 *    sentence word-for-word does not ask, and a light descriptor tweak of the
 *    baseline the tile declares does not ask.
 *  - PR #662 §2's normal-impression sweep keeps treating `ai-draft` as a
 *    template-default line. That asymmetry is deliberate and documented
 *    (`quickFindingsMerge.ts:157`): a normal Conclusion the Composer offered is a
 *    starting point, and the sentence fence is a different question. A pinned
 *    test below keeps `ai-draft` OUT of that sweep's owned set.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({ id: "t", dismiss: () => {}, update: () => {} })),
  useToast: vi.fn(),
}));

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { normalizeForDedupe, splitToSentences, type InsertSource } from "@/lib/reportFieldMerge";
import { quickSelectTilePatch } from "@/lib/zai-workspace/quickSelectTileFixture";
import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";
import {
  applyPathologyPatch,
  isProtectedManualSentence,
  type ReportNarrative,
} from "./pathologyPatch";
import { stripNormalImpressionLinesProvenanceAware } from "./quickFindingsMerge";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8").replace(/\r\n/g, "\n");
const commentFree = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/(\s)\/\/[^/\n]*$/gm, "$1");

const tile = (label: string) => {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
};

const BASELINE = "The study is technically adequate.";

function openStudy(id: string) {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
    }),
    studies: [{ id, patient: { name: `Patient ${id}`, sex: "F" }, modality: "MR" }],
    activeStudyId: id,
    activeStudyInstanceUID: `1.2.840.${id}`,
    completedStudyIds: new Set<string>(),
  } as never);
}

let acceptSeq = 0;
/** Step 1 of the real journey: the draft is on screen, he presses Accept. */
function acceptIntoFindings(aiSentence: string) {
  openStudy(`accept-${(acceptSeq += 1)}`);
  useWorkspace.getState().setField("findings", BASELINE, { source: "manual" });
  expect(useWorkspace.getState().applyAiComposerAccepted({
    findings: `${BASELINE}\n${aiSentence}`,
    impression: "Conclusion.",
    recommendation: "",
  })).toBe("applied");
  // The premise of every test below, re-checked rather than assumed: the accepted
  // sentence is CARE's AI-authorship tag, and nothing else on the page moved.
  expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(aiSentence)])
    .toEqual(["ai-draft"]);
  return aiSentence;
}

/** Step 2: press a tile. Returns what the click did and what the page says now. */
function pressTile(label: string, over: { force?: boolean } = {}) {
  const verdict = useWorkspace.getState().applyPathologyOverlay({
    ...quickSelectTilePatch(tile(label), "findings"),
    ...over,
  });
  const s = useWorkspace.getState();
  return {
    verdict,
    findings: s.findingsText,
    pending: s.pendingPathologyPatch,
    ledgerRows: s.appliedPathologyPatches.length,
  };
}

const stated = (text: string) => splitToSentences(text).map(normalizeForDedupe);

const narrative = (findings: string, impression = "Conclusion."): ReportNarrative => ({
  clinicalHistory: "", technique: "", findings, impression, recommendation: "",
});
const prov = (sentence: string, source: InsertSource) => ({
  findings: { [normalizeForDedupe(sentence)]: [source] },
});

// ─────────────────────────────────────────────────────────────────────────────
// §1 The predicate itself: which recorded authors protect a sentence.
// ─────────────────────────────────────────────────────────────────────────────
describe("the authorship signal", () => {
  const SENTENCE = "The ventricular system is dilated.";
  const tags = (...sources: InsertSource[]) =>
    isProtectedManualSentence(SENTENCE, { [normalizeForDedupe(SENTENCE)]: sources });

  it("protects the three authors that are a person deciding to keep the words", () => {
    expect(tags("manual")).toBe(true);
    expect(tags("radiologist-voice")).toBe(true);
    expect(tags("ai-draft"), "an accepted AI sentence is a person's decision").toBe(true);
  });

  it("leaves a catalogue or template default replaceable", () => {
    for (const source of ["template", "protocol", "quick-normal", "companion", "system"] as const) {
      expect(tags(source), source).toBe(false);
    }
  });

  it("leaves the ledger's own wording replaceable", () => {
    // quick-select / quick-findings / structured-template / macro ARE the tile
    // text, tracked by the ledger; fencing them would stop same-slot upgrades.
    for (const source of ["quick-select", "quick-findings", "structured-template", "macro"] as const) {
      expect(tags(source), source).toBe(false);
    }
  });

  it("does not protect text with no recorded author", () => {
    expect(isProtectedManualSentence(SENTENCE, {})).toBe(false);
    expect(isProtectedManualSentence(SENTENCE, undefined)).toBe(false);
    expect(isProtectedManualSentence(SENTENCE, { [normalizeForDedupe(SENTENCE)]: [] })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 The journey, through the real store: Accept, then press.
// ─────────────────────────────────────────────────────────────────────────────
describe("accepted AI prose against a Quick Select tile", () => {
  it("asks before retiring an accepted statement of ventriculomegaly", () => {
    const kept = acceptIntoFindings("The ventricular system is dilated.");
    const before = useWorkspace.getState().appliedPathologyPatches.length;
    const out = pressTile("Normal ventricles");

    expect(out.verdict, "the click must ask, not decide").toBe("pending");
    expect(out.findings).toContain(kept);
    expect(out.findings).not.toContain("Ventricular system and cisternal spaces are normal");
    // The hold writes nothing at all — no ledger row either, so Cancel is a pure
    // dismissal rather than an undo.
    expect(out.ledgerRows).toBe(before);
    // And the dialog's REMOVE list names his words, not just the tile.
    expect(out.pending?.manualKept?.findings ?? []).toEqual([expect.stringContaining("ventricular")]);
  });

  it("asks before overwriting an accepted denial with an affirmative finding", () => {
    const kept = acceptIntoFindings("No acute infarction is seen.");
    const out = pressTile("Acute infarct (CT)");
    expect(out.verdict).toBe("pending");
    expect(out.findings).toContain(kept);
  });

  it("asks even when the tile means the same thing, because the words differ", () => {
    // Not friction for its own sake: his sentence and the catalogue's can carry
    // different certainty ("generalized" vs "with prominence of sulci"), and it is
    // his wording that was reviewed against this patient's images.
    const kept = acceptIntoFindings("There is generalized cerebral atrophy.");
    const out = pressTile("Cerebral atrophy");
    expect(out.verdict).toBe("pending");
    expect(out.findings).toContain(kept);
  });

  it("Replace still replaces — the protection asks, it never refuses", () => {
    const kept = acceptIntoFindings("The ventricular system is dilated.");
    expect(pressTile("Normal ventricles").verdict).toBe("pending");
    const out = pressTile("Normal ventricles", { force: true });
    expect(out.verdict).toBe("applied");
    expect(out.findings).not.toContain(kept);
    expect(stated(out.findings)).toEqual(
      expect.arrayContaining(stated(tile("Normal ventricles").sentence)),
    );
  });

  it("an identical click on a sentence with no recorded author stays silent", () => {
    // The negative control for §1's fourth case: if "no provenance" had become
    // "protected", the tile wall would stop on most of the clinic's reports.
    openStudy("untagged-control");
    const sentence = "The ventricular system is dilated.";
    useWorkspace.getState().setField("findings", `${BASELINE}\n${sentence}`, { source: "manual" });
    useWorkspace.setState({
      // Written by hand, then re-labelled as if no author were recorded — the
      // state an older draft hydrates into.
      fieldProvenance: {
        ...useWorkspace.getState().fieldProvenance,
        findings: {},
      },
    } as never);
    expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe(sentence)])
      .toBeUndefined();
    const out = pressTile("Normal ventricles");
    expect(out.verdict).toBe("applied");
    expect(out.findings).not.toContain(sentence);
  });

  it("a tile writing the accepted sentence word-for-word does not ask", () => {
    // The commonest way the field gets filled: the draft paraphrases the catalogue,
    // so the accepted text can BE the tile sentence. The "replacement" puts the
    // same words back, and an interruption there is the friction this file refuses
    // to add.
    const sentence = tile("Cerebral atrophy").sentence;
    acceptIntoFindings(sentence);
    const out = pressTile("Cerebral atrophy");
    expect(out.verdict, "same words in, same words out — nothing was lost").toBe("applied");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 The escapes that must survive the widening, at the patch layer.
// ─────────────────────────────────────────────────────────────────────────────
describe("escapes preserved for ai-draft text", () => {
  it("a light descriptor tweak of the tile's own declared baseline still syncs", () => {
    const baseline = "The ventricular system is dilated, consistent with hydrocephalus.";
    const edited = "The ventricular system is mildly dilated, consistent with hydrocephalus.";
    const result = applyPathologyPatch({
      existing: narrative(edited),
      incoming: { findings: baseline, impression: "Hydrocephalus." },
      ownership: {
        anatomicalSection: "ventricles",
        conflictGroup: "hydrocephalus",
        baselineReplaces: baseline,
      },
      provenance: prov(edited, "ai-draft"),
      source: "quick-select",
    });
    // "Syncs" is the tile's direction: the escape keeps the sentence REPLACEABLE,
    // so the catalogue's own wording lands and no dialog opens.
    expect(result.ambiguous).toBe(false);
    expect(result.manualKept.findings).toEqual([]);
    expect(result.narrative.findings).toContain(baseline);
    expect(result.narrative.findings).not.toContain("mildly");
  });

  it("the escape stays scoped to a tweak — a rewritten accepted sentence still asks", () => {
    // Same ownership, same declared baseline, one variable: how far the accepted
    // wording is from it. Without this leg the pair above cannot tell an escape
    // from a blanket "never ask".
    const baseline = "The ventricular system is dilated, consistent with hydrocephalus.";
    const rewritten = "There is dilatation of the ventricular system.";
    const result = applyPathologyPatch({
      existing: narrative(rewritten),
      incoming: { findings: baseline, impression: "Hydrocephalus." },
      ownership: {
        anatomicalSection: "ventricles",
        conflictGroup: "hydrocephalus",
        baselineReplaces: baseline,
      },
      provenance: prov(rewritten, "ai-draft"),
      source: "quick-select",
    });
    expect(result.ambiguous).toBe(true);
    expect(result.manualKept.findings).toEqual([expect.stringContaining("dilatation")]);
    expect(result.narrative.findings).toContain(rewritten);
  });

  it("untagged prose in the same slot is still replaced, with the same fixture", () => {
    const sentence = "The ventricular system is dilated.";
    const withTag = applyPathologyPatch({
      existing: narrative(sentence),
      incoming: { findings: "Hydrocephalus.", impression: "Hydrocephalus." },
      ownership: { anatomicalSection: "ventricles", conflictGroup: "hydrocephalus" },
      provenance: prov(sentence, "ai-draft"),
      source: "quick-select",
    });
    const withoutTag = applyPathologyPatch({
      existing: narrative(sentence),
      incoming: { findings: "Hydrocephalus.", impression: "Hydrocephalus." },
      ownership: { anatomicalSection: "ventricles", conflictGroup: "hydrocephalus" },
      provenance: prov(sentence, "template"),
      source: "quick-select",
    });
    // The whole of this PR is the middle column of that pair.
    expect(withTag.ambiguous).toBe(true);
    expect(withTag.replacedSentences).toEqual([]);
    expect(withTag.narrative.findings).toContain(sentence);
    expect(withoutTag.ambiguous).toBe(false);
    expect(withoutTag.narrative.findings).not.toContain(sentence);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 What the widening must NOT touch.
// ─────────────────────────────────────────────────────────────────────────────
describe("the PR #662 normal-impression sweep keeps ai-draft strippable", () => {
  it("an accepted normal Conclusion still yields to abnormal content", () => {
    const normal = "Normal MRI of the brain.";
    const stripped = stripNormalImpressionLinesProvenanceAware(
      [normal, "The ventricular system is dilated, consistent with hydrocephalus."],
      { provenance: { [normalizeForDedupe(normal)]: ["ai-draft"] } },
    );
    expect(stripped).not.toContain(normal);
    // The controls: the same line owned by a person, or with no author recorded,
    // survives. `ai-draft` is a template default to THIS sweep and protected prose
    // to the sentence fence — two questions, and this PR moves only one of them.
    const owned = stripNormalImpressionLinesProvenanceAware(
      [normal, "The ventricular system is dilated, consistent with hydrocephalus."],
      { provenance: { [normalizeForDedupe(normal)]: ["manual"] } },
    );
    expect(owned).toContain(normal);
    const untracked = stripNormalImpressionLinesProvenanceAware(
      [normal, "The ventricular system is dilated, consistent with hydrocephalus."],
      {},
    );
    expect(untracked).toContain(normal);
  });

  it("ai-draft stays OUT of that sweep's owned-source set", () => {
    // A separate vocabulary on purpose (`quickFindingsMerge.ts`), and the only
    // guard against the two being "tidied" into one.
    const merge = commentFree(read("quickFindingsMerge.ts"));
    const start = merge.indexOf("const OWNED_SOURCES");
    const end = merge.indexOf("];", start);
    expect(start).toBeGreaterThan(-1);
    const block = merge.slice(start, end);
    expect(block).not.toMatch(/"ai-draft"/);
    expect(block).toMatch(/"manual"/);
    expect(block).toMatch(/"radiologist-voice"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 One predicate, no fork.
// ─────────────────────────────────────────────────────────────────────────────
describe("the fix lives in the existing signal", () => {
  const patchSrc = commentFree(read("pathologyPatch.ts"));
  const start = patchSrc.indexOf("export function isProtectedManualSentence");
  const body = patchSrc.slice(start, patchSrc.indexOf("\nexport ", start + 10));

  it("is the only authorship predicate the overlay walk reads", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toMatch(/"ai-draft"/);
    expect(body).toMatch(/"manual"/);
    expect(body).toMatch(/"radiologist-voice"/);
    // The walk still calls this one function rather than re-deciding authorship.
    const calls = patchSrc.match(/isProtectedManualSentence\(/g) ?? [];
    expect(calls).toHaveLength(3); // 1 declaration + 2 call sites in the walk
  });

  it("gives no new authority to the withheld path — it is warn-and-ask only", () => {
    // `isProtectedManualSentence` must not be consulted anywhere new. Its readers
    // are the two `protectedManual` legs, and nothing else in the package.
    const readers = patchSrc
      .split("\n")
      .filter((l) => /isProtectedManualSentence\(/.test(l) && !/export function/.test(l));
    expect(readers).toHaveLength(2);
  });
});
