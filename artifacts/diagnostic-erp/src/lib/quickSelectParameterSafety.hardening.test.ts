/**
 * B-09 — a Quick Select tile may write a resolved clinical statement, or it may
 * write nothing. It must never write a sentence that still contains a parameter
 * the radiologist did not supply.
 *
 * Measured before this PR existed (probe against the real store at `641f5a90`),
 * clicking the shipped tile "Acute infarct (DWI)" wrote, verbatim:
 *
 *   Findings   "Restricted diffusion in the {side} MCA territory on DWI/ADC…"
 *   Impression "Acute {side} MCA territory infarct."
 *   Ledger     lastRendered.findings / lastRendered.impression — same braces
 *
 * and returned "applied", so the tile counted as a use, the after-pick feedback
 * fired, and a silent draft save followed. Three of the ten affected tiles are
 * `category: "critical"` (acute infarct, basal ganglia hemorrhage, acute
 * hemorrhage), so the braces sit in the sentence a stroke or haemorrhage report
 * is signed with. The Quick Select strip has always had a substitution path
 * (`applySideToIncoming`) and always had an explicit laterality control in the
 * sibling Clinic Quick Select panel — the strip simply never carried the value
 * across, so the path no-opped (`if (!side) return incoming`) and the template
 * reached the page as written.
 *
 * What is fixed here, and what is deliberately NOT:
 *
 * - The guard sits at the shared clinical-application boundary every Quick Select
 *   write already passes through (`applyPathologyOverlay`), before its first
 *   `set()`, so there is no partial apply: no prose, no ledger row, no undo
 *   frame, no dirty flag, and a "pending" same-slot overwrite is not consumed.
 * - Nothing is deleted, blanked or defaulted. `{side}` never becomes "" and
 *   never becomes "left": either the radiologist chose, or the write refuses.
 *   T4 pins the `{severity}` case specifically, because the existing engine
 *   *silently deletes* an unfilled `{severity}` when the same template also
 *   carries `{side}` — a tile that asks "how severe?" must not answer by
 *   removing the question.
 * - `mergeField` / `setField` are NOT guarded, and T7 pins why: the text a
 *   radiologist types is first-class, including braces they meant as a blank
 *   (`___`) or as their own shorthand. Refusing those would be the defect the
 *   spec calls "blocking legitimate radiologist braces".
 *
 * Out of scope, with evidence: `structured-template` writes reach the same
 * boundary with `{level}`/`{effect}` and are NOT a Quick Select source
 * (`isQuickSelectSource` is false for them), so this guard deliberately leaves
 * what Structured Reporting writes untouched — a different contract.
 *
 * What this PR ADDS on top of the original B-09 scope (T8/T9): the out-of-band
 * placeholder hole the declaration-only audit missed. A `{size}`, `{location}`,
 * `{volume}`, `{swelling}`, `{grade}` or `{vessel}` — a token the side/severity
 * chips never offer and `fillTemplate` never substitutes — is now refused at the
 * boundary for every Quick Select source (`quick-select`, `macro`,
 * `quick-findings`), rather than printed. The canvas strip routes the boxes that
 * declare such a token to the existing structured dialog (which substitutes them)
 * so a real box still applies; a box that carries one it cannot answer is refused,
 * not leaked. See quickSelectStructuredSubstitution.test.ts and
 * quickSelectStripStructuredRouting.test.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({ id: "t", dismiss: () => {}, update: () => {} })),
  useToast: vi.fn(),
}));

import { toast } from "@/hooks/use-toast";
import { DEFAULT_QUICK_SELECT_TILES } from "@/lib/zai-workspace/quick-select-library";
import { quickFindingPatch } from "@/lib/zai-workspace/quickSelectTilePayload";
import { quickSelectTilePatch } from "@/lib/zai-workspace/quickSelectTileFixture";
import { emptyClinicalState } from "@/lib/zai-workspace/clinicalStateReset";
import {
  isQuickSelectSource,
  QUICK_SELECT_PARAMETER_SOURCES,
  quickSelectParametersIn,
  unresolvedQuickSelectParameters,
  unresolvedQuickSelectPlaceholders,
} from "@/lib/zai-workspace/quickSelectParameterContract";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import type { Side } from "@/lib/sideSwap";

const here = dirname(fileURLToPath(import.meta.url));
function code(rel: string): string {
  return readFileSync(join(here, rel), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}
const storeCode = code("zai-workspace/store.ts");
const stripCode = code("../components/radiology/zai-workspace/quick-select-strip.tsx");

const brainContext = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
});
const lsContext = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine", regions: ["LS Spine"], source: "auto",
});

function tile(label: string) {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`shipped tile missing: ${label}`);
  return found;
}
/** The three-sentence critical tile that started this: `{side}` in Findings AND Impression. */
const INFARCT = tile("Acute infarct (DWI)");
/** `{severity} {side} …` — the only shipped tile that asks for a severity. */
const FORAMINAL = tile("Foraminal stenosis L4-L5");
/** No parameter at all: the control that proves the guard is not a blanket refusal. */
const PLAIN = tile("Normal brain parenchyma");

