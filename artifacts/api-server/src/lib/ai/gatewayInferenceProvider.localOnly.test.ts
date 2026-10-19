/**
 * STAGE 1 PR-A — the overnight/shadow gateway cannot put a patient's frames in
 * front of a cloud provider with nobody in the room.
 *
 * What this seam used to do: when the admin turned on `deepseekCloudVisionAllowed`
 * (or ran the A/B arm), every scheduled shadow tick re-sent the SAME DICOM frames
 * a second time to a named cloud endpoint, and nothing recorded that it happened.
 * Two callers reach it — a cron tick and an admin self-test — and neither is a
 * clinician authorising a patient's pixels.
 *
 * The rule under test: the flag is necessary, the attestation is sufficient, and
 * an unattended job can produce neither. A refusal is filed rather than swallowed,
 * because "we did not send it, and here is why" is evidence and silence is not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  generateAiResponse: vi.fn(),
  requestStructuredReport: vi.fn(),
  ops: {
    nightVisionProvider: "local" as string,
    deepseekCloudVisionAllowed: false,
  },
  vision: {
    model: "qwen3-vl:8b",
    endpointUrl: "http://172.16.1.140:11434",
    numCtx: 8192,
    think: false,
    temperature: 0.2,
    policy: {
      safeMode: false,
      maxTokens: 4096,
      timeoutMs: 60_000,
      maxImages: 4,
      imageCapReason: "test cap",
      numCtxSource: "env",
    },
  },
  audit: [] as Array<Record<string, unknown>>,
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));
vi.mock("@workspace/ai-providers", () => ({
  generateAiResponse: (...args: unknown[]) => h.generateAiResponse(...args),
  requestStructuredReport: (...args: unknown[]) => h.requestStructuredReport(...args),
  defaultModelForProvider: (provider: string, vision = false) =>
    vision ? `${provider}-vision-model` : `${provider}-text-model`,
}));
vi.mock("./overnightVisionConfig", () => ({
  getOvernightVisionInferenceOptions: async () => h.vision,
}));
vi.mock("./clinicalConfigService", () => ({
  getOvernightOpsControls: async () => h.ops,
}));
// The writer itself is proven against PostgreSQL in `imageSendAudit.request.test.ts`;
// here it is captured so these cases can read exactly what was filed.
vi.mock("./imageSendAudit", () => ({
  recordImageSendAudit: (record: Record<string, unknown>) => {
    h.audit.push(record);
    return Promise.resolve();
  },
}));

const { gatewayInferenceProvider } = await import("./gatewayInferenceProvider");

const STUDY = "1.2.840.10000.localonly";
const PIXEL = "/9j/4AAQSkZJRgABAQAAAQABAAD/";
const JPEG = { seriesUid: "1.2.s", sopUid: "1.2.i", frameNumber: 1, imageData: PIXEL };

function input(overrides: Record<string, unknown> = {}) {
  return {
    studyInstanceUid: STUDY,
    modality: "MR",
    imageAnchors: [{ seriesUid: "1.2.s", sopUid: "1.2.i", frameNumber: 1 }],
    images: [{ ...JPEG, sopUid: "1.2.i1" }, JPEG],
    jobReference: "ai_shadow_job:4182",
    ...overrides,
  } as never;
}

function localAnswer() {
  return {
    success: true,
    text: '{"findings":[],"impression":["No significant abnormality."]}',
    error: undefined,
    execution: { locality: "local", provider: "ollama", model: "qwen3-vl:8b" },
    diagnostics: null,
  };
}

function cloudAnswer() {
  return {
    success: true,
    text: '{"findings":[],"impression":["Cloud answer."]}',
    error: undefined,
    execution: { locality: "cloud", provider: "deepseek", model: "deepseek-vision-model" },
    diagnostics: null,
  };
}

function structured(text: string) {
  return {
    report: {
      studyContext: { studyInstanceUid: STUDY, modality: "MR", imageCount: 2 },
      findings: [],
      measurements: [],
      impression: [text],
    },
    degraded: false,
    provider: "ollama",
    model: "qwen3-vl:8b",
    modelDigest: null,
    attempts: 1,
    detail: "ok",
  };
}

beforeEach(() => {
  h.ops.nightVisionProvider = "local";
  h.ops.deepseekCloudVisionAllowed = false;
  h.audit.length = 0;
  h.generateAiResponse.mockReset();
  h.requestStructuredReport.mockReset();
  h.generateAiResponse.mockResolvedValue(localAnswer());
  h.requestStructuredReport.mockResolvedValue(structured("No significant abnormality."));
});

function providersCalled(): string[] {
  return h.generateAiResponse.mock.calls.map((c) => String(c[0]));
}

describe("gatewayInferenceProvider — Stage 1 keeps patient frames local", () => {
  it("does not call a cloud provider when the admin flag is on but nobody attested", async () => {
    h.ops = { nightVisionProvider: "deepseek", deepseekCloudVisionAllowed: true };
    const out = await gatewayInferenceProvider.infer(input());
    expect(providersCalled()).toEqual(["ollama"]);
    expect(out.provenance.provider).toBe("ollama");
  });

  it("does not call cloud on the A/B arm either — that arm used to send frames purely as telemetry", async () => {
    h.ops = { nightVisionProvider: "ab", deepseekCloudVisionAllowed: true };
    await gatewayInferenceProvider.infer(input());
    expect(providersCalled()).toEqual(["ollama"]);
  });

  it("files the local send with the locality the send layer reported and the job that asked", async () => {
    await gatewayInferenceProvider.infer(input());
    expect(h.audit).toHaveLength(1);
    const row = h.audit[0];
    expect(row).toMatchObject({
      studyInstanceUID: STUDY,
      provider: "ollama",
      model: "qwen3-vl:8b",
      resolvedUrl: "http://172.16.1.140:11434",
      executedLocality: "local",
      numImages: 2,
      imageSourceTypes: ["DICOM", "DICOM"],
      jobReference: "ai_shadow_job:4182",
      success: true,
    });
  });

  it("files the cloud refusal too, so a non-send is evidence and not a silence", async () => {
    h.ops = { nightVisionProvider: "deepseek", deepseekCloudVisionAllowed: true };
    await gatewayInferenceProvider.infer(input());
    expect(h.audit).toHaveLength(2);
    expect(h.audit[1]).toMatchObject({
      provider: "deepseek",
      executedLocality: "cloud",
      numImages: 2,
      jobReference: "ai_shadow_job:4182",
      success: false,
    });
    expect(String(h.audit[1].safeFailureReason)).toContain("PHI_IMAGE_CLOUD_UNATTESTED");
  });

  it("files no refusal when the admin never permitted cloud in the first place", async () => {
    h.ops = { nightVisionProvider: "deepseek", deepseekCloudVisionAllowed: false };
    await gatewayInferenceProvider.infer(input());
    expect(h.audit).toHaveLength(1);
    expect(providersCalled()).toEqual(["ollama"]);
  });

  it("files no refusal when the night mode is local — nothing was being refused", async () => {
    h.ops = { nightVisionProvider: "local", deepseekCloudVisionAllowed: true };
    await gatewayInferenceProvider.infer(input());
    expect(h.audit).toHaveLength(1);
    expect(h.audit[0].provider).toBe("ollama");
  });

  it("sends the second time when a named clinician attested THESE frames", async () => {
    h.ops = { nightVisionProvider: "deepseek", deepseekCloudVisionAllowed: true };
    await gatewayInferenceProvider.infer(
      input({ imageConsent: { attestedBy: "staff-user:12", attestedAt: "2026-10-19T03:00:00.000Z" } }),
    );
    expect(providersCalled()).toEqual(["ollama", "deepseek"]);
    const cloudCall = h.generateAiResponse.mock.calls[1];
    // The policy in `assertCloudImageEgress` only clears a send that carries both
    // the provenance and the attestation, so the seam has to pass them down.
    expect(cloudCall[3]).toMatchObject({
      cloudVisionAllowed: true,
      consentAttestedPerRequest: true,
      imageSourceTypes: ["DICOM", "DICOM"],
    });
    // Two rows and no refusal: the local send, and the cloud send a human asked
    // for. A filed refusal here would mean the attestation was ignored.
    expect(h.audit).toHaveLength(2);
    expect(h.audit[1]).toMatchObject({ provider: "deepseek", success: true, numImages: 2 });
  });

  it("treats an attestation that names nobody as no attestation at all", async () => {
    h.ops = { nightVisionProvider: "deepseek", deepseekCloudVisionAllowed: true };
    await gatewayInferenceProvider.infer(
      input({ imageConsent: { attestedBy: "   ", attestedAt: "2026-10-19T03:00:00.000Z" } }),
    );
    expect(providersCalled()).toEqual(["ollama"]);
  });

  it("treats an attestation with no timestamp as no attestation", async () => {
    h.ops = { nightVisionProvider: "deepseek", deepseekCloudVisionAllowed: true };
    await gatewayInferenceProvider.infer(
      input({ imageConsent: { attestedBy: "staff-user:12", attestedAt: "" } }),
    );
    expect(providersCalled()).toEqual(["ollama"]);
  });

  it("never reports a local failure as a cloud success it never obtained", async () => {
    h.ops = { nightVisionProvider: "deepseek", deepseekCloudVisionAllowed: true };
    h.generateAiResponse.mockResolvedValue({
      success: false,
      text: "",
      error: "ollama_unreachable",
      execution: { locality: "local" },
      diagnostics: { httpStatus: null, errorCode: "connection_refused", elapsedMs: 10 },
    });
    const out = await gatewayInferenceProvider.infer(input());
    expect(providersCalled()).toEqual(["ollama"]);
    expect(out.draft.impression).toHaveLength(0);
    expect(out.provenance.degraded).toBe(true);
    expect(out.provenance.provider).toBe("ollama");
    const refused = h.audit[0];
    expect(refused.success).toBe(false);
    expect(refused.safeFailureReason).toBe("ollama_unreachable");
  });

  it("files nothing for a text-only shadow run, which is not an image egress", async () => {
    h.ops = { nightVisionProvider: "deepseek", deepseekCloudVisionAllowed: true };
    await gatewayInferenceProvider.infer(input({ images: [] }));
    expect(h.audit).toHaveLength(0);
    expect(providersCalled()).toEqual(["ollama"]);
  });
});
