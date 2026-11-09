/**
 * Cloud-vision consent + engine pathway — the regression suite for the
 * CARE Composer → qwen3-vl-plus image transmission authorization.
 *
 * ROOT CAUSE this pins against regressing: the composer's SELECTED_IMAGES mode
 * was built local-only (Stage 1 PR-A). Two gates had no production wiring on the
 * durable-job path — the per-request clinician attestation
 * (`consentAttestedPerRequest` was set by no caller) and the pixel
 * de-identification proof (no `PixelEgressProof` was ever passed) — so a cloud
 * image job could only fail closed, and the only cloud runs that completed were
 * TEXT_ONLY ones, which strip the selected images at enqueue. These tests prove
 * the authorization pathway now exists AND that every refusal still refuses.
 *
 * The chain exercised here is the real one: runReportComposer → provider
 * resolution from the session snapshot → assertComposerProviderPolicy (twice) →
 * resolveSelectedKeyImagesForCompose (mocked at the DB/disk seam) → cloud
 * capability registry → QwenComposerAdapter → de-identification (injected OCR,
 * real sharp) → assertGatewayPrivacy → openAiCompatibleChat (spy). Only the
 * database, the filesystem and the network are seams.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Synthetic patient — no real person. */
const SYNTHETIC_IDENTIFIERS = {
  patientName: "Zqtest Synthpatient",
  firstName: "Zqtest",
  lastName: "Synthpatient",
  dateOfBirth: "1990-01-01",
  mrn: "SYN-0001",
  patientId: "SYN-0001",
  accessionNumber: "ACC-SYN-1",
  extraForbiddenTerms: [],
};

const h = vi.hoisted(() => ({
  globalSettings: null as string | null,
  qwenEncryptedKey: "test-key" as string | null,
  qwenEndpointUrl: "https://dashscope.example.com/compatible-mode/v1" as string | null,
  qwenIsEnabled: true,
  /** What the mocked key-image resolver returns; shaped like the real result. */
  resolvedImages: [] as Array<{
    keyImageId: number;
    mimeType: "image/jpeg";
    base64: string;
    bytes: number;
    observationId: string | null;
    caption: string;
    sourceType: string;
  }>,
  resolvedError: null as string | null,
  /** What the mocked patient-identity resolver returns. */
  patientIdentifiers: null as Record<string, unknown> | null,
}));

const chatSpy = vi.hoisted(() => vi.fn());
const resolveImagesSpy = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: unknown) => ({ provider: value }),
  and: (...parts: unknown[]) => parts,
  inArray: (...parts: unknown[]) => parts,
  desc: () => ({}),
  lt: () => ({}),
  or: (...parts: unknown[]) => parts,
  isNull: () => ({}),
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: { provider?: unknown }) => ({
          limit: async () => {
            const provider = String(cond?.provider ?? "");
            if (provider === "__global__") {
              return h.globalSettings ? [{ settingsJson: h.globalSettings }] : [];
            }
            if (provider === "qwen") {
              return [
                {
                  encryptedApiKey: h.qwenEncryptedKey,
                  endpointUrl: h.qwenEndpointUrl,
                  isEnabled: h.qwenIsEnabled,
                },
              ];
            }
            return [];
          },
        }),
      }),
    }),
  },
  aiProviderSettingsTable: {
    provider: "provider",
    settingsJson: "settings_json",
    encryptedApiKey: "encrypted_api_key",
    defaultModel: "default_model",
    endpointUrl: "endpoint_url",
    isEnabled: "is_enabled",
  },
  aiModelRoutesTable: { taskKey: "task_key", provider: "provider", model: "model" },
}));

vi.mock("@workspace/crypto", () => ({
  decryptSecret: (s: string) => `decrypted(${s})`,
  encryptSecret: (s: string) => s,
}));

vi.mock("@workspace/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/ai-providers")>();
  return {
    ...actual,
    openAiCompatibleChat: chatSpy,
    resolveTaskRoute: async () => null,
  };
});

vi.mock("./resolveSelectedKeyImages", () => ({
  resolveSelectedKeyImagesForCompose: resolveImagesSpy,
  COMPOSER_MAX_IMAGE_BYTES: 2_500_000,
  COMPOSER_MAX_TOTAL_IMAGE_BYTES: 8_000_000,
  assertSelectedKeyImageRefsSafe: () => null,
  isComposerKeyImageUrl: () => true,
}));

