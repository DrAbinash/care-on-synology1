import { describe, it, expect } from "vitest";
import * as RenderEngine from "./renderEngine";
import * as AbnormalityEngine from "./abnormalityEngine";
import * as SideSwap from "./sideSwap";
import * as QuickFindingsMerge from "./quickFindingsMerge";

// Ticket F1a coverage: renderEngine.ts is a pure re-export facade — no logic
// lives here. The strongest possible proof of "zero behavior change" is
// reference identity (toBe, not toEqual): if RenderEngine.fillTemplate IS
// AbnormalityEngine.fillTemplate (the exact same function object), then by
// construction it behaves identically in every case abnormalityEngine's own
// tests already cover — there is no separate implementation to drift.

describe("renderEngine — version constant (Ticket F1a)", () => {
  it("exports a non-empty version string", () => {
    expect(typeof RenderEngine.RENDER_ENGINE_VERSION).toBe("string");
    expect(RenderEngine.RENDER_ENGINE_VERSION.length).toBeGreaterThan(0);
  });
});

describe("renderEngine — re-exports abnormalityEngine's public surface as identical references", () => {
  it("functions and constants are the exact same objects, not copies", () => {
    expect(RenderEngine.fillTemplate).toBe(AbnormalityEngine.fillTemplate);
    expect(RenderEngine.renderAbnormality).toBe(AbnormalityEngine.renderAbnormality);
    expect(RenderEngine.parseProperties).toBe(AbnormalityEngine.parseProperties);
    expect(RenderEngine.EMPTY_INSTANCE).toBe(AbnormalityEngine.EMPTY_INSTANCE);
  });
});

describe("renderEngine — re-exports sideSwap's public surface as identical references", () => {
  it("functions are the exact same objects, not copies", () => {
    expect(RenderEngine.applySide).toBe(SideSwap.applySide);
    expect(RenderEngine.swapSides).toBe(SideSwap.swapSides);
    expect(RenderEngine.hasSideWords).toBe(SideSwap.hasSideWords);
  });
});

describe("renderEngine — re-exports quickFindingsMerge's public surface as identical references", () => {
  it("functions are the exact same objects, not copies", () => {
    expect(RenderEngine.mergeBlock).toBe(QuickFindingsMerge.mergeBlock);
    expect(RenderEngine.removeBlock).toBe(QuickFindingsMerge.removeBlock);
    expect(RenderEngine.mergeImpression).toBe(QuickFindingsMerge.mergeImpression);
    expect(RenderEngine.removeImpression).toBe(QuickFindingsMerge.removeImpression);
  });
});

describe("renderEngine — spot-check: re-exported functions still behave exactly as their source module's own tests expect", () => {
  it("renderAbnormality (via the facade) renders identically to calling abnormalityEngine directly", () => {
    const tpl = {
      findingText: "There is a {severity} disc bulge at {level}.",
      impressionText: "{severity} disc bulge, {level}.",
      techniqueText: "",
      recommendationText: "",
    };
    const inst = { side: "" as const, severity: "moderate" as const, chronicity: "" as const, level: "L4-L5", value: "" };

    expect(RenderEngine.renderAbnormality(tpl, inst)).toEqual(AbnormalityEngine.renderAbnormality(tpl, inst));
  });

  it("mergeBlock/removeBlock (via the facade) round-trip identically to calling quickFindingsMerge directly", () => {
    const merged = RenderEngine.mergeBlock("", "Finding text.");
    expect(merged).toBe(QuickFindingsMerge.mergeBlock("", "Finding text."));
    expect(RenderEngine.removeBlock(merged, "Finding text.")).toBe(
      QuickFindingsMerge.removeBlock(merged, "Finding text."),
    );
  });
});

// Ticket F1b coverage: pure orchestration logic extracted from
// RadiologyReportingWorkspace's applyRendered / handleQuickToggle /
// handleInstanceUpdate. These functions own the DECISION of what the next
// state should be; React state ownership (useState/useRef) stays in the
// component per F1b's scope — see removeImpressionShadowing.test.ts for
// the source-level proof that the component correctly wires into these.

const EMPTY_STATE: RenderEngine.ReportTextState = {
  rawFindings: "", impression: [], technique: "", recommendation: "",
};

function rendered(overrides: Partial<RenderEngine.RenderedAbnormality> = {}): RenderEngine.RenderedAbnormality {
  return { finding: "", impression: "", technique: "", recommendation: "", ...overrides };
}

