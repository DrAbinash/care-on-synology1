/**
 * B-03 + narrow B-04 — AI can suggest; the radiologist decides whether it enters
 * the report; and once accepted, WHAT was accepted, WHERE it went, WHO authored it
 * and whether the rest of the report is now stale must all stay truthful.
 *
 * Reproduced at `a6656632` (#876/#877/#878/#879 all merged) by calling the real
 * production boundary with real production items:
 *
 *   1. **The destination was not honoured.** `store.insertCopilotText` ended with
 *      `mergeField("findings", item.insertText, "companion")` and never looked at
 *      `insertTarget`. The store's own `CopilotItem` did not even carry the field
 *      (`runCopilotAnalysis` items have keys
 *      `id,kind,title,detail,confidence,band,source`), while both item producers
 *      that DO declare a target — `copilotOrchestrator.analyzeCopilot`
 *      (`insertTarget: "recommendation"`, the rec-mra rule) and the AI reasoner
 *      parser `parseCopilotAiResponse` (`insertTarget: "impression"` for an
 *      `IMPRESSION:` line) — were silently routed to Findings:
 *
 *        manual Findings "No acute infarct."
 *        + accept the AI item intended for Impression
 *          → Findings became "No acute infarct.\nAcute infarct in the left MCA
 *            territory."   and Impression stayed empty.
 *
 *      The report now asserts both a thing and its negation, in the one field a
 *      referrer reads, and the Impression the radiologist still has to write does
 *      not contain the finding. The Copilot panel even renders the button as
 *      "Insert → impression" (the `Insert{item.insertTarget ? …}` label in
 *      `CareCopilotPanel.tsx`), so the promise the UI
 *      makes and the action the store performs disagree.
 *
 *   2. **The authorship was mislabelled.** Everything accepted through this
 *      boundary was stamped `companion` — the companion panel's source label.
 *      AI-authored prose therefore entered the record as if a measurement panel
 *      had written it, which is the one direction of mislabelling that matters:
 *      `fullReportFormat.ts` (`classifyFormatSection`: `ai-draft` → "ai", while
 *      `companion` falls through the `GENERATED_SOURCES` arm) reports a field as
 *      AI-derived only for `ai-draft`,
 *      `ObservationLedgerPanel.tsx` (`deriveObservationBadges`) shows "AI" only
 *      for `ai-draft` and "MEASUREMENT" for `companion`, and
 *      `undoLastAbnormal.ts` (`isAbnormalPathologyPatch`) excludes
 *      `ai-draft` from the
 *      abnormal-pattern undo set but includes `companion`. CARE already has the
 *      right label — `acceptGhostText` and `applyAiComposerAccepted` both use
 *      `ai-draft` — so this fix honours a declared provenance and defaults AI
 *      items to it, rather than inventing vocabulary.
 *
 *   3. **An accepted AI Impression certified itself as reconciled** (the narrow
 *      B-04 part, and the one defect that is live for a radiologist today).
 *      `mergeField` cleared `impressionNeedsRefresh` for every non-`manual`
 *      source, so Ctrl+I → Accept on an impression the model summarised from
 *      findings flipped the flag from `true` to `false` while the findings that
 *      made it stale were untouched, and the sign gate stopped demanding a
 *      refresh. Sources that legitimately clear it own BOTH sides of the
 *      reconciliation — a Quick Select tile writes the finding and its impression
 *      line in one action, a template/protocol is applied whole. An accepted
 *      proposal owns neither: it changes the Impression's words, which proves
 *      nothing about the Findings behind them. So `ai-draft` now behaves like
 *      `manual` on that line, and no new flag, no new state and no new
 *      reconciliation proof was invented.
 *
 * Deliberately NOT done: no AI provider/model/prompt work, no new provenance
 * vocabulary or migration, no second clinical-truth store, no ledger redesign, no
 * undo framework, no `recommendationNeedsRefresh`, no general Impression-freshness
 * rewrite (hydration, dictation, `refreshImpressionFromLedger`, frozen ordering,
 * system-normal, abnormal tiles with no impression payload — all untouched), and
 * nothing that auto-accepts or auto-generates an Impression.
 *
 * The fix is a declared contract at the one boundary, plus one condition on one
 * line of `mergeField`. Where no target is declared the documented existing
 * behaviour is preserved (the rail's deterministic nudges are findings sentences —
 * pinned by #840's stamp tests); where one is declared it is authoritative; an
 * unknown target, or an AI item with no target, fails closed with no write at all.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({ id: "t", dismiss: () => {}, update: () => {} })),
  useToast: vi.fn(),
}));

import { useWorkspace } from "@/lib/zai-workspace/store";
import { aiProposalBindingForImpression } from "@/lib/zai-workspace/aiProposalContext";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { runCopilotAnalysis, type CopilotItem } from "@/lib/zai-workspace/types";
import {
  resolveCopilotAcceptance,
  type CopilotAcceptanceItem,
} from "@/lib/zai-workspace/copilotAcceptanceContract";
import { analyzeCopilot } from "@/lib/copilotOrchestrator";
import { parseCopilotAiResponse } from "@/lib/copilotAiModule";
import { normalizeForDedupe, splitToSentences } from "@/lib/reportFieldMerge";
import { quickSelectTilePatch } from "@/lib/zai-workspace/quickSelectTileFixture";
import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8").replace(/\r\n/g, "\n");
/** Strip comments so a docstring can never satisfy a code assertion. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/(\s)\/\/[^/\n]*$/gm, "$1");

const storeSrc = code(read("zai-workspace/store.ts"));
const insertBody = (() => {
  const start = storeSrc.indexOf("insertCopilotText: (item) => {");
  const end = storeSrc.indexOf("recomputeCopilot: () => {", start);
  return storeSrc.slice(start, end > start ? end : start + 4000);
})();
const mergeBody = (() => {
  const start = storeSrc.indexOf("mergeField: (f, incoming, source) => {");
  const end = storeSrc.indexOf("setFieldIfEmpty:", start);
  return storeSrc.slice(start, end > start ? end : start + 3000);
})();

const FINDINGS = "Acute infarct in the left MCA territory. No haemorrhage.";
const IMPRESSION = "Acute left MCA infarct.";
const RECOMMENDATION = "Clinical correlation with stroke team.";

function openStudy(id = "study-A", opts: { findings?: string } = {}) {
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
  useWorkspace.getState().setField("findings", opts.findings ?? FINDINGS, { source: "manual" });
  useWorkspace.getState().setField("impression", IMPRESSION, { source: "manual" });
  useWorkspace.getState().setField("recommendation", RECOMMENDATION, { source: "manual" });
  // Those three writes are exactly what arms the staleness flag; every case below
  // decides it from a known starting point instead of by accident.
  useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);
}

/** A store-shaped item from a real production item, stamped the way the store
 *  stamps it. `kind`/`insertTarget`/`provenance` are the acceptance contract. */
