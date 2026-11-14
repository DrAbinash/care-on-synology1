/**
 * Item 4 — the reconciliation a Quick Select answer performs has to be readable
 * BEFORE the answer, not after it.
 *
 * REPRODUCED on `ba207aa62` by pressing a shipped tile over prose the radiologist
 * owns, with the real store and the real catalogue:
 *
 *   Findings  "… The ventricular system is dilated."   (his own sentence)
 *   Impression "Ventriculomegaly."
 *   press "Normal ventricles" → verdict "pending" — and the dialog offers REMOVE
 *   and ADD for the Findings only. Answer Replace and the Impression becomes
 *
 *     Ventriculomegaly.
 *     Ventricles and cisternal spaces are normal.
 *     No hydrocephalus.
 *
 *   i.e. the Conclusion the clinic prints now asserts a thing and its own
 *   negation, `impressionNeedsRefresh` reads FALSE (so nothing warns), and the
 *   only way to learn it was to look at the report afterwards. The tile's
 *   conclusion lines JOIN the ones on the page; they do not replace them, and the
 *   dialog never said so.
 *
 * The fix parks the answer's own Impression text on the pending patch —
 * `conclusionPreview: { from, to }` — and the dialog renders it line by line,
 * marking each "stays" or "new".
 *
 * It is NOT a second derivation. The pending branch already ran the overlay as a
 * pure probe to decide whether to ask; the preview is that same `runOverlay`
 * closure, called on the same inputs the commit calls it on — including the page
 * the system-normal yield leaves, which is why the yield's DECISION moved above
 * the gate while its WRITE stays below (Priority 1 is untouched: a click that is
 * about to ask still writes nothing, and a cancel is still a pure dismissal).
 * Every §2 test below asserts `preview.to === impressionText` after the real
 * answer, so a preview that drifts from the write fails here rather than in the
 * clinic.
 *
 * Deliberately NOT done: no new clinical-truth derivation, no change to what the
 * overlay decides or writes, no change to `refreshImpressionFromLedger` or the
 * `ai-draft`/manual impression-freshness rules, no contradiction detector invented
 * (the dialog shows the lines and their provenance-by-label; reading them as a
 * contradiction stays the radiologist's judgement, which is the ruling this repo
 * already makes about the Impression), and no auto-edit of a Conclusion.
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
import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";
import { quickSelectTilePatch } from "@/lib/zai-workspace/quickSelectTileFixture";
import { SYSTEM_NORMAL_IMPRESSION_TEXT } from "@/lib/conceptCanon/normalImpression";
import { normalizeForDedupe } from "@/lib/reportFieldMerge";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8").replace(/\r\n/g, "\n");
const commentFree = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/(\s)\/\/[^/\n]*$/gm, "$1");

const S = () => useWorkspace.getState();

const tile = (label: string) => {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
};

function open(id: string) {
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

/** The one payload a real tile click sends, optionally answered with force. */
const press = (label: string, over: { force?: boolean } = {}) =>
  S().applyPathologyOverlay({ ...quickSelectTilePatch(tile(label), "findings"), ...over });

/** Everything a HOLD must leave untouched. */
const clinicalPage = () => {
  const s = S();
  return JSON.stringify({
    findings: s.findingsText,
    impression: s.impressionText,
    technique: s.techniqueText,
    recommendation: s.recommendationText,
    prov: s.fieldProvenance,
    rows: s.appliedPathologyPatches.map((p) => [p.id, p.lastRendered.findings, p.lastRendered.impression]),
    needsRefresh: s.impressionNeedsRefresh,
    dirty: s.isDirty,
  });
};

const lines = (text: string) => text.split(/\n+/).map((s) => s.trim()).filter(Boolean);

beforeEach(() => {
  vi.restoreAllMocks();
  open("study-4");
});