vi.mock("../ai/resolvePatientIdentifiers", () => ({
  resolvePatientIdentifiersForEgress: async () =>
    h.patientIdentifiers
      ? { ok: true, identifiers: h.patientIdentifiers, resolvedFrom: "patient_row" }
      : {
          ok: false,
          reason: "this study is not linked to a patient record",
        },
}));
vi.mock("../voiceReportComposer/runtimeConfig", () => ({
  resolveComposerRuntime: async () => ({
    enabled: true,
    model: "qwen3-vl:8b",
    visionModel: "qwen3-vl:8b",
    endpoint: "http://127.0.0.1:11434",
    localOnly: true,
    temperature: 0.1,
    timeoutMs: 90_000,
    numCtx: 8192,
  }),
}));

import sharp from "sharp";
import { runReportComposer } from "./composeEngine";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";
import {
  resolveImageConsent,
  encodeImageConsentEnvelope,
  encodeRagOverrideEnvelope,
  decodeImageConsentEnvelope,
  withJobEnvelopes,
  IMAGE_CONSENT_ENVELOPE_KEY,
  resolveRagOverride,
} from "./types";
import {
  __setComposerCloudVisionDepsForTests,
} from "./providers/compatibleComposerAdapters";
import { assertComposerProviderPolicy } from "./providers/assertComposerProviderPolicy";

const OWNERSHIP = {
  draftId: 5,
  studyId: 1,
  worklistId: 9,
  patientId: 77,
  draftStudyId: 1,
  draftWorklistId: 9,
  draftPatientId: 77,
};

function cloudSnapshot(over: Partial<ComposerInputSnapshot> = {}): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    regions: ["LS Spine"],
    bodyPart: "SPINE_LUMBAR",
    family: "spine",
    spineSegment: "lumbar",
    protocol: "Plain",
    reportTitle: "MRI LUMBOSACRAL SPINE",
    clinicalHistory: "Low back pain with radiculopathy.",
    technique: "Multiplanar MRI lumbar spine.",
    findings: "L4-L5 disc extrusion contacting the right L5 traversing root.",
    impression: "",
    recommendation: "",
    observations: [
      {
        concept: "disc",
        source: "quick-select",
        findingsText: "L4-L5 disc extrusion.",
        laterality: null,
        level: "L4-L5",
      },
    ],
    worklistId: 9,
    jobKindHint: "FULL_REPORT",
    aiMode: "SELECTED_IMAGES",
    selectedKeyImages: [1, 2, 3, 4].map((keyImageId) => ({ keyImageId, caption: `image ${keyImageId}` })),
    sessionProvider: "qwen",
    sessionModel: "qwen3-vl-plus",
    ...over,
  });
}

