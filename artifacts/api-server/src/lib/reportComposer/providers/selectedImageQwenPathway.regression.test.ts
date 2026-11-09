/**
 * Selected-image pathway regression tests — the eight verification requirements
 * from the Qwen3-VL-Plus image transmission audit.
 *
 * Requirements:
 * 1. Text-only jobs send zero images
 * 2. Selected-image jobs transmit exactly the selected images
 * 3. Four images are supported
 * 4. Missing consent blocks cloud transmission
 * 5. PHI or image-policy failures block transmission
 * 6. Qwen receives valid multimodal message payloads
 * 7. Failed AI output never overwrites the radiologist's report
 * 8. Ollama and existing providers remain unaffected
 *
 * WHY THIS FILE WAS RED AND WHAT THE FIX IS
 * It previously mocked `./gatewayPrivacy` with a re-implementation of the gate, so
 * most of what it asserted was the mock's own policy, and its pixel-proof limb was
 * conditioned on `chatSpy.getMockImplementation()` — the fake asked the transport
 * spy whether the test had stubbed an answer, which makes a gate pass or fail on
 * how the test was written rather than on what the product does. It also drove the
 * adapter without `patientIdentifiers`, which the engine always supplies
 * (composeEngine.ts:893), so every image case died in the real adapter at
 * `cloud_image_not_verifiable` before the fake gate was ever reached.
 *
 * Here the REAL `assertGatewayPrivacy` runs. The only thing injected is the
 * on-premises OCR read, through the seam the product exists to expose
 * (`__setComposerCloudVisionDepsForTests`), and sharp stays real — so the
 * re-encoded bytes asserted below are the bytes a clinic would actually egress.
 *
 * Two of the old expectations were also wrong about the product:
 *  - an image send with no proof is refused `cloud_image_not_verifiable` by the
 *    adapter when the patient could not be resolved, and `cloud_image_not_verified`
 *    by the gate when a caller omits a proof it could have had. Both codes are now
 *    tested where each is produced, not conflated.
 *  - a PNG selection does NOT egress as PNG. The de-identification gate re-encodes
 *    every cleared image to JPEG so no container metadata survives, so that is what
 *    requirement 6 asserts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  globalSettings: null as string | null,
  qwenEncryptedKey: "test-key" as string | null,
  qwenEndpointUrl: "https://dashscope.example.com/compatible-mode/v1" as string | null,
  qwenIsEnabled: true,
}));

const chatSpy = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: unknown) => ({ provider: value }),
  and: (...parts: unknown[]) => parts,
  inArray: (...parts: unknown[]) => parts,
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
  };
});

import sharp from "sharp";
import {
  QwenComposerAdapter,
  __setComposerCloudVisionDepsForTests,
} from "./compatibleComposerAdapters";
import { assertComposerProviderPolicy } from "./assertComposerProviderPolicy";
import { assertGatewayPrivacy, type PixelEgressProof } from "./gatewayPrivacy";
import { parseComposerDraftJson } from "../types";
import type { ComposerProviderImage, ComposerProviderRequest } from "./types";
import type { PatientIdentifiers } from "../../ai/imageDeidentification";

const CLEAN_SYSTEM_PROMPT = "You are CARE's radiology reporting assistant.";
const CLEAN_USER_PROMPT = "MRI BRAIN: Fazekas grade 1 white matter changes. No acute infarct.";

/**
 * Synthetic patient — no real person's name appears in this file or in any
 * fixture prompt, and the name is what the burned-in check is matched against.
 */
const SYNTHETIC_PATIENT: PatientIdentifiers = {
  patientName: "Zqtest Synthpatient",
  firstName: "Zqtest",
  lastName: "Synthpatient",
  dateOfBirth: "1990-01-01",
  mrn: "SYN-0001",
  patientId: "SYN-0001",
  accessionNumber: "ACC-SYN-1",
  extraForbiddenTerms: [],
};