function reset(context = brainContext()) {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportingContext: context,
    studies: [{ id: "study-1", patient: { name: "Test Patient", sex: "F" }, modality: "MR" }],
    activeStudyId: "study-1",
    activeStudyInstanceUID: "1.2.840.TEST",
    completedStudyIds: new Set<string>(),
  } as never);
  toastMock.mockClear();
}

/** Everything a refused click must leave exactly where it was. */
function clinicalState() {
  const s = useWorkspace.getState();
  return {
    clinicalHistoryText: s.clinicalHistoryText,
    techniqueText: s.techniqueText,
    findingsText: s.findingsText,
    impressionText: s.impressionText,
    recommendationText: s.recommendationText,
    fieldProvenance: JSON.parse(JSON.stringify(s.fieldProvenance)),
    appliedPathologyPatches: JSON.parse(JSON.stringify(s.appliedPathologyPatches)),
    voiceComposerObservations: JSON.parse(JSON.stringify(s.voiceComposerObservations)),
    pendingPathologyPatch: JSON.parse(JSON.stringify(s.pendingPathologyPatch ?? null)),
    selectedObservationId: s.selectedObservationId,
    isDirty: s.isDirty,
    undoDepth: s.patchUndoStack.length,
    impressionNeedsRefresh: s.impressionNeedsRefresh,
    notification: JSON.parse(JSON.stringify(s.notification ?? null)),
    measurements: JSON.parse(JSON.stringify(s.measurements)),
    lastMergeResult: JSON.parse(JSON.stringify(s.lastMergeResult ?? null)),
  };
}

/** One click on a shipped catalogue entry, through the production payload builder. */
function click(label: string, params?: { side?: Side | ""; severity?: string }) {
  const t = tile(label);
  return useWorkspace.getState().applyPathologyOverlay(
    quickSelectTilePatch(t, "findings", params),
  );
}

const toastMock = vi.mocked(toast);
const SUPPORTED_TOKENS = ["{side}", "{severity}", "{chronicity}", "{level}", "{value}"];

function textsNow(): string[] {
  const s = useWorkspace.getState();
  const ledger = s.appliedPathologyPatches.flatMap((p) => [
    p.lastRendered.findings, p.lastRendered.impression, p.lastRendered.recommendation,
    p.observation?.findingsText ?? "",
  ]);
  return [s.findingsText, s.impressionText, s.recommendationText, ...ledger];
}

beforeEach(() => { vi.restoreAllMocks(); reset(); });