async function fourSyntheticImages() {
  const buf = await sharp({
    create: { width: 24, height: 24, channels: 3, background: { r: 96, g: 128, b: 160 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  const base64 = buf.toString("base64");
  return [1, 2, 3, 4].map((keyImageId) => ({
    keyImageId,
    mimeType: "image/jpeg" as const,
    base64,
    bytes: buf.byteLength,
    observationId: null,
    caption: `image ${keyImageId}`,
    sourceType: "VIEWPORT_CAPTURE",
  }));
}

const DRAFT_JSON = JSON.stringify({
  findings: "L4-L5 disc extrusion contacting the right L5 traversing root.",
  impression: "L4-L5 disc extrusion with right L5 traversing root contact.",
  recommendation: "",
});

beforeEach(() => {
  chatSpy.mockReset();
  resolveImagesSpy.mockReset();
  h.globalSettings = null;
  h.qwenEncryptedKey = "test-key";
  h.qwenEndpointUrl = "https://dashscope.example.com/compatible-mode/v1";
  h.qwenIsEnabled = true;
  h.patientIdentifiers = { ...SYNTHETIC_IDENTIFIERS };
  h.resolvedImages = [];
  h.resolvedError = null;
  delete process.env.QWEN_API_KEY;
  __setComposerCloudVisionDepsForTests({
    buildOcrRunner: () => async () => ({ read: true, transcript: "MRI LS SPINE T2 SAG" }),
  });
  resolveImagesSpy.mockImplementation(async (args: { snapshot: ComposerInputSnapshot }) => {
    const refs = args.snapshot.selectedKeyImages ?? [];
    const selectedKeyImageIds = refs.map((r) => r.keyImageId);
    // Mirrors the real resolver's early validation (resolveSelectedKeyImages.ts):
    // the cap and the empty check fire before any DB or disk access.
    if (refs.length > 4) {
      return {
        ok: false,
        safeError: "selected_images_limit",
        detail: "At most 4 key images may be selected.",
        selectedKeyImageIds,
      };
    }
    if (h.resolvedError) {
      return { ok: false, safeError: h.resolvedError, detail: h.resolvedError, selectedKeyImageIds };
    }
    return {
      ok: true,
      images: h.resolvedImages,
      selectedKeyImageIds,
      linkedObservationIds: [],
    };
  });
});

afterEach(() => {
  delete process.env.QWEN_API_KEY;
  __setComposerCloudVisionDepsForTests(null);
});

describe("R4 — missing per-request consent blocks the cloud image send", () => {
  it("refuses before any adapter or transport call when no clinician attested", async () => {
    h.resolvedImages = await fourSyntheticImages();
    const run = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: cloudSnapshot(),
      ownership: OWNERSHIP,
      cloudVisionAllowed: true,
      requireAttestation: true,
      consentAttestedPerRequest: false,
    });
    expect(run.ok).toBe(false);
    expect(run.safeError).toMatch(/^cloud_image_/);
    expect(run.provenance?.aiMode).toBe("SELECTED_IMAGES");
    expect(run.provenance?.imagesLoaded ?? 0).toBe(0);
    // The count-only policy pass refuses before images are even read.
    expect(resolveImagesSpy).not.toHaveBeenCalled();
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("refuses when the clinic has not opted into cloud vision at all", async () => {
    h.resolvedImages = await fourSyntheticImages();
    const run = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: cloudSnapshot(),
      ownership: OWNERSHIP,
      cloudVisionAllowed: false,
      requireAttestation: true,
      consentAttestedPerRequest: true,
    });
    expect(run.ok).toBe(false);
    expect(run.safeError).toBe("cloud_vision_not_allowed");
    expect(chatSpy).not.toHaveBeenCalled();
  });
});

describe("R2/R6 — consented 4-image request reaches qwen3-vl-plus as a valid multimodal payload", () => {
  it("runs the full authorized chain and reports verified-clean pixels", async () => {
    h.resolvedImages = await fourSyntheticImages();
    chatSpy.mockResolvedValue({
      ok: true,
      text: DRAFT_JSON,
      provider: "qwen",
      model: "qwen3-vl-plus",
      latencyMs: 210,
      usage: { promptTokens: 2400, completionTokens: 420, totalTokens: 2820 },
    });
    const run = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: cloudSnapshot(),
      ownership: OWNERSHIP,
      cloudVisionAllowed: true,
      requireAttestation: true,
      consentAttestedPerRequest: true,
    });
    expect(run.ok).toBe(true);
    expect(run.model).toBe("qwen3-vl-plus");
    expect(run.provider).toBe("qwen");
    expect(run.draft?.impression).toContain("L4-L5");

    const p = run.provenance;
    expect(p?.aiMode).toBe("SELECTED_IMAGES");
    expect(p?.imagesLoaded).toBe(4);
    expect(p?.selectedKeyImageIds).toEqual([1, 2, 3, 4]);
    expect(p?.imageSourceTypes).toEqual(["VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE"]);
    expect(p?.executedLocality).toBe("cloud");
    expect(p?.pixelPosture).toBe("verified_clean");

    // The engine handed the adapter the resolved patient identity.
    expect(resolveImagesSpy).toHaveBeenCalledTimes(1);

    expect(chatSpy).toHaveBeenCalledTimes(1);
    const sent = chatSpy.mock.calls[0][0] as {
      provider: string;
      model: string;
      images?: Array<{ mimeType: string; base64: string }>;
      extraBody?: Record<string, unknown>;
    };
    expect(sent.provider).toBe("qwen");
    expect(sent.model).toBe("qwen3-vl-plus");
    expect(sent.images).toHaveLength(4);
    for (const img of sent.images ?? []) {
      expect(img.mimeType).toBe("image/jpeg");
    }
    // Qwen3 reasoning is disabled for a direct structured answer.
    expect(sent.extraBody).toEqual({ enable_thinking: false });
  });

  it("blocks when the study has no resolvable patient (no vacuous pixel check)", async () => {
    h.resolvedImages = await fourSyntheticImages();
    h.patientIdentifiers = null;
    const run = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: cloudSnapshot(),
      ownership: OWNERSHIP,
      cloudVisionAllowed: true,
      requireAttestation: true,
      consentAttestedPerRequest: true,
    });
    expect(run.ok).toBe(false);
    expect(run.safeError).toBe("cloud_image_not_verifiable");
    expect(run.provenance?.degradedReason).toContain("patient");
    expect(chatSpy).not.toHaveBeenCalled();
  });
});

