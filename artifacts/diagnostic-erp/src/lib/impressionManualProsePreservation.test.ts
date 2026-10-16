/**
 * PRIORITY 2 — hand-typed Findings prose must not become an Impression by itself.
 *
 * Measured on main (71e64219), in the unit path the workspace's own derived-
 * impression effect calls (`useWorkspaceClinicalUi.tsx` → `refreshImpressionFromLedger`):
 * a sentence typed into Findings that CARE's vocabulary does not carry is promoted
 * into the Conclusion by a character count. `isAbnormalFindingLine` asks
 * `assertsAbnormality` (which answers true for any sentence that names neither a
 * cue nor a normality), finds no cue, and falls through to `s.length > 24`. Two
 * clinically identical sentences therefore differ only by their spelling length:
 *
 *   "A small focus of gyral thickening is present."            → stays in Findings
 *   "A 6 mm area of gyral thickening is present along the left frontal convexity."
 *                                                              → appears in the signed Conclusion
 *
 * Nobody pressed anything for the second one. The effect that runs it is silent —
 * it fires whenever the Findings→Impression dependency moves and the Conclusion is
 * not radiologist-manual — so the sentence the doctor dictated as a *finding*
 * arrives in the *Conclusion* without an ask, and the doctor reads a Conclusion
 * they never wrote.
 *
 * These tests pin the boundary the brief requires: the automatic refresh concludes
 * only what it can name (a recognised abnormality, or a ledger row the doctor
 * explicitly selected), while the two controls the doctor presses — Generate
 * Impression and Refresh from Findings — keep summarising free text exactly as
 * they do today, because there the length default is the lesser evil: dropping
 * unknown dictated prose silently would be worse than surfacing it for review.
 *
 * The second half is the contradiction the same fallthrough creates: when every
 * leftover sentence reads normal, `generateLocalImpression` returns its canned
 * "No significant abnormality detected." — and the automatic path appends that
 * straight under a Conclusion that already carries an abnormality.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { useWorkspace } from "./zai-workspace/store";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { generateLocalImpression, isAbnormalFindingLine } from "./generateLocalImpression";
import { impressionProvenanceIsRadiologistManual } from "./impressionProvenance";

const FAZEKAS1 = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Fazekas 1")!;

/** Every `refreshImpressionFromLedger` call site in the workspace hook, as written. */
function UI_CLINICAL_CALL_SITES(): string[] {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  return src.match(/refreshImpressionFromLedger\([^\n]*\)/g) ?? [];
}

/** Same claim, different length. Only one of these is a "finding" today. */
const UNKNOWN_SHORT = "Gyral thickening noted.";
const UNKNOWN_LONG = "A 6 mm area of gyral thickening is present along the left frontal convexity.";

/** A finding CARE's cue list does name, typed by hand rather than clicked. */
const CUED_HAND_TYPED = "A 2 cm ring-enhancing lesion is present in the left temporal lobe.";

/** Prose that reads normal, which is what earns the canned fallback. */
const NORMAL_READING = "The pituitary gland is normal in size and signal.";

const GENERIC_NORMAL_FALLBACK = "No significant abnormality detected.";

function resetBrain() {
  useWorkspace.setState({
    reportingContext: buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI Brain Plain",
      regions: ["Brain"],
      source: "auto",
    }),
    reportFormats: DEFAULT_REPORT_FORMATS,
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    appliedPathologyPatches: [],
    fieldProvenance: {},
    impressionNeedsRefresh: false,
    impressionOrderFrozen: false,
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    appliedFormatReportTitle: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
  });
}

/** The Quick Select path a tile click takes, minus the format scaffold. */
function overlayTile(tile: typeof FAZEKAS1, id: string) {
  useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: tile.sentence, impression: tile.impressionSentence },
    templates: { findings: tile.sentence, impression: tile.impressionSentence },
    ownership: {
      anatomicalSection: tile.anatomicalSection,
      conflictGroup: tile.conflictGroup,
      baselineReplaces: tile.baselineReplaces,
    },
    source: "quick-select",
    id,
    region: tile.scopeBodyPart,
    label: tile.label,
    findingsText: tile.sentence,
    properties: tile.properties,
  });
}

