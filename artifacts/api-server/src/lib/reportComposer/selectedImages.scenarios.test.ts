/**
 * Manual-walkthrough scenario matrix — automated evidence for §15 items
 * that do not require a live Ollama / Orthanc stack.
 */
import { describe, expect, it } from "vitest";
import {
  COMPOSER_MAX_SELECTED_KEY_IMAGES,
  parseComposerSnapshot,
} from "./types";
import { computeSnapshotHashes, isComposeJobStale } from "./snapshot";
import { validateComposerOutput } from "./validateOutput";
import {
  selectPersonaModules,
  resolvePrimaryRegionLabel,
  CARE_SELECTED_IMAGE_ASSISTED,
  CARE_MRI_CERVICAL,
  CARE_MRI_LUMBAR,
} from "./persona";
import { buildUserPrompt } from "./composeEngine";
import { classifyOllamaModelVisionByName } from "@workspace/ai-providers";

describe("§15 scenario matrix (automated)", () => {
  it("1. MRI Brain observations only", () => {
    const s = parseComposerSnapshot({
      modality: "MR",
      family: "brain",
      region: "Brain",
      regions: ["Brain"],
      bodyPart: "BRAIN",
      findings: "Fazekas grade 1.",
      impression: "",
      recommendation: "",
      observations: [],
      aiMode: "TEXT_ONLY",
    });
    expect(resolvePrimaryRegionLabel(s)).toBe("MRI Brain");
    expect(selectPersonaModules(s)).not.toContain(CARE_SELECTED_IMAGE_ASSISTED);
  });

  it("2. MRI Cervical with canal measurement context", () => {
    const s = parseComposerSnapshot({
      modality: "MR",
      family: "spine",
      spineSegment: "cervical",
      region: "Cervical Spine",
      regions: ["Cervical Spine"],
      bodyPart: "SPINE_CERVICAL",
      findings: "AP canal at C5-C6 measures 9 mm.",
      impression: "",
      recommendation: "",
      observations: [
        {
          concept: "canal_ap",
          level: "C5-C6",
          findingsText: "AP canal at C5-C6 measures 9 mm.",
        },
      ],
      aiMode: "TEXT_ONLY",
    });
    expect(resolvePrimaryRegionLabel(s)).toBe("MRI Cervical Spine");
    expect(selectPersonaModules(s)).toContain(CARE_MRI_CERVICAL);
  });

  it("3. MRI LS + whole-spine screening stays LS primary", () => {
    const s = parseComposerSnapshot({
      modality: "MR",
      family: "spine",
      spineSegment: "lumbar",
      region: "LS Spine",
      regions: ["LS Spine", "Whole Spine Screening"],
      bodyPart: "SPINE_LUMBAR",
      findings: "Disc bulge L4-L5.",
      impression: "",
      recommendation: "",
      observations: [],
      aiMode: "TEXT_ONLY",
    });
    expect(resolvePrimaryRegionLabel(s)).toBe("MRI Lumbosacral Spine");
    expect(selectPersonaModules(s)).toContain(CARE_MRI_LUMBAR);
  });

  it("4. Selected-image mode with two key images — hash + prompt", () => {
    const s = parseComposerSnapshot({
      modality: "MR",
      family: "brain",
      findings: "Fazekas grade 1.",
      impression: "",
      recommendation: "",
      observations: [],
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [
        { keyImageId: 101, caption: "axial FLAIR" },
        { keyImageId: 102, caption: "DWI b1000" },
      ],
      jobKindHint: "FULL_REPORT",
    });
    expect(selectPersonaModules(s)).toContain(CARE_SELECTED_IMAGE_ASSISTED);
    const prompt = buildUserPrompt("FULL_REPORT", s);
    expect(prompt).toContain("axial FLAIR");
    expect(prompt).toContain("keyImageId=101");
    expect(prompt).not.toMatch(/middle.?slice/i);
  });

  it("5. No selected images — validation blocks READY", () => {
    const s = parseComposerSnapshot({
      modality: "MR",
      family: "brain",
      findings: "x",
      impression: "",
      recommendation: "",
      observations: [],
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [],
    });
    const v = validateComposerOutput(s, {
      findings: "x",
      impression: "Normal",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.ok).toBe(false);
    expect(v.errors).toContain("selected_images_empty");
  });

  it("6. Text-only model classified as text-only (vision gate input)", () => {
    expect(classifyOllamaModelVisionByName("llama3.2:3b")).toBe("text-only");
    expect(classifyOllamaModelVisionByName("qwen3-vl:8b")).toBe("vision");
  });

  it("7. Ollama offline / image job does not mutate report — empty selection fails closed", () => {
    // Report text is only mutated via applyAiComposerAccepted after READY+Accept.
    // Empty/failed selected-image jobs never reach READY (validated here).
    const s = parseComposerSnapshot({
      modality: "MR",
      family: "brain",
      findings: "Protected manual findings.",
      impression: "Protected impression.",
      recommendation: "",
      observations: [],
      aiMode: "SELECTED_IMAGES",
      selectedKeyImages: [],
    });
    const v = validateComposerOutput(s, {
      findings: "AI would overwrite",
      impression: "AI would overwrite",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.ok).toBe(false);
    expect(s.findings).toBe("Protected manual findings.");
  });

  it("8. Report edited while composing → STALE via inputHash/reportRevision", () => {
    const enqueue = parseComposerSnapshot({
      modality: "MR",
      family: "brain",
      findings: "Original findings.",
      impression: "",
      recommendation: "",
      observations: [],
      aiMode: "TEXT_ONLY",
      jobKindHint: "FULL_REPORT",
    });
    const live = parseComposerSnapshot({
      ...enqueue,
      findings: "Edited while composing.",
    });
    const eh = computeSnapshotHashes(enqueue);
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
  });

  it("9. Study context switch while composing → STALE via inputHash", () => {
    const enqueue = parseComposerSnapshot({
      modality: "MR",
      family: "brain",
      protocol: "Plain",
      reportTitle: "MRI BRAIN PLAIN",
      findings: "Same text.",
      impression: "",
      recommendation: "",
      observations: [],
      aiMode: "TEXT_ONLY",
      jobKindHint: "FULL_REPORT",
    });
    const live = parseComposerSnapshot({
      ...enqueue,
      protocol: "Contrast",
      reportTitle: "MRI BRAIN CONTRAST",
    });
    const eh = computeSnapshotHashes(enqueue);
    const lh = computeSnapshotHashes(live);
    expect(eh.reportRevision).toBe(lh.reportRevision);
    expect(eh.inputHash).not.toBe(lh.inputHash);
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
  });

  it("10–12. Max images + no auto-apply contract markers", () => {
    expect(COMPOSER_MAX_SELECTED_KEY_IMAGES).toBe(4);
    // Apply remains client-gated; STALE_READY cannot pass isComposeJobStale as fresh.
    const h = computeSnapshotHashes(
      parseComposerSnapshot({
        modality: "MR",
        findings: "a",
        impression: "",
        recommendation: "",
        observations: [],
        aiMode: "TEXT_ONLY",
        jobKindHint: "FULL_REPORT",
      }),
    );
    expect(
      isComposeJobStale({
        jobStatus: "STALE_READY",
        storedReportRevision: "old",
        storedFindingsHash: "old",
        storedImpressionHash: "old",
        storedInputHash: "old",
        current: {
          findingsHash: h.findingsHash,
          impressionHash: h.impressionHash,
          reportRevision: h.reportRevision,
          inputHash: h.inputHash,
        },
      }).stale,
    ).toBe(true);
  });
});
