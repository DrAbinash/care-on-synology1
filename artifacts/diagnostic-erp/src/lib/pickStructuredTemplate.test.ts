import { describe, expect, it, vi } from "vitest";
import {
  inferStructuredTemplateMatch,
  pickStructuredTemplate,
  pickStructuredTemplateForRegion,
  studyRegionToBodyPart,
  templateRegionMismatch,
} from "./pickStructuredTemplate";

const TEMPLATES = [
  { id: 1, templateName: "MRI Brain Plain", modality: "MRI", bodyPart: "BRAIN", studyType: "PLAIN" },
  { id: 2, templateName: "MRI LS Spine", modality: "MRI", bodyPart: "SPINE_LS", studyType: "PLAIN" },
  { id: 3, templateName: "MRI Cervical Spine", modality: "MRI", bodyPart: "SPINE_CERVICAL", studyType: "PLAIN" },
];

describe("inferStructuredTemplateMatch", () => {
  it("detects LS spine from common PACS descriptions", () => {
    expect(inferStructuredTemplateMatch("MR", "MRI LS SPINE")).toEqual({
      bodyPart: "SPINE_LS",
      studyType: "PLAIN",
    });
    expect(inferStructuredTemplateMatch("MRI", "02-Aug-2026 LS SPINE MR 263")).toEqual({
      bodyPart: "SPINE_LS",
      studyType: "PLAIN",
    });
  });

  it("detects brain studies", () => {
    expect(inferStructuredTemplateMatch("MR", "MRI BRAIN PLAIN")).toEqual({
      bodyPart: "BRAIN",
      studyType: "PLAIN",
    });
  });
});

describe("pickStructuredTemplate", () => {
  it("picks LS spine template not brain for LS spine study", () => {
    const match = pickStructuredTemplate(TEMPLATES, "MR", "MRI LS SPINE");
    expect(match?.id).toBe(2);
    expect(match?.templateName).toBe("MRI LS Spine");
  });

  it("does not use broken bodyPart substring match", () => {
    // Old bug: "MRI LS SPINE".includes("SPINE_LS") === false → fell back to first MRI (Brain)
    const match = pickStructuredTemplate(TEMPLATES, "MR", "LS SPINE MR");
    expect(match?.bodyPart).toBe("SPINE_LS");
  });
});

describe("pickStructuredTemplateForRegion", () => {
  it("loads LS Spine template even when description would default to MRI Brain", () => {
    const match = pickStructuredTemplateForRegion(
      TEMPLATES,
      "MR",
      "LS Spine",
      "MRI",
    );
    expect(match?.bodyPart).toBe("SPINE_LS");
    expect(match?.templateName).not.toMatch(/brain/i);
  });

  it("prefers the region default / v2 format when several LS Spine rows exist", () => {
    const rows = [
      ...TEMPLATES,
      { id: 9, templateName: "MRI Lumbosacral Spine – CARE Standard", modality: "MRI", bodyPart: "SPINE_LS", studyType: "PLAIN", isDefault: true, schemaVersion: 2 },
    ];
    const match = pickStructuredTemplate(rows, "MR", "MRI LS SPINE");
    expect(match?.id).toBe(9);
  });

  it("warns in non-production when multiple templates are marked isDefault for one region", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = [
      { id: 1, templateName: "A", modality: "MRI", bodyPart: "SPINE_LS", studyType: "PLAIN", isDefault: true, schemaVersion: 2 },
      { id: 2, templateName: "B", modality: "MRI", bodyPart: "SPINE_LS", studyType: "PLAIN", isDefault: true, schemaVersion: 2 },
    ];
    const match = pickStructuredTemplate(rows, "MR", "MRI LS SPINE");
    expect(match?.id).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      "[pickStructuredTemplate] 2 templates have isDefault=true for the same region; using the first.",
    );
    warn.mockRestore();
  });
});

describe("studyRegionToBodyPart", () => {
  it("maps LS Spine region", () => {
    expect(studyRegionToBodyPart("LS Spine")).toBe("SPINE_LS");
  });
});

describe("templateRegionMismatch", () => {
  it("flags brain template on spine region", () => {
    expect(templateRegionMismatch("LS Spine", "BRAIN")).toBe(true);
    expect(templateRegionMismatch("LS Spine", "SPINE_LS")).toBe(false);
  });
});
