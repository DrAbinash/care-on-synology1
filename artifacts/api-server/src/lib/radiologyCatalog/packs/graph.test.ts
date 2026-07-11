import { describe, it, expect } from "vitest";
import { buildNormalizedGraph, expandCombo } from "./graph";
import { load, VALID_PACK, EXTENDS_PACK, COMBO_PACK } from "./__fixtures__/packs";

describe("graph — normalization & shared-library resolution", () => {
  it("resolves refs to complete rows (labels from registries)", () => {
    const g = buildNormalizedGraph([load("v", VALID_PACK)]);
    const circle = g.findings.find((f) => f.id_key === "shapes.circle")!;
    expect(circle.parameters).toEqual([{ param_key: "shade", required: true, default_option_key: "light", sort_order: 0 }]);
    expect(circle.severities).toEqual([{ key: "sev_low", label: "Low", rank: 1, sort_order: 0 }]);
    expect(circle.locations[0]).toMatchObject({ key: "north", label: "North region", laterality: "left" });
    expect(circle.measurements[0]).toMatchObject({ key: "radius", unit: "mm", min: 0, max: 500 });
    expect(circle.recommendations[0]).toMatchObject({ text: "Observe over time.", priority: "routine" });
    expect(circle.aliases.sort()).toEqual(["disc", "round thing"]);
    expect(g.parameters[0].options.map((o) => o.key).sort()).toEqual(["dark", "light"]);
  });
});

describe("graph — extends inheritance", () => {
  it("child inherits base bindings and adds its own", () => {
    const g = buildNormalizedGraph([load("e", EXTENDS_PACK)]);
    const child = g.findings.find((f) => f.id_key === "child.shape")!;
    expect(child.parameters.map((p) => p.param_key)).toContain("shade");   // inherited
    expect(child.severities.map((s) => s.key)).toContain("base_sev");       // inherited
    expect(child.locations.map((l) => l.key)).toContain("base_loc");        // inherited
    expect(child.measurements.map((m) => m.key)).toContain("size");         // own
    expect(child.display_name).toBe("Child shape");                          // own scalar
  });
});

describe("graph — combo expansion", () => {
  it("transitively expands included findings", () => {
    const g = buildNormalizedGraph([load("c", COMBO_PACK)]);
    expect(expandCombo(g, "combo.all").sort()).toEqual(["leaf.a", "leaf.b"]);
    expect(expandCombo(g, "leaf.a")).toEqual([]);
  });
});