function acceptanceItem(
  source: { id: string; title: string; detail: string; insertText?: string; insertTarget?: unknown },
  over: Partial<CopilotItem> = {},
): CopilotItem {
  const studyId = useWorkspace.getState().activeStudyId ?? "study-A";
  return {
    id: source.id,
    kind: "ai-draft",
    title: source.title,
    detail: source.detail,
    confidence: "medium",
    source: "AI reasoner",
    insertText: source.insertText,
    // The field the producer declared, carried through to the boundary verbatim.
    insertTarget: source.insertTarget as CopilotItem["insertTarget"],
    studyId,
    ...over,
  } as CopilotItem;
}

/** The real AI reasoner parser, and the real deterministic engine, each asked for
 *  an item with a declared target — nothing here is a test-only stand-in. */
function aiImpressionItem() {
  return parseCopilotAiResponse("IMPRESSION: Acute infarct extends into the insular cortex.")
    .find((i) => i.insertTarget === "impression")!;
}
function aiRecommendationItem() {
  return parseCopilotAiResponse("RECOMMENDATION: CT angiography for vessel occlusion.")
    .find((i) => i.insertTarget === "recommendation")!;
}
function engineRecommendationItem() {
  return analyzeCopilot({
    modality: "MR", studyDescription: "MRI Brain", clinicalHistory: "Sudden onset aphasia.",
    findings: "Acute infarct in the left MCA territory.", impression: ["Acute left MCA infarct."],
    recommendation: "", technique: "MRI brain performed on a 3T scanner.", selectedFindingLabels: [],
  }).items.find((i) => i.insertTarget === "recommendation" && !!i.insertText)!;
}

/** The clinical part of the store — what a refusal must leave byte-identical. */
const clinical = () => {
  const s = useWorkspace.getState();
  return {
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
    technique: s.techniqueText,
    history: s.clinicalHistoryText,
    prov: JSON.stringify(s.fieldProvenance),
    needsRefresh: s.impressionNeedsRefresh,
  };
};

const snap = () => {
  const s = useWorkspace.getState();
  return {
    findings: s.findingsText,
    impression: s.impressionText,
    recommendation: s.recommendationText,
    technique: s.techniqueText,
    prov: JSON.stringify(s.fieldProvenance),
    needsRefresh: s.impressionNeedsRefresh,
    dirty: s.isDirty,
    ack: [...s.acknowledgedCopilotIds].sort().join(","),
  };
};

beforeEach(() => {
  vi.restoreAllMocks();
  openStudy();
});

