/**
 * Cloud-vision Composer pathway — the regression suite for selected key images
 * reaching a cloud vision model (qwen3-vl-plus) through the shared OpenAI-compatible
 * transport.
 *
 * What changed to make this possible (and what these tests pin):
 *  - `composeViaSharedTransport` now PRODUCES the `PixelEgressProof` that
 *    `assertGatewayPrivacy` always demanded and no caller ever provided: the
 *    de-identification gate (metadata-stripping re-encode + on-premises OCR read
 *    against the study's own patient identifiers) runs inside the adapter, on the
 *    exact bytes about to be sent. Until that wiring existed, every composer cloud
 *    image send was refused with `cloud_image_not_verified` whatever the clinic had
 *    configured — which is why the only cloud runs that ever completed were
 *    TEXT_ONLY ones.
 *
 * Mocks follow `composerCloudEgress.regression.test.ts`: the provider settings row
 * through a fake `ai_provider_settings` select, credentials through passthrough
 * decryption, and `openAiCompatibleChat` through a spy. The de-identification
 * OCR runner is injected through `__setComposerCloudVisionDepsForTests`; sharp is
 * REAL, so the re-encoded proof bytes these tests assert are the bytes a clinic
 * would actually egress.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  globalSettings: null as string | null,
  qwenEncryptedKey: "test-key" as string | null,
  qwenEndpointUrl: "https://dashscope.example.com/compatible-mode/v1" as string | null,
  qwenIsEnabled: true,
  noQwenRow: false,
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
              if (h.noQwenRow) return [];
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
import type { ComposerProviderRequest } from "./types";
import type { PatientIdentifiers } from "../../ai/imageDeidentification";

const CLEAN_USER_PROMPT = [
  "RADIOLOGIST OBSERVATIONS (canonical clinical truth)",
  "- [quick-select] Lumbar | L4-5 | disc | central | extruded",
  "  Findings: Right L5 traversing root compressed by disc extrusion.",
].join("\n");

/** Synthetic patient — no real person. The OCR transcript is injected per test. */
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

async function syntheticJpeg(): Promise<{ base64: string; mimeType: "image/jpeg" }> {
  const buf = await sharp({
    create: { width: 24, height: 24, channels: 3, background: { r: 96, g: 128, b: 160 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { base64: buf.toString("base64"), mimeType: "image/jpeg" };
}

function request(overrides: Partial<ComposerProviderRequest> = {}): ComposerProviderRequest {
  return {
    systemPrompt: "You are CARE's radiology reporting assistant.",
    userPrompt: CLEAN_USER_PROMPT,
    model: "qwen3-vl-plus",
    temperature: 0.1,
    timeoutMs: 30_000,
    ...overrides,
  };
}

const adapter = new QwenComposerAdapter();

beforeEach(() => {
  chatSpy.mockReset();
  h.globalSettings = null;
  h.qwenEncryptedKey = "test-key";
  h.qwenEndpointUrl = "https://dashscope.example.com/compatible-mode/v1";
  h.qwenIsEnabled = true;
  h.noQwenRow = false;
  delete process.env.QWEN_API_KEY;
  __setComposerCloudVisionDepsForTests({
    // Clean on-premises read: the model transcribed overlay text and none of it
    // belongs to the synthetic patient.
    buildOcrRunner: () => async () => ({ read: true, transcript: "MRI LS SPINE T2 SAGittAL AXIAL" }),
  });
});

afterEach(() => {
  delete process.env.QWEN_API_KEY;
  __setComposerCloudVisionDepsForTests(null);
});

describe("R1 — text-only cloud runs carry zero images", () => {
  it("sends no images array to the transport when none were selected", async () => {
    chatSpy.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ findings: "F", impression: "I", recommendation: "" }),
      provider: "qwen",
      model: "qwen3-vl-plus",
      latencyMs: 5,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const r = await adapter.compose(request());
    expect(r.ok).toBe(true);
    expect(chatSpy).toHaveBeenCalledTimes(1);
    const sent = chatSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.images ?? []).toHaveLength(0);
    expect(r.ok && r.pixelPosture).toBeUndefined();
  });
});

describe("R2/R6 — four selected images egress as a verified multimodal payload to qwen3-vl-plus", () => {
  it("builds a pixel proof from the exact request bytes and sends the re-encoded set", async () => {
    const originals = [await syntheticJpeg(), await syntheticJpeg(), await syntheticJpeg(), await syntheticJpeg()];
    chatSpy.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ findings: "F", impression: "I", recommendation: "" }),
      provider: "qwen",
      model: "qwen3-vl-plus",
      latencyMs: 120,
      usage: { promptTokens: 2200, completionTokens: 400, totalTokens: 2600 },
    });
    const r = await adapter.compose(
      request({
        images: originals,
        cloudVisionAllowed: true,
        patientIdentifiers: SYNTHETIC_PATIENT,
        maxTokens: 4096,
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.pixelPosture).toBe("verified_clean");

    expect(chatSpy).toHaveBeenCalledTimes(1);
    const sent = chatSpy.mock.calls[0][0] as {
      provider: string;
      model: string;
      systemPrompt: string;
      userPrompt: string;
      images?: Array<{ mimeType: string; base64: string }>;
      jsonMode: boolean;
      extraBody?: Record<string, unknown>;
      maxTokens?: number;
    };
    // The transport was addressed exactly as the workflow expects.
    expect(sent.provider).toBe("qwen");
    expect(sent.model).toBe("qwen3-vl-plus");
    expect(sent.jsonMode).toBe(true);
    expect(sent.extraBody).toEqual({ enable_thinking: false });
    expect(typeof sent.maxTokens).toBe("number");

    // EXACTLY four images, in order, each the metadata-stripped re-encode the
    // de-identification gate produced — not the caller's original bytes.
    expect(sent.images).toHaveLength(4);
    for (let i = 0; i < 4; i += 1) {
      expect(sent.images![i].mimeType).toBe("image/jpeg");
      expect(sent.images![i].base64).not.toBe(originals[i].base64);
      // The egress bytes are a real, decodable JPEG.
      const meta = await sharp(Buffer.from(sent.images![i].base64, "base64")).metadata();
      expect(meta.format).toBe("jpeg");
    }
    // Re-encoded bytes for identical sources are identical — order is stable.
    expect(sent.images![0].base64).toBe(sent.images![1].base64);

    // The proof covered the WHOLE set: a partial proof is a refusal, not a
    // smaller send (pinned in gatewayPrivacy, exercised through this path).
    expect(sent.systemPrompt).toContain("radiology");
  });
});

