/**
 * Endpoint-derived locality — composer policy gate integration tests.
 *
 * SECURITY INVARIANT: A "local_openai_compatible" provider whose resolved URL
 * points to a public internet address must be reclassified as cloud for PHI
 * egress purposes. The URL is the ground truth, not the provider name.
 *
 * These tests pin the assertComposerProviderPolicy gate with the resolvedUrl
 * parameter. They prove that:
 *  1. A local provider with a private URL bypasses cloud vision gate (unchanged)
 *  2. A local provider with a public URL is reclassified as cloud
 *  3. ALL data (text AND images) is refused for reclassified providers — the
 *     admin thought the provider was local and did NOT consent to cloud egress
 *  4. A genuinely local provider (private URL) has no cloud gate
 */
import { describe, it, expect, vi } from "vitest";

// Mock DB and crypto to prevent import-time DATABASE_URL crash.
// assertComposerProviderPolicy imports from @workspace/ai-providers which
// transitively imports @workspace/db.
vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: unknown) => ({ provider: value }),
  and: (...parts: unknown[]) => parts,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
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
  decryptSecret: (s: string) => s,
  encryptSecret: (s: string) => s,
}));

import { assertComposerProviderPolicy } from "./assertComposerProviderPolicy";

describe("assertComposerProviderPolicy — endpoint-derived locality", () => {
  // ─── Genuinely local: private URL → no cloud gate ─────────────────────────

  describe("local_openai_compatible + private URL", () => {
    it("allows TEXT_ONLY without cloud controls", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "TEXT_ONLY",
        localEndpointConfigured: true,
        resolvedUrl: "http://192.168.1.100:8080",
      });
      expect(r).toEqual({ ok: true });
    });

    it("allows SELECTED_IMAGES without cloudVisionAllowed (genuinely local)", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "SELECTED_IMAGES",
        cloudVisionAllowed: false,
        imageCount: 4,
        localEndpointConfigured: true,
        resolvedUrl: "http://192.168.1.100:8080",
      });
      expect(r).toEqual({ ok: true });
    });

    it("allows SELECTED_IMAGES on localhost without cloudVisionAllowed", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "SELECTED_IMAGES",
        cloudVisionAllowed: false,
        imageCount: 2,
        localEndpointConfigured: true,
        resolvedUrl: "http://localhost:8080",
      });
      expect(r).toEqual({ ok: true });
    });

    it("allows SELECTED_IMAGES on 10.x LAN without cloudVisionAllowed", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "SELECTED_IMAGES",
        cloudVisionAllowed: false,
        imageCount: 1,
        localEndpointConfigured: true,
        resolvedUrl: "http://10.0.1.50:8080",
      });
      expect(r).toEqual({ ok: true });
    });
  });

  // ─── Reclassified as cloud: public URL → ALL data refused ─────────────────

  describe("local_openai_compatible + public URL (reclassified as cloud)", () => {
    it("refuses TEXT_ONLY — clinical text is PHI, admin did not consent to cloud", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "TEXT_ONLY",
        cloudVisionAllowed: false,
        imageCount: 0,
        localEndpointConfigured: true,
        resolvedUrl: "https://api.openai.com/v1",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.safeError).toBe("local_provider_url_points_to_cloud");
    });

    it("refuses SELECTED_IMAGES without cloudVisionAllowed", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "SELECTED_IMAGES",
        cloudVisionAllowed: false,
        imageCount: 4,
        localEndpointConfigured: true,
        resolvedUrl: "https://api.openai.com/v1",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.safeError).toBe("local_provider_url_points_to_cloud");
    });

    it("refuses SELECTED_IMAGES even WITH cloudVisionAllowed — the admin configured a LOCAL provider", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "SELECTED_IMAGES",
        cloudVisionAllowed: true,
        imageCount: 3,
        localEndpointConfigured: true,
        resolvedUrl: "https://api.openai.com/v1",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.safeError).toBe("local_provider_url_points_to_cloud");
    });

    it("refuses TEXT_ONLY even when imageCount > 0 (the mode is text, the URL is cloud)", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "TEXT_ONLY",
        cloudVisionAllowed: false,
        imageCount: 2,
        localEndpointConfigured: true,
        resolvedUrl: "https://api.openai.com/v1",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.safeError).toBe("local_provider_url_points_to_cloud");
    });

    it("refuses a DeepSeek public URL pointed at a local provider", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "TEXT_ONLY",
        localEndpointConfigured: true,
        resolvedUrl: "https://api.deepseek.com",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.safeError).toBe("local_provider_url_points_to_cloud");
    });

    it("refuses images to cloud metadata endpoint (169.254.169.254)", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "SELECTED_IMAGES",
        cloudVisionAllowed: false,
        imageCount: 1,
        localEndpointConfigured: true,
        resolvedUrl: "http://169.254.169.254/latest/meta-data",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.safeError).toBe("local_provider_url_points_to_cloud");
    });
  });

  // ─── No URL resolved: unchanged behaviour ─────────────────────────────────

  describe("local_openai_compatible + no resolvedUrl", () => {
    it("allows TEXT_ONLY when endpoint configured but no resolvedUrl passed", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "TEXT_ONLY",
        localEndpointConfigured: true,
      });
      expect(r).toEqual({ ok: true });
    });

    it("allows SELECTED_IMAGES without cloudVisionAllowed (no URL to reclassify)", () => {
      const r = assertComposerProviderPolicy({
        provider: "local_openai_compatible",
        aiMode: "SELECTED_IMAGES",
        cloudVisionAllowed: false,
        imageCount: 2,
        localEndpointConfigured: true,
      });
      expect(r).toEqual({ ok: true });
    });
  });

  // ─── Ollama: not affected by resolvedUrl (handled separately) ──────────────

  describe("ollama — not reclassified by resolvedUrl", () => {
    it("allows TEXT_ONLY regardless", () => {
      const r = assertComposerProviderPolicy({
        provider: "ollama",
        aiMode: "TEXT_ONLY",
      });
      expect(r).toEqual({ ok: true });
    });

    it("blocks SELECTED_IMAGES with empty images (unchanged)", () => {
      const r = assertComposerProviderPolicy({
        provider: "ollama",
        aiMode: "SELECTED_IMAGES",
        imageCount: 0,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.safeError).toBe("selected_images_empty");
    });
  });

  // ─── Cloud providers: unaffected by resolvedUrl ───────────────────────────

  describe("cloud providers — always cloud regardless of resolvedUrl", () => {
    it("openai requires cloudVisionAllowed for images", () => {
      const r = assertComposerProviderPolicy({
        provider: "openai",
        aiMode: "SELECTED_IMAGES",
        cloudVisionAllowed: false,
        imageCount: 1,
        cloudApiKeyConfigured: true,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.safeError).toBe("cloud_vision_not_allowed");
    });

    it("deepseek requires API key", () => {
      const r = assertComposerProviderPolicy({
        provider: "deepseek",
        aiMode: "TEXT_ONLY",
        cloudApiKeyConfigured: false,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.safeError).toBe("deepseek_api_key_not_configured");
    });
  });
});