// ─────────────────────────────────────────────────────────────────────────────
// §19 — Audit B's actual Copilot problem, executed through the real action.
// ─────────────────────────────────────────────────────────────────────────────
describe("B-03 reproduction — an item intended for Impression does not land in Findings", () => {
  it("the production AI parser declares an impression target and the boundary obeys it", () => {
    const ai = aiImpressionItem();
    expect(ai.insertTarget).toBe("impression");
    const before = snap();
    useWorkspace.getState().insertCopilotText(acceptanceItem(ai));
    const s = useWorkspace.getState();
    expect(s.impressionText).toContain("Acute infarct extends into the insular cortex.");
    // And Findings is byte-for-byte what it was — no AI sentence smuggled in.
    expect(s.findingsText).toBe(before.findings);
    expect(s.recommendationText).toBe(before.recommendation);
  });

  it("the pre-fix behaviour was a self-contradictory Findings and an empty Impression", () => {
    // Positive control that the test above is not vacuous: the same item, sent to
    // the field the old boundary hard-coded, is exactly the defect. Written out
    // rather than asserted against the removed line so this file stays honest
    // about what main does.
    openStudy();
    const before = useWorkspace.getState().findingsText;
    useWorkspace.getState().mergeField("findings", "Acute infarct extends into the insular cortex.", "companion");
    const after = useWorkspace.getState().findingsText;
    expect(after).not.toBe(before);
    expect(after).toMatch(/Acute infarct in the left MCA territory/);
    expect(after).toMatch(/extends into the insular cortex/);
    expect(useWorkspace.getState().fieldProvenance.findings?.[normalizeForDedupe("Acute infarct extends into the insular cortex.")])
      .toEqual(["companion"]);
  });

  it("the deterministic engine's recommendation item reaches Recommendation, not Findings", () => {
    const eng = engineRecommendationItem();
    expect(eng.insertTarget).toBe("recommendation");
    const before = snap();
    useWorkspace.getState().insertCopilotText(acceptanceItem(eng, { kind: "recommendation", source: "Copilot" }));
    const s = useWorkspace.getState();
    expect(s.recommendationText).toContain("MR angiography of the intracranial vessels");
    expect(s.findingsText).toBe(before.findings);
    expect(s.impressionText).toBe(before.impression);
  });

  it("the button label and the destination agree for every declared target", () => {
    // `CareCopilotPanel` prints `Insert → {item.insertTarget}`. A click that
    // ignores the label is a UI telling the radiologist one field and writing
    // another, so this is asserted for all three targets at the store boundary.
    for (const target of ["findings", "impression", "recommendation"] as const) {
      openStudy();
      const text = `Suggested sentence for ${target}.`;
      useWorkspace.getState().insertCopilotText(acceptanceItem({
        id: `t:${target}`, title: "t", detail: "d", insertText: text, insertTarget: target,
      }));
      const s = useWorkspace.getState();
      const landed = [
        s.findingsText.includes(text) ? "findings" : "",
        s.impressionText.includes(text) ? "impression" : "",
        s.recommendationText.includes(text) ? "recommendation" : "",
      ].filter(Boolean);
      expect(landed).toEqual([target]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §18 A1–A12 — the matrix, through real production actions.
// ─────────────────────────────────────────────────────────────────────────────
describe("A1/A2/A3 — field isolation: only the intended field moves", () => {
  const cases = [
    ["findings", "impression", "recommendation"],
    ["impression", "findings", "recommendation"],
    ["recommendation", "findings", "impression"],
  ] as const;

  for (const [target, untouched1, untouched2] of cases) {
    it(`A-${target}: only ${target} changes`, () => {
      const before = snap();
      const text = `Accepted AI sentence destined for ${target}.`;
      useWorkspace.getState().insertCopilotText(acceptanceItem({
        id: `iso:${target}`, title: "t", detail: "d", insertText: text, insertTarget: target,
      }));
      const s = useWorkspace.getState();
      const other = (f: string) => ({ findings: s.findingsText, impression: s.impressionText, recommendation: s.recommendationText })[f];
      expect(other(untouched1)).toBe(before[untouched1]);
      expect(other(untouched2)).toBe(before[untouched2]);
      expect(s.techniqueText).toBe(before.technique);
      expect(other(target)).toContain(text);
      // Authorship: accepted AI prose is labelled with CARE's existing AI label.
      const fieldKey = target as "findings" | "impression" | "recommendation";
      expect(s.fieldProvenance[fieldKey]?.[normalizeForDedupe(text)]).toEqual(["ai-draft"]);
    });
  }
});

describe("A4/A5/A6 — freshness follows the existing semantics", () => {
  it("A5 an accepted AI Findings sentence marks the Impression stale", () => {
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    useWorkspace.getState().insertCopilotText(acceptanceItem({
      id: "a5", title: "t", detail: "d", insertText: "Additional oedema with mass effect.", insertTarget: "findings",
    }));
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
  });

  it("A4 an accepted AI Impression does not certify stale Findings as reconciled", () => {
    useWorkspace.setState({ impressionNeedsRefresh: true } as never);
    useWorkspace.getState().insertCopilotText(acceptanceItem({
      id: "a4", title: "t", detail: "d", insertText: "Acute left MCA infarct with oedema.", insertTarget: "impression",
    }));
    const s = useWorkspace.getState();
    expect(s.impressionText).toContain("Acute left MCA infarct with oedema.");
    expect(s.impressionNeedsRefresh).toBe(true);
  });

  it("A4b the live Ctrl+I ghost path keeps its own staleness too", () => {
    // This is the defect a radiologist hits today: the model summarises the
    // findings, the impression lands as ghost text, and accepting it used to flip
    // the flag to "fresh" while the findings that made it stale stay put.
    useWorkspace.getState().mergeField("findings", "New oedema around the infarct.", "manual");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    // C2 gave the ghost channel a binding: a suggestion now has to say what state
    // it was generated from, so this fixture builds one from the findings it was
    // actually summarising — the same call the live Ctrl+I hook makes. Which field
    // is STALE is the point of the test; whose staleness it is, is not.
    useWorkspace.getState().setGhostText(
      "Acute infarct with surrounding oedema.",
      "impression",
      aiProposalBindingForImpression(useWorkspace.getState()),
    );
    useWorkspace.getState().acceptGhostText();
    const s = useWorkspace.getState();
    expect(s.impressionText).toContain("Acute infarct with surrounding oedema.");
    expect(s.impressionNeedsRefresh).toBe(true);
    expect(s.fieldProvenance.impression?.[normalizeForDedupe("Acute infarct with surrounding oedema.")])
      .toEqual(["ai-draft"]);
  });

  it("A4c sources that own both sides still reconcile the Impression (positive control)", () => {
    // If this fails, the A4 rule was implemented as "never clear", which would be
    // the general B-04 rewrite this PR is forbidden to do.
    openStudy();
    useWorkspace.setState({ impressionNeedsRefresh: true } as never);
    expect(useWorkspace.getState().mergeField("impression", "Extra impression line.", "quick-select"))
      .toBe("applied");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    useWorkspace.setState({ impressionNeedsRefresh: true } as never);
    expect(useWorkspace.getState().mergeField("impression", "Another line.", "template")).toBe("applied");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
  });

  it("A4d a manual Impression edit is unchanged by this rule, as before", () => {
    useWorkspace.setState({ impressionNeedsRefresh: true } as never);
    expect(useWorkspace.getState().mergeField("impression", "Radiologist's own impression line.", "manual"))
      .toBe("applied");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
  });

  it("A6 an accepted AI Recommendation leaves freshness exactly as it was", () => {
    for (const start of [false, true] as const) {
      openStudy();
      useWorkspace.setState({ impressionNeedsRefresh: start } as never);
      useWorkspace.getState().insertCopilotText(acceptanceItem(aiRecommendationItem()));
      const s = useWorkspace.getState();
      expect(s.recommendationText).toContain("CT angiography for vessel occlusion.");
      expect(s.impressionNeedsRefresh).toBe(start);
      expect(s.findingsText).toBe(FINDINGS);
      expect(s.impressionText).toBe(IMPRESSION);
    }
  });

  it("there is no recommendationNeedsRefresh invented here", () => {
    const keys = Object.keys(useWorkspace.getState());
    expect(keys.some((k) => /recommendation.*[Ss]tale|recommendationNeedsRefresh/i.test(k))).toBe(false);
  });
});

describe("A7/A8 — acceptance does not bypass B-02, and dedupe stays safe", () => {
  it("A7 the radiologist's manual sentence survives a contradictory accepted AI sentence", () => {
    openStudy("study-A", { findings: "No acute infarct." });
    useWorkspace.getState().insertCopilotText(acceptanceItem({
      id: "a7", title: "t", detail: "d", insertText: "Acute infarct.", insertTarget: "findings",
    }));
    const s = useWorkspace.getState();
    expect(s.findingsText).toContain("No acute infarct.");
    expect(s.findingsText).toContain("Acute infarct.");
    expect(s.findingsText.split("\n")).toHaveLength(2);
    // Each keeps its own author: the boundary may not launder manual text into
    // AI text or the other way round.
    expect(s.fieldProvenance.findings?.[normalizeForDedupe("No acute infarct.")]).toEqual(["manual"]);
    expect(s.fieldProvenance.findings?.[normalizeForDedupe("Acute infarct.")]).toEqual(["ai-draft"]);
  });

  it("A8 accepted AI text already in the field is not duplicated", () => {
    openStudy();
    const before = snap();
    const already = "Acute infarct in the left MCA territory.";
    useWorkspace.getState().insertCopilotText(acceptanceItem({
      id: "a8", title: "t", detail: "d", insertText: already, insertTarget: "findings",
    }));
    const s = useWorkspace.getState();
    // The safe dedupe from #878 still applies at this boundary: the sentence is
    // the same text under normalization, so it appears once. Compared as sentences
    // because the merge re-lays the block ("A. B." arrives as two lines), which is
    // layout, not a second copy.
    expect(s.findingsText).not.toBe(before.findings + `\n${already}`);
    expect(splitToSentences(s.findingsText).map(normalizeForDedupe))
      .toEqual(splitToSentences(before.findings).map(normalizeForDedupe));
    expect(s.findingsText.match(/Acute infarct in the left MCA territory\./g)).toHaveLength(1);
    // Provenance is where a duplicate legitimately changes, and that is textual
    // fact rather than a clinical decision: the same sentence now has two
    // producers, both of them recorded. #878's "a true duplicate sets no flag"
    // rule holds only while provenance is identical too, which it is not here,
    // so the flag follows the existing findings-write semantics.
    expect(s.fieldProvenance.findings?.[normalizeForDedupe(already)]).toEqual(["manual", "ai-draft"]);
    expect(s.impressionNeedsRefresh).toBe(true);
    expect(s.recommendationText).toBe(before.recommendation);
  });
});

describe("A9/A10/A11/A12 — the guards an acceptance must still pass", () => {
  it("A9 a suggestion generated for study A cannot mutate study B", () => {
    openStudy("study-A");
    const itemForA = acceptanceItem({ id: "a9", title: "t", detail: "d", insertText: "Patient A's AI impression line.", insertTarget: "impression" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openStudy("study-B");
    const before = snap();

    useWorkspace.getState().insertCopilotText({ ...itemForA, studyId: "study-A" } as CopilotItem);

    expect(snap()).toEqual(before);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("copilot insert refused"))).toBe(true);
  });

  it("A9b the live ghost path cannot be accepted across a study switch either", () => {
    // §12, for the surface whose freshness behaviour this PR changes. The ghost
    // ghost is held in `CLINICAL_RESET_FIELDS` (`clinicalStateReset.ts`, next to
    // `copilotItems`), so the
    // switch empties it, and the response itself is dropped unless the study open
    // when it lands is the study it was requested for
    // (`useTriggerAiImpression.ts`, the `shouldApplyAsyncStudyKey` check).
    // Proven here so the freshness change is
    // known not to have opened a cross-patient hole on this path.
    openStudy("study-A");
    useWorkspace.getState().setGhostText("Patient A's model impression.", "impression");
    useWorkspace.setState({ impressionNeedsRefresh: true } as never);
    openStudy("study-B", { findings: "Patient B has no infarct." });
    const before = clinical();
    useWorkspace.getState().acceptGhostText();
    expect(clinical()).toEqual(before);
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
  });

  it("A10 a signed report refuses every targeted acceptance", () => {
    for (const target of ["findings", "impression", "recommendation"] as const) {
      openStudy();
      const before = snap();
      useWorkspace.setState({ isFinalized: true } as never);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      useWorkspace.getState().insertCopilotText(acceptanceItem({
        id: `a10:${target}`, title: "t", detail: "d",
        insertText: `Signed-report probe for ${target}.`, insertTarget: target,
      }));
      const s = useWorkspace.getState();
      expect(s.findingsText).toBe(before.findings);
      expect(s.impressionText).toBe(before.impression);
      expect(s.recommendationText).toBe(before.recommendation);
      expect(s.isDirty).toBe(false);
      expect(s.acknowledgedCopilotIds.size).toBe(0);
      expect(warn.mock.calls.some((c) => String(c[0]).includes("the report is signed"))).toBe(true);
      warn.mockRestore();
    }
  });

  it("A11 an unknown or missing target fails closed instead of guessing Findings", () => {
    // Unknown value: nothing may be written, whatever the item's origin.
    openStudy();
    const before = snap();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useWorkspace.getState().insertCopilotText(acceptanceItem({
      id: "a11", title: "t", detail: "d", insertText: "A sentence with nowhere to go.", insertTarget: "clinicalHistory",
    }));
    expect(snap()).toEqual(before);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    // AI-authored with no target at all: the guess that used to be made is the
    // defect this file reproduces, so it stays closed.
    openStudy();
    const before2 = snap();
    useWorkspace.getState().insertCopilotText(acceptanceItem({
      id: "a11b", title: "t", detail: "d", insertText: "AI prose without a declared destination.",
    }));
    expect(snap()).toEqual(before2);
  });

  it("A11b a deterministic rail nudge with no target keeps its documented Findings default", () => {
    // Not an invention: `runCopilotAnalysis` has always produced these as findings
    // sentences, and #840's stamp tests pin that insert. Removing the default
    // would silently disable the rail's only live Insert buttons.
    openStudy("study-A", { findings: FINDINGS });
    const nudge = runCopilotAnalysis({
      findingsText: FINDINGS, impressionText: IMPRESSION, modality: "MR", sex: "F",
      measurements: [], hasPrior: true,
    }).find((i) => i.id === "missing-comparison")!;
    expect(nudge.insertText).toBeTruthy();
    expect((nudge as CopilotItem).insertTarget).toBeUndefined();
    const before = snap();
    useWorkspace.getState().insertCopilotText({ ...nudge, studyId: "study-A" } as CopilotItem);
    const s = useWorkspace.getState();
    expect(s.findingsText).toContain("Comparison made with prior study dated ____.");
    expect(s.impressionText).toBe(before.impression);
    expect(s.recommendationText).toBe(before.recommendation);
    // Its author is still the copilot nudge of record, not a claim about AI.
    expect(s.fieldProvenance.findings?.[normalizeForDedupe("Comparison made with prior study dated ____.")])
      .toEqual(["companion"]);
  });

  it("A12 receiving an AI response is not acceptance — nothing is written until the radiologist accepts", () => {
    const before = clinical();
    // The parser alone: proposals are data.
    const items = parseCopilotAiResponse([
      "IMPRESSION: Model impression line.",
      "RECOMMENDATION: Model recommendation line.",
      "DIFFERENTIAL: a | b",
    ].join("\n"));
    expect(items).toHaveLength(3);
    expect(clinical()).toEqual(before);

    // The ghost layer: the response is held out of the report until Accept.
    // (C2: it also carries the state it was generated from, which for this path
    // is the findings the request was built from — unchanged here, so the
    // proposal is fresh and the rest of this test is about authorship, not age.)
    useWorkspace.getState().setGhostText(
      "Model impression line.",
      "impression",
      aiProposalBindingForImpression(useWorkspace.getState()),
    );
    expect(clinical()).toEqual(before);
    expect(useWorkspace.getState().ghostText).toBe("Model impression line.");
    expect(useWorkspace.getState().ghostTextTarget).toBe("impression");

    // The rail: an item present in the list changes no field. Acknowledging it is
    // UI bookkeeping, so the comparison above is on clinical state only.
    useWorkspace.getState().recomputeCopilot();
    expect(clinical()).toEqual(before);
    useWorkspace.getState().acknowledgeCopilotItem("ai:impression:0");
    expect(clinical()).toEqual(before);

    // Only acceptance writes.
    useWorkspace.getState().acceptGhostText();
    expect(useWorkspace.getState().impressionText).toContain("Model impression line.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The contract itself, as a pure decision (so the rules are legible and the
// store cannot quietly re-add a default).
// ─────────────────────────────────────────────────────────────────────────────
describe("the acceptance contract", () => {
  const base = { kind: "ai-draft", title: "t", detail: "d", confidence: "medium", source: "AI", insertText: "S." } as const;

  it("a declared target is authoritative for each of the three fields", () => {
    for (const field of ["findings", "impression", "recommendation"] as const) {
      const r = resolveCopilotAcceptance({ ...base, insertTarget: field } as CopilotAcceptanceItem);
      expect(r.accepted).toBe(true);
      if (r.accepted) expect(r.field).toBe(field);
    }
  });

  it("AI authorship is attributed to ai-draft, never to the companion panel", () => {
    const r = resolveCopilotAcceptance({ ...base, insertTarget: "impression" } as CopilotAcceptanceItem);
    expect(r.accepted && r.source).toBe("ai-draft");
    // An item that declares its own provenance wins over the kind heuristic.
    const d = resolveCopilotAcceptance({
      ...base, insertTarget: "impression", provenance: "quick-findings",
    } as CopilotAcceptanceItem);
    expect(d.accepted && d.source).toBe("quick-findings");
  });

  it("a deterministic copilot nudge keeps the existing companion default and the findings default", () => {
    const r = resolveCopilotAcceptance({
      ...base, kind: "suggestion", source: "Priors",
    } as CopilotAcceptanceItem);
    expect(r.accepted && r.source).toBe("companion");
    expect(r.accepted && r.field).toBe("findings");
  });

  it("an unknown target, and an AI item with no target, are both refused with a reason", () => {
    const bad = resolveCopilotAcceptance({ ...base, insertTarget: "technique" } as unknown as CopilotAcceptanceItem);
    expect(bad.accepted).toBe(false);
    if (!bad.accepted) expect(bad.reason).toBe("invalid-insert-target");
    const none = resolveCopilotAcceptance(base as CopilotAcceptanceItem);
    expect(none.accepted).toBe(false);
    if (!none.accepted) expect(none.reason).toBe("ai-proposal-without-target");
  });

  it("the refusal says why, so a dead button is diagnosable", () => {
    const bad = resolveCopilotAcceptance({ ...base, insertTarget: "clinicalHistory" } as unknown as CopilotAcceptanceItem);
    expect(!bad.accepted ? bad.detail : "").toMatch(/clinicalHistory/);
    expect(!bad.accepted ? bad.detail : "").toMatch(/findings \| impression \| recommendation/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source contracts — the removed hard-codings cannot come back unnoticed.
// ─────────────────────────────────────────────────────────────────────────────
describe("contract — the boundary resolves a target, it does not assume one", () => {
  it("insertCopilotText no longer writes Findings unconditionally", () => {
    expect(insertBody).toMatch(/resolveCopilotAcceptance/);
    expect(insertBody).not.toMatch(/mergeField\(\s*"findings"\s*,\s*item\.insertText/);
    // Positive controls: both matchers really are able to see the shapes they ban.
    expect('mergeField("findings", item.insertText, "companion")').toMatch(/mergeField\(\s*"findings"\s*,\s*item\.insertText/);
    expect("const a = resolveCopilotAcceptance(item);").toMatch(/resolveCopilotAcceptance/);
    expect(insertBody.length).toBeGreaterThan(500);
  });

  it("no provenance label is hard-coded at the acceptance call site", () => {
    expect(insertBody).not.toMatch(/mergeField\([^)]*,\s*"companion"\s*\)/);
    expect('get().mergeField("findings", `Measurements: ${"x"}.`, "companion")')
      .toMatch(/mergeField\([^)]*,\s*"companion"\s*\)/);
  });

  it("an accepted AI draft cannot certify impression freshness", () => {
    // The claim is about the SOURCE, not about a literal. mergeField re-bases the
    // Findings→Impression dependency only for a source that owns both sides, and
    // `ai-draft` is excluded by name. A behavioural version of the same rule is
    // pinned by A4/A4b/P20 in this file and its neighbour; this matcher is here to
    // keep the exclusion from being quietly widened.
    expect(mergeBody).toMatch(/const ownsBoth = f === "impression"[\s\S]{0,40}source !== "manual"[\s\S]{0,40}source !== "ai-draft"/);
    expect(mergeBody).toMatch(/deriveImpressionDependency\(get\(\), ownsBoth \? \{ rebase: true \} : undefined/);
    // Banned shape: an unconditional clear, and the old per-source literal.
    expect(mergeBody).not.toMatch(/impressionNeedsRefresh:\s*false/);
    // Positive control: a mergeField that clears on every non-manual source is
    // exactly the shape being banned, and the matcher sees it.
    expect(code('...(f === "impression" && source !== "manual" ? { impressionNeedsRefresh: false } : {})'))
      .not.toMatch(/source !== "ai-draft"/);
  });

  it("the study-stamp and signed-report guards still run before any write", () => {
    const signedIdx = insertBody.indexOf("refuseSignedMutation");
    const stampIdx = insertBody.indexOf("item.studyId !== get().activeStudyId");
    const resolveIdx = insertBody.indexOf("resolveCopilotAcceptance");
    expect(signedIdx).toBeGreaterThan(-1);
    expect(stampIdx).toBeGreaterThan(-1);
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(signedIdx).toBeLessThan(stampIdx);
    expect(stampIdx).toBeLessThan(resolveIdx);
    // And the refusal itself is a return, not a write: between resolving the
    // contract and the first field write there is no `set` and no dirty flag.
    const afterResolve = insertBody.slice(resolveIdx);
    const refuseRegion = afterResolve.slice(0, afterResolve.indexOf("mergeField"));
    expect(refuseRegion.length).toBeGreaterThan(20);
    expect(refuseRegion).toMatch(/return;/);
    expect(refuseRegion).not.toMatch(/\bset\(\{/);
    expect(refuseRegion).not.toMatch(/isDirty/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The other AI surfaces, held to what they already do (so this fix is not a
// regression in disguise and Audit C inherits a measured baseline).
// ─────────────────────────────────────────────────────────────────────────────
describe("neighbouring paths — already correct, and still correct", () => {
  it("acceptance stays prose-only — it creates no canonical observation and no ledger row", () => {
    // §16. The existing boundary is a text insert, so this PR preserves that: AI
    // acceptance must not open a second clinical-truth store. A structured
    // contribution still arrives through the pathology patch / ledger path, which
    // this file does not touch.
    openStudy();
    const patches = useWorkspace.getState().appliedPathologyPatches.length;
    useWorkspace.getState().insertCopilotText(acceptanceItem({
      id: "p1", title: "t", detail: "d", insertText: "Acute infarct with surrounding oedema.", insertTarget: "impression",
    }));
    const s = useWorkspace.getState();
    expect(s.appliedPathologyPatches.length).toBe(patches);
    expect(s.impressionText).toContain("Acute infarct with surrounding oedema.");
    expect(s.fieldProvenance.impression?.[normalizeForDedupe("Acute infarct with surrounding oedema.")])
      .toEqual(["ai-draft"]);
  });

  it("undo: an acceptance pushes no clinical undo frame, as it did before", () => {
    // Documented, not fixed (§21). `mergeField` is an additive sentence insert and
    // has never pushed `withPushedClinicalUndo` — #878's suite pins that for the
    // tile path too — so an accepted suggestion is undone the way any inserted
    // sentence is: by editing the text back, or by the patch-undo stack when the
    // write came from a pathology patch. The acceptance boundary does not change
    // that, and building a new undo surface for AI inserts is explicitly out of
    // scope here. Asserted so the claim is measured rather than remembered.
    openStudy();
    const depth = useWorkspace.getState().patchUndoStack.length;
    useWorkspace.getState().insertCopilotText(acceptanceItem({
      id: "u1", title: "t", detail: "d", insertText: "An accepted AI impression line.", insertTarget: "impression",
    }));
    expect(useWorkspace.getState().patchUndoStack.length).toBe(depth);
    expect(useWorkspace.getState().isDirty).toBe(true);
  });

  it("the AI Composer writes accepted AI prose per field and claims no reconciliation", () => {
    openStudy();
    useWorkspace.setState({ impressionNeedsRefresh: true } as never);
    useWorkspace.getState().applyAiComposerAccepted({
      findings: "Acute infarct in the left MCA territory with cytotoxic oedema.",
      impression: IMPRESSION,
      recommendation: RECOMMENDATION,
    });
    const s = useWorkspace.getState();
    expect(s.findingsText).toContain("cytotoxic oedema");
    expect(s.impressionText).toBe(IMPRESSION);
    expect(s.recommendationText).toBe(RECOMMENDATION);
    expect(s.fieldProvenance.findings?.[normalizeForDedupe("Acute infarct in the left MCA territory with cytotoxic oedema.")])
      .toEqual(["ai-draft"]);
    expect(s.impressionNeedsRefresh).toBe(true);
  });

  it("dictation into Impression is untouched by the new rule", () => {
    useWorkspace.setState({ impressionNeedsRefresh: true } as never);
    expect(useWorkspace.getState().mergeField("impression", "Dictated impression line.", "radiologist-voice"))
      .toBe("applied");
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
  });

  it("the measurement branch still lands in Findings with the companion panel as its author", () => {
    openStudy("study-A", { findings: FINDINGS });
    useWorkspace.getState().setMeasurements([
      { id: "m1", name: "Lesion", value: 12, unit: "mm", source: "viewer", inserted: false } as never,
    ]);
    useWorkspace.getState().recomputeCopilot();
    const item = useWorkspace.getState().copilotItems.find((i) => i.kind === "measurement")!;
    expect(item).toBeTruthy();
    useWorkspace.getState().insertCopilotText(item);
    const s = useWorkspace.getState();
    const sentence = "Measurements: Lesion: 12mm.";
    expect(s.findingsText).toContain(sentence);
    expect(s.measurements[0]!.inserted).toBe(true);
    expect(s.fieldProvenance.findings?.[normalizeForDedupe(sentence)]).toEqual(["companion"]);
    expect(s.impressionNeedsRefresh).toBe(true);
    // A viewer measurement accepted from the rail is not an AI claim, and must not
    // be relabelled as one by this fix.
    expect(s.fieldProvenance.findings?.[normalizeForDedupe(sentence)]).not.toContain("ai-draft");
  });

  it("a Quick Select tile that owns both sides still writes its impression and reconciles", () => {
    openStudy();
    const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Disc herniation L4-L5")!;
    expect(tile).toBeTruthy();
    expect(tile.sentence).not.toMatch(/\{[a-z]+\}/i);
    expect(tile.impressionSentence).toBeTruthy();
    expect(tile.impressionSentence).not.toMatch(/\{[a-z]+\}/i);
    useWorkspace.setState({ impressionNeedsRefresh: true } as never);
    useWorkspace.getState().applyPathologyOverlay(quickSelectTilePatch(tile, "findings"));
    const s = useWorkspace.getState();
    const stated = (t: string) => splitToSentences(t).map(normalizeForDedupe);
    expect(stated(s.findingsText)).toEqual(expect.arrayContaining(stated(tile.sentence)));
    expect(stated(s.impressionText)).toEqual(expect.arrayContaining(stated(tile.impressionSentence!)));
    expect(s.impressionNeedsRefresh).toBe(false);
    expect(s.fieldProvenance.impression?.[normalizeForDedupe(tile.impressionSentence!)])
      .toEqual(["quick-findings"]);
  });
});
