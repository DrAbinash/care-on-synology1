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

  it("returns null instead of guessing a body part the study never named", () => {
    // Every one of these used to resolve confidently: MRI and CT to BRAIN, USG to
    // ABDOMEN, X-RAY to CHEST. The modality matched, the anatomy did not, and the
    // function answered as though both had.
    expect(inferStructuredTemplateMatch("MR", "MRI KNEE")).toBeNull();
    expect(inferStructuredTemplateMatch("MRI", "MR LEFT KNEE")).toBeNull();
    expect(inferStructuredTemplateMatch("CT", "CT LIVER")).toBeNull();
    expect(inferStructuredTemplateMatch("USG", "USG BREAST")).toBeNull();
    expect(inferStructuredTemplateMatch("XR", "X-RAY RIGHT HAND")).toBeNull();
  });

  it("still matches the anatomy it is actually told", () => {
    // Guards the other direction: null-ing the fallback must not have narrowed
    // the keyword matches that real PACS descriptions rely on.
    expect(inferStructuredTemplateMatch("MRI", "MRI BRAIN WITH CONTRAST")).toEqual({
      bodyPart: "BRAIN",
      studyType: "CONTRAST",
    });
    expect(inferStructuredTemplateMatch("MRI", "MRI DWI STROKE PROTOCOL")).toEqual({
      bodyPart: "BRAIN",
      studyType: "STROKE_PROTOCOL",
    });
    expect(inferStructuredTemplateMatch("CT", "HRCT CHEST")).toEqual({
      bodyPart: "CHEST",
      studyType: "HRCT",
    });
    expect(inferStructuredTemplateMatch("USG", "KUB ULTRASOUND")).toEqual({
      bodyPart: "ABDOMEN",
      studyType: undefined,
    });
    expect(inferStructuredTemplateMatch("MR", "MRI DORSAL SPINE")).toEqual({
      bodyPart: "SPINE_DORSAL",
      studyType: "PLAIN",
    });
  });
});

describe("which format a region opens on — the declared default, not the sort order", () => {
  it("takes the declared default even when another row sorts first", () => {
    // The whole reason isDefault exists. Production shipped with it false on all
    // 29 rows, so every region resolved through the rows[0] tail below and a
    // brain study landed on "MRI Brain Plain" only because P sorts before S and W.
    const rows = [
      { id: 1, templateName: "MRI Brain Advanced Research", modality: "MRI", bodyPart: "BRAIN", studyType: "RESEARCH" },
      { id: 2, templateName: "MRI Brain Plain", modality: "MRI", bodyPart: "BRAIN", studyType: "PLAIN", isDefault: true },
      { id: 3, templateName: "MRI Brain With Contrast", modality: "MRI", bodyPart: "BRAIN", studyType: "CONTRAST" },
    ];
    expect(pickStructuredTemplateForRegion(rows, "MR", "Brain")?.id).toBe(2);
  });

  it("resolves no format for a region the mapping does not know", () => {
    // studyRegionToBodyPart covers spine segments, brain, chest and abdomen only.
    // USG regions — obstetric, pelvis, scrotum, limb doppler — are not in it, so
    // the region path returns null for them rather than guessing. Recorded here
    // because it is easy to misread as a bug: ultrasound reporting runs through
    // its own surface and does not depend on this path.
    const rows = [
      { id: 1, templateName: "Anomaly Scan", modality: "USG", bodyPart: "OBSTETRIC", studyType: "ANOMALY" },
      { id: 2, templateName: "Early Pregnancy", modality: "USG", bodyPart: "OBSTETRIC", studyType: "EARLY" },
    ];
    expect(pickStructuredTemplateForRegion(rows, "USG", "Obstetric")).toBeNull();
    // …and the same rows do resolve once the region is one the mapping knows,
    // so this is the mapping refusing, not the pool being empty.
    expect(pickStructuredTemplateForRegion(
      [{ id: 1, templateName: "USG Abdomen", modality: "USG", bodyPart: "ABDOMEN", studyType: "GREY_SCALE" }],
      "USG",
      "Abdomen",
    )?.id).toBe(1);
  });
});

describe("pickStructuredTemplate", () => {
  it("chooses no template for an unrecognised MRI rather than the brain one", () => {
    // TEMPLATES holds an MRI Brain row, which is exactly what an MRI knee used to
    // be handed. With formats seeded in production this stops being cosmetic:
    // brain sections would pre-fill a knee report.
    const match = pickStructuredTemplate(TEMPLATES, "MR", "MRI KNEE");
    expect(match).toBeNull();
  });

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

  it("does not guess Brain when the region has no template mapping", () => {
    const match = pickStructuredTemplateForRegion(
      TEMPLATES,
      "MR",
      "Knee",
    );
    expect(match).toBeNull();
  });
});

describe("studyRegionToBodyPart", () => {
  it("maps LS Spine region", () => {
    expect(studyRegionToBodyPart("LS Spine")).toBe("SPINE_LS");
  });

  it("maps cervical / dorsal / whole separately", () => {
    expect(studyRegionToBodyPart("Cervical Spine")).toBe("SPINE_CERVICAL");
    expect(studyRegionToBodyPart("Dorsal Spine")).toBe("SPINE_DORSAL");
    expect(studyRegionToBodyPart("Whole Spine")).toBe("SPINE_WHOLE");
    expect(studyRegionToBodyPart("Knee")).toBeNull();
  });
});

describe("templateRegionMismatch", () => {
  it("flags brain template on spine region", () => {
    expect(templateRegionMismatch("LS Spine", "BRAIN")).toBe(true);
    expect(templateRegionMismatch("LS Spine", "SPINE_LS")).toBe(false);
  });
});