/** Overlay text a modality really prints — none of it belongs to the patient. */
const CLEAN_TRANSCRIPT = "MRI BRAIN T2 FLAIR AXIAL SAGITTAL SE 2000";

const adapter = new QwenComposerAdapter();

async function syntheticImage(
  mimeType: "image/jpeg" | "image/png" = "image/jpeg",
): Promise<ComposerProviderImage> {
  const source = sharp({
    create: { width: 24, height: 24, channels: 3, background: { r: 96, g: 128, b: 160 } },
  });
  const buf = mimeType === "image/png"
    ? await source.png().toBuffer()
    : await source.jpeg({ quality: 80 }).toBuffer();
  return { base64: buf.toString("base64"), mimeType };
}

/**
 * Records what the on-premises checker was shown, so a test can prove the bytes
 * verified are the bytes sent — the property that makes the pixel proof
 * non-forgeable, and the one the mocked gate could not express at all.
 */
function ocrSpy(transcript: string = CLEAN_TRANSCRIPT) {
  const seen: Array<{ base64: string; mimeType: string }> = [];
  const buildOcrRunner = () => async (base64: string, mimeType: string) => {
    seen.push({ base64, mimeType });
    return { read: true as const, transcript };
  };
  return { seen, buildOcrRunner };
}

function request(overrides: Partial<ComposerProviderRequest> = {}): ComposerProviderRequest {
  return {
    systemPrompt: CLEAN_SYSTEM_PROMPT,
    userPrompt: CLEAN_USER_PROMPT,
    model: "qwen3-vl-plus",
    temperature: 0.1,
    timeoutMs: 30_000,
    ...overrides,
  };
}

function okTransport(images = 1) {
  chatSpy.mockResolvedValue({
    ok: true,
    text: '{"findings":"x","impression":"y"}',
    provider: "qwen",
    model: "qwen3-vl-plus",
    latencyMs: 100,
    usage: { promptTokens: 10 * images, completionTokens: 5, totalTokens: 15 },
  });
}

function sent() {
  return chatSpy.mock.calls[0][0] as {
    provider: string;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    jsonMode?: boolean;
    extraBody?: Record<string, unknown>;
    images?: Array<{ base64: string; mimeType: string }>;
  };
}

beforeEach(() => {
  chatSpy.mockReset();
  h.globalSettings = null;
  h.qwenEncryptedKey = "test-key";
  h.qwenEndpointUrl = "https://dashscope.example.com/compatible-mode/v1";
  h.qwenIsEnabled = true;
  delete process.env.QWEN_API_KEY;
  // Default posture: the clinic's own model reads the image and finds nothing
  // belonging to this patient.
  const ocr = ocrSpy();
  __setComposerCloudVisionDepsForTests({ buildOcrRunner: ocr.buildOcrRunner });
});

afterEach(() => {
  delete process.env.QWEN_API_KEY;
  __setComposerCloudVisionDepsForTests(null);
});

describe("1. Text-only jobs send zero images", () => {
  it("TEXT_ONLY mode with imageCount=0 passes policy check", () => {
    const r = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
      cloudApiKeyConfigured: true,
    });
    expect(r.ok).toBe(true);
  });

  it("TEXT_ONLY mode does not require cloudVisionAllowed", () => {
    const r = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
      cloudVisionAllowed: false,
      cloudApiKeyConfigured: true,
    });
    expect(r.ok).toBe(true);
  });

  it("adapter call with no images sends a text-only payload and spends no OCR pass", async () => {
    const ocr = ocrSpy();
    __setComposerCloudVisionDepsForTests({ buildOcrRunner: ocr.buildOcrRunner });
    okTransport();

    const r = await adapter.compose(request());

    expect(r.ok).toBe(true);
    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(sent().images ?? []).toHaveLength(0);
    // "No images selected" must not quietly trigger the on-premises checker.
    expect(ocr.seen).toHaveLength(0);
  });
});