// ─────────────────────────────────────────────────────────────────────────────
// §1 The defect, closed: the answer's Conclusion is on the patch before the answer.
// ─────────────────────────────────────────────────────────────────────────────
describe("§1 the HOLD names the Conclusion its answer writes", () => {
  it("an owned ventriculomegaly sentence held the click, and now shows what Replace does", () => {
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    S().setField("impression", "Ventriculomegaly.", { source: "manual" });
    useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);

    expect(press("Normal ventricles")).toBe("pending");
    const preview = S().pendingPathologyPatch?.conclusionPreview;
    expect(preview, "the pending patch must carry the answer's Conclusion").toBeTruthy();
    expect(preview!.from).toBe("Ventriculomegaly.");
    // The honest, uncomfortable content: his line stays and the tile's negation
    // joins it. That is the fact the dialog used to hide.
    expect(preview!.to).toContain("Ventriculomegaly.");
    expect(preview!.to).toContain("No hydrocephalus.");
  });

  it("and the answer performs exactly the reconciliation it showed", () => {
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    S().setField("impression", "Ventriculomegaly.", { source: "manual" });
    useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);

    expect(press("Normal ventricles")).toBe("pending");
    const shown = S().pendingPathologyPatch?.conclusionPreview?.to ?? "";
    press("Normal ventricles", { force: true });
    expect(S().impressionText).toBe(shown);
  });

  it("and the dialog's own answer reaches the same text as a raw approved press", () => {
    // The button he presses is `confirmOverwriteAndApply()`, which replays the pending
    // patch with `force: true` AND its same-slot extras (`level`, `concept`, `label`),
    // so it is not literally the press the tests above make. The preview has to hold on
    // the door the clinic uses, not on a synthetic one.
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    S().setField("impression", "Ventriculomegaly.", { source: "manual" });
    useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);

    expect(press("Normal ventricles")).toBe("pending");
    const shown = S().pendingPathologyPatch?.conclusionPreview?.to ?? "";
    expect(shown).toBeTruthy();
    S().confirmOverwriteAndApply();
    expect(S().impressionText).toBe(shown);
    expect(S().pendingPathologyPatch).toBeFalsy();
  });

  it("a click that changes no Conclusion says so instead of printing the same list twice", () => {
    // The tile's own wording is already on the page, on its own lines, in the
    // radiologist's hand. Replace then moves the Findings and leaves the Conclusion
    // exactly where it was — and the dialog must not render the same list twice and
    // call it a change. This is the case the "unchanged" arm exists for.
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    S().setField("impression", "Ventricles and cisternal spaces are normal.\nNo hydrocephalus.", { source: "manual" });
    useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);

    expect(press("Normal ventricles")).toBe("pending");
    const preview = S().pendingPathologyPatch?.conclusionPreview;
    expect(preview!.from).toBe(preview!.to);
    press("Normal ventricles", { force: true });
    expect(S().impressionText).toBe(preview!.to);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 preview === write, on every path that can arm the dialog.
// ─────────────────────────────────────────────────────────────────────────────
describe("§2 the preview is the write, not an opinion about it", () => {
  const scenario = (label: string, setup: () => void) => {
    it(label, () => {
      open(`study-${normalizeForDedupe(label).slice(0, 24)}`);
      setup();
      useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);
      expect(press("Normal ventricles")).toBe("pending");
      const preview = S().pendingPathologyPatch?.conclusionPreview;
      expect(preview).toBeTruthy();
      press("Normal ventricles", { force: true });
      expect(S().impressionText, `the answer must match the shown Conclusion for: ${label}`).toBe(preview!.to);
    });
  };

  scenario("owned Findings sentence, manual Impression", () => {
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    S().setField("impression", "Ventriculomegaly.", { source: "manual" });
  });

  scenario("owned Findings sentence, template Impression", () => {
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    S().setField("impression", "Some template normal.", { source: "template" });
  });

  scenario("dictated Findings sentence", () => {
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "radiologist-voice" });
    S().setField("impression", "Ventriculomegaly.", { source: "radiologist-voice" });
  });

  scenario("system normal seeded — the yield is decided above the gate, written below", () => {
    S().seedSystemNormalImpression();
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    expect(S().impressionText).toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  scenario("empty Impression", () => {
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    S().setField("impression", "", { source: "manual" });
  });

  // The layout half of the answer, where a preview built from the raw overlay output
  // would have been wrong: the commit ends with the priority/rejoin pass, so a
  // statement authored as one line can arrive as two (and a two-line field can leave
  // as two). Both of these are that case, and both previews carry it.
  scenario("the tile's own wording hand-written as ONE statement", () => {
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    S().setField("impression", "Ventricles and cisternal spaces are normal. No hydrocephalus.", { source: "manual" });
  });

  scenario("a second normal above the tile's wording", () => {
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    S().setField("impression", "Normal study.\nVentricles and cisternal spaces are normal. No hydrocephalus.", { source: "manual" });
  });

  it("a same-slot upgrade asks too, and its preview covers the row it vacates", () => {
    S().setField("findings", "The study is technically adequate.", { source: "manual" });
    S().setField("impression", "Normal study.", { source: "template" });
    useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);
    expect(press("Normal ventricles")).toBe("applied");
    const v = press("Hydrocephalus");
    const pending = S().pendingPathologyPatch;
    // Whether this second click asks or simply replaces is the store's decision, not
    // this test's assumption; the rule under test is only that a click which DOES ask
    // shows the answer it will perform.
    if (v === "pending") {
      expect(pending?.conclusionPreview).toBeTruthy();
      press("Hydrocephalus", { force: true });
      expect(S().impressionText).toBe(pending!.conclusionPreview!.to);
    } else {
      expect(pending).toBeFalsy();
    }
  });

  it("no shipped findings tile is left with a preview that contradicts its own answer", () => {
    // The sweep the scenario list above cannot be: every box on the strip, over
    // prose the radiologist owns, with the HOLD's shown Conclusion compared with
    // the one the answer writes. Tiles that do not ask are not this item's path.
    const asked: string[] = [];
    for (const t of DEFAULT_QUICK_SELECT_TILES) {
      if (t.field !== "findings") continue;
      open(`sweep-${t.id}`);
      S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
      S().setField("impression", "Ventriculomegaly.", { source: "manual" });
      useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);
      if (press(t.label) !== "pending") continue;
      const shown = S().pendingPathologyPatch?.conclusionPreview?.to;
      expect(shown, `${t.label} asked without a Conclusion preview`).toBeDefined();
      press(t.label, { force: true });
      if (S().impressionText !== shown) asked.push(t.label);
    }
    expect(asked, `answers that did not match their shown Conclusion: ${asked.join(" | ")}`).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 Priority 1 survives the preview: asking still writes nothing.
// ─────────────────────────────────────────────────────────────────────────────
describe("§3 the HOLD still writes nothing while it shows the answer", () => {
  it("a pending click with a Conclusion preview leaves the report byte-identical", () => {
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    S().setField("impression", "Ventriculomegaly.", { source: "manual" });
    useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);
    const before = clinicalPage();
    expect(press("Normal ventricles")).toBe("pending");
    expect(S().pendingPathologyPatch?.conclusionPreview).toBeTruthy();
    expect(clinicalPage()).toBe(before);
  });

  it("and with a system normal on the page, cancelling still restores the same bytes", () => {
    S().seedSystemNormalImpression();
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);
    const before = clinicalPage();
    expect(press("Normal ventricles")).toBe("pending");
    // The yield decision ran while composing the preview; it must not have written.
    expect(S().impressionText).toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
    S().cancelOverwrite();
    expect(clinicalPage()).toBe(before);
  });

  it("Keep existing is the answer the preview promises: the report does not move", () => {
    S().setField("findings", "The study is technically adequate. The ventricular system is dilated.", { source: "manual" });
    S().setField("impression", "Ventriculomegaly.", { source: "manual" });
    useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);
    const before = clinicalPage();
    press("Normal ventricles");
    S().cancelOverwrite();
    expect(clinicalPage()).toBe(before);
    expect(S().impressionText).toBe("Ventriculomegaly.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 The payload is not enough — the dialog has to render it.
// ─────────────────────────────────────────────────────────────────────────────
describe("§4 the dialog renders the shown Conclusion", () => {
  const dialog = commentFree(read("../components/radiology/zai-workspace/confirm-overwrite-dialog.tsx"));

  it("it reads the pending preview rather than re-deriving one", () => {
    expect(dialog).toContain("pendingPatch?.conclusionPreview");
    expect(dialog).toContain('data-testid="replace-conclusion-preview"');
    expect(dialog).toContain('data-testid="replace-conclusion-line"');
    expect(dialog).toContain('data-testid="replace-conclusion-unchanged"');
    expect(dialog).toContain('r.stays ? "stays" : "new"');
  });

  it("and it does not smuggle in a second Impression derivation", () => {
    // The dialog must stay a reader. A component that called the ledger refresh or
    // the preview action here would be a second author of the report's meaning.
    expect(dialog).not.toContain("refreshImpressionFromLedger");
    expect(dialog).not.toContain("previewImpressionFromLedger");
    expect(dialog).not.toContain("generateLocalImpression");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 The store's side of the contract.
// ─────────────────────────────────────────────────────────────────────────────
describe("§5 the preview is the commit's own composition", () => {
  const store = commentFree(read("zai-workspace/store.ts"));
  const holdBranch = (() => {
    const start = store.indexOf('if ((result.ambiguous || needsSlotConfirm) && !opts.force) {');
    expect(start).toBeGreaterThan(-1);
    const end = store.indexOf('return "pending";', start);
    return store.slice(start, end > start ? end : start + 3000);
  })();

  it("the pending branch composes the answer with the same runOverlay the commit calls", () => {
    expect(holdBranch).toContain("runOverlay(");
    expect(holdBranch).toContain("conclusionPreview");
    expect(holdBranch).toContain("answerPage.narrative.impression");
  });

  it("and with the same layout pass the commit ends with", () => {
    // The overlay is not the last writer: `orderImpressionByPriority()` rejoins each
    // live row's authored statement and sorts the Conclusion, so a preview built from
    // the raw overlay output shows lines the report never prints (measured before this
    // pin: every §2 scenario). One layout function now has two callers.
    expect(holdBranch).toContain("layOutImpression(");
    expect(store).toContain("const next = layOutImpression(");
    // …and the commit's two early returns, which skip that pass, are mirrored.
    expect(holdBranch).toContain("impressionOrderFrozen");
    expect(holdBranch).toContain("yieldRefusedByManual");
  });

  it("and the only writes on that path are the dialog flags", () => {
    // Priority 1 ratchet: the preview must not become a reason to write prose.
    const setCall = holdBranch.slice(holdBranch.indexOf("set({"));
    expect(setCall).toContain("confirmOverwriteOpen: true");
    // Only the object's OWN keys are writes. `findingsText:` appears deeper inside, as
    // the same-slot dialog copy the ConfirmOverwriteDialog reads — it is data about the
    // question, not a report field.
    const ind = (setCall.match(/\n( +)[a-zA-Z]\w*:/) ?? ["", "", ""])[1].length;
    const topKeys = [...setCall.matchAll(new RegExp(`^ {${ind}}([a-zA-Z]\\w*):`, "gm"))].map((m) => m[1]);
    expect(topKeys.sort()).toEqual(["confirmOverwriteOpen", "pendingPathologyPatch"]);
    expect(setCall).not.toContain("impressionText:");
    expect(setCall).not.toContain("fieldProvenance:");
    expect(setCall).not.toContain("appliedPathologyPatches:");
  });

  it("the yield decision moved up; its write did not", () => {
    const decisionAt = store.indexOf("yieldedBase = {");
    const gateAt = store.indexOf('if ((result.ambiguous || needsSlotConfirm) && !opts.force) {');
    const writeAt = store.indexOf("impressionText: yieldedBase.narrative.impression");
    expect(decisionAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(decisionAt).toBeLessThan(gateAt);
    expect(writeAt).toBeGreaterThan(gateAt);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 Unrelated promises this change must not have disturbed.
// ─────────────────────────────────────────────────────────────────────────────
describe("§6 the fences that already existed still hold", () => {
  it("an abnormal still withdraws the seeded system normal on the commit path", () => {
    S().seedSystemNormalImpression();
    S().setField("findings", "The study is technically adequate.", { source: "manual" });
    useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);
    const v = press("Hydrocephalus");
    expect(v).toBe("applied");
    expect(S().impressionText).not.toContain(SYSTEM_NORMAL_IMPRESSION_TEXT);
  });

  it("a manual normal Conclusion is still not withdrawn by a tile click", () => {
    S().setField("findings", "The study is technically adequate.", { source: "manual" });
    S().setField("impression", "Normal MRI of the brain.", { source: "manual" });
    useWorkspace.setState({ impressionNeedsRefresh: false, isDirty: false } as never);
    press("Hydrocephalus");
    expect(S().impressionText).toContain("Normal MRI of the brain.");
  });
});