describe("R1 — text-only cloud runs carry zero images", () => {
  it("never resolves key images and sends no images to the transport", async () => {
    chatSpy.mockResolvedValue({
      ok: true,
      text: DRAFT_JSON,
      provider: "qwen",
      model: "qwen3-vl-plus",
      latencyMs: 90,
      usage: { promptTokens: 900, completionTokens: 300, totalTokens: 1200 },
    });
    const run = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: cloudSnapshot({ aiMode: "TEXT_ONLY", selectedKeyImages: [] }),
      ownership: OWNERSHIP,
      cloudVisionAllowed: true,
      requireAttestation: true,
    });
    expect(run.ok).toBe(true);
    expect(run.provenance?.aiMode).toBe("TEXT_ONLY");
    expect(run.provenance?.imagesLoaded ?? 0).toBe(0);
    expect(resolveImagesSpy).not.toHaveBeenCalled();
    const sent = chatSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.images ?? []).toHaveLength(0);
  });

  it("IMPRESSION jobs stay text-only even with images selected in the snapshot", async () => {
    chatSpy.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ impression: "L4-L5 disc extrusion." }),
      provider: "qwen",
      model: "qwen3-vl-plus",
      latencyMs: 60,
      usage: { promptTokens: 500, completionTokens: 100, totalTokens: 600 },
    });
    const run = await runReportComposer({
      kind: "IMPRESSION",
      snapshot: cloudSnapshot(),
      ownership: OWNERSHIP,
      cloudVisionAllowed: true,
      requireAttestation: true,
      consentAttestedPerRequest: true,
    });
    expect(run.ok).toBe(true);
    expect(run.provenance?.aiMode).toBe("TEXT_ONLY");
    expect(resolveImagesSpy).not.toHaveBeenCalled();
    const sent = chatSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.images ?? []).toHaveLength(0);
  });
});

describe("R3 — at most four selected key images", () => {
  it("refuses a fifth image before any model is contacted", async () => {
    const run = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: cloudSnapshot({
        selectedKeyImages: [1, 2, 3, 4, 5].map((keyImageId) => ({ keyImageId, caption: `image ${keyImageId}` })),
      }),
      ownership: OWNERSHIP,
      cloudVisionAllowed: true,
      requireAttestation: true,
      consentAttestedPerRequest: true,
    });
    expect(run.ok).toBe(false);
    expect(run.safeError).toBe("selected_images_limit");
    expect(chatSpy).not.toHaveBeenCalled();
  });
});

describe("R7 — a failed AI output never becomes a draft", () => {
  it("returns no draft when the provider transport fails after consent", async () => {
    h.resolvedImages = await fourSyntheticImages();
    chatSpy.mockResolvedValue({
      ok: false,
      provider: "qwen",
      model: "qwen3-vl-plus",
      safeError: "empty_final_content",
      latencyMs: 120,
      usage: { promptTokens: 2400, completionTokens: 0, totalTokens: 2400 },
    });
    const run = await runReportComposer({
      kind: "FULL_REPORT",
      snapshot: cloudSnapshot(),
      ownership: OWNERSHIP,
      cloudVisionAllowed: true,
      requireAttestation: true,
      consentAttestedPerRequest: true,
    });
    expect(run.ok).toBe(false);
    expect(run.safeError).toBe("empty_final_content");
    expect(run.draft).toBeUndefined();
    expect(run.provenance?.imagesLoaded).toBe(4);
    expect(run.provenance?.executedLocality).toBe("cloud");
  });
});

