/**
 * The composer's selected-image path must size its own context window and must
 * refuse rather than let Ollama truncate the radiologist's observations.
 *
 * Two halves on purpose:
 *  A) with a controlled short system prompt, the arithmetic for 1/2/3/4 images;
 *  B) with the REAL CARE radiologist persona, what actually happens to a
 *     4-image LS-spine request today.
 *
 * Harness (mock surface) mirrors composeEngine.mimeAndFallback.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  resolveComposerRuntime,
  validateOllamaUrl,
  resolveSelectedKeyImagesForCompose,
  assertVisionCapableModel,
  resolveComposerProvider,
  assertComposerProviderPolicy,
  composeMock,
  buildCareSystemPromptMock,
} = vi.hoisted(() => ({
  resolveComposerRuntime: vi.fn(),
  validateOllamaUrl: vi.fn(() => ({ ok: true as const })),
  resolveSelectedKeyImagesForCompose: vi.fn(),
  assertVisionCapableModel: vi.fn(async () => ({ ok: true as const })),
  resolveComposerProvider: vi.fn(),
  assertComposerProviderPolicy: vi.fn(() => ({ ok: true as const })),
  composeMock: vi.fn(),
  buildCareSystemPromptMock: vi.fn(() => "S".repeat(400)),
}));

vi.mock("../voiceReportComposer/runtimeConfig", () => ({ resolveComposerRuntime }));
vi.mock("../ssrf/ollamaUrlGuard", () => ({ validateOllamaUrl }));
vi.mock("./resolveSelectedKeyImages", () => ({ resolveSelectedKeyImagesForCompose }));
vi.mock("./visionCapability", () => ({
  assertVisionCapableModel,
  __resetVisionCapabilityCacheForTests: vi.fn(),
}));
vi.mock("./providers", async () => {
  const actual = await vi.importActual<typeof import("./providers")>("./providers");
  return { ...actual, resolveComposerProvider, assertComposerProviderPolicy };
});
vi.mock("./persona", () => ({
  buildCareSystemPrompt: buildCareSystemPromptMock,
  CARE_PERSONA_VERSION: "vitest-persona",
}));

import { runReportComposer } from "./composeEngine";
import { planComposerVisionContext } from "./composerContextBudget";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";
import { PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX } from "../ai/contextBudget";

function snapshot(opts: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    regions: ["LS Spine"],
    bodyPart: "SPINE_LUMBAR",
    family: "spine",
    spineSegment: "lumbar",
    protocol: "MRI Lumbar Spine",
    reportTitle: "MRI LS SPINE",
    studyType: "MRI LS Spine",
    clinicalHistory: "Low back pain with right leg radiculopathy.",
    technique: "Multiplanar multisequence MRI of the lumbar spine.",
    findings: "Loss of lordosis. Disc desiccation at L3-L4, L4-L5 and L5-S1.",
    impression: "L4-L5 disc bulge with canal stenosis.",
    recommendation: "",
    observations: [
      {
        concept: "canal_ap",
        source: "structured" as const,
        region: "LS Spine",
        level: "L4-L5",
        measurement: "7.1",
        findingsText: "At L4-L5, AP canal diameter measures 7.1 mm.",
      },
    ],
    jobKindHint: "FULL_REPORT",
    ...opts,
  });
}

function baseRuntime(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    endpoint: "http://127.0.0.1:11434",
    endpointSource: "test",
    model: "test-composer",
    fallbackModel: null as string | null,
    numCtx: 4096,
    temperature: 0.1,
    timeoutMs: 30_000,
    localOnly: true,
    visionModel: "test-vision",
    ...overrides,
  };
}

function images(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    keyImageId: i + 1,
    mimeType: "image/jpeg" as const,
    base64: "AAAJPEG",
    bytes: 10,
    observationId: null,
    caption: `frame ${i + 1}`,
  }));
}

function mockImages(count: number) {
  resolveSelectedKeyImagesForCompose.mockResolvedValue({
    ok: true,
    images: images(count),
    linkedObservationIds: [],
    selectedKeyImageIds: Array.from({ length: count }, (_, i) => i + 1),
  });
}

const OWNERSHIP = {
  draftId: 42,
  studyId: 7,
  worklistId: 7,
  patientId: 11,
  draftStudyId: 7,
  draftWorklistId: 7,
  draftPatientId: 11,
};

async function composeSelectedImages(snap = snapshot({ aiMode: "SELECTED_IMAGES" })) {
  return runReportComposer({
    kind: "FULL_REPORT",
    snapshot: snap,
    allowDeterministicFallback: false,
    ownership: OWNERSHIP,
  });
}

function sentRequest() {
  return composeMock.mock.calls[0]?.[0] as {
    numCtx: number;
    images?: unknown[];
    userPrompt: string;
    systemPrompt: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveComposerRuntime.mockResolvedValue(baseRuntime());
  validateOllamaUrl.mockReturnValue({ ok: true });
  assertComposerProviderPolicy.mockReturnValue({ ok: true });
  assertVisionCapableModel.mockResolvedValue({ ok: true });
  buildCareSystemPromptMock.mockReturnValue("S".repeat(400));
  resolveComposerProvider.mockReturnValue({
    name: "ollama",
    getCapabilities: async () => ({ text: true, vision: true, local: true }),
    compose: composeMock,
  });
  composeMock.mockResolvedValue({
    ok: true,
    text: JSON.stringify({
      findings: "Findings.",
      impression: "Impression.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    }),
    provider: "ollama",
    model: "test-vision",
    latencyMs: 5,
    execution: "LOCAL",
  });
});

describe("A. selected-image num_ctx arithmetic (controlled prompt)", () => {
  it("1 image fits the clinic default and is not inflated", async () => {
    mockImages(1);
    const run = await composeSelectedImages();
    expect(run.ok).toBe(true);
    expect(sentRequest().numCtx).toBe(4096);
  });

  it("2 images still fit the clinic default", async () => {
    mockImages(2);
    const run = await composeSelectedImages();
    expect(run.ok).toBe(true);
    expect(sentRequest().numCtx).toBe(4096);
  });

  it("3 images raise num_ctx above the default, within the ceiling", async () => {
    mockImages(3);
    const run = await composeSelectedImages();
    expect(run.ok).toBe(true);
    const sent = sentRequest();
    expect(sent.numCtx).toBeGreaterThan(4096);
    expect(sent.numCtx).toBeLessThanOrEqual(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
  });

  it("4 images raise num_ctx further and still stay inside the ceiling", async () => {
    mockImages(4);
    const run = await composeSelectedImages();
    expect(run.ok).toBe(true);
    const sent = sentRequest();
    expect(sent.numCtx).toBeGreaterThan(4096);
    expect(sent.numCtx).toBeLessThanOrEqual(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
    // Monotonic: more images never mean less requested context.
    expect(sent.numCtx).toBeGreaterThan(3_000);
  });

  it("sends exactly what the shared estimator asked for", async () => {
    mockImages(4);
    const snap = snapshot({ aiMode: "SELECTED_IMAGES" });
    await composeSelectedImages(snap);
    const expected = planComposerVisionContext({
      imageCount: 4,
      systemPrompt: sentRequest().systemPrompt,
      userPrompt: sentRequest().userPrompt,
      configuredNumCtx: 4096,
    });
    expect(sentRequest().numCtx).toBe(expected.numCtx);
  });

  it("never lowers a configured window that already fits", async () => {
    resolveComposerRuntime.mockResolvedValue(baseRuntime({ numCtx: PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX }));
    mockImages(2);
    await composeSelectedImages();
    expect(sentRequest().numCtx).toBe(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
  });

  it("fails closed and sends NOTHING when even the ceiling cannot hold it", async () => {
    mockImages(4);
    buildCareSystemPromptMock.mockReturnValue("S".repeat(60_000));
    const run = await composeSelectedImages();
    expect(run.ok).toBe(false);
    expect(run.safeError).toBe("composer_context_budget_exceeded");
    expect(composeMock).not.toHaveBeenCalled();
    expect(run.provenance?.degradedReason).toMatch(/fewer key images/i);
    expect(run.provenance?.imagesLoaded).toBe(4);
  });

  it("TEXT_ONLY keeps using the configured window untouched", async () => {
    const run = await composeSelectedImages(snapshot({ aiMode: "TEXT_ONLY" }));
    expect(run.ok).toBe(true);
    const sent = sentRequest();
    expect(sent.numCtx).toBe(4096);
    expect(sent.images).toBeUndefined();
  });

  it("selected-image drafting never degrades to a deterministic draft", async () => {
    resolveComposerRuntime.mockResolvedValue(baseRuntime({ enabled: false, model: "" }));
    mockImages(4);
    const run = await composeSelectedImages();
    expect(run.safeError).toBe("composer_model_not_configured");
    expect(composeMock).not.toHaveBeenCalled();
  });
});

describe("B. at the measured real persona size, what the clinic can actually do", () => {
  // Measured against the live composer prompt assembly for an MRI LS Spine
  // FULL_REPORT request: system 11,053 characters (+ ~1.5k user prompt).
  const MEASURED_PERSONA_CHARS = 11_053;

  it("3 images still go through, at a raised but legal window", async () => {
    mockImages(3);
    buildCareSystemPromptMock.mockReturnValue("S".repeat(MEASURED_PERSONA_CHARS));
    const run = await composeSelectedImages();
    expect(run.ok).toBe(true);
    const sent = sentRequest();
    expect(sent.numCtx).toBeGreaterThan(4096);
    expect(sent.numCtx).toBeLessThanOrEqual(PREFERRED_MULTI_IMAGE_DRAFT_NUM_CTX);
  });

  it("4 images are refused with the number that DOES fit, not a silent truncation", async () => {
    mockImages(4);
    buildCareSystemPromptMock.mockReturnValue("S".repeat(MEASURED_PERSONA_CHARS));
    const run = await composeSelectedImages();
    expect(run.ok).toBe(false);
    expect(run.safeError).toBe("composer_context_budget_exceeded");
    expect(composeMock).not.toHaveBeenCalled();
    expect(run.provenance?.degradedReason).toMatch(/3 fit this report/i);
    expect(run.provenance?.degradedReason).toMatch(/ollama_composer_num_ctx/i);
  });
});