function typeIntoFindings(text: string) {
  const current = useWorkspace.getState().findingsText;
  useWorkspace.getState().setField("findings", current ? `${current}\n${text}` : text);
}

/** What the derived-impression effect runs, with no press behind it. */
function runAutomaticRefresh() {
  useWorkspace.getState().refreshImpressionFromLedger({ automatic: true });
}

/** What the two controls the radiologist presses run. */
function runExplicitRefresh() {
  useWorkspace.getState().refreshImpressionFromLedger();
}

function impressionLines(): string[] {
  return useWorkspace.getState().impressionText
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Sentences of any field text, across both its line and its period breaks. */
function sentencesOf(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("the length rule is the whole mechanism", () => {
  it("two identical claims differ only by character count", () => {
    // Not a clinical distinction: neither sentence is denied, and neither names a
    // cue. `isAbnormalFindingLine` answers on `s.length > 24`, so the shorter one
    // is a finding nobody concludes and the longer one is a finding everyone does.
    expect(UNKNOWN_SHORT.length).toBeLessThanOrEqual(24);
    expect(UNKNOWN_LONG.length).toBeGreaterThan(24);
    expect(isAbnormalFindingLine(UNKNOWN_SHORT)).toBe(false);
    expect(isAbnormalFindingLine(UNKNOWN_LONG)).toBe(true);
  });
});

describe("A — the automatic refresh never concludes prose it cannot name", () => {
  beforeEach(resetBrain);

  it("unknown typed prose stays out of the Impression", () => {
    overlayTile(FAZEKAS1, "qf-f1");
    const before = useWorkspace.getState().findingsText;
    typeIntoFindings(UNKNOWN_LONG);
    runAutomaticRefresh();

    const lines = impressionLines();
    // This is the defect: today the typed sentence sits in the Conclusion.
    expect(lines.some((l) => l.includes("gyral thickening"))).toBe(false);
    expect(lines.some((l) => /frontal convexity/i.test(l))).toBe(false);

    // Nothing was discarded. The sentence is still exactly where it was written.
    expect(useWorkspace.getState().findingsText).toBe(`${before}\n${UNKNOWN_LONG}`);
  });

  it("the same prose reaches the Impression when the radiologist presses Refresh", () => {
    // The explicit controls keep today's behaviour, and this pins why: dropping
    // unknown dictated prose silently would be worse than surfacing it for review.
    overlayTile(FAZEKAS1, "qf-f1");
    typeIntoFindings(UNKNOWN_LONG);
    runExplicitRefresh();

    expect(impressionLines().some((l) => /gyral thickening/i.test(l))).toBe(true);
  });

  it("a hand-typed abnormality CARE does recognise is still concluded automatically", () => {
    // The gate is about what CARE can name, not about who typed it. A lesion is a
    // lesion whether it came from a tile or the keyboard, and swallowing it from
    // the Conclusion would be the same clinical loss in the other direction.
    overlayTile(FAZEKAS1, "qf-lesion");
    typeIntoFindings(CUED_HAND_TYPED);
    runAutomaticRefresh();

    const lines = impressionLines();
    expect(lines.some((l) => /ring-enhancing lesion/i.test(l))).toBe(true);
  });

  it("an explicitly selected abnormality keeps its own deterministic Conclusion line", () => {
    overlayTile(FAZEKAS1, "qf-f1");
    typeIntoFindings(UNKNOWN_LONG);
    runAutomaticRefresh();

    const lines = impressionLines();
    expect(lines.filter((l) => /fazekas/i.test(l))).toHaveLength(1);
    expect(lines.filter((l) => /gyral thickening/i.test(l))).toHaveLength(0);
  });

  it("manual Findings prose survives the automatic refresh byte-for-byte", () => {
    overlayTile(FAZEKAS1, "qf-f1");
    typeIntoFindings(UNKNOWN_LONG);
    typeIntoFindings(NORMAL_READING);
    const findings = useWorkspace.getState().findingsText;
    runAutomaticRefresh();
    expect(useWorkspace.getState().findingsText).toBe(findings);
  });

  it("refusing the prose leaves the Impression marked as needing a refresh", () => {
    // The point of not copying is not to hide. `refreshImpressionFromLedger`
    // re-bases the Findings→Impression dependency every time it runs, which is
    // right for a press and wrong for a refusal: the banner would go quiet on a
    // Conclusion that now demonstrably does not cover a finding the doctor typed.
    // Left armed, the amber "Impression needs refresh" appears, the sign dialog
    // asks, and one press does what the automatic path would not.
    overlayTile(FAZEKAS1, "qf-f1");
    useWorkspace.setState({ impressionNeedsRefresh: false });
    typeIntoFindings(UNKNOWN_LONG);
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);

    runAutomaticRefresh();

    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    expect(useWorkspace.getState().impressionDependencyReasons).toContain("findings-changed");
    expect(impressionLines().some((l) => /gyral thickening/i.test(l))).toBe(false);
  });

  it("the press that takes the prose also clears the signal it was made for", () => {
    overlayTile(FAZEKAS1, "qf-f1");
    useWorkspace.setState({ impressionNeedsRefresh: false });
    typeIntoFindings(UNKNOWN_LONG);

    runExplicitRefresh();

    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
    expect(impressionLines().some((l) => /gyral thickening/i.test(l))).toBe(true);
  });

  it("when nothing was refused the signal rebases exactly as it always did", () => {
    // The anti-nag control. A refusal has to stay on screen; a refresh that took
    // everything it was given must not leave a banner the doctor cannot clear.
    overlayTile(FAZEKAS1, "qf-lesion");
    useWorkspace.setState({ impressionNeedsRefresh: false });
    typeIntoFindings(CUED_HAND_TYPED);

    runAutomaticRefresh();

    expect(impressionLines().some((l) => /ring-enhancing lesion/i.test(l))).toBe(true);
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
  });

  it("normal-reading prose is not a refusal either, so it does not nag", () => {
    overlayTile(FAZEKAS1, "qf-f1");
    useWorkspace.setState({ impressionNeedsRefresh: false });
    typeIntoFindings(NORMAL_READING);

    runAutomaticRefresh();

    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(false);
  });
});

describe("B — the canned normal never answers an abnormality", () => {
  beforeEach(resetBrain);

  it("a normal-reading leftover cannot append 'No significant abnormality detected.' to an abnormal Conclusion", () => {
    overlayTile(FAZEKAS1, "qf-f1");
    typeIntoFindings(NORMAL_READING);
    // Prove the fixture does what the brief says it does before asserting the fix:
    // the leftover is unexplained, reads normal, and earns the canned fallback.
    expect(generateLocalImpression(NORMAL_READING)).toEqual([GENERIC_NORMAL_FALLBACK]);

    runAutomaticRefresh();

    const lines = impressionLines();
    expect(lines.some((l) => /fazekas/i.test(l))).toBe(true);
    expect(lines.some((l) => l === GENERIC_NORMAL_FALLBACK)).toBe(false);
  });

  it("a purely normal report gets no normality conclusion invented for it", () => {
    // Behaviour change, and it is the one the brief asks for. "No significant
    // abnormality detected." is a clinical assertion of normality, and CARE's own
    // rule for those is that they need an attributable owner — which is why the
    // Quick Normal baselines carry a manifest. A sentence the system writes itself
    // under a Conclusion, because leftover prose happened to read normal, has no
    // such owner. The doctor can still have it, by pressing the control.
    typeIntoFindings(NORMAL_READING);
    typeIntoFindings(UNKNOWN_SHORT);

    runAutomaticRefresh();

    expect(impressionLines()).not.toContain(GENERIC_NORMAL_FALLBACK);
    runExplicitRefresh();
    expect(impressionLines()).toContain(GENERIC_NORMAL_FALLBACK);
  });

  it("the explicit press keeps printing what it prints today", () => {
    overlayTile(FAZEKAS1, "qf-f1");
    typeIntoFindings(NORMAL_READING);
    runExplicitRefresh();
    expect(impressionLines().some((l) => /fazekas/i.test(l))).toBe(true);
  });
});

describe("C — what the radiologist wrote is theirs", () => {
  beforeEach(resetBrain);

  it("a hand-authored Impression is not touched by the automatic refresh", () => {
    // Checked at the action, not at the one caller that happens to check it: an
    // automatic refresh is automatic wherever it starts from.
    overlayTile(FAZEKAS1, "qf-f1");
    const authored = "No acute infarction. Chronic small vessel disease only.";
    useWorkspace.getState().setField("impression", authored);
    expect(impressionProvenanceIsRadiologistManual(useWorkspace.getState().fieldProvenance.impression)).toBe(true);
    typeIntoFindings(UNKNOWN_LONG);

    runAutomaticRefresh();

    expect(useWorkspace.getState().impressionText).toBe(authored);
  });

  it("an automatic refresh leaves nothing of the draft identity behind for a reopen to lose", () => {
    // Save/reopen is proven in the browser; here the requirement is that the
    // refresh is not silently destructive: the ledger row and the typed sentence
    // both stay in state, so the next serialize writes the same report.
    overlayTile(FAZEKAS1, "qf-f1");
    typeIntoFindings(UNKNOWN_LONG);
    const patchesBefore = useWorkspace.getState().appliedPathologyPatches.length;
    const findingsBefore = useWorkspace.getState().findingsText;

    runAutomaticRefresh();

    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches).toHaveLength(patchesBefore);
    expect(patches[0].templates.findings).toBe(FAZEKAS1.sentence);
    expect(useWorkspace.getState().findingsText).toBe(findingsBefore);
    expect(impressionLines().some((l) => /fazekas/i.test(l))).toBe(true);
  });

  it("a tile clicked after a hand-written Impression adds its own line and deletes nothing", () => {
    // This is requirement 5 meeting requirement 7, and both hold: the selected
    // abnormality brings its deterministic Conclusion line, and every sentence the
    // doctor wrote is still there. What changes is only that CARE keeps an
    // Impression as one sentence per line, so a hand-written line carrying two
    // sentences is stored as two — compare by sentence, never by raw string.
    const authored = "No acute infarction. Chronic small vessel disease only.";
    useWorkspace.getState().setField("impression", authored);
    expect(
      impressionProvenanceIsRadiologistManual(useWorkspace.getState().fieldProvenance.impression),
    ).toBe(true);

    overlayTile(FAZEKAS1, "qf-f1");

    const after = useWorkspace.getState().impressionText;
    for (const sentence of authored.split(/(?<=\.)\s+/)) {
      expect(sentencesOf(after)).toContain(sentence);
    }
    expect(sentencesOf(after).filter((s) => /fazekas/i.test(s))).toHaveLength(1);
  });
});

describe("D — which call sites are silent and which are a press", () => {
  it("the derived-impression effect refreshes as automatic; the two controls still press", () => {
    // Everything above is asserted against the store action, which is the right
    // place — but the defect the brief confirms arrives through the effect, so the
    // effect's own call site is pinned here. Counted over the whole file rather
    // than sliced, because a slice that silently matched nothing would pass.
    const sites = UI_CLINICAL_CALL_SITES();
    // Positive control: the three call sites this file knows about are all there.
    expect(sites).toHaveLength(3);
    expect(sites.filter((s) => s.includes("automatic: true"))).toHaveLength(1);
    expect(sites.filter((s) => /refreshImpressionFromLedger\(\)/.test(s))).toHaveLength(2);
  });
});