describe("2. Selected-image jobs transmit exactly the selected images", () => {
  it("SELECTED_IMAGES with consent sends every selected image", async () => {
    okTransport(2);
    const images = [await syntheticImage(), await syntheticImage()];

    const r = await adapter.compose(
      request({ images, cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );

    expect(r.ok).toBe(true);
    expect(r.ok && r.pixelPosture).toBe("verified_clean");
    expect(chatSpy).toHaveBeenCalledTimes(1);
    expect(sent().images).toHaveLength(2);
  });

  it("three selected images become three transmitted images, verified one by one", async () => {
    const ocr = ocrSpy();
    __setComposerCloudVisionDepsForTests({ buildOcrRunner: ocr.buildOcrRunner });
    okTransport(3);
    const images = [await syntheticImage(), await syntheticImage(), await syntheticImage()];

    await adapter.compose(
      request({ images, cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );

    expect(sent().images).toHaveLength(3);
    expect(ocr.seen).toHaveLength(3);
  });

  it("what is sent is what the on-premises checker inspected, not the caller's bytes", async () => {
    const ocr = ocrSpy();
    __setComposerCloudVisionDepsForTests({ buildOcrRunner: ocr.buildOcrRunner });
    okTransport();
    const original = await syntheticImage();

    await adapter.compose(
      request({ images: [original], cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );

    const egress = sent().images!;
    expect(egress[0].base64).toBe(ocr.seen[0].base64);
    expect(egress[0].base64).not.toBe(original.base64);
  });
});

describe("3. Four images are supported", () => {
  it("policy allows 4 images with consent", () => {
    const r = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "SELECTED_IMAGES",
      imageCount: 4,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      imageSourceTypes: ["DICOM", "DICOM", "DICOM", "DICOM"],
      consentAttestedPerRequest: true,
    });
    expect(r.ok).toBe(true);
  });

  it("adapter sends 4 images to Qwen", async () => {
    const ocr = ocrSpy();
    __setComposerCloudVisionDepsForTests({ buildOcrRunner: ocr.buildOcrRunner });
    okTransport(4);
    const images = [
      await syntheticImage(),
      await syntheticImage(),
      await syntheticImage(),
      await syntheticImage(),
    ];

    const r = await adapter.compose(
      request({ images, cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );

    expect(r.ok).toBe(true);
    expect(sent().images).toHaveLength(4);
    // The whole set, not a prefix of it: a partial verification is a refusal.
    expect(ocr.seen).toHaveLength(4);
  });
});

describe("4. Missing consent blocks cloud transmission", () => {
  it("patient-derived images without a per-request attestation are blocked", () => {
    const r = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "SELECTED_IMAGES",
      imageCount: 2,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      imageSourceTypes: ["VIEWPORT_CAPTURE", "VIEWPORT_CAPTURE"],
      requireAttestation: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("cloud_image_sources_not_attested");
  });

  it("images whose provenance is unknown are blocked too", () => {
    const r = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "SELECTED_IMAGES",
      imageCount: 2,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      requireAttestation: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("cloud_image_provenance_unverified");
  });

  it("adapter refuses without cloudVisionAllowed and does not run the checker first", async () => {
    const ocr = ocrSpy();
    __setComposerCloudVisionDepsForTests({ buildOcrRunner: ocr.buildOcrRunner });
    const images = [await syntheticImage()];

    const r = await adapter.compose(
      request({ images, cloudVisionAllowed: false, patientIdentifiers: SYNTHETIC_PATIENT }),
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("cloud_vision_not_allowed");
    expect(chatSpy).not.toHaveBeenCalled();
    // The opt-in is checked before the expensive on-premises pass, so a send that
    // is going to be refused costs the clinic nothing.
    expect(ocr.seen).toHaveLength(0);
  });
});

describe("5. PHI or image-policy failures block transmission", () => {
  it("PHI in the prompt blocks the cloud send while the setting stays at its deny default", async () => {
    const r = await adapter.compose(
      request({
        userPrompt: "Clinical history: Patient: Zqtest Synthpatient, UHID: SYN-0001. Right leg pain since Monday.",
      }),
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("PHI_TEXT_CLOUD_BLOCKED");
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("adapter refuses when the patient behind the study could not be resolved", async () => {
    const images = [await syntheticImage()];

    const r = await adapter.compose(request({ images, cloudVisionAllowed: true }));

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.safeError).toBe("cloud_image_not_verifiable");
      expect(r.detail).toContain("patient");
    }
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("an unreadable image from the local checker is a refusal, not a clean pass", async () => {
    __setComposerCloudVisionDepsForTests({
      buildOcrRunner: () => async () => ({
        read: false as const,
        reason: "no local vision model is configured",
      }),
    });
    const images = [await syntheticImage()];

    const r = await adapter.compose(
      request({ images, cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("cloud_image_not_verifiable");
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("the patient's own identifiers burned into the raster block transmission", async () => {
    __setComposerCloudVisionDepsForTests({
      buildOcrRunner: () => async () => ({
        read: true as const,
        transcript: "ZQTEST SYNTHPATIENT MRN SYN-0001 DOB 1990-01-01",
      }),
    });
    const images = [await syntheticImage()];

    const r = await adapter.compose(
      request({ images, cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.safeError).toBe("cloud_image_burned_in_identifiers");
      // Categories only — the matched value is itself PHI and must not be echoed.
      expect(r.detail).not.toContain("Zqtest");
    }
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("the gate refuses pixels when no proof accompanies them (default deny)", async () => {
    const images = [await syntheticImage()];

    const r = await assertGatewayPrivacy({
      provider: "qwen",
      systemPrompt: CLEAN_SYSTEM_PROMPT,
      userPrompt: CLEAN_USER_PROMPT,
      images,
      cloudVisionAllowed: true,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("cloud_image_not_verified");
  });

  it("the gate refuses a proof that covers fewer images than are being sent", async () => {
    const one = await syntheticImage();
    const proof: PixelEgressProof = { posture: "clean", images: [{ base64: one.base64, mimeType: one.mimeType }] };

    const r = await assertGatewayPrivacy({
      provider: "qwen",
      systemPrompt: CLEAN_SYSTEM_PROMPT,
      userPrompt: CLEAN_USER_PROMPT,
      images: [one, one],
      cloudVisionAllowed: true,
      pixelProof: proof,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.safeError).toBe("cloud_image_verification_incomplete");
      expect(r.detail).toContain("1 of 2");
    }
  });

  it("the gate sends the verified bytes, not the bytes the caller asked with", async () => {
    const asked = await syntheticImage();
    const verified = await syntheticImage();
    const proof: PixelEgressProof = {
      posture: "clean",
      images: [{ base64: verified.base64, mimeType: "image/jpeg" }],
    };

    const r = await assertGatewayPrivacy({
      provider: "qwen",
      systemPrompt: CLEAN_SYSTEM_PROMPT,
      userPrompt: CLEAN_USER_PROMPT,
      images: [asked],
      cloudVisionAllowed: true,
      pixelProof: proof,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.images[0].base64).toBe(verified.base64);
      expect(r.pixelPosture).toBe("verified_clean");
    }
  });
});

describe("6. Qwen receives valid multimodal message payloads", () => {
  it("every cleared image egresses as a decodable JPEG, whatever it was selected as", async () => {
    okTransport();
    const png = await syntheticImage("image/png");

    const r = await adapter.compose(
      request({ images: [png], cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );

    expect(r.ok).toBe(true);
    const egress = sent().images!;
    expect(egress).toHaveLength(1);
    // Not "png in, png out": the de-identification gate re-encodes to JPEG so no
    // container metadata (EXIF, tEXt, COM) can survive the trip.
    expect(egress[0].mimeType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(egress[0].base64, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect((meta as { metadata?: Record<string, unknown> }).metadata ?? {}).not.toHaveProperty("exif");
  });

  it("transport is addressed to the qwen provider and the vision model", async () => {
    okTransport();

    await adapter.compose(request());

    expect(sent().provider).toBe("qwen");
    expect(sent().model).toBe("qwen3-vl-plus");
  });

  it("the clinical prompts reach the vendor unchanged when no identifier was detected", async () => {
    okTransport();

    await adapter.compose(
      request({ images: [await syntheticImage()], cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );

    expect(sent().userPrompt).toBe(CLEAN_USER_PROMPT);
    expect(sent().systemPrompt).toBe(CLEAN_SYSTEM_PROMPT);
  });

  it("a non-vision model is refused before any byte is prepared", async () => {
    const r = await adapter.compose(
      request({ model: "qwen3-max", images: [await syntheticImage()], cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("model_not_vision_capable");
    expect(chatSpy).not.toHaveBeenCalled();
  });
});

describe("7. Failed AI output never overwrites the radiologist's report", () => {
  it("prose instead of JSON parses to no draft", () => {
    expect(parseComposerDraftJson("This is not JSON at all")).toBeNull();
  });

  it("a draft truncated at the output ceiling parses to no draft", () => {
    // Exactly what a provider returns when it runs out of tokens mid-report: the
    // JSON must be rejected whole, never half-accepted into the radiologist's text.
    expect(parseComposerDraftJson('{"findings":"L4-5 disc extrusion')).toBeNull();
    expect(parseComposerDraftJson('{"findings":"x","impression":"y"')).toBeNull();
  });

  it("a JSON object with no report fields yields no clinical text of its own", () => {
    // The schema defaults every field, so an off-shape object is NOT rejected
    // here — it parses to an empty draft. That is precisely why the engine's
    // preserving kinds backfill the radiologist's own text before applying
    // (composeEngine.ts:1183-1193): the parse layer guarantees only that a
    // model which said nothing about findings writes no findings of its own.
    const draft = parseComposerDraftJson('{"notes":"not a report"}');
    expect(draft).not.toBeNull();
    expect(draft?.findings).toBe("");
    expect(draft?.impression).toBe("");
  });

  it("provider failure returns ok:false with no text to write", async () => {
    chatSpy.mockResolvedValue({
      ok: false,
      safeError: "rate_limit_exceeded",
      model: "qwen3-vl-plus",
      latencyMs: 50,
      usage: null,
    });

    const r = await adapter.compose(request());

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.safeError).toBe("rate_limit_exceeded");
      expect("text" in r).toBe(false);
    }
  });
});

describe("8. Ollama and existing providers remain unaffected", () => {
  it("Ollama SELECTED_IMAGES does not require cloudVisionAllowed", () => {
    const r = assertComposerProviderPolicy({
      provider: "ollama",
      aiMode: "SELECTED_IMAGES",
      imageCount: 2,
      cloudVisionAllowed: false,
      localEndpointConfigured: true,
    });
    expect(r.ok).toBe(true);
  });

  it("local_openai_compatible SELECTED_IMAGES does not require cloudVisionAllowed", () => {
    const r = assertComposerProviderPolicy({
      provider: "local_openai_compatible",
      aiMode: "SELECTED_IMAGES",
      imageCount: 3,
      cloudVisionAllowed: false,
      localEndpointConfigured: true,
    });
    expect(r.ok).toBe(true);
  });

  it("Ollama text-only still works without any cloud configuration", () => {
    const r = assertComposerProviderPolicy({
      provider: "ollama",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
      localEndpointConfigured: true,
    });
    expect(r.ok).toBe(true);
  });

  it("the local arm passes prompts through the gate with nothing egressed", async () => {
    const r = await assertGatewayPrivacy({
      provider: "ollama",
      systemPrompt: CLEAN_SYSTEM_PROMPT,
      userPrompt: "Patient: Zqtest Synthpatient — named, and still on-premises.",
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cloud).toBe(false);
      expect(r.userPrompt).toContain("Zqtest");
      expect(r.textPosture).toBe("not_applicable");
      expect(r.pixelPosture).toBe("not_verified");
    }
  });
});
