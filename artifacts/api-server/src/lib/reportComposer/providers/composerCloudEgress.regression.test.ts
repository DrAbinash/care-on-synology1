/**
 * Cloud egress regression — the two properties this PR must not disturb.
 *
 * P0-2: selected images going to a cloud provider must stay impossible through
 * the normal composer, even after P0-7 made cloud text genuinely configurable.
 * A key that now resolves correctly must not become an image licence.
 *
 * P0-7: the cloud arm must accept the key the admin saved in AI Provider
 * Settings, and must refuse to call the transport before that resolution and
 * the privacy gate have both passed. Resolution includes the ON/OFF switch on
 * the same row: a provider that is switched off is not used, and a provider
 * configured only through the environment is not treated as switched off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPERATOR_SUPPLIED_IMAGE_SOURCE,
  PATIENT_DERIVED_IMAGE_SOURCES,
} from "@workspace/ai-providers";

const h = vi.hoisted(() => ({
  /** provider name resolved from the mocked `eq(provider, …)` predicate */
  wanted: "__global__" as string,
  globalSettings: null as string | null,
  openaiEncryptedKey: null as string | null,
  openaiEndpointUrl: null as string | null,
  /** The admin's ON/OFF switch on that same row. */
  openaiIsEnabled: true,
  /** When true the provider has no `ai_provider_settings` row at all. */
  noOpenaiRow: false,
}));

