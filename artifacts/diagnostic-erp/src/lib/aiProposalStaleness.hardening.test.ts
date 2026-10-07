/**
 * C2 — a study-bound AI proposal must say what clinical state it came from, and
 * must stop being acceptable when that state is no longer the state of the report.
 *
 * C1 answered "which model produced these words?". C2 answers "which clinical
 * state were these words produced from?". Both are needed before a radiologist
 * can be shown a draft and told it is current: without the second answer, CARE can
 * present yesterday's reasoning as though it had been generated from the report
 * that exists now.
 *
 * REPRODUCED ON `0bdaac92` (the commit that merged C1) by the tests below, which
 * were written against the production store before any C2 code existed. The ghost
 * channel there is two plain fields and one unconditional write:
 *
 *   setGhostText: (t, target) => set({ ghostText: t, ghostTextTarget: target })
 *   acceptGhostText: () => {
 *     const { ghostText, ghostTextTarget } = get();
 *     if (!ghostText || !ghostTextTarget) return;
 *     get().mergeField(ghostTextTarget, ghostText, "ai-draft");
 *     …
 *
 * So the sequence a radiologist can actually perform is:
 *
 *   1. Study A, Findings = X. Ctrl+I → the model summarises X.
 *   2. The ghost appears. The radiologist keeps typing: Findings = Y.
 *   3. Tab (Accept).
 *
 * Before C2, step 3 writes an Impression summarising X into the report that now
 * says Y, and nothing anywhere notices. The Impression is one keystroke old and
 * labelled `ai-draft`, which is the authorship #880 made truthful — so the record
 * says honestly "AI wrote this" about a sentence that no longer matches the
 * findings it claims to summarise. `impressionNeedsRefresh` does not save it
 * either: an accepted AI Impression deliberately cannot certify reconciliation
 * (#880), so the flag stays armed and the report still goes out with an
 * Impression derived from text that has been deleted.
 *
 * Study navigation, by contrast, is ALREADY safe and this file preserves rather
 * than duplicates it: `ghostText`/`ghostTextTarget` are in `CLINICAL_RESET_FIELDS`
 * (`zai-workspace/clinicalStateReset.ts:79-80`), so A → B clears A's proposal
 * before A can be accepted in B, and the response itself is dropped when it lands
 * on a different study (`useTriggerAiImpression.ts:68-80`,
 * `shouldApplyAsyncStudyKey`). The tests below pin those guarantees from the
 * outside instead of re-implementing them, and add the one thing that was missing:
 * a proposal that survives on screen while its own clinical source changes.
 *
 * Deliberately NOT done here: no provider/model/prompt work (C1 owns that), no
 * second acceptance boundary (freshness ends in the existing
 * `mergeField(field, text, "ai-draft")`), no new provenance vocabulary, no
 * migration or table, no persistence of prompts or clinical text, no Composer
 * rewrite (it already has `inputHash`/`reportRevision`/`STALE_READY` semantics of
 * its own — only its private text normalizer is reused), no
 * `recommendationNeedsRefresh`, no semantic similarity, no fuzzy staleness, and
 * no "Accept anyway" escape hatch.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({ id: "t", dismiss: () => {}, update: () => {} })),
  useToast: vi.fn(),
}));

import { useWorkspace, EMPTY_FIELD_PROVENANCE } from "@/lib/zai-workspace/store";
import { provenanceMapToSegments } from "@/lib/reportFieldMerge";
import { emptyClinicalState, CLINICAL_RESET_FIELDS } from "@/lib/zai-workspace/clinicalStateReset";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  aiProposalBindingForImpression,
  currentAiProposalContext,
  evaluateAiProposal,
  fingerprintAiProposalContext,
} from "@/lib/zai-workspace/aiProposalContext";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8").replace(/\r\n/g, "\n");
/** Strip comments so a docstring can never satisfy a code assertion. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/(\s)\/\/[^/\n]*$/gm, "$1");

/** The Findings state X the model was given, the Y it was not, and the proposal X made. */
const FINDINGS_X = "Acute infarct in the left MCA territory. No haemorrhage.";
const FINDINGS_Y = "Acute infarct in the left MCA territory with haemorrhagic transformation.";
const IMPRESSION_FROM_X = "Acute left MCA infarct.";

function openStudyA() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
    }),
    studies: [{ id: "study-A", patient: { name: "Patient A", sex: "F" }, modality: "MR" }],
    activeStudyId: "study-A",
    activeStudyInstanceUID: "1.2.840.study-A",
    completedStudyIds: new Set<string>(),
  } as never);
  useWorkspace.getState().setField("findings", FINDINGS_X, { source: "manual" });
  useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);
}

