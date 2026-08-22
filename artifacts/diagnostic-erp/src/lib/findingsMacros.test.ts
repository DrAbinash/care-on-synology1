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
import { buildReportingStudyContext } from "./reportingStudyContext";

afterEach(() => {
  resetAllChocolateBoxes();
});

describe("chocolateBoxSetFor", () => {
  it("prefers the selected region over the DICOM description", () => {
    const set = chocolateBoxSetFor(buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI BRAIN PLAIN",
      regions: ["LS Spine"],
      source: "override",
    }));
    expect(set?.key).toBe("lumbar");
    expect(set?.tiles.map((t) => t.label)).toContain("L1-2 Level");
    expect(set?.tiles.map((t) => t.label)).not.toContain("C5-6 Level");
  });

  it("does not guess Brain from description when no region is resolved", () => {
    expect(chocolateBoxSetFor(buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI BRAIN PLAIN",
      regions: [],
      source: "unresolved",
    }))).toBeNull();
  });

  it("picks cervical-specific tiles, not lumbar", () => {
    const set = chocolateBoxSetFor(buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI Cervical Spine",
      regions: ["Cervical Spine"],
      source: "auto",
    }));
    expect(set?.key).toBe("cervical");
    expect(set?.tiles.map((t) => t.label)).toContain("C5-6 Level");
    expect(set?.tiles.map((t) => t.label)).not.toContain("L1-2 Level");
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
      "Basal Ganglia Hemorrhage",
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
    const set = resolvedChocolateBoxSet(buildReportingStudyContext({
      modality: "MR",
      studyDescription: "MRI NECK",
      regions: ["Neck"],
      source: "auto",
    }));
    expect(set.key).toBe("neck");
    expect(set.tiles).toEqual([]);
    upsertChocolateTile(set.key, { label: "Normal neck", text: "Neck soft tissues are unremarkable." });
    expect(loadChocolateTiles("neck")).toHaveLength(1);
  });
});
