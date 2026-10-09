/**
 * Cloud egress regression — the two properties this PR must not disturb.
 *
 * P0-2: selected images going to a cloud provider must stay impossible through
 * the normal composer, even after P0-7 made cloud text genuinely configurable.
 * A key that now resolves correctly must not become an image licence.
 *
 * P0-7: the cloud arm must accept the key the admin saved in AI Provider
 * Settings, and must refuse to call the transport before that resolution and
 * the privacy gate have both passed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** provider name resolved from the mocked `eq(provider, …)` predicate */
  wanted: "__global__" as string,
  globalSettings: null as string | null,
  openaiEncryptedKey: null as string | null,
  openaiEndpointUrl: null as string | null,
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
              return [
                {
                  encryptedApiKey: h.openaiEncryptedKey,
                  endpointUrl: h.openaiEndpointUrl,
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