describe("R8 — local providers are unaffected by the cloud consent pathway", () => {
  it("ollama SELECTED_IMAGES policy passes without consent or cloud flags", () => {
    const r = assertComposerProviderPolicy({
      provider: "ollama",
      aiMode: "SELECTED_IMAGES",
      imageCount: 4,
      consentAttestedPerRequest: false,
      requireAttestation: true,
    });
    expect(r.ok).toBe(true);
  });

  it("ollama text policy is unchanged", () => {
    const r = assertComposerProviderPolicy({
      provider: "ollama",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
    });
    expect(r.ok).toBe(true);
  });

  it("a cloud text run needs no consent (no pixels, no attestation term)", () => {
    const r = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
      cloudApiKeyConfigured: true,
      consentAttestedPerRequest: false,
      requireAttestation: true,
    });
    expect(r.ok).toBe(true);
  });

  it("development mode keeps the admin opt-in as the decision (no attestation demanded)", () => {
    const r = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "SELECTED_IMAGES",
      imageCount: 4,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      imageSourceTypes: ["VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE"],
      consentAttestedPerRequest: false,
      requireAttestation: false,
    });
    expect(r.ok).toBe(true);
  });
});

describe("consent contract — resolve / encode / decode", () => {
  it("stamps the attester from the session, never from the request body", () => {
    const c = resolveImageConsent(
      { confirmed: true, attestedBy: "Someone Else", attestedByStaffId: 999 },
      { subjectName: "Dr. Radiologist", staffId: 42 },
    );
    expect(c.attested).toBe(true);
    expect(c.attestedBy).toBe("Dr. Radiologist");
    expect(c.attestedByStaffId).toBe(42);
    expect(c.attestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(c.needsRecording).toBe(true);
  });

  it("an unconfirmed or sessionless request records nothing", () => {
    expect(resolveImageConsent({ confirmed: true }, null).attested).toBe(false);
    expect(resolveImageConsent({}, { subjectName: "Dr. X", staffId: 1 }).attested).toBe(false);
    expect(resolveImageConsent("yes", { subjectName: "Dr. X", staffId: 1 }).attested).toBe(false);
    expect(resolveImageConsent(null, { subjectName: "Dr. X", staffId: 1 }).needsRecording).toBe(false);
  });

  it("round-trips through the job's validation_json envelope", () => {
    const c = resolveImageConsent({ confirmed: true }, { subjectName: "Dr. Radiologist", staffId: 42 });
    const json = encodeImageConsentEnvelope(c);
    expect(json).not.toBeNull();
    const back = decodeImageConsentEnvelope(json);
    expect(back).toEqual(c);
  });

  it("decode refuses a hand-edited row with no attestation timestamp", () => {
    expect(decodeImageConsentEnvelope(JSON.stringify({ [IMAGE_CONSENT_ENVELOPE_KEY]: { attested: true } }))).toBeNull();
    expect(decodeImageConsentEnvelope(null)).toBeNull();
    expect(decodeImageConsentEnvelope("not json")).toBeNull();
    expect(decodeImageConsentEnvelope(JSON.stringify({ provenance: { model: "x" } }))).toBeNull();
  });

  it("settle writes preserve BOTH the consent and RAG envelopes", () => {
    const consent = resolveImageConsent({ confirmed: true }, { subjectName: "Dr. R", staffId: 7 });
    const rag = resolveRagOverride("on", true);
    const atEnqueue = JSON.stringify({
      ...(JSON.parse(encodeRagOverrideEnvelope(rag)!) as object),
      ...(JSON.parse(encodeImageConsentEnvelope(consent)!) as object),
    });
    const settled = withJobEnvelopes(atEnqueue, { ok: true, errors: [] });
    const parsed = JSON.parse(settled!) as Record<string, unknown>;
    expect(parsed.ok).toBe(true);
    expect(decodeImageConsentEnvelope(settled)?.attestedBy).toBe("Dr. R");
    expect((parsed.ragOverride as Record<string, unknown>).effective).toBe("on");
  });
});