/**
 * The way the live Ctrl+I path lands a proposal: the hook reads the store, builds
 * the binding from what it actually had in hand, and calls the producer action.
 * Everything in this file goes through the real store rather than by setting state,
 * because the guarantee being tested is about the action, not about a field shape.
 */
function proposeImpressionFromCurrentFindings(text = IMPRESSION_FROM_X) {
  const st = useWorkspace.getState();
  const binding = aiProposalBindingForImpression(st);
  useWorkspace.getState().setGhostText(text, "impression", binding);
  return binding;
}

describe("C2 reproduction and contract — the proposal carries the state it was made from", () => {
  beforeEach(() => openStudyA());

  it("P17 identical clinically material context gives the same fingerprint", () => {
    const a = fingerprintAiProposalContext({
      studyId: "study-A", studyInstanceUID: "1.2.840.study-A",
      sourceField: "findings", sourceText: FINDINGS_X, targetField: "impression",
    });
    const b = fingerprintAiProposalContext({
      studyId: "study-A", studyInstanceUID: "1.2.840.study-A",
      sourceField: "findings", sourceText: FINDINGS_X, targetField: "impression",
    });
    expect(a).toBe(b);
    // Non-vacuity: a digest that returned a constant would pass this and fail nothing.
    const c = fingerprintAiProposalContext({
      studyId: "study-A", studyInstanceUID: "1.2.840.study-A",
      sourceField: "findings", sourceText: FINDINGS_Y, targetField: "impression",
    });
    expect(c).not.toBe(a);
  });

  it("P16 a clinically material source change changes the fingerprint", () => {
    const base = {
      studyId: "study-A", studyInstanceUID: "1.2.840.study-A",
      sourceField: "findings" as const, targetField: "impression" as const,
    };
    expect(fingerprintAiProposalContext({ ...base, sourceText: FINDINGS_X }))
      .not.toBe(fingerprintAiProposalContext({ ...base, sourceText: FINDINGS_Y }));
    // A different study with identical text is a different context too — the study
    // axis is inside the digest, not only beside it.
    expect(fingerprintAiProposalContext({ ...base, sourceText: FINDINGS_X }))
      .not.toBe(fingerprintAiProposalContext({
        ...base, studyId: "study-B", studyInstanceUID: "1.2.840.study-B", sourceText: FINDINGS_X,
      }));
  });

  it("P15 whitespace and line-ending-only differences do not create false staleness", () => {
    // The Composer already normalizes this way on both sides of its own wire
    // (`normalizeForHash`), and C2 reuses that rule rather than inventing a second
    // one: a trailing space, a doubled space or a CRLF is not a clinical change.
    const spaced = fingerprintAiProposalContext({
      studyId: "study-A", studyInstanceUID: "1.2.840.study-A",
      sourceField: "findings", sourceText: "  Left MCA infarct.   No haemorrhage.  ",
      targetField: "impression",
    });
    const plain = fingerprintAiProposalContext({
      studyId: "study-A", studyInstanceUID: "1.2.840.study-A",
      sourceField: "findings", sourceText: "Left MCA infarct. No haemorrhage.",
      targetField: "impression",
    });
    expect(spaced).toBe(plain);
    const crlf = fingerprintAiProposalContext({
      studyId: "study-A", studyInstanceUID: "1.2.840.study-A",
      sourceField: "findings", sourceText: "Left MCA infarct.\r\nNo haemorrhage.",
      targetField: "impression",
    });
    const lf = fingerprintAiProposalContext({
      studyId: "study-A", studyInstanceUID: "1.2.840.study-A",
      sourceField: "findings", sourceText: "Left MCA infarct.\nNo haemorrhage.",
      targetField: "impression",
    });
    expect(crlf).toBe(lf);
    // The rule's boundary, stated honestly rather than oversold: `normalizeForHash`
    // folds spaces and tabs and converts CRLF to LF, but does not turn a newline
    // into a space, so a line break is still a difference. That is deliberate —
    // pressing Enter inside Findings changes the printed report, and it is the same
    // line the Composer already treats as a change. Inventing a more aggressive
    // normalizer here would be a second, looser rule about clinical text, which is
    // the judgement #878 removed from the merge layer.
    expect(crlf).not.toBe(plain);
    // And a real edit inside the same whitespace shape is still caught.
    expect(fingerprintAiProposalContext({
      studyId: "study-A", studyInstanceUID: "1.2.840.study-A",
      sourceField: "findings", sourceText: "Left MCA infarct. No haemorrhage.",
      targetField: "impression",
    })).not.toBe(fingerprintAiProposalContext({
      studyId: "study-A", studyInstanceUID: "1.2.840.study-A",
      sourceField: "findings", sourceText: "Left MCA infarct. Small haemorrhage.",
      targetField: "impression",
    }));
  });

  it("P18 the stored proposal metadata contains no clinical text", () => {
    proposeImpressionFromCurrentFindings();
    const binding = useWorkspace.getState().ghostProposal;
    expect(binding).not.toBeNull();
    const serialised = JSON.stringify(binding);
    // The sentence the proposal was generated FROM, and the proposal's own text,
    // must not be recoverable from the metadata: only a digest and identities.
    expect(serialised).not.toContain("MCA");
    expect(serialised).not.toContain("Acute infarct");
    expect(serialised).not.toContain(IMPRESSION_FROM_X.replace(/\.$/, ""));
    expect(binding!.contextRevision).toMatch(/^[a-z0-9-]+$/);
  });

  it("P19 provider and model are not part of clinical freshness", () => {
    // C1's execution identity answers WHO produced the words. Changing that answer
    // — switching clinic model, or a fallback provider — does not make the
    // reasoning older than the report, so it must not appear in the digest at all:
    // a fingerprint that mixed them would stale every open proposal on a settings
    // change, which is a different question wearing the same word.
    const clinical = {
      studyId: "study-A", studyInstanceUID: "1.2.840.study-A",
      sourceField: "findings" as const, sourceText: FINDINGS_X, targetField: "impression" as const,
    };
    const withExecutionFields = {
      ...clinical,
      // Extra properties are the trap: if the digest stringified the whole object,
      // a provider change would look like a clinical change.
      provider: "ollama", model: "qwen3-vl:8b", locality: "local", timeoutMs: 300_000,
    } as unknown as typeof clinical;
    expect(fingerprintAiProposalContext(clinical))
      .toBe(fingerprintAiProposalContext(withExecutionFields));
  });

  it("P1 a fresh proposal on an unchanged study accepts through the existing boundary", () => {
    proposeImpressionFromCurrentFindings();
    useWorkspace.getState().acceptGhostText();
    const st = useWorkspace.getState();
    expect(st.impressionText).toContain("Acute left MCA infarct.");
    expect(st.ghostText).toBeNull();
    expect(st.ghostProposal).toBeNull();
    // And it is still labelled as AI authorship by the #880 vocabulary, with no new
    // provenance invented for the freshness path. `fieldProvenance[field]` is keyed
    // by the merge layer's own normalized sentence, so the lookup goes through the
    // same function that produced the key rather than a hand-built string.
    const st2 = useWorkspace.getState();
    const segments = provenanceMapToSegments(
      st2.impressionText,
      st2.fieldProvenance.impression ?? EMPTY_FIELD_PROVENANCE,
    );
    const accepted = segments.find((seg) => seg.text.includes("Acute left MCA infarct."));
    expect(accepted).toBeDefined();
    expect(accepted!.sources).toContain("ai-draft");
  });

  it("P2 findings changed after generation → the proposal is stale, and refusal writes nothing", () => {
    const binding = proposeImpressionFromCurrentFindings();
    // The radiologist keeps working: the findings the model summarised are edited.
    useWorkspace.getState().setField("findings", "Left MCA infarct with haemorrhagic transformation.", { source: "manual" });

    const verdict = evaluateAiProposal(binding, currentAiProposalContext(useWorkspace.getState()));
    expect(verdict.fresh).toBe(false);
    expect(verdict.reason).toBe("source-changed");

    const before = useWorkspace.getState().impressionText;
    useWorkspace.getState().acceptGhostText();
    const after = useWorkspace.getState().impressionText;
    expect(after).toBe(before);
    expect(after).not.toContain("Acute left MCA infarct.");
  });

  it("P3 a response generated from X that lands after an edit to Y is stale on arrival", () => {
    // The request was built from X; while it was in flight the report became Y.
    // The proposal is not "accepted then discovered" — the store can already tell
    // when it arrives, and the same evaluation the UI uses is the one acceptance
    // uses, so there is no window where the two disagree.
    const st = useWorkspace.getState();
    const binding = aiProposalBindingForImpression(st); // context: FINDINGS_X
    useWorkspace.getState().setField("findings", "Left MCA infarct. New: 6 mm midline shift.", { source: "manual" });
    useWorkspace.getState().setGhostText(IMPRESSION_FROM_X, "impression", binding);

    expect(evaluateAiProposal(binding, currentAiProposalContext(useWorkspace.getState())).fresh).toBe(false);
    // The UI affordance and the trust boundary read the same thing: a selector over
    // the proposal plus the current clinical state, so it re-evaluates on every edit.
    expect(useWorkspace.getState().ghostProposalStale()).toBe(true);
    const before = useWorkspace.getState().impressionText;
    useWorkspace.getState().acceptGhostText();
    expect(useWorkspace.getState().impressionText).toBe(before);
  });

  it("P4/P5/P6 a stale proposal cannot mutate Impression, Findings or Recommendation", () => {
    const targetFields = ["impression", "findings", "recommendation"] as const;
    for (const target of targetFields) {
      openStudyA();
      const st = useWorkspace.getState();
      const binding = aiProposalBindingForImpression(st, target);
      useWorkspace.getState().setField("findings", "Findings edited after generation.", { source: "manual" });
      useWorkspace.getState().setGhostText(`A stale proposal for ${target}.`, target, binding);
      const snapshot = {
        impression: useWorkspace.getState().impressionText,
        findings: useWorkspace.getState().findingsText,
        recommendation: useWorkspace.getState().recommendationText,
      };
      useWorkspace.getState().acceptGhostText();
      const after = useWorkspace.getState();
      expect(after.impressionText).toBe(snapshot.impression);
      expect(after.findingsText).toBe(snapshot.findings);
      expect(after.recommendationText).toBe(snapshot.recommendation);
      // The refused proposal stays on screen as stale — refusing silently while
      // clearing it would look to the radiologist like the click did nothing.
      expect(after.ghostText).toBe(`A stale proposal for ${target}.`);
    }
  });

  it("P8 discard clears the proposal and changes no report field", () => {
    proposeImpressionFromCurrentFindings();
    const before = useWorkspace.getState().findingsText;
    useWorkspace.getState().setGhostText(null, null);
    const after = useWorkspace.getState();
    expect(after.ghostText).toBeNull();
    expect(after.ghostTextTarget).toBeNull();
    expect(after.ghostProposal).toBeNull();
    expect(after.findingsText).toBe(before);
    expect(after.impressionText).toBe("");
  });

  it("P7 regenerate re-reads the current context and gets a new fingerprint", () => {
    const first = proposeImpressionFromCurrentFindings();
    useWorkspace.getState().setField("findings", "Left MCA infarct with haemorrhagic transformation.", { source: "manual" });

    // Regenerate WITHOUT discarding first — which is what GhostLayer's button
    // actually does: it only sends a new request, it never clears the screen. The
    // proposal that arrives has to describe the report as it is now, so the binding
    // on screen must be the new one (§26 M5 is a producer that keeps the old).
    const second = proposeImpressionFromCurrentFindings("Revised impression for the new findings.");
    expect(second.contextRevision).not.toBe(first.contextRevision);
    expect(useWorkspace.getState().ghostProposal?.contextRevision).toBe(second.contextRevision);
    expect(useWorkspace.getState().ghostText).toBe("Revised impression for the new findings.");
    expect(useWorkspace.getState().ghostProposalStale()).toBe(false);
    useWorkspace.getState().acceptGhostText();
    expect(useWorkspace.getState().impressionText).toContain("Revised impression for the new findings.");

    // And the explicit Discard-then-regenerate path, which is the other way the
    // radiologist can leave a stale suggestion behind: nothing may survive in the
    // channel that was built from text nobody can still see.
    useWorkspace.getState().setField("findings", "New oedema appears on the repeat sequence.", { source: "manual" });
    useWorkspace.getState().setGhostText(null, null);
    expect(useWorkspace.getState().ghostProposal).toBeNull();
    const third = proposeImpressionFromCurrentFindings("Third impression.");
    expect(third.contextRevision).not.toBe(second.contextRevision);
    expect(useWorkspace.getState().ghostProposal?.contextRevision).toBe(third.contextRevision);
    expect(evaluateAiProposal(third, currentAiProposalContext(useWorkspace.getState())).fresh).toBe(true);
  });

  it("P9 a proposal for study A is never acceptable while study B is open", () => {
    const binding = proposeImpressionFromCurrentFindings();
    // The ordinary navigation path clears the proposal (already true before C2 —
    // pinned by clinicalStateReset.hardening.test.ts). What C2 adds is that the
    // binding itself also refuses, so a proposal that reaches B by any route that
    // went round that reset cannot be written into B's report.
    useWorkspace.setState({
      ...emptyClinicalState(),
      studies: [
        { id: "study-A", patient: { name: "Patient A", sex: "F" }, modality: "MR" },
        { id: "study-B", patient: { name: "Patient B", sex: "M" }, modality: "CT" },
      ],
      activeStudyId: "study-B",
      activeStudyInstanceUID: "1.2.840.study-B",
      completedStudyIds: new Set<string>(),
    } as never);
    useWorkspace.getState().setField("findings", "Haemorrhagic contusion, right frontal.", { source: "manual" });

    expect(useWorkspace.getState().ghostText).toBeNull();
    expect(useWorkspace.getState().ghostProposal).toBeNull();

    useWorkspace.getState().setGhostText(IMPRESSION_FROM_X, "impression", binding);
    const verdict = evaluateAiProposal(binding, currentAiProposalContext(useWorkspace.getState()));
    expect(verdict.fresh).toBe(false);
    expect(verdict.reason).toBe("study-changed");
    const before = useWorkspace.getState().impressionText;
    useWorkspace.getState().acceptGhostText();
    expect(useWorkspace.getState().impressionText).toBe(before);
    expect(useWorkspace.getState().impressionText).not.toContain("MCA");
  });

  it("P10 A → B → A does not revive A's proposal", () => {
    proposeImpressionFromCurrentFindings();
    useWorkspace.setState({
      ...emptyClinicalState(),
      activeStudyId: "study-B",
      activeStudyInstanceUID: "1.2.840.study-B",
      studies: [{ id: "study-B", patient: { name: "Patient B", sex: "M" }, modality: "CT" }],
      completedStudyIds: new Set<string>(),
    } as never);
    useWorkspace.setState({
      ...emptyClinicalState(),
      activeStudyId: "study-A",
      activeStudyInstanceUID: "1.2.840.study-A",
      studies: [{ id: "study-A", patient: { name: "Patient A", sex: "F" }, modality: "MR" }],
      completedStudyIds: new Set<string>(),
    } as never);
    const st = useWorkspace.getState();
    expect(st.ghostText).toBeNull();
    expect(st.ghostProposal).toBeNull();
    // Returning to A restored the findings from the study record, not from the
    // abandoned proposal; nothing is waiting to be accepted.
    expect(st.impressionText).toBe("");
  });

  it("P11/P12 navigation clears the proposal — the same reset covers the new binding", () => {
    proposeImpressionFromCurrentFindings();
    // The enumerated clinical-reset contract is the mechanism: a new key that is
    // not in it would survive a study switch, so this is asserted both ways.
    expect(CLINICAL_RESET_FIELDS).toContain("ghostProposal");
    expect(Object.keys(emptyClinicalState())).toContain("ghostProposal");
    expect(emptyClinicalState().ghostProposal).toBeNull();

    useWorkspace.setState({ ...emptyClinicalState(), activeStudyId: "study-B" } as never);
    expect(useWorkspace.getState().ghostText).toBeNull();
    expect(useWorkspace.getState().ghostProposal).toBeNull();
  });

  it("P11 Next and P12 Park clear the proposal through the real actions", () => {
    // The test above proves the helper covers the new key. These prove the two
    // navigation buttons a radiologist actually presses go through it, rather
    // than through some path that happens to spread the same object.
    const queue = [
      { id: "study-A", patient: { name: "Patient A", sex: "F" }, modality: "MR", tatMinutes: 10, priority: "routine" },
      { id: "study-B", patient: { name: "Patient B", sex: "M" }, modality: "CT", tatMinutes: 5, priority: "urgent" },
    ];

    for (const navigate of ["advanceToNextStudy", "parkStudy"] as const) {
      openStudyA();
      useWorkspace.setState({ studies: queue as never, activeStudyId: "study-A" } as never);
      proposeImpressionFromCurrentFindings();
      expect(useWorkspace.getState().ghostProposal).not.toBeNull();

      useWorkspace.getState()[navigate]();

      const st = useWorkspace.getState();
      expect(st.activeStudyId, `${navigate} did not move off study A`).not.toBe("study-A");
      expect(st.ghostText, `${navigate} left a ghost on screen`).toBeNull();
      expect(st.ghostProposal, `${navigate} left Patient A's context binding behind`).toBeNull();
      expect(st.ghostProposalStaleReason(), `${navigate} must leave nothing to accept`).toBe("unbound");
      // And nothing of A's report is sitting in B's fields.
      expect(st.findingsText).toBe("");
    }
  });

  it("P9b a binding that reaches study B by a route round the reset still refuses", () => {
    // The navigation tests above are the ordinary path. This is why the binding
    // exists as well as the reset: browser Back/Forward, or a click handler
    // holding the previous render, reaches acceptance without ever passing
    // through the helper — and the study pair inside the binding is what stops it.
    const binding = proposeImpressionFromCurrentFindings();
    useWorkspace.setState({ activeStudyId: "study-B", activeStudyInstanceUID: "1.2.840.study-B" } as never);
    useWorkspace.setState({ ghostText: IMPRESSION_FROM_X, ghostTextTarget: "impression", ghostProposal: binding } as never);
    expect(useWorkspace.getState().ghostProposalStale()).toBe(true);
    const before = useWorkspace.getState().impressionText;
    useWorkspace.getState().acceptGhostText();
    expect(useWorkspace.getState().impressionText).toBe(before);
  });

  it("P13 finalized between generation and acceptance refuses, and says why", () => {
    const binding = proposeImpressionFromCurrentFindings();
    expect(evaluateAiProposal(binding, currentAiProposalContext(useWorkspace.getState())).fresh).toBe(true);
    useWorkspace.setState({ isFinalized: true, finalizedStudyId: "study-A" } as never);
    const before = useWorkspace.getState().impressionText;
    useWorkspace.getState().acceptGhostText();
    expect(useWorkspace.getState().impressionText).toBe(before);
    // #838/#847's signed-state boundary is what refuses here — C2 does not
    // reimplement it, and the freshness verdict is still "fresh": the report was
    // signed, not the context changed. Two different answers, two different names.
    expect(evaluateAiProposal(binding, currentAiProposalContext(useWorkspace.getState())).fresh).toBe(true);
  });

  it("P14 a proposal with no binding, or an invalid target, fails closed", () => {
    // The type makes a proposal without a binding unrepresentable for producers,
    // but the store is reachable by direct setState in tests, in dev tools and in
    // any future code path — so the action itself refuses rather than trusting the
    // call sites.
    useWorkspace.setState({
      ghostText: "An unbound proposal.", ghostTextTarget: "impression", ghostProposal: null,
    } as never);
    const before = useWorkspace.getState().impressionText;
    useWorkspace.getState().acceptGhostText();
    expect(useWorkspace.getState().impressionText).toBe(before);
    expect(useWorkspace.getState().ghostProposalStaleReason()).toBe("unbound");

    // A binding aimed at a field that is not a narrative target is refused too:
    // #880 made the declared target authoritative and never re-derives it from
    // text, so an unusable target cannot be talked into existing.
    const st = useWorkspace.getState();
    const badTarget = aiProposalBindingForImpression(st, "technique" as never);
    useWorkspace.setState({
      ghostText: "A technique-shaped proposal.", ghostTextTarget: "technique", ghostProposal: badTarget,
    } as never);
    const verdict = evaluateAiProposal(badTarget, currentAiProposalContext(useWorkspace.getState()));
    expect(verdict.fresh).toBe(false);
    expect(verdict.reason).toBe("invalid-target");
    const beforeTechnique = useWorkspace.getState().techniqueText;
    useWorkspace.getState().acceptGhostText();
    expect(useWorkspace.getState().techniqueText).toBe(beforeTechnique);
  });

  it("P20 an accepted fresh AI Impression still cannot certify reconciliation (#880)", () => {
    // Proposal freshness (C2, "was this made from the current report?") and report
    // Impression freshness (#880, "does the Impression match the Findings?") are
    // different questions. A proposal that passes C2 must not start answering the
    // other one.
    useWorkspace.getState().setField("findings", FINDINGS_Y, { source: "manual" });
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    const binding = aiProposalBindingForImpression(useWorkspace.getState());
    useWorkspace.getState().setGhostText("Acute left MCA infarct.", "impression", binding);
    expect(useWorkspace.getState().ghostProposalStale()).toBe(false);
    useWorkspace.getState().acceptGhostText();
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
  });

  it("P21 the freshness gate does not override authorship protection (#878)", () => {
    const manual = "No acute infarct.";
    useWorkspace.getState().setField("impression", manual, { source: "manual" });
    proposeImpressionFromCurrentFindings("Acute infarct in the left MCA territory.");
    useWorkspace.getState().acceptGhostText();
    const impression = useWorkspace.getState().impressionText;
    expect(impression).toContain(manual);
    expect(impression).toContain("Acute infarct in the left MCA territory.");
    expect(impression).not.toBe("Acute infarct in the left MCA territory.");
  });

  it("P22 generating a proposal mutates no authoritative field", () => {
    const before = {
      findings: useWorkspace.getState().findingsText,
      impression: useWorkspace.getState().impressionText,
      recommendation: useWorkspace.getState().recommendationText,
      technique: useWorkspace.getState().techniqueText,
      needsRefresh: useWorkspace.getState().impressionNeedsRefresh,
      dirty: useWorkspace.getState().isDirty,
    };
    proposeImpressionFromCurrentFindings();
    const after = useWorkspace.getState();
    expect(after.findingsText).toBe(before.findings);
    expect(after.impressionText).toBe(before.impression);
    expect(after.recommendationText).toBe(before.recommendation);
    expect(after.techniqueText).toBe(before.technique);
    expect(after.impressionNeedsRefresh).toBe(before.needsRefresh);
    // A proposal is not an edit: it must not make the report dirty, because a
    // dirty report autosaves and an unaccepted sentence would reach the record.
    expect(after.isDirty).toBe(before.dirty);
  });

  it("P23 a proposal becoming stale mutates no authoritative field", () => {
    proposeImpressionFromCurrentFindings();
    const before = {
      impression: useWorkspace.getState().impressionText,
      needsRefresh: useWorkspace.getState().impressionNeedsRefresh,
    };
    useWorkspace.getState().setField("findings", "Completely different findings now.", { source: "manual" });
    expect(useWorkspace.getState().ghostProposalStale()).toBe(true);
    const after = useWorkspace.getState();
    expect(after.impressionText).toBe(before.impression);
    // Staleness is a verdict about the proposal, never a rewrite of the report.
    expect(after.impressionNeedsRefresh).not.toBe(before.needsRefresh);
    expect(after.impressionNeedsRefresh).toBe(true);
  });

  it("editing the target field itself does not falsely stale a findings-sourced proposal", () => {
    // The model was given the Findings, not the Impression (`field: "impression"`
    // sends reportBody only), so typing in the Impression box does not make the
    // proposal's reasoning older than the report. #878's non-destructive merge is
    // what protects the manual text on accept, and that is already tested — here
    // the risk is the opposite one: a gate so eager it refuses valid work.
    proposeImpressionFromCurrentFindings();
    useWorkspace.getState().setField("impression", "Correlate with the clinical examination.", { source: "manual" });
    expect(useWorkspace.getState().ghostProposalStale()).toBe(false);
    useWorkspace.getState().acceptGhostText();
    const impression = useWorkspace.getState().impressionText;
    expect(impression).toContain("Correlate with the clinical examination.");
    expect(impression).toContain("Acute left MCA infarct.");
  });

  it("P30 an older response cannot overwrite a newer proposal", () => {
    // Rapid Ctrl+I: request 1 starts, request 2 starts, request 2 answers first.
    // A late answer from request 1 must not replace the newer proposal — this is
    // the ordering half of the same lifecycle, and it is enforced where the
    // proposal is written, not in the hook, so no producer can bypass it.
    const first = useWorkspace.getState().beginAiProposalRequest();
    useWorkspace.getState().setField("findings", "Findings as they were for request 1.", { source: "manual" });
    const b1 = aiProposalBindingForImpression(useWorkspace.getState());
    const second = useWorkspace.getState().beginAiProposalRequest();
    expect(second).toBeGreaterThan(first);
    useWorkspace.getState().setField("findings", "Findings as they are for request 2.", { source: "manual" });
    const b2 = aiProposalBindingForImpression(useWorkspace.getState());

    useWorkspace.getState().setGhostText("Newer proposal.", "impression", { ...b2, requestSeq: second });
    expect(useWorkspace.getState().ghostText).toBe("Newer proposal.");
    useWorkspace.getState().setGhostText("Older proposal.", "impression", { ...b1, requestSeq: first });
    expect(useWorkspace.getState().ghostText).toBe("Newer proposal.");

    // A fresh generation is allowed again, and it is the newer one that wins.
    const third = useWorkspace.getState().beginAiProposalRequest();
    useWorkspace.getState().setGhostText("Third proposal.", "impression", { ...b2, requestSeq: third });
    expect(useWorkspace.getState().ghostText).toBe("Third proposal.");
    expect(useWorkspace.getState().ghostProposal?.requestSeq).toBe(third);
  });

  it("the request sequence is NOT cleared by a study switch", () => {
    // Deliberate, and the one reset-list exception in this file: the sequence is a
    // monotonic ordering, not clinical content. Resetting it to zero on navigation
    // would let a response still in flight from the previous study arrive as
    // "latest" and win.
    expect(CLINICAL_RESET_FIELDS).not.toContain("ghostRequestSeq");
    const seq = useWorkspace.getState().beginAiProposalRequest();
    useWorkspace.setState({ ...emptyClinicalState(), activeStudyId: "study-B" } as never);
    expect(useWorkspace.getState().ghostRequestSeq).toBeGreaterThanOrEqual(seq);
    const next = useWorkspace.getState().beginAiProposalRequest();
    expect(next).toBeGreaterThan(seq);
  });

  it("source contract: acceptance ends in the existing #880 boundary, not a copy of it", () => {
    const src = code(read("zai-workspace/store.ts"));
    // Anchored on the implementation's arrow body, not on the bare identifier:
    // `acceptGhostText:` appears first in the actions interface, and slicing from
    // there would assert about a type declaration instead of the code that writes.
    const start = src.indexOf("acceptGhostText: () => {");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("acknowledgeCopilotItem: (id)", start);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body.length).toBeGreaterThan(80);
    // The one write is the one boundary #880 owns, with the one source it uses.
    expect(body).toContain('mergeField(ghostTextTarget, ghostText, "ai-draft")');
    expect(body.match(/mergeField\(/g)).toHaveLength(1);
    // The gate is a call into the shared pure module, not a re-implementation of
    // staleness inside the store (which is how a second truth store gets born).
    expect(body).toContain("evaluateAiProposal");
    expect(body.match(/evaluateAiProposal/g)!.length).toBeLessThanOrEqual(1);
    // C2's verdict must not start answering #880's different question.
    expect(body).not.toContain("impressionNeedsRefresh");
    expect(body).not.toContain("needsRefresh");
    // No escape hatch: the refusal returns, it does not fall through to the write.
    expect(body).toContain("if (!verdict.fresh)");
  });

  it("source contract: the UI reads the same verdict instead of deciding its own", () => {
    const ghost = code(read("../components/radiology/reporting-canvas/GhostLayer.tsx"));
    // GhostLayer may disable a button from the shared evaluator or the store's
    // derived selector — both are calls into the one rule. What it may not do is
    // carry its own copy of the comparison, and it may never offer "accept anyway".
    expect(ghost).toContain("ghostProposal");
    expect(ghost).not.toContain("fingerprintAiProposalContext");
    expect(ghost.toLowerCase()).not.toMatch(/accept anyway|force accept|accept stale/i);
    // A stale suggestion renders WITHOUT an Accept button at all, so the escape
    // hatch is not merely discouraged but absent from that branch of the tree.
    expect(ghost).toMatch(/stale \? \(\s*<>\s*<p/);
    expect(ghost).toMatch(/data-testid="ghost-regenerate"/);
    expect(ghost).toMatch(/data-testid="ghost-discard"/);
    expect(ghost).toMatch(/Accept \(Tab\)/);
  });

  it("source contract: the Ctrl+I producer records its context before it asks", () => {
    const hook = code(read("../hooks/radiology-workspace/useTriggerAiImpression.ts"));
    // P16's in-flight drift only behaves if the binding describes the state at
    // REQUEST time. Asserted by order, because "read it later" looks identical
    // until a response lands after an edit — which is the case that matters.
    const claim = hook.indexOf("beginAiProposalRequest()");
    const post = hook.indexOf('api.post<AiDraftResponse>("');
    expect(claim).toBeGreaterThan(-1);
    expect(post).toBeGreaterThan(claim);
    expect(hook).toMatch(/const binding = \{[\s\S]*?aiProposalBindingForImpression\(/);
    expect(hook).toContain("requestSeq,");
    // The proposal is handed over WITH its binding; a bare two-argument call would
    // put an unbound suggestion back on screen, which is the pre-C2 shape.
    expect(hook).toMatch(/setGhostText\(res\.impression, "impression", binding\)/);
    expect(hook).not.toMatch(/setGhostText\([^,]+,\s*"[a-z]+"\s*\)/);
    // Arrival is classified, not assumed, and the existing study guard is kept
    // rather than duplicated into the fingerprint path.
    expect(hook).toContain("evaluateAiProposal");
    expect(hook).toContain("shouldApplyAsyncStudyKey");
  });

  it("source contract: the editor's deterministic completion is bound too", () => {
    const editor = code(read("../components/radiology/zai-workspace/findings-editor.tsx"));
    // Out-of-scope for C2 to decide whether a regex completion is "AI" — that is
    // #880's authorship question. In scope is that a suggestion reaching Tab
    // carries what it was generated from, so this producer is total, not just the
    // model path.
    expect(editor).toMatch(/aiProposalBindingForField\(useWorkspace\.getState\(\), narrative, narrative\)/);
    expect(editor).toMatch(/setGhost\(s, narrative, binding\)/);
    // Tab still goes through the store's boundary rather than deciding locally.
    expect(editor).toMatch(/if \(e\.key === "Tab" && gt && gTarget === field\) \{ e\.preventDefault\(\); accept\(\); return; \}/);
    expect(editor).not.toMatch(/mergeField/);
    // And a stale one stops looking acceptable in place.
    expect(editor).toContain("ghostProposalStale");
  });
});
