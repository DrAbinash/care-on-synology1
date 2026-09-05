/**
 * Regression: SELECTED_IMAGES preserves per-image MIME;
 * fallbackUsed provenance must reflect actual fallback behaviour.
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
} = vi.hoisted(() => ({
  resolveComposerRuntime: vi.fn(),
  validateOllamaUrl: vi.fn(() => ({ ok: true as const })),
  resolveSelectedKeyImagesForCompose: vi.fn(),
  assertVisionCapableModel: vi.fn(async () => ({ ok: true as const })),
  resolveComposerProvider: vi.fn(),
  assertComposerProviderPolicy: vi.fn(() => ({ ok: true as const })),
  composeMock: vi.fn(),
}));

vi.mock("../voiceReportComposer/runtimeConfig", () => ({
  resolveComposerRuntime,
}));
vi.mock("../ssrf/ollamaUrlGuard", () => ({
  validateOllamaUrl,
}));
vi.mock("./resolveSelectedKeyImages", () => ({
  resolveSelectedKeyImagesForCompose,
}));
vi.mock("./visionCapability", () => ({
  assertVisionCapableModel,
  __resetVisionCapabilityCacheForTests: vi.fn(),
}));
vi.mock("./providers", async () => {
  const actual = await vi.importActual<typeof import("./providers")>("./providers");
  return {
    ...actual,
    resolveComposerProvider,
    assertComposerProviderPolicy,
  };
});

import { runReportComposer } from "./composeEngine";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

function snapshot(opts: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "Brain",
    regions: ["Brain"],
    bodyPart: "BRAIN",
    family: "brain",
    protocol: "Plain",
    reportTitle: "MRI BRAIN PLAIN",
    studyType: "MRI Brain Plain",
    findings: "Few punctate T2/FLAIR hyperintense white matter lesions.",
    impression: "Mild chronic small-vessel ischemic changes.",
    recommendation: "",
    observations: [],
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

beforeEach(() => {
  vi.clearAllMocks();
  resolveComposerRuntime.mockResolvedValue(baseRuntime());
  validateOllamaUrl.mockReturnValue({ ok: true });
  assertComposerProviderPolicy.mockReturnValue({ ok: true });
  assertVisionCapableModel.mockResolvedValue({ ok: true });
  resolveComposerProvider.mockReturnValue({
    name: "ollama",
    getCapabilities: async () => ({ text: true, vision: true, local: true }),
    compose: composeMock,
  });
});

describe("runReportComposer SELECTED_IMAGES MIME preservation", () => {
  it("passes jpeg/png/webp mimeType + base64 through without coercing to image/jpeg", async () => {
    resolveSelectedKeyImagesForCompose.mockResolvedValue({
      ok: true,
      images: [
        {
          keyImageId: 1,
          mimeType: "image/jpeg",
          base64: "AAAJPEG",
          bytes: 10,
          observationId: null,
          caption: "j",
        },
        {
          keyImageId: 2,
          mimeType: "image/png",
          base64: "AAAPNG",
          bytes: 10,
          observationId: null,
          caption: "p",
        },
        {
          keyImageId: 3,
          mimeType: "image/webp",
          base64: "AAAWEBP",
          bytes: 10,
          observationId: null,
          caption: "w",
        },
      ],
      selectedKeyImageIds: [1, 2, 3],
      linkedObservationIds: [],
    });
    composeMock.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        findings: "Image-assisted findings.",
        impression: "Image-assisted impression.",
        recommendation: "",
      }),
      provider: "ollama",
      model: "test-vision",
      latencyMs: 1,
    });

    const result = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: snapshot({
        aiMode: "SELECTED_IMAGES",
        selectedKeyImages: [
          { keyImageId: 1, caption: "jpeg" },
          { keyImageId: 2, caption: "png" },
          { keyImageId: 3, caption: "webp" },
        ],
      }),
      allowDeterministicFallback: false,
      ownership: {
        draftId: 42,
        studyId: 7,
        worklistId: null,
        patientId: null,
        draftStudyId: 7,
        draftWorklistId: null,
        draftPatientId: null,
      },
    });

    expect(result.ok).toBe(true);
    expect(composeMock).toHaveBeenCalledTimes(1);
    const req = composeMock.mock.calls[0]![0] as {
      images: Array<{ mimeType: string; base64: string }>;
    };
    expect(req.images).toEqual([
      { mimeType: "image/jpeg", base64: "AAAJPEG" },
      { mimeType: "image/png", base64: "AAAPNG" },
      { mimeType: "image/webp", base64: "AAAWEBP" },
    ]);
  });
});

describe("runReportComposer fallbackUsed provenance", () => {
  it("sets fallbackUsed=false when primary fails, no secondary attempted, deterministic disabled", async () => {
    resolveComposerRuntime.mockResolvedValue(baseRuntime({ fallbackModel: null }));
    composeMock.mockResolvedValue({
      ok: false,
      provider: "ollama",
      model: "test-composer",
      safeError: "compose_failed",
      latencyMs: 1,
    });

    const result = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: snapshot({ aiMode: "TEXT_ONLY" }),
      allowDeterministicFallback: false,
    });

    expect(result.ok).toBe(false);
    expect(result.fallbackUsed).toBe(false);
    expect(result.provenance?.fallbackUsed).toBe(false);
    expect(composeMock).toHaveBeenCalledTimes(1);
  });

  it("sets fallbackUsed=true when configured secondary model is attempted and succeeds", async () => {
    resolveComposerRuntime.mockResolvedValue(baseRuntime({ fallbackModel: "backup-model" }));
    composeMock
      .mockResolvedValueOnce({
        ok: false,
        provider: "ollama",
        model: "test-composer",
        safeError: "compose_failed",
        latencyMs: 1,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: JSON.stringify({
          findings: "From fallback model.",
          impression: "Fallback impression.",
          recommendation: "",
        }),
        provider: "ollama",
        model: "backup-model",
        latencyMs: 1,
      });

    const result = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: snapshot({ aiMode: "TEXT_ONLY" }),
      allowDeterministicFallback: false,
    });

    expect(result.ok).toBe(true);
    expect(result.fallbackUsed).toBe(true);
    expect(result.model).toBe("backup-model");
    expect(result.provenance?.fallbackUsed).toBe(true);
    expect(composeMock).toHaveBeenCalledTimes(2);
    expect((composeMock.mock.calls[1]![0] as { model: string }).model).toBe("backup-model");
  });

  it("sets provider/model=deterministic and fallbackUsed=true when deterministic composition runs", async () => {
    resolveComposerRuntime.mockResolvedValue(baseRuntime({ fallbackModel: null }));
    composeMock.mockResolvedValue({
      ok: false,
      provider: "ollama",
      model: "test-composer",
      safeError: "compose_failed",
      latencyMs: 1,
    });

    const result = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: snapshot({ aiMode: "TEXT_ONLY" }),
      allowDeterministicFallback: true,
    });

    expect(result.ok).toBe(true);
    expect(result.model).toBe("deterministic");
    expect(result.fallbackUsed).toBe(true);
    expect(result.provenance?.provider).toBe("deterministic");
    expect(result.provenance?.model).toBe("deterministic");
    expect(result.provenance?.fallbackUsed).toBe(true);
  });
});
