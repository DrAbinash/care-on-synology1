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
  assertComposerProviderPolicy: vi.fn((): GateResult => ({ ok: true })),
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

/**
 * The provider gate returns a union, and `vi.fn()` fixes its return type at the
 * first value it is handed. Both the default here and the refusals in the PR-A
 * block below therefore go through these typed values, or a refusal stops
 * compiling as `{ ok: true }`.
 */
type GateResult = { ok: true } | { ok: false; safeError: string };
const ALLOW_GATE: GateResult = { ok: true };
const denyGate = (safeError: string): GateResult => ({ ok: false, safeError });

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
  assertComposerProviderPolicy.mockReturnValue(ALLOW_GATE);
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

describe("PR-A — the image gate is re-run on the bytes' real provenance", () => {
  const gateCalls = () =>
    assertComposerProviderPolicy.mock.calls as unknown as Array<[Record<string, unknown>]>;

  function resolvedImages(sourceTypes: string[]) {
    return {
      ok: true,
      images: sourceTypes.map((sourceType, i) => ({
        keyImageId: i + 1,
        mimeType: "image/jpeg",
        base64: `AAABYQFNFBRA${i}`,
        bytes: 12,
        observationId: null,
        caption: `frame ${i + 1}`,
        sourceType,
      })),
      selectedKeyImageIds: sourceTypes.map((_, i) => i + 1),
      linkedObservationIds: [],
    };
  }

  function imageRequest(count: number) {
    return {
      kind: "FULL_REPORT" as const,
      snapshot: snapshot({
        aiMode: "SELECTED_IMAGES",
        selectedKeyImages: Array.from({ length: count }, (_, i) => ({
          keyImageId: i + 1,
          caption: `frame ${i + 1}`,
        })),
      }),
      allowDeterministicFallback: false,
      ownership: {
        draftId: 42,
        studyId: 7,
        worklistId: 11,
        patientId: 3,
        draftStudyId: 7,
        draftWorklistId: 11,
        draftPatientId: 3,
      },
    };
  }

  it("asks the gate again once the bytes are known, and hands it their real source types", async () => {
    resolveSelectedKeyImagesForCompose.mockResolvedValue(
      resolvedImages(["PACS_SCREENSHOT", "OPERATOR_SUPPLIED"]),
    );
    // First pass = the pre-adapter gate, which can only count. Second = the
    // authoritative one, which sees what the frames actually are.
    assertComposerProviderPolicy
      .mockReset()
      .mockReturnValueOnce(ALLOW_GATE)
      .mockReturnValueOnce(denyGate("cloud_image_sources_not_attested"));

    const result = await runReportComposer(imageRequest(2));

    expect(result.ok).toBe(false);
    expect(result.safeError).toBe("cloud_image_sources_not_attested");
    expect(composeMock).not.toHaveBeenCalled();

    expect(assertComposerProviderPolicy).toHaveBeenCalledTimes(2);
    const first = gateCalls()[0]![0];
    const second = gateCalls()[1]![0];
    expect(first.imageSourceTypes).toBeUndefined();
    expect(first.imageCount).toBe(2);
    expect(second.imageSourceTypes).toEqual(["PACS_SCREENSHOT", "OPERATOR_SUPPLIED"]);
    // Nothing in the Composer may invent a clinician's attestation.
    expect(second.consentAttestedPerRequest).toBe(false);
  });

  it("carries the source types into the refusal provenance so the audit can name them", async () => {
    resolveSelectedKeyImagesForCompose.mockResolvedValue(resolvedImages(["DICOM"]));
    assertComposerProviderPolicy
      .mockReset()
      .mockReturnValueOnce(ALLOW_GATE)
      .mockReturnValueOnce(denyGate("cloud_image_provenance_unverified"));

    const result = await runReportComposer(imageRequest(1));
    expect(result.provenance?.imageSourceTypes).toEqual(["DICOM"]);
    expect(result.provenance?.imagesLoaded).toBe(1);
    expect(String(result.provenance?.degradedReason)).toContain("DICOM");
  });

  it("records the locality the adapter answered with, not the one the settings hoped for", async () => {
    resolveSelectedKeyImagesForCompose.mockResolvedValue(resolvedImages(["OPERATOR_SUPPLIED"]));
    composeMock.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ findings: "F.", impression: "I.", recommendation: "" }),
      provider: "ollama",
      model: "test-vision",
      latencyMs: 1,
      execution: "CLOUD",
    });

    const result = await runReportComposer(imageRequest(1));
    expect(result.ok).toBe(true);
    expect(result.provenance?.executedLocality).toBe("cloud");
    expect(result.provenance?.resolvedEndpoint).toBe("http://127.0.0.1:11434");
  });

  it("records `local` only when the adapter says it ran locally", async () => {
    resolveSelectedKeyImagesForCompose.mockResolvedValue(resolvedImages(["OPERATOR_SUPPLIED"]));
    composeMock.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ findings: "F.", impression: "I.", recommendation: "" }),
      provider: "ollama",
      model: "test-vision",
      latencyMs: 1,
      execution: "LOCAL",
    });

    const result = await runReportComposer(imageRequest(1));
    expect(result.provenance?.executedLocality).toBe("local");
  });

  it("leaves the locality unset rather than defaulting an unattributed adapter to local", async () => {
    resolveSelectedKeyImagesForCompose.mockResolvedValue(resolvedImages(["OPERATOR_SUPPLIED"]));
    composeMock.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ findings: "F.", impression: "I.", recommendation: "" }),
      provider: "ollama",
      model: "test-vision",
      latencyMs: 1,
    });

    const result = await runReportComposer(imageRequest(1));
    expect(result.provenance?.executedLocality).toBeNull();
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

  it("TEXT_ONLY with qwen3:14b calls Ollama and does not emit deterministic_fallback", async () => {
    resolveComposerRuntime.mockResolvedValue(
      baseRuntime({ model: "qwen3:14b", fallbackModel: null }),
    );
    composeMock.mockResolvedValue({
      ok: true,
      provider: "ollama",
      model: "qwen3:14b",
      text: JSON.stringify({
        findings: "L4-5 diffuse disc bulge with bilateral lateral recess narrowing.\nL5-S1 disc desiccation.",
        impression: "Lumbar disc disease at L4-5 and L5-S1.",
        recommendation: "",
        unresolvedQuestions: [],
        warnings: [],
      }),
      latencyMs: 42,
    });

    const result = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: snapshot({
        aiMode: "TEXT_ONLY",
        modality: "MR",
        region: "LS_SPINE",
        findings: "No significant disc bulge.",
        observations: [
          {
            concept: "disc_bulge",
            source: "quick-select",
            level: "L4-L5",
            findingsText: "L4-5 diffuse disc bulge with bilateral lateral recess narrowing.",
          },
        ],
      }),
      allowDeterministicFallback: true,
    });

    expect(result.ok).toBe(true);
    expect(result.model).toBe("qwen3:14b");
    expect(result.fallbackUsed).toBe(false);
    expect(result.draft?.warnings ?? []).not.toContain("deterministic_fallback");
    expect(result.provenance?.provider).toBe("ollama");
    expect(result.provenance?.personaVersion).toBeTruthy();
    expect(composeMock).toHaveBeenCalledTimes(1);
    const call = composeMock.mock.calls[0]![0] as { model: string; systemPrompt: string };
    expect(call.model).toBe("qwen3:14b");
    expect(call.systemPrompt.length).toBeGreaterThan(40);
  });
});