describe("R5 — image policy failures block before any transport call", () => {
  it("refuses when no patient identifiers were resolved (nothing to check against)", async () => {
    const images = [await syntheticJpeg()];
    const r = await adapter.compose(request({ images, cloudVisionAllowed: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.safeError).toBe("cloud_image_not_verifiable");
      expect(r.detail).toContain("patient");
    }
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("refuses when the on-premises model could not read the image", async () => {
    __setComposerCloudVisionDepsForTests({
      buildOcrRunner: () => async () => ({ read: false, reason: "no local vision model is configured" }),
    });
    const images = [await syntheticJpeg()];
    const r = await adapter.compose(
      request({ images, cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("cloud_image_not_verifiable");
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("refuses when the patient's own identifiers are burned into the image", async () => {
    __setComposerCloudVisionDepsForTests({
      buildOcrRunner: () => async () => ({ read: true, transcript: "ZQTEST SYNTHPATIENT MRN SYN-0001 1990-01-01" }),
    });
    const images = [await syntheticJpeg()];
    const r = await adapter.compose(
      request({ images, cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("cloud_image_burned_in_identifiers");
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("refuses one unreadable image out of four — the set fails as a whole", async () => {
    let call = 0;
    __setComposerCloudVisionDepsForTests({
      buildOcrRunner: () => async () => {
        call += 1;
        return call === 3 ? { read: false, reason: "transient" } : { read: true, transcript: "clean" };
      },
    });
    const images = [
      await syntheticJpeg(),
      await syntheticJpeg(),
      await syntheticJpeg(),
      await syntheticJpeg(),
    ];
    const r = await adapter.compose(
      request({ images, cloudVisionAllowed: true, patientIdentifiers: SYNTHETIC_PATIENT }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("cloud_image_not_verifiable");
    if (!r.ok) expect(r.detail).toContain("3 of 4");
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("still refuses images when cloudVisionAllowed is off (existing default-deny)", async () => {
    const images = [await syntheticJpeg()];
    const r = await adapter.compose(
      request({ images, cloudVisionAllowed: false, patientIdentifiers: SYNTHETIC_PATIENT }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("cloud_vision_not_allowed");
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("blocks PHI text the scrubber cannot clear", async () => {
    const images = [await syntheticJpeg()];
    const r = await adapter.compose(
      request({
        systemPrompt: "You are CARE's radiology reporting assistant.",
        userPrompt: "Clinical history: Patient name: Ramesh Kumar. MRN: 45812. Pain since 12/03.",
        images,
        cloudVisionAllowed: true,
        patientIdentifiers: SYNTHETIC_PATIENT,
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.safeError).toBe("PHI_TEXT_CLOUD_BLOCKED");
    expect(chatSpy).not.toHaveBeenCalled();
  });
});