const chatSpy = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: unknown) => ({ provider: value }),
  and: (...parts: unknown[]) => parts,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: { provider?: string }) => ({
          limit: async () => {
            const provider = cond?.provider ?? "";
            h.wanted = provider;
            if (provider === "__global__") {
              return h.globalSettings ? [{ settingsJson: h.globalSettings }] : [];
            }
            if (provider === "openai") {
              if (h.noOpenaiRow) return [];
              return [
                {
                  encryptedApiKey: h.openaiEncryptedKey,
                  endpointUrl: h.openaiEndpointUrl,
                  isEnabled: h.openaiIsEnabled,
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

// The stored key is opaque to these tests; passthrough decryption keeps the
// assertions about *which* key was used, not about the cipher.
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

import { assertComposerProviderPolicy } from "./assertComposerProviderPolicy";
import { OpenAiComposerAdapter } from "./openaiComposerAdapter";
import type { ComposerProviderRequest } from "./types";

const CLEAN_USER_PROMPT = [
  "RADIOLOGIST OBSERVATIONS (canonical clinical truth)",
  "- [quick-select] Lumbar | L4-5 | disc | central | extruded",
  "  Findings: Right L5 traversing root compressed by disc extrusion.",
  "  Measurement: AP canal diameter: 8.6 mm",
].join("\n");

const JPEG_IMAGE = { mimeType: "image/jpeg" as const, base64: "AAAA" };

function request(overrides: Partial<ComposerProviderRequest> = {}): ComposerProviderRequest {
  return {
    systemPrompt: "You are CARE's radiology reporting assistant.",
    userPrompt: CLEAN_USER_PROMPT,
    model: "gpt-4o",
    temperature: 0.1,
    timeoutMs: 30_000,
    ...overrides,
  };
}

beforeEach(() => {
  chatSpy.mockReset();
  h.globalSettings = null;
  h.openaiEncryptedKey = null;
  h.openaiEndpointUrl = null;
  h.openaiIsEnabled = true;
  h.noOpenaiRow = false;
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe("P0-2 — cloud image egress stays default-deny", () => {
  it("blocks SELECTED_IMAGES for a cloud provider even when its key resolves", () => {
    const r = assertComposerProviderPolicy({
      provider: "openai",
      aiMode: "SELECTED_IMAGES",
      cloudVisionAllowed: false,
      imageCount: 4,
      cloudApiKeyConfigured: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("cloud_vision_not_allowed");
  });

  it("blocks by image count as well as by mode, so an inline image list cannot slip past", () => {
    const r = assertComposerProviderPolicy({
      provider: "qwen",
      aiMode: "TEXT_ONLY",
      images: [JPEG_IMAGE],
      cloudApiKeyConfigured: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("cloud_vision_not_allowed");
  });

  it("allows cloud TEXT on the same configuration that blocks its images", () => {
    expect(
      assertComposerProviderPolicy({
        provider: "openai",
        aiMode: "TEXT_ONLY",
        imageCount: 0,
        cloudApiKeyConfigured: true,
      }),
    ).toEqual({ ok: true });
  });

  it("never applies the cloud vision gate to the local arms", () => {
    for (const provider of ["ollama", "local_openai_compatible"] as const) {
      const r = assertComposerProviderPolicy({
        provider,
        aiMode: "SELECTED_IMAGES",
        imageCount: 3,
        cloudVisionAllowed: false,
        localEndpointConfigured: true,
      });
      expect(r).toEqual({ ok: true });
    }
  });

  it("refuses a provider with no composer adapter instead of treating it as local", () => {
    const r = assertComposerProviderPolicy({
      provider: "gemini" as never,
      aiMode: "TEXT_ONLY",
      imageCount: 0,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("composer_provider_not_configured");
  });

  it("keeps the previous env-only answer for callers that do not pass a resolved key", () => {
    const before = assertComposerProviderPolicy({
      provider: "openai",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
    });
    expect(before.ok).toBe(false);
    process.env.OPENAI_API_KEY = "sk-env-for-policy";
    const after = assertComposerProviderPolicy({
      provider: "openai",
      aiMode: "TEXT_ONLY",
      imageCount: 0,
    });
    expect(after).toEqual({ ok: true });
  });

  it("the cloud transport itself refuses images without a second opt-in, and never dials out", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const r = await new OpenAiComposerAdapter().compose(
      request({ images: [JPEG_IMAGE, JPEG_IMAGE] }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("cloud_vision_not_allowed");
    expect(chatSpy).not.toHaveBeenCalled();
  });
});

/**
 * P0-A (Stage 1 PR-A): the admin's `cloudVisionAllowed` switch says cloud vision
 * is permitted for the clinic. It cannot say that THIS patient's frames were put
 * in front of THIS provider on purpose, so it is necessary and not sufficient.
 * These cases are the rule PR-B's screenshot button has to satisfy; they are
 * here before the button exists so the button cannot be shipped without it.
 */
describe("P0-A — the clinic flag does not clear the patient", () => {
  it("refuses a patient-derived frame with the flag on and nobody attesting", () => {
    const r = assertComposerProviderPolicy({
      provider: "openai",
      aiMode: "SELECTED_IMAGES",
      imageCount: 2,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      imageSourceTypes: ["PACS_SCREENSHOT", "PACS_SCREENSHOT"],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("cloud_image_sources_not_attested");
  });

  it("refuses every source type the key-image table can hold", () => {
    for (const source of PATIENT_DERIVED_IMAGE_SOURCES) {
      const r = assertComposerProviderPolicy({
        provider: "openai",
        aiMode: "SELECTED_IMAGES",
        imageCount: 1,
        cloudVisionAllowed: true,
        cloudApiKeyConfigured: true,
        imageSourceTypes: [source],
      });
      expect(r.ok, `source ${source} must not be sendable to cloud unattested`).toBe(false);
    }
  });

  it("treats an unknown source as patient-derived, not as clearance", () => {
    const r = assertComposerProviderPolicy({
      provider: "openai",
      aiMode: "SELECTED_IMAGES",
      imageCount: 3,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("cloud_image_provenance_unverified");
  });

  it("refuses a provenance list that does not cover every image", () => {
    // Every named source here is operator-supplied, so the ONLY thing that can
    // refuse the send is the count mismatch: three frames going out with two
    // names attached means one frame's owner is unknown.
    const r = assertComposerProviderPolicy({
      provider: "openai",
      aiMode: "SELECTED_IMAGES",
      imageCount: 3,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      imageSourceTypes: [OPERATOR_SUPPLIED_IMAGE_SOURCE, OPERATOR_SUPPLIED_IMAGE_SOURCE],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("cloud_image_provenance_unverified");
  });

  it("names the patient frame, not the count, when both are wrong", () => {
    const r = assertComposerProviderPolicy({
      provider: "openai",
      aiMode: "SELECTED_IMAGES",
      imageCount: 3,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      imageSourceTypes: ["UPLOAD", OPERATOR_SUPPLIED_IMAGE_SOURCE],
    });
    if (r.ok) return;
    expect(r.safeError).toBe("cloud_image_sources_not_attested");
  });

  it("refuses a mixed set because one image belongs to the patient", () => {
    const r = assertComposerProviderPolicy({
      provider: "openai",
      aiMode: "SELECTED_IMAGES",
      imageCount: 2,
      cloudVisionAllowed: true,
      cloudApiKeyConfigured: true,
      imageSourceTypes: [OPERATOR_SUPPLIED_IMAGE_SOURCE, "VIEWPORT_CAPTURE"],
    });
    if (r.ok) return;
    expect(r.safeError).toBe("cloud_image_sources_not_attested");
  });

  it("lets an operator's own phantom through on the flag alone (the trial path stays up)", () => {
    expect(
      assertComposerProviderPolicy({
        provider: "openai",
        aiMode: "SELECTED_IMAGES",
        imageCount: 1,
        cloudVisionAllowed: true,
        cloudApiKeyConfigured: true,
        imageSourceTypes: [OPERATOR_SUPPLIED_IMAGE_SOURCE],
      }),
    ).toEqual({ ok: true });
  });

  it("lets the same patient frame through once a clinician attested THIS request", () => {
    expect(
      assertComposerProviderPolicy({
        provider: "openai",
        aiMode: "SELECTED_IMAGES",
        imageCount: 1,
        cloudVisionAllowed: true,
        cloudApiKeyConfigured: true,
        imageSourceTypes: ["PACS_SCREENSHOT"],
        consentAttestedPerRequest: true,
      }),
    ).toEqual({ ok: true });
  });

  it("does not touch text-only reporting, which is what the clinic runs today", () => {
    expect(
      assertComposerProviderPolicy({
        provider: "deepseek",
        aiMode: "TEXT_ONLY",
        imageCount: 0,
        cloudVisionAllowed: true,
        cloudApiKeyConfigured: true,
      }),
    ).toEqual({ ok: true });
  });
});

describe("P0-7 — the composer sends with the key from AI Provider Settings", () => {
  it("uses the stored (decrypted) key with no environment variable set", async () => {
    h.openaiEncryptedKey = "settings-row-key";
    h.openaiEndpointUrl = "https://api.openai.com/v1";
    chatSpy.mockResolvedValue({
      ok: true,
      text: '{"findings":"x","impression":"y"}',
      model: "gpt-4o",
      latencyMs: 12,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    const r = await new OpenAiComposerAdapter().compose(request());

    expect(r.ok).toBe(true);
    expect(chatSpy).toHaveBeenCalledTimes(1);
    const args = chatSpy.mock.calls[0][0] as { apiKey: string; baseURL: string };
    expect(args.apiKey).toBe("decrypted(settings-row-key)");
    expect(args.baseURL).toBe("https://api.openai.com/v1");
  });

  it("refuses to dial out when neither the settings table nor the environment has a key", async () => {
    const r = await new OpenAiComposerAdapter().compose(request());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("openai_api_key_not_configured");
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("refuses a provider the admin switched OFF, even though its key still resolves", async () => {
    // The switch and the key live on the same row. Reading only the key meant a
    // deliberately disabled OpenAI could still be handed patient text, while
    // `/generate` and the interactive gateway refused the same screen setting.
    h.openaiEncryptedKey = "settings-row-key";
    h.openaiIsEnabled = false;
    const r = await new OpenAiComposerAdapter().compose(request());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("openai_provider_disabled");
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("does not read an environment-only configuration as switched OFF", async () => {
    // No `ai_provider_settings` row is not a statement about enablement — it is
    // how every pre-UI clinic and the CLI configured a vendor. Refusing here
    // would silently disable drafting for installs that work today.
    process.env.OPENAI_API_KEY = "sk-env";
    h.noOpenaiRow = true;
    chatSpy.mockResolvedValue({
      ok: true,
      text: '{"findings":"x","impression":"y"}',
      model: "gpt-4o",
      latencyMs: 12,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    const r = await new OpenAiComposerAdapter().compose(request());
    expect(r.ok).toBe(true);
    expect(chatSpy).toHaveBeenCalledTimes(1);
  });

  it("sends the output ceiling so a long report is not cut off mid-JSON", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    chatSpy.mockResolvedValue({
      ok: true,
      text: '{"findings":"x","impression":"y"}',
      model: "gpt-4o",
      latencyMs: 12,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });

    await new OpenAiComposerAdapter().compose(request({ maxTokens: 2400 }));

    const sent = chatSpy.mock.calls[0][0] as { maxTokens?: number };
    expect(sent.maxTokens).toBe(2400);
  });
});

describe("P0-1 — the privacy gate sits before the network call", () => {
  it("blocks a prompt naming the patient and sends nothing", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const r = await new OpenAiComposerAdapter().compose(
      request({ userPrompt: "Patient: Ramesh Kumar\nUHID: 45812\nRight L5 root compressed." }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.safeError).toBe("PHI_TEXT_CLOUD_BLOCKED");
    expect(chatSpy).not.toHaveBeenCalled();
  });

  it("sends the redacted text, not the original, when the clinic opted into redaction", async () => {
    h.globalSettings = JSON.stringify({ cloudTextPhiAllowed: true });
    process.env.OPENAI_API_KEY = "sk-env";
    chatSpy.mockResolvedValue({
      ok: true,
      text: '{"findings":"x","impression":"y"}',
      model: "gpt-4o",
      latencyMs: 9,
      usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    });

    await new OpenAiComposerAdapter().compose(
      request({ userPrompt: "Patient: Ramesh Kumar\nUHID: 45812\nRight L5 root compressed." }),
    );

    expect(chatSpy).toHaveBeenCalledTimes(1);
    const sent = chatSpy.mock.calls[0][0] as { userPrompt: string };
    expect(sent.userPrompt).not.toContain("Ramesh Kumar");
    expect(sent.userPrompt).not.toContain("45812");
    expect(sent.userPrompt).toContain("[REDACTED]");
    // The clinical fact the redaction must never eat.
    expect(sent.userPrompt).toContain("Right L5 root compressed.");
  });

  it("sends clean clinical prose exactly as written", async () => {
    process.env.OPENAI_API_KEY = "sk-env";
    chatSpy.mockResolvedValue({
      ok: true,
      text: '{"findings":"x","impression":"y"}',
      model: "gpt-4o",
      latencyMs: 9,
      usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    });

    await new OpenAiComposerAdapter().compose(request());

    const sent = chatSpy.mock.calls[0][0] as { userPrompt: string };
    expect(sent.userPrompt).toBe(CLEAN_USER_PROMPT);
  });
});
