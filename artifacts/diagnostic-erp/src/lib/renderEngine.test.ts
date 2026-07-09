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
