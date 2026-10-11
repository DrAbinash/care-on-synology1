/**
 * Cloud composer credential resolution (P0-7).
 *
 * The defect: AI Provider Settings stores the key encrypted in
 * `ai_provider_settings`, and the admin UI's "Test connection" reads that row —
 * while the Report Composer's cloud adapters read `process.env` only. A clinic
 * could therefore see a green, healthy provider and get
 * `<provider>_api_key_not_configured` on every real draft.
 *
 * The fix is precedence, not a new table: database → environment → vendor
 * default, matching what `localOpenAICompatibleConfig.ts` already does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dbKey: null as string | null,
  dbUrl: null as string | null,
  envKey: null as string | null,
  envUrl: null as string | null,
  throwOnLookup: false,
  /** The `ai_provider_settings` row for this provider, or null when there is none. */
  row: null as { isEnabled: boolean } | null,
}));

vi.mock("@workspace/ai-providers", () => ({
  getProviderApiKey: async (provider: string) => {
    if (h.throwOnLookup) throw new Error(`db down: ${provider}`);
    return h.dbKey;
  },
  getProviderEndpointUrl: async () => h.dbUrl,
  // The admin's ON/OFF switch, read from the same table as the key.
  loadProviderConfig: async () => {
    if (h.throwOnLookup) throw new Error("db down");
    return h.row;
  },
  readEnvApiKey: () => h.envKey,
  readEnvBaseUrl: () => h.envUrl,
  COMPATIBLE_PROVIDER_DEFAULTS: {
    openai: { defaultModel: "gpt-4o", baseURL: "https://api.openai.com/v1" },
    qwen: { defaultModel: "qwen3.7-plus", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    deepseek: { defaultModel: "deepseek-chat", baseURL: "https://api.deepseek.com" },
  },
}));

vi.mock("../../logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { resolveCloudComposerConfig, asCloudComposerProvider } from "./cloudComposerConfig";

beforeEach(() => {
  h.dbKey = null;
  h.dbUrl = null;
  h.envKey = null;
  h.envUrl = null;
  h.throwOnLookup = false;
  h.row = null;
});

describe("resolveCloudComposerConfig", () => {
  it("uses the key saved through AI Provider Settings, not only the environment", async () => {
    h.dbKey = "sk-from-settings";
    const cfg = await resolveCloudComposerConfig("openai");
    expect(cfg.apiKey).toBe("sk-from-settings");
    expect(cfg.keyConfigured).toBe(true);
  });

  it("prefers the database over the environment when both are set", async () => {
    h.dbKey = "sk-from-settings";
    h.envKey = "sk-from-env";
    h.dbUrl = "https://settings.example.com/v1";
    h.envUrl = "https://env.example.com/v1";
    const cfg = await resolveCloudComposerConfig("qwen");
    expect(cfg.apiKey).toBe("sk-from-settings");
    expect(cfg.baseURL).toBe("https://settings.example.com/v1");
  });

  it("still honours an environment-only configuration", async () => {
    h.envKey = "sk-from-env";
    h.envUrl = "https://env.example.com/v1/";
    const cfg = await resolveCloudComposerConfig("deepseek");
    expect(cfg.apiKey).toBe("sk-from-env");
    // Trailing slash normalised, as the transport expects.
    expect(cfg.baseURL).toBe("https://env.example.com/v1");
  });

  it("falls back to the vendor default endpoint when neither layer sets one", async () => {
    h.dbKey = "sk-from-settings";
    const cfg = await resolveCloudComposerConfig("openai");
    expect(cfg.baseURL).toBe("https://api.openai.com/v1");
  });

  it("reports unconfigured when no layer has a key", async () => {
    const cfg = await resolveCloudComposerConfig("openai");
    expect(cfg.apiKey).toBeNull();
    expect(cfg.keyConfigured).toBe(false);
  });

  it("a settings-table outage degrades to the environment instead of blocking an env-configured clinic", async () => {
    h.throwOnLookup = true;
    h.envKey = "sk-from-env";
    const cfg = await resolveCloudComposerConfig("openai");
    expect(cfg.keyConfigured).toBe(true);
    expect(cfg.apiKey).toBe("sk-from-env");
    expect(cfg.configLookupFailed).toBe(true);
  });

  it("never reports a key it does not have when the lookup fails and env is empty", async () => {
    h.throwOnLookup = true;
    const cfg = await resolveCloudComposerConfig("openai");
    expect(cfg.apiKey).toBeNull();
    expect(cfg.keyConfigured).toBe(false);
    expect(cfg.configLookupFailed).toBe(true);
  });

  it("exposes no secret beyond the returned key string (nothing logged, nothing exposed to the client)", async () => {
    h.dbKey = "sk-secret-value";
    const cfg = await resolveCloudComposerConfig("openai");
    const keys = Object.keys(cfg).sort();
    // `enabled` and `configLookupFailed` are booleans about the admin's own
    // settings screen — they disclose nothing the UI does not already show, and
    // `apiKey` is the only credential-bearing field.
    expect(keys).toEqual([
      "apiKey",
      "baseURL",
      "configLookupFailed",
      "enabled",
      "keyConfigured",
      "provider",
    ]);
  });

  describe("the admin's ON/OFF switch", () => {
    it("reports the switch OFF when a settings row says OFF, even with a usable key", async () => {
      h.dbKey = "sk-from-settings";
      h.row = { isEnabled: false };
      const cfg = await resolveCloudComposerConfig("openai");
      // The key still resolves — this field is the honest answer to "is it on?",
      // and it is the caller's job to refuse. Silent disablement here would make
      // the env fallback look like a working provider.
      expect(cfg.keyConfigured).toBe(true);
      expect(cfg.enabled).toBe(false);
    });

    it("reports the switch ON when a settings row says ON", async () => {
      h.row = { isEnabled: true };
      const cfg = await resolveCloudComposerConfig("openai");
      expect(cfg.enabled).toBe(true);
    });

    it("reports null, not false, when no settings row exists — env config makes no enablement statement", async () => {
      h.envKey = "sk-from-env";
      h.row = null;
      const cfg = await resolveCloudComposerConfig("openai");
      expect(cfg.enabled).toBeNull();
      expect(cfg.keyConfigured).toBe(true);
    });

    it("reports null when the settings table cannot be read, so an outage is not read as OFF", async () => {
      h.throwOnLookup = true;
      const cfg = await resolveCloudComposerConfig("openai");
      expect(cfg.enabled).toBeNull();
      expect(cfg.configLookupFailed).toBe(true);
    });
  });
});

describe("asCloudComposerProvider", () => {
  it("narrows only the three wired cloud arms", () => {
    expect(asCloudComposerProvider("openai")).toBe("openai");
    expect(asCloudComposerProvider("qwen")).toBe("qwen");
    expect(asCloudComposerProvider("deepseek")).toBe("deepseek");
    expect(asCloudComposerProvider("ollama")).toBeNull();
    expect(asCloudComposerProvider("local_openai_compatible")).toBeNull();
  });
});