describe("applyRenderedTransition — pure equivalent of applyRendered (Ticket F1b)", () => {
  it("first render (no prev): merges every non-empty field of `next`, leaves the rest alone", () => {
    const next = rendered({ finding: "Disc bulge at L4-5.", impression: "Moderate disc bulge, L4-5." });

    const result = RenderEngine.applyRenderedTransition(EMPTY_STATE, undefined, next);

    expect(result).toEqual({
      rawFindings: "Disc bulge at L4-5.",
      impression: ["Moderate disc bulge, L4-5."],
      technique: "",
      recommendation: "",
    });
  });

  it("re-render (prev AND next both present, different content): removes the old text then merges the new — for every field, in one pass", () => {
    const prev = rendered({ finding: "Mild disc bulge at L4-5.", impression: "Mild disc bulge, L4-5." });
    const next = rendered({ finding: "Severe disc bulge at L4-5.", impression: "Severe disc bulge, L4-5." });
    const state: RenderEngine.ReportTextState = {
      rawFindings: "Mild disc bulge at L4-5.",
      impression: ["Mild disc bulge, L4-5."],
      technique: "",
      recommendation: "",
    };

    const result = RenderEngine.applyRenderedTransition(state, prev, next);

    // The old text is gone and the new text is present — not both, and not
    // neither. This is the exact sequential remove-then-merge dependency
    // that previously required React's functional setState chaining
    // (two setImpression calls in one applyRendered invocation); here it's
    // just two ordinary statements reassigning a local variable.
    expect(result.rawFindings).toBe("Severe disc bulge at L4-5.");
    expect(result.impression).toEqual(["Severe disc bulge, L4-5."]);
  });

  it("deselect (prev present, next null): removes the old text from every field, merges nothing", () => {
    const prev = rendered({ finding: "Disc bulge at L4-5.", impression: "Moderate disc bulge, L4-5." });
    const state: RenderEngine.ReportTextState = {
      rawFindings: "Disc bulge at L4-5.",
      impression: ["Moderate disc bulge, L4-5."],
      technique: "",
      recommendation: "",
    };

    const result = RenderEngine.applyRenderedTransition(state, prev, null);

    expect(result).toEqual(EMPTY_STATE);
  });

  it("a manually-edited sentence is preserved — exact-match removal only, no data loss", () => {
    const prev = rendered({ finding: "Disc bulge at L4-5." });
    const state: RenderEngine.ReportTextState = {
      ...EMPTY_STATE,
      rawFindings: "Disc bulge at L4-5, radiologist-confirmed on review.", // edited, no longer an exact match
    };

    const result = RenderEngine.applyRenderedTransition(state, prev, null);

    expect(result.rawFindings).toBe("Disc bulge at L4-5, radiologist-confirmed on review.");
  });

  it("does not touch a field that neither prev nor next populated", () => {
    const state: RenderEngine.ReportTextState = {
      rawFindings: "Unrelated existing findings text.",
      impression: ["Unrelated existing impression."],
      technique: "Unrelated technique text.",
      recommendation: "Unrelated recommendation text.",
    };
    const next = rendered({ finding: "New finding only." }); // impression/technique/recommendation all empty

    const result = RenderEngine.applyRenderedTransition(state, undefined, next);

    expect(result.impression).toEqual(["Unrelated existing impression."]);
    expect(result.technique).toBe("Unrelated technique text.");
    expect(result.recommendation).toBe("Unrelated recommendation text.");
  });
});

describe("toggleQuickSelection — pure equivalent of the selectedQuickIds Set update (Ticket F1b)", () => {
  it("adds an id when selected=true, without mutating the input Set", () => {
    const current = new Set([1, 2]);
    const result = RenderEngine.toggleQuickSelection(current, 3, true);

    expect(result).toEqual(new Set([1, 2, 3]));
    expect(current).toEqual(new Set([1, 2])); // unchanged
  });

  it("removes an id when selected=false, without mutating the input Set", () => {
    const current = new Set([1, 2, 3]);
    const result = RenderEngine.toggleQuickSelection(current, 2, false);

    expect(result).toEqual(new Set([1, 3]));
    expect(current).toEqual(new Set([1, 2, 3])); // unchanged
  });
});

describe("setQuickInstance / deleteQuickInstance — pure equivalents of the quickInstances Map update (Ticket F1b)", () => {
  it("setQuickInstance sets an entry, returning a new Map", () => {
    const current = new Map<number, RenderEngine.AbnormalityInstance>();
    const inst = RenderEngine.seedQuickInstance("left");

    const result = RenderEngine.setQuickInstance(current, 42, inst);

    expect(result.get(42)).toEqual(inst);
    expect(current.size).toBe(0); // unchanged
  });

  it("deleteQuickInstance removes an entry, returning a new Map", () => {
    const inst = RenderEngine.seedQuickInstance("right");
    const current = new Map([[42, inst]]);

    const result = RenderEngine.deleteQuickInstance(current, 42);

    expect(result.has(42)).toBe(false);
    expect(current.has(42)).toBe(true); // unchanged
  });

  it("deleteQuickInstance no-ops (returns an equivalent Map) when the id isn't present", () => {
    const current = new Map([[1, RenderEngine.seedQuickInstance("left")]]);
    const result = RenderEngine.deleteQuickInstance(current, 999);
    expect(result).toEqual(current);
  });
});

describe("seedQuickInstance / patchQuickInstance — pure equivalents of handleQuickToggle's select branch and handleInstanceUpdate (Ticket F1b)", () => {
  it("seedQuickInstance returns EMPTY_INSTANCE with the given side", () => {
    expect(RenderEngine.seedQuickInstance("bilateral")).toEqual({ ...RenderEngine.EMPTY_INSTANCE, side: "bilateral" });
  });

  it("patchQuickInstance seeds a fresh instance when none exists yet, then applies the patch", () => {
    const result = RenderEngine.patchQuickInstance(undefined, "left", { severity: "moderate" });
    expect(result).toEqual({ ...RenderEngine.EMPTY_INSTANCE, side: "left", severity: "moderate" });
  });

  it("patchQuickInstance merges the patch onto an existing instance without discarding other properties", () => {
    const current: RenderEngine.AbnormalityInstance = { side: "left", severity: "mild", chronicity: "chronic", level: "L4-L5", value: "" };
    const result = RenderEngine.patchQuickInstance(current, "left", { severity: "severe" });
    expect(result).toEqual({ side: "left", severity: "severe", chronicity: "chronic", level: "L4-L5", value: "" });
  });
});
