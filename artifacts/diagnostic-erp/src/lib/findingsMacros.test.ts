import { afterEach, describe, expect, it } from "vitest";
import {
  chocolateBoxSetFor,
  deleteChocolateTile,
  loadChocolateTiles,
  resetAllChocolateBoxes,
  resetChocolateTiles,
  resolvedChocolateBoxSet,
  upsertChocolateTile,
} from "./findingsMacros";

afterEach(() => {
  resetAllChocolateBoxes();
});

describe("chocolateBoxSetFor", () => {
  it("prefers the selected region over the DICOM description", () => {
    const set = chocolateBoxSetFor("MR", "MRI BRAIN PLAIN", "LS Spine");
    expect(set?.key).toBe("spine");
  });

  it("matches brain from description when no region is set", () => {
    expect(chocolateBoxSetFor("MR", "MRI BRAIN PLAIN")?.key).toBe("brain");
  });
});

describe("chocolate box add / edit from the workstation", () => {
  it("loads built-in Brain tiles before any customisation", () => {
    const tiles = loadChocolateTiles("brain");
    expect(tiles.map((t) => t.label)).toEqual([
      "Infarct",
      "Senile Changes",
      "Pituitary Tumor",
      "Normal Brain",
    ]);
  });

  it("adds a custom box and keeps the built-ins", () => {
    upsertChocolateTile("brain", { label: "Meningioma", text: "Dural-based [mass] in the [location]." });
    const labels = loadChocolateTiles("brain").map((t) => t.label);
    expect(labels).toContain("Infarct");
    expect(labels).toContain("Meningioma");
  });

  it("edits an existing box in place", () => {
    upsertChocolateTile("brain", {
      id: "brain-infarct",
      label: "Acute infarct",
      text: "Restricted diffusion in [territory].",
    });
    const tile = loadChocolateTiles("brain").find((t) => t.id === "brain-infarct");
    expect(tile?.label).toBe("Acute infarct");
    expect(tile?.text).toContain("Restricted diffusion");
  });

  it("deletes a box and can restore defaults", () => {
    deleteChocolateTile("brain", "brain-infarct");
    expect(loadChocolateTiles("brain").some((t) => t.id === "brain-infarct")).toBe(false);
    resetChocolateTiles("brain");
    expect(loadChocolateTiles("brain").some((t) => t.id === "brain-infarct")).toBe(true);
  });

  it("still shows an addable set for unmatched regions", () => {
    const set = resolvedChocolateBoxSet("MR", "MRI NECK", "Neck");
    expect(set.key).toBe("neck");
    expect(set.tiles).toEqual([]);
    upsertChocolateTile(set.key, { label: "Normal neck", text: "Neck soft tissues are unremarkable." });
    expect(loadChocolateTiles("neck")).toHaveLength(1);
  });
});
