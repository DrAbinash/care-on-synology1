/**
 * Selected-image + region-aware Background Report Composer tests.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  COMPOSER_MAX_SELECTED_KEY_IMAGES,
  parseComposerSnapshot,
  type ComposerInputSnapshot,
} from "./types";
import {
  computeSnapshotHashes,
  canonicalSelectedKeyImagesHashPayload,
  isComposeJobStale,
} from "./snapshot";
import { selectPersonaModules, resolvePrimaryRegionLabel, CARE_PERSONA_VERSION } from "./persona";
import { CARE_MRI_BRAIN, CARE_MRI_SPINE, CARE_MRI_CERVICAL, CARE_MRI_DORSAL, CARE_MRI_LUMBAR, CARE_SELECTED_IMAGE_ASSISTED } from "./persona";
import { validateComposerOutput } from "./validateOutput";
import { buildUserPrompt } from "./composeEngine";
import { classifyOllamaModelVisionByName } from "@workspace/ai-providers";

function snap(opts: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "Brain",
    regions: ["Brain"],
    bodyPart: "BRAIN",
    family: "brain",
    protocol: "Plain",
    reportTitle: "MRI BRAIN PLAIN",
    findings: "Few punctate T2/FLAIR hyperintense white matter lesions, Fazekas grade 1.",
    impression: "Mild chronic small-vessel ischemic changes (Fazekas grade 1).",
    recommendation: "",
    observations: [
      {
        concept: "fazekas",
        source: "quick-select",
        findingsText: "Fazekas grade 1 white matter changes.",
        laterality: null,
        level: null,
      },
    ],
    jobKindHint: "FULL_REPORT",
    ...opts,
  });
}

describe("region routing (spine segments + selected-image module)", () => {
  it("MRI Brain gets Brain rules only", () => {
    const modules = selectPersonaModules(snap({ family: "brain", modality: "MR" }));
    expect(modules).toContain(CARE_MRI_BRAIN);
    expect(modules).not.toContain(CARE_MRI_SPINE);
    expect(modules).not.toContain(CARE_SELECTED_IMAGE_ASSISTED);
    expect(resolvePrimaryRegionLabel(snap({ family: "brain" }))).toBe("MRI Brain");
  });

  it("Cervical gets generic spine + cervical rules", () => {
    const modules = selectPersonaModules(
      snap({
        family: "spine",
        spineSegment: "cervical",
        region: "Cervical Spine",
        bodyPart: "SPINE_CERVICAL",
      }),
    );
    expect(modules).toContain(CARE_MRI_SPINE);
    expect(modules).toContain(CARE_MRI_CERVICAL);
    expect(modules).not.toContain(CARE_MRI_LUMBAR);
    expect(resolvePrimaryRegionLabel(snap({ family: "spine", spineSegment: "cervical" }))).toBe(
      "MRI Cervical Spine",
    );
  });

  it("Dorsal gets generic spine + dorsal rules", () => {
    const modules = selectPersonaModules(
      snap({ family: "spine", spineSegment: "dorsal", bodyPart: "SPINE_DORSAL" }),
    );
    expect(modules).toContain(CARE_MRI_SPINE);
    expect(modules).toContain(CARE_MRI_DORSAL);
  });

  it("Lumbar gets generic spine + lumbar rules", () => {
    const modules = selectPersonaModules(
      snap({ family: "spine", spineSegment: "lumbar", bodyPart: "SPINE_LUMBAR" }),
    );
    expect(modules).toContain(CARE_MRI_SPINE);
    expect(modules).toContain(CARE_MRI_LUMBAR);
    expect(resolvePrimaryRegionLabel(snap({ family: "spine", spineSegment: "lumbar" }))).toBe(
      "MRI Lumbosacral Spine",
    );
  });

  it("Unknown region gets master/safety only", () => {
    const modules = selectPersonaModules(
      snap({ family: "unknown", modality: "OT", region: "Other", bodyPart: undefined }),
    );
    expect(modules).not.toContain(CARE_MRI_BRAIN);
    expect(modules).not.toContain(CARE_MRI_SPINE);
  });

  it("Primary LS plus screening remains LS primary", () => {
    const s = snap({
      family: "spine",
      spineSegment: "lumbar",
      region: "LS Spine",
      regions: ["LS Spine", "Whole Spine Screening"],
      bodyPart: "SPINE_LUMBAR",
    });
    expect(resolvePrimaryRegionLabel(s)).toBe("MRI Lumbosacral Spine");
    const modules = selectPersonaModules(s);
    expect(modules).toContain(CARE_MRI_LUMBAR);
  });

  it("SELECTED_IMAGES adds assisted module without dropping region rules", () => {
    const modules = selectPersonaModules(
      snap({
        family: "brain",
        aiMode: "SELECTED_IMAGES",
        selectedKeyImages: [{ keyImageId: 1, caption: "FLAIR axial" }],
      }),
    );
    expect(modules).toContain(CARE_MRI_BRAIN);
    expect(modules).toContain(CARE_SELECTED_IMAGE_ASSISTED);
  });
});

describe("text-only compatibility", () => {
  it("old snapshots without aiMode/selectedKeyImages still parse", () => {
    const s = parseComposerSnapshot({
      modality: "MR",
      findings: "x",
      impression: "y",
      recommendation: "",
      observations: [],
    });
    expect(s.aiMode).toBeUndefined();
    expect(s.selectedKeyImages).toBeUndefined();
    const h = computeSnapshotHashes(s);
    expect(h.inputHash).toMatch(/^[a-f0-9]{32}$/);
  });

  it("TEXT_ONLY hashes match when selectedKeyImages omitted vs empty", () => {
    const a = computeSnapshotHashes(snap({ aiMode: "TEXT_ONLY" }));
    const b = computeSnapshotHashes(snap({ aiMode: "TEXT_ONLY", selectedKeyImages: [] }));
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.reportRevision).toBe(b.reportRevision);
  });

  it("user prompt for IMPRESSION does not require images", () => {
    const prompt = buildUserPrompt("IMPRESSION", snap({ aiMode: "SELECTED_IMAGES", selectedKeyImages: [{ keyImageId: 9 }] }));
    // Impression jobs still get study context; image caption block is only for FULL_REPORT SELECTED_IMAGES path
    expect(typeof prompt).toBe("string");
  });
});

describe("image selection hashing / stale", () => {
  it("selected IDs participate in inputHash", () => {
    const base = snap({ aiMode: "SELECTED_IMAGES", selectedKeyImages: [{ keyImageId: 1, caption: "a" }] });
    const changed = snap({ aiMode: "SELECTED_IMAGES", selectedKeyImages: [{ keyImageId: 2, caption: "a" }] });
    expect(computeSnapshotHashes(base).inputHash).not.toBe(computeSnapshotHashes(changed).inputHash);
    expect(computeSnapshotHashes(base).reportRevision).toBe(computeSnapshotHashes(changed).reportRevision);
  });

  it("add/remove/reorder/caption change invalidates READY via inputHash", () => {
    const enqueue = snap({
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [
        { keyImageId: 1, caption: "FLAIR" },
        { keyImageId: 2, caption: "T2" },
      ],
    });
    const eh = computeSnapshotHashes(enqueue);

    const removed = snap({
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [{ keyImageId: 1, caption: "FLAIR" }],
    });
    const reordered = snap({
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [
        { keyImageId: 2, caption: "T2" },
        { keyImageId: 1, caption: "FLAIR" },
      ],
    });
    const captioned = snap({
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [
        { keyImageId: 1, caption: "FLAIR updated" },
        { keyImageId: 2, caption: "T2" },
      ],
    });

    for (const live of [removed, reordered, captioned]) {
      const lh = computeSnapshotHashes(live);
      expect(
        isComposeJobStale({
          jobStatus: "READY",
          storedReportRevision: eh.reportRevision,
          storedFindingsHash: eh.findingsHash,
          storedImpressionHash: eh.impressionHash,
          storedInputHash: eh.inputHash,
          current: {
            findingsHash: lh.findingsHash,
            impressionHash: lh.impressionHash,
            reportRevision: lh.reportRevision,
            inputHash: lh.inputHash,
          },
        }).stale,
      ).toBe(true);
    }
  });

  it("max selected images constant is 4", () => {
    expect(COMPOSER_MAX_SELECTED_KEY_IMAGES).toBe(4);
  });

  it("canonicalSelectedKeyImagesHashPayload never includes base64-looking fields from schema", () => {
    const payload = canonicalSelectedKeyImagesHashPayload(
      snap({
        selectedKeyImages: [
          {
            keyImageId: 7,
            caption: "axial FLAIR",
            seriesInstanceUid: "1.2.3",
            sopInstanceUid: "1.2.3.4",
          },
        ],
      }),
    );
    expect(payload).toContain("7");
    expect(payload).toContain("axial FLAIR");
    expect(payload).not.toMatch(/data:image/);
    expect(payload).not.toMatch(/AAAA/);
  });

  it("includeInReport is not part of composer snapshot schema", () => {
    const s = snap({
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [{ keyImageId: 1, caption: "x" }],
    });
    expect(JSON.stringify(s.selectedKeyImages)).not.toContain("includeInReport");
  });
});

describe("vision capability classification", () => {
  it("qwen3-vl:8b is classified as vision", () => {
    expect(classifyOllamaModelVisionByName("qwen3-vl:8b")).toBe("vision");
  });

  it("llama3.2 is text-only", () => {
    expect(classifyOllamaModelVisionByName("llama3.2:3b")).toBe("text-only");
  });

  it("SELECTED_IMAGES FULL_REPORT user prompt includes selected-image context captions", () => {
    const prompt = buildUserPrompt(
      "FULL_REPORT",
      snap({
        aiMode: "SELECTED_IMAGES",
        selectedKeyImages: [
          { keyImageId: 11, caption: "axial FLAIR", observationId: "obs-1" },
          { keyImageId: 12, caption: "sag T2", seriesDescription: "T2 SAG" },
        ],
      }),
    );
    expect(prompt).toMatch(/keyImageId=11|SELECTED|selected/i);
    expect(prompt).toContain("axial FLAIR");
    // Never embeds Orthanc middle-slice fetch language
    expect(prompt).not.toMatch(/middle.?slice|orthanc\/instances/i);
  });
});

describe("clinical safety — selected-image validation", () => {
  it("blocks complete-study review claims", () => {
    const s = snap({
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [{ keyImageId: 1, caption: "FLAIR" }],
    });
    const v = validateComposerOutput(s, {
      findings: "I reviewed the entire MRI dataset. Brain is normal.",
      impression: "Normal MRI brain.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.ok).toBe(false);
    expect(v.errors).toContain("selected_images_claimed_complete_review");
  });

  it("blocks empty selected images in SELECTED_IMAGES mode", () => {
    const s = snap({ aiMode: "SELECTED_IMAGES", selectedKeyImages: [] });
    const v = validateComposerOutput(s, {
      findings: s.findings,
      impression: s.impression,
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.ok).toBe(false);
    expect(v.errors).toContain("selected_images_empty");
  });

  it("blocks diffusion restriction without ADC in corpus", () => {
    const s = snap({
      aiMode: "SELECTED_IMAGES",
      findings: "T2 hyperintensity in left parietal white matter.",
      observations: [
        { concept: "signal", source: "manual", findingsText: "T2 hyperintensity left parietal." },
      ],
      selectedKeyImages: [{ keyImageId: 1, caption: "DWI only" }],
    });
    const v = validateComposerOutput(s, {
      findings: "Restricted diffusion in the left parietal lobe.",
      impression: "Acute infarct.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.ok).toBe(false);
    expect(v.errors).toContain("unsupported_diffusion_restriction");
  });

  it("blocks myelomalacia without supporting observation", () => {
    const s = snap({
      family: "spine",
      spineSegment: "cervical",
      aiMode: "SELECTED_IMAGES",
      findings: "T2 cord hyperintensity at C5-C6.",
      observations: [
        {
          concept: "cord_signal",
          level: "C5-C6",
          source: "manual",
          findingsText: "T2 cord hyperintensity at C5-C6.",
        },
      ],
      selectedKeyImages: [{ keyImageId: 1, caption: "sag T2" }],
    });
    const v = validateComposerOutput(s, {
      findings: "Myelomalacia at C5-C6.",
      impression: "Cervical myelomalacia.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.ok).toBe(false);
    expect(v.errors).toContain("unsupported_myelomalacia");
  });

  it("preserves Fazekas grade — inventing hemorrhage still hard-fails", () => {
    const s = snap();
    const v = validateComposerOutput(s, {
      findings: s.findings,
      impression: "Fazekas grade 1. Acute hemorrhage.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.ok).toBe(false);
    expect(v.unsupportedMentions).toContain("hemorrhage");
  });

  it("persona version is set for provenance", () => {
    expect(CARE_PERSONA_VERSION).toMatch(/selected-image/);
  });
});

describe("hash payload stability helper", () => {
  it("sha of payload is stable", () => {
    const p = canonicalSelectedKeyImagesHashPayload(
      snap({ selectedKeyImages: [{ keyImageId: 3, caption: "x" }] }),
    );
    const h1 = createHash("sha256").update(p).digest("hex").slice(0, 16);
    const h2 = createHash("sha256").update(p).digest("hex").slice(0, 16);
    expect(h1).toBe(h2);
  });
});