// ─────────────────────────────────────────────────────────────────────────────
// T1 / T2 — the unresolved tile is refused before anything is touched.
// ─────────────────────────────────────────────────────────────────────────────
describe("T1/T2 — laterality required but absent: refuse, and refuse completely", () => {
  it("refuses the shipped `{side}` tile instead of writing the braces", () => {
    const before = clinicalState();
    expect(click("Acute infarct (DWI)")).toBe("refused");
    expect(useWorkspace.getState().findingsText).toBe("");
    expect(useWorkspace.getState().impressionText).toBe("");
    expect(useWorkspace.getState().recommendationText).toBe("");
    expect(useWorkspace.getState().appliedPathologyPatches).toEqual([]);
    expect(useWorkspace.getState().appliedPathologyPatches.length)
      .toBe(before.appliedPathologyPatches.length);
  });

  it("changes nothing at all — not the prose, the ledger, provenance, undo, or the dirty flag", () => {
    const before = clinicalState();
    click("Acute infarct (DWI)");
    click("Basal ganglia hemorrhage");
    click("Foraminal stenosis L4-L5", { side: "left" });
    expect(clinicalState()).toEqual(before);
    const s = useWorkspace.getState();
    expect(s.isDirty).toBe(false);
    expect(s.patchUndoStack.length).toBe(0);
    expect(s.selectedObservationId).toBeNull();
    expect(s.pendingPathologyPatch).toBeNull();
    expect(Object.keys(s.fieldProvenance)).toHaveLength(0);
    expect(s.impressionNeedsRefresh).toBe(false);
  });

  it("leaves no brace anywhere the report is read or re-rendered", () => {
    click("Acute infarct (DWI)");
    for (const text of textsNow()) {
      for (const token of SUPPORTED_TOKENS) expect(text).not.toContain(token);
    }
  });

  it("does not strip the parameter to hide it — the sentence is absent, not emptied", () => {
    click("Acute infarct (DWI)");
    // The forbidden "fix" was to delete `{side}` from the output, which would
    // have left a fluent but unfounded "Restricted diffusion in the MCA
    // territory…". Assert the absence of BOTH forms.
    expect(useWorkspace.getState().findingsText).not.toMatch(/diffusion in the MCA territory/i);
    expect(useWorkspace.getState().findingsText).not.toMatch(/\{side\}/);
  });

  it("tells the radiologist which value is missing, in the refusal style the workspace already uses", () => {
    click("Acute infarct (DWI)");
    expect(toastMock).toHaveBeenCalledTimes(1);
    const shown = toastMock.mock.calls[0]![0] as { title: string; description: string };
    expect(`${shown.title} ${shown.description}`).toMatch(/side/i);
    expect(`${shown.title} ${shown.description}`).toMatch(/nothing was applied/i);
  });

  it("keeps the three sentences of one tile together on a refusal", () => {
    // "Acute infarct (DWI)" carries a recommendation too. Half a tile landing is
    // the contradiction the payload module was extracted to prevent.
    click("Acute infarct (DWI)");
    expect(useWorkspace.getState().recommendationText).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 — one explicit value resolves Findings and Impression, and the ledger agrees.
// ─────────────────────────────────────────────────────────────────────────────
describe("T3 — an explicit side resolves the whole tile", () => {
  it("writes the chosen side into Findings and Impression from the same value", () => {
    expect(click("Acute infarct (DWI)", { side: "right" })).toBe("applied");
    const s = useWorkspace.getState();
    expect(s.findingsText).toContain("right MCA territory");
    expect(s.impressionText).toContain("Acute right MCA territory infarct.");
    expect(s.recommendationText).toContain("stroke team");
    for (const text of [s.findingsText, s.impressionText]) {
      for (const token of SUPPORTED_TOKENS) expect(text).not.toContain(token);
    }
  });

  it("stamps the Observation Ledger with the same laterality the prose says", () => {
    click("Acute infarct (DWI)", { side: "left" });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches).toHaveLength(1);
    expect(patches[0]!.observation?.laterality).toBe("left");
    expect(patches[0]!.lastRendered.findings).toContain("left MCA territory");
    expect(patches[0]!.lastRendered.impression).toContain("left MCA territory infarct");
  });

  it("carries a bilateral choice through without inventing a side", () => {
    click("Acute infarct (DWI)", { side: "bilateral" });
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/bilateral MCA territory/i);
    expect(s.impressionText).toMatch(/bilateral MCA territory infarct/i);
  });

  it("resolves a left choice for one tile without disturbing an earlier right one", () => {
    click("Acute infarct (DWI)", { side: "right" });
    click("Orbital cellulitis", { side: "left" });
    const s = useWorkspace.getState();
    expect(s.findingsText).toContain("right MCA territory");
    expect(s.findingsText).toContain("left orbit");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 — `{severity}`: resolve it or refuse. Silent deletion is the forbidden fix.
// ─────────────────────────────────────────────────────────────────────────────
describe("T4 — severity is a clinical parameter, not decorative text", () => {
  it("refuses when the side is chosen but the severity was not", () => {
    const before = clinicalState();
    expect(click("Foraminal stenosis L4-L5", { side: "left" })).toBe("refused");
    expect(clinicalState().findingsText).toBe(before.findingsText);
    expect(useWorkspace.getState().appliedPathologyPatches).toEqual([]);
    // The engine deletes an unfilled `{severity}` as long as the template also
    // carries `{side}`. That output is fluent and unfounded — it must not appear.
    expect(useWorkspace.getState().findingsText).not.toMatch(/neural foraminal stenosis/i);
  });

  it("names the severity in the refusal", () => {
    click("Foraminal stenosis L4-L5", { side: "left" });
    const shown = toastMock.mock.calls[0]![0] as { description: string };
    expect(`${toastMock.mock.calls[0]![0]!.title} ${shown.description}`).toMatch(/severity/i);
  });

  it("writes the chosen severity when both parameters are explicit", () => {
    expect(click("Foraminal stenosis L4-L5", { side: "left", severity: "moderate" })).toBe("applied");
    const s = useWorkspace.getState();
    expect(s.findingsText).toMatch(/moderate left neural foraminal stenosis at L4-L5/i);
    for (const token of SUPPORTED_TOKENS) expect(s.findingsText).not.toContain(token);
    expect(s.appliedPathologyPatches[0]!.observation?.severity).toBe("moderate");
    expect(s.appliedPathologyPatches[0]!.observation?.laterality).toBe("left");
  });

  it("refuses when the severity is chosen but the side was not", () => {
    expect(click("Foraminal stenosis L4-L5", { severity: "severe" })).toBe("refused");
    expect(useWorkspace.getState().findingsText).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 — non-parameterized tiles are untouched by the guard.
// ─────────────────────────────────────────────────────────────────────────────
describe("T5 — the guard is a parameter check, not a Quick Select blocker", () => {
  it("applies a tile with no parameter, with no side chosen", () => {
    expect(click("Normal brain parenchyma")).toBe("applied");
    // Byte-for-byte the text the same click produced before this PR.
    expect(useWorkspace.getState().findingsText).toBe(
      "Brain parenchyma shows normal signal intensity.\nNo evidence of acute infarct, hemorrhage, or mass lesion.",
    );
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("applies a tile that merely mentions a side word in prose", () => {
    expect(click("Disc herniation L4-L5")).toBe("applied");
    expect(useWorkspace.getState().findingsText).not.toContain("{");
  });

  it("still refuses a signed study first, with the signed-report message", () => {
    useWorkspace.setState({ isFinalized: true } as never);
    expect(click("Acute infarct (DWI)", { side: "left" })).toBe("refused");
    const shown = toastMock.mock.calls[0]![0] as { title: string };
    expect(shown.title).toMatch(/signed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 — same-slot semantics survive a refusal.
// ─────────────────────────────────────────────────────────────────────────────
describe("T6 — a refused click does not consume or duplicate same-slot state", () => {
  beforeEach(() => reset(lsContext()));

  it("re-apply with a corrected severity replaces the sentence, not duplicates it", () => {
    click("Foraminal stenosis L4-L5", { side: "left", severity: "mild" });
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(1);
    click("Foraminal stenosis L4-L5", { side: "left", severity: "severe" });
    const patches = useWorkspace.getState().appliedPathologyPatches;
    expect(patches).toHaveLength(1);
    expect(patches[0]!.observation?.severity).toBe("severe");
    expect(useWorkspace.getState().findingsText).toMatch(/severe left neural foraminal stenosis/i);
    expect(useWorkspace.getState().findingsText).not.toMatch(/mild/);
  });

  it("leaves an existing applied row exactly as it was when a second tile is refused", () => {
    click("Foraminal stenosis L4-L5", { side: "left", severity: "mild" });
    const before = clinicalState();
    expect(click("Acute infarct (DWI)")).toBe("refused");
    const after = clinicalState();
    expect(after.appliedPathologyPatches).toEqual(before.appliedPathologyPatches);
    expect(after.findingsText).toBe(before.findingsText);
    expect(after.undoDepth).toBe(before.undoDepth);
  });

  it("does not arm the same-slot confirm dialog or move the selection", () => {
    click("Foraminal stenosis L4-L5", { side: "left", severity: "mild" });
    const selected = useWorkspace.getState().selectedObservationId;
    expect(useWorkspace.getState().pendingPathologyPatch).toBeNull();
    expect(click("Foraminal stenosis L4-L5", { side: "left" })).toBe("refused");   // no severity
    expect(useWorkspace.getState().pendingPathologyPatch).toBeNull();
    expect(useWorkspace.getState().selectedObservationId).toBe(selected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10 — the ledger and the prose must keep saying the same thing afterwards.
// ─────────────────────────────────────────────────────────────────────────────
describe("§10 — re-choosing the side does not quietly drop the severity", () => {
  beforeEach(() => reset(lsContext()));

  it("keeps the severity in the sentence, the rendered copy and the ledger", () => {
    click("Foraminal stenosis L4-L5", { side: "left", severity: "moderate" });
    useWorkspace.getState().relateralizePatches("right");
    const s = useWorkspace.getState();
    const patch = s.appliedPathologyPatches[0]!;
    expect(s.findingsText).toMatch(/moderate right neural foraminal stenosis/i);
    expect(patch.lastRendered.findings).toMatch(/moderate right/i);
    expect(patch.observation?.severity).toBe("moderate");
    expect(patch.observation?.laterality).toBe("right");
    for (const token of SUPPORTED_TOKENS) {
      expect(s.findingsText).not.toContain(token);
      expect(patch.lastRendered.findings ?? "").not.toContain(token);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scope boundary — the second Quick Select source is covered; the surfaces that
// resolve their own parameters upstream are deliberately NOT.
// ─────────────────────────────────────────────────────────────────────────────
describe("scope — what this contract owns, and what it stops short of", () => {
  /**
   * The chocolate-box macro tile, sent exactly as `useReportingStudySetup.applyChocolateTile`
   * builds it: `side: ownership.supportsLaterality ? undefined : ""` — no side for a tile
   * whose own text demands one. Executed at HEAD this wrote
   * "Acute intraparenchymal hemorrhage in the {side} basal ganglia…" into Findings and
   * Impression. It is a Quick Select surface (Settings → Radiology → Quick Select edits
   * these boxes), so it refuses now. Pinned because it is a named behaviour change on a
   * surface this PR did not add controls to.
   */
  const CHOCO_HEMORRHAGE = {
    incoming: {
      findings: "Acute intraparenchymal hemorrhage in the {side} basal ganglia with surrounding edema. Mass effect with midline shift of ___ mm.",
      impression: "Acute {side} basal ganglia hemorrhage.",
    },
    templates: {
      findings: "Acute intraparenchymal hemorrhage in the {side} basal ganglia with surrounding edema. Mass effect with midline shift of ___ mm.",
      impression: "Acute {side} basal ganglia hemorrhage.",
    },
    ownership: {
      anatomicalSection: "basal ganglia",
      conflictGroup: "hemorrhage",
      baselineReplaces: "Basal ganglia are normal",
    },
    source: "macro" as const,
    side: undefined,
    id: "choco-brain-basal-ganglia-hemorrhage",
    region: "Brain",
    label: "Basal Ganglia Hemorrhage",
    findingsText: "Acute intraparenchymal hemorrhage in the {side} basal ganglia with surrounding edema. Mass effect with midline shift of ___ mm.",
    supportsLaterality: true,
  };

  it("refuses the chocolate-box tile that asks for a side it never supplies", () => {
    const before = clinicalState();
    expect(useWorkspace.getState().applyPathologyOverlay(CHOCO_HEMORRHAGE)).toBe("refused");
    expect(clinicalState()).toEqual(before);
    for (const text of textsNow()) expect(text).not.toContain("{side}");
  });

  it("applies the same chocolate-box tile once a side is supplied", () => {
    const r = useWorkspace.getState().applyPathologyOverlay({ ...CHOCO_HEMORRHAGE, side: "right" });
    expect(r).toBe("applied");
    expect(useWorkspace.getState().findingsText).toContain("right basal ganglia");
    expect(useWorkspace.getState().impressionText).toContain("Acute right basal ganglia hemorrhage.");
    expect(useWorkspace.getState().findingsText).toContain("___ mm");
  });

  /**
   * The Structured Reporting surface hands this boundary the raw `outputSentence`
   * templates from the format document (`"Disc desiccation is seen at {level}."`),
   * because its own narrative comes from `generateFromValues()`, which does fill them.
   * Its ledger rows are not this contract's parameters, and refusing them would change
   * what a different feature writes — so they are reported as still unresolved, not
   * silently guarded here. This test exists so that decision is visible and so a future
   * change to it cannot be accidental.
   */
  it("does not take over the structured-format surface", () => {
    const r = useWorkspace.getState().applyMacroBundle({
      bundleId: "structured-template-format",
      observations: [{
        incoming: { findings: "Disc desiccation is seen at {level}.", impression: "{level} disc desiccation." },
        templates: { findings: "Disc desiccation is seen at {level}.", impression: "{level} disc desiccation." },
        ownership: { conflictGroup: "disc_desiccation", concept: "disc_desiccation" },
        source: "structured-template",
        region: "LS Spine",
        concept: "disc_desiccation",
        level: "L4-L5",
        findingsText: "Disc desiccation is seen at {level}.",
        supportsLaterality: false,
        id: "structured-LS Spine-disc_desiccation-L4-L5-",
      }],
    });
    expect(r).toBe("applied");
    expect(useWorkspace.getState().appliedPathologyPatches).toHaveLength(1);
    expect(toastMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 — the radiologist's own text stays first-class, braces included (§12).
// ─────────────────────────────────────────────────────────────────────────────
describe("T7 — manual prose is never refused for containing a placeholder", () => {
  beforeEach(() => reset(lsContext()));

  it("accepts a typed sentence containing {side}", () => {
    useWorkspace.getState().setField(
      "findings",
      "Small {side} subdural hygroma, stable. ___ mm midline shift.",
    );
    expect(useWorkspace.getState().findingsText).toContain("{side}");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("accepts a merged recommendation containing {severity}", () => {
    useWorkspace.getState().mergeField("recommendation", "Correlate with {severity} symptoms.", "manual");
    expect(useWorkspace.getState().recommendationText).toContain("{severity}");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("still protects that manual sentence after a refused tile click", () => {
    useWorkspace.getState().setField("findings", "Left foraminal stenosis, {severity} at L4-L5.");
    const manual = useWorkspace.getState().findingsText;
    expect(click("Foraminal stenosis L4-L5")).toBe("refused");
    expect(useWorkspace.getState().findingsText).toBe(manual);
  });

  it("lets a recommendation tile with braces reach the field it belongs to", () => {
    const guarded = unresolvedQuickSelectParameters(
      { recommendation: "Clinical correlation with {side} symptoms." },
      {},
    );
    expect(guarded).toEqual(["side"]);
    // …and that the strip, not mergeField, is what refuses it: mergeField itself
    // has no idea about parameters and must stay that way.
    expect(storeCode).not.toMatch(/mergeField:[\s\S]{0,400}unresolvedQuickSelectParameters/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 — the census: which shipped tiles carry a parameter, and can they be resolved?
// ─────────────────────────────────────────────────────────────────────────────
describe("T8 — census over every shipped Quick Select template", () => {
  function tileText(t: (typeof DEFAULT_QUICK_SELECT_TILES)[number]): string {
    return [t.sentence, t.impressionSentence ?? "", t.recommendationSentence ?? ""].join(" ");
  }

  it("counts the parameterized tiles at HEAD", () => {
    const affected = DEFAULT_QUICK_SELECT_TILES.filter((t) => quickSelectParametersIn(tileText(t)).size > 0);
    expect(affected.map((t) => t.label).sort()).toEqual([
      "AVM",
      "Acute hemorrhage",
      "Acute infarct (DWI)",
      "Aneurysm",
      "Basal ganglia hemorrhage",
      "Cavernoma",
      "Chronic infarct",
      "Contusion",
      "Epidural hematoma",
      "Extra-axial collection",
      // The cervical catalogue added two laterality boxes, at levels the lumbar
      // set had no tile for. Both put `{side}` in the findings sentence and again
      // in the impression sentence, which is why the token count below moves by
      // four and the tile count by two.
      "Foraminal stenosis C5-C6",
      "Foraminal stenosis L4-L5",
      "Hip effusion",
      "Hippocampal sclerosis",
      "Mass lesion",
      "Maxillary sinusitis",
      "Meniscus tear",
      "Midline shift",
      "Nerve root compression C6",
      "Orbital cellulitis",
      "Renal calculus",
      "Rotator cuff tear",
      "Subdural hematoma",
    ]);
    expect(affected.length).toBe(23);
  });

  it("counts the tokens so a new one cannot arrive uncounted", () => {
    let side = 0;
    let severity = 0;
    for (const t of DEFAULT_QUICK_SELECT_TILES) {
      side += (t.sentence.match(/\{side\}/g) ?? []).length
        + ((t.impressionSentence ?? "").match(/\{side\}/g) ?? []).length
        + ((t.recommendationSentence ?? "").match(/\{side\}/g) ?? []).length;
      severity += (t.sentence.match(/\{severity\}/g) ?? []).length
        + ((t.impressionSentence ?? "").match(/\{severity\}/g) ?? []).length
        + ((t.recommendationSentence ?? "").match(/\{severity\}/g) ?? []).length;
    }
    // 41 / 2 since the owner's 2026-10-18 lumbar approval: "Foraminal stenosis L4-L5"
    // now repeats its own `{severity} {side}` in the Impression it was approved to
    // write, so one more of each token ships. The strip already offered both controls
    // for this box, and quickSelectLsSpineImpressions.test.ts proves both are
    // substituted in the Impression before it reaches the page — not printed as braces.
    expect(side).toBe(41);
    expect(severity).toBe(2);
  });

  it("ships no tile that asks for a parameter the contract cannot resolve", () => {
    // {level} / {value} / {chronicity} belong to the structured and macro
    // engines, which resolve them before the store is called. If a Quick Select
    // tile ever asks for one, this test is the stop sign: the strip offers no
    // control for it, so the tile could only ever refuse.
    for (const t of DEFAULT_QUICK_SELECT_TILES) {
      expect([...quickSelectParametersIn(tileText(t))].sort()).toEqual(
        [...quickSelectParametersIn(tileText(t))].filter((p) => p === "side" || p === "severity"),
      );
    }
  });

  it("resolves every parameterized tile from the strip's own controls", () => {
    for (const t of DEFAULT_QUICK_SELECT_TILES) {
      const needed = quickSelectParametersIn(tileText(t));
      const values = {
        side: needed.has("side") ? "left" as Side : "",
        severity: needed.has("severity") ? "moderate" : "",
      };
      expect(unresolvedQuickSelectParameters(
        { findings: t.sentence, impression: t.impressionSentence, recommendation: t.recommendationSentence },
        values,
      )).toEqual([]);
    }
  });

  it("treats the shipped unfilled blank ___ as prose, never as a parameter", () => {
    expect(quickSelectParametersIn("Mass effect with midline shift of ___ mm.")).toEqual(new Set());
  });

  it("only ever guards the sources the Quick Select contract owns", () => {
    // A ratchet, not a description: every source here is a surface that can be
    // asked for a side and a severity, and a new one must be added deliberately
    // with a surface behind it that supplies both. `quick-findings` is the
    // database box clicked from this same strip.
    expect([...QUICK_SELECT_PARAMETER_SOURCES].sort()).toEqual(["macro", "quick-findings", "quick-select"]);
  });

  it("guards a database box the same way it guards a shipped tile", () => {
    // The property the ratchet above only names. A box authored through the API
    // is validated for wording, not for parameters, so nothing else stands
    // between a `{severity}` in a clinic's own sentence and a literal brace in a
    // signed report.
    const box = quickFindingPatch(
      {
        id: 4001, label: "Canal stenosis", studyType: "LS Spine",
        findingText: "{severity} central canal stenosis at L4-L5.",
        impressionText: "", techniqueText: "", recommendationText: "",
      },
      { region: "LS Spine" },
    );
    expect(isQuickSelectSource(box.source)).toBe(true);
    expect(unresolvedQuickSelectParameters(box.templates!, {})).toEqual(["severity"]);
    expect(unresolvedQuickSelectParameters(box.templates!, { severity: "severe" })).toEqual([]);
  });

  it("never asks a database box for a side it would then refuse to use", () => {
    // The store resolves the side only when the observation declares laterality,
    // and inference reads findingsText and the properties column alone. The
    // refusal guard reads every section. A box carrying {side} only in its
    // impression or recommendation would therefore be asked for a side it could
    // never spend — and refuse on every click, forever. The builder declares
    // laterality over the same four sections the guard scans, which is what keeps
    // the two in step; this pins that they cannot drift.
    for (const section of ["findingText", "impressionText", "techniqueText", "recommendationText"] as const) {
      const box = quickFindingPatch(
        {
          id: 4002, label: `Sided ${section}`, studyType: "LS Spine",
          findingText: "", impressionText: "", techniqueText: "", recommendationText: "",
          [section]: "Stenosis to the {side}.",
        },
        { region: "LS Spine" },
        { side: "left" },
      );
      expect(box.supportsLaterality, `${section} asks for a side`).toBe(true);
      expect(box.side, `${section}'s side must be spendable`).toBe("left");
      expect(unresolvedQuickSelectParameters(box.templates!, { side: box.side })).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wiring — the strip is the only thing that can supply the value, so pin that it does.
// ─────────────────────────────────────────────────────────────────────────────
describe("wiring — the parameter reaches the boundary from the surface that collects it", () => {
  it("the payload builder carries an explicit side and severity onto the patch", () => {
    expect(quickSelectTilePatch(INFARCT, "findings", { side: "right" }).side).toBe("right");
    expect(quickSelectTilePatch(FORAMINAL, "findings", { severity: "moderate" }).severity).toBe("moderate");
    expect(quickSelectTilePatch(INFARCT, "findings").side).toBeUndefined();
    expect(quickSelectTilePatch(INFARCT, "findings").severity).toBeUndefined();
  });

  it("the payload still declares the tile as laterality-capable", () => {
    expect(quickSelectTilePatch(INFARCT, "findings").supportsLaterality).toBe(true);
    expect(quickSelectTilePatch(PLAIN, "findings").supportsLaterality).toBe(false);
  });

  it("the strip hands its chosen parameters to the one writer, which builds the payload the store reads", () => {
    expect(stripCode).toMatch(/onToggle\(\s*box,\s*true,\s*\{[^}]*side[^}]*severity[^}]*\}\s*\)/);
    // Positive control: the shape the scanner wants really is a call with both keys.
    expect("onToggle(box, true, { side: qsSide, severity: qsSeverity })")
      .toMatch(/onToggle\(\s*box,\s*true,\s*\{[^}]*side[^}]*severity[^}]*\}\s*\)/);
    // …and a call that dropped them would NOT match, so the assertion is not vacuous.
    expect("onToggle(box, true)")
      .not.toMatch(/onToggle\(\s*box,\s*true,\s*\{[^}]*side[^}]*severity[^}]*\}\s*\)/);
  });

  it("the strip has no write path of its own that could bypass the store guard", () => {
    // Recommendation / technique / history boxes used to be written with
    // mergeField, which has no parameter path at all, so the strip had to run the
    // guard itself before that branch. It no longer writes anything directly:
    // every click goes to `onToggle`, so the guard inside the overlay is the only
    // one that has to exist and there is no second place to forget it.
    expect(stripCode).not.toMatch(/mergeField/);
    expect(stripCode).not.toMatch(/applyPathologyOverlay/);
    expect(stripCode).toMatch(/onToggle\(/);
    // Positive control: the scanner really would see a direct write.
    expect('mergeField(field, tile.sentence, { source: "quick-select" })').toMatch(/mergeField/);
    expect(quickSelectParametersIn("Correlate with {side} symptoms.")).toEqual(new Set(["side"]));
  });

  it("the strip offers a chip for every parameter any section of the box can ask for", () => {
    // The chips are scanned over all four sentences, the same set the builder
    // declares laterality from and the same set the refusal guard reads. Scanning
    // one section and guarding four is how a box ends up refusing forever for a
    // parameter no chip offered.
    expect(stripCode).toMatch(/quickSelectParametersIn\(quickSelectBoxWrittenText\(box\)\)/);
  });

  it("the guard runs inside the overlay, before the overlay's first write", () => {
    expect(storeCode).toMatch(/unresolvedQuickSelectParameters\(/);
    const guard = storeCode.search(/unresolvedQuickSelectParameters\(/);
    const firstWrite = storeCode.slice(guard).search(/\n\s+set\(\{/);
    expect(guard).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(storeCode.slice(guard, guard + firstWrite)).toMatch(/return "refused"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 — the out-of-band property guard: NO unresolved `{token}` reaches a report
// section, whatever its name. Task A's whole-catalogue requirement, enforced at
// the shared write boundary AFTER side/severity substitution, so the leak the
// declaration test missed (a `{size}` the side/severity chips never offer) is
// refused rather than printed. This is the backstop behind the strip's new
// structured-dialog routing: a box that carries an unfilled out-of-band token
// and never reaches the dialog cannot write.
// ─────────────────────────────────────────────────────────────────────────────
describe("T8 — out-of-band placeholders are refused at the boundary, not printed", () => {
  function dbBox(overrides: Record<string, unknown>) {
    return {
      id: 900001,
      studyType: "Whole Abdomen",
      label: "Leaky gall bladder box",
      findingText: "Gallbladder contains a {size} calculus.",
      impressionText: "Cholelithiasis, {size}.",
      techniqueText: "",
      recommendationText: "",
      anatomicalSection: "",
      conflictGroup: "",
      baselineReplaces: "",
      concept: "",
      questionsJson: "[]",
      properties: "",
      ...overrides,
    } as never;
  }

  function apply(box: never, params: { side?: Side | ""; severity?: string } = {}) {
    return useWorkspace.getState().applyPathologyOverlay(
      quickFindingPatch(box, { region: "Whole Abdomen", studyType: "Whole Abdomen" }, params),
    );
  }

  it("refuses a box whose prose carries an unfillable {size}, and changes nothing", () => {
    const before = clinicalState();
    expect(apply(dbBox({}))).toBe("refused");
    const s = useWorkspace.getState();
    expect(s.findingsText).toBe("");
    expect(s.impressionText).toBe("");
    expect(s.appliedPathologyPatches).toEqual([]);
    expect(clinicalState()).toEqual(before);
  });

  it("names the leaked token in the refusal, not a generic message", () => {
    apply(dbBox({ findingText: "A {size} lesion in the {location}." }));
    expect(toastMock).toHaveBeenCalled();
    const shown = toastMock.mock.calls.at(-1)![0] as { title: string; description: string };
    const all = `${shown.title} ${shown.description}`;
    expect(all).toMatch(/nothing was applied/i);
    expect(all).toMatch(/size/);
    expect(all).toMatch(/location/);
  });

  it("does NOT refuse a box already resolved through the structured dialog (no brace left)", () => {
    // The substitute for `applyStructuredDialog`'s output: the same sentence with
    // the answered value, brace-free. It must apply exactly as an ordinary box.
    expect(apply(dbBox({ findingText: "Gallbladder contains a 6 mm calculus.", impressionText: "Cholelithiasis, 6 mm." })))
      .toBe("applied");
    expect(useWorkspace.getState().findingsText).toContain("6 mm calculus");
  });

  it("still refuses an unresolved {side} with its dedicated side message (guards are complementary)", () => {
    // A box asking only `{side}` is caught by the EARLIER side/severity guard,
    // before the out-of-band check — the new code must not swallow that wording.
    apply(dbBox({ findingText: "Restricted diffusion in the {side} MCA territory.", impressionText: "" }));
    const shown = toastMock.mock.calls.at(-1)![0] as { description: string };
    expect(shown.description).toMatch(/side/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 — the pure placeholder detector: identifier-shaped only, so a radiologist's
// own braces survive; and it reads every section a one-click write commits.
// ─────────────────────────────────────────────────────────────────────────────
describe("T9 — unresolvedQuickSelectPlaceholders is a token scanner, not a brace ban", () => {
  it("finds every distinct out-of-band token across the four sections", () => {
    expect(
      unresolvedQuickSelectPlaceholders({
        findings: "A {size} mass with {swelling}.",
        impression: "{grade} appearances.",
        technique: "",
        recommendation: "{size} again.",
      }),
    ).toEqual(expect.arrayContaining(["size", "swelling", "grade"]));
  });

  it("ignores braces that are not template tokens (legitimate clinical text)", () => {
    expect(unresolvedQuickSelectPlaceholders({ findings: "Calcifications ({ }) scattered.", impression: "{1, 2}, {'a': 1}, { see note }", technique: "", recommendation: "" }))
      .toEqual([]);
  });

  it("sees a token already resolved to a value as none", () => {
    expect(unresolvedQuickSelectPlaceholders({ findings: "left MCA territory infarct.", impression: "", technique: "", recommendation: "" }))
      .toEqual([]);
  });
});
