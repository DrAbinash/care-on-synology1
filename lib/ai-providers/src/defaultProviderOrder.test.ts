import { beforeEach, describe, expect, test, vi } from "vitest";

// getDefaultProviderName decides where an AI task goes when nobody configured a
// route for it. It used to walk BUILTIN_PROVIDER_NAMES in declaration order,
// which lists openai and gemini before ollama — so switching on a cloud key for
// one feature silently re-pointed every unrouted task at that cloud, including
// the clinical-note endpoint that sends named demographics.

type Row = { settingsJson?: string | null; isEnabled?: boolean };

let globalSettings: string | null;
const enabled: Record<string, boolean> = {};

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, value: unknown) => ({ __provider: value }),
  and: (...parts: unknown[]) => parts,
}));

vi.mock("@workspace/db", () => {
  const aiProviderSettingsTable = { provider: "provider", settingsJson: "settings_json", isEnabled: "is_enabled" };
  const db = {
    select: () => ({
      from: () => ({
        where: (cond: { __provider?: string } | unknown[]) => {
          const flat = Array.isArray(cond) ? cond : [cond];
          const hit = flat.find((c) => (c as { __provider?: string })?.__provider) as
            | { __provider: string }
            | undefined;
          const provider = hit?.__provider ?? "";
          const row: Row =
            provider === "__global__"
              ? { settingsJson: globalSettings }
              : { isEnabled: enabled[provider] === true };
          return { limit: async () => [row] };
        },
      }),
    }),
  };
  return { db, aiProviderSettingsTable, aiModelRoutesTable: {} };
});

vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => s }));

import { getDefaultProviderName } from "./index";

beforeEach(() => {
  globalSettings = null;
  for (const k of Object.keys(enabled)) delete enabled[k];
});

describe("getDefaultProviderName", () => {
  test("an explicit global default still wins", async () => {
    globalSettings = JSON.stringify({ defaultProvider: "deepseek" });
    enabled.ollama = true;
    enabled.deepseek = true;
    expect(await getDefaultProviderName()).toBe("deepseek");
  });

  test("with both local and cloud enabled, local is chosen", async () => {
    enabled.openai = true;
    enabled.gemini = true;
    enabled.ollama = true;
    expect(await getDefaultProviderName()).toBe("ollama");
  });

  test("local_openai_compatible also counts as on-prem", async () => {
    enabled.openai = true;
    enabled.local_openai_compatible = true;
    expect(await getDefaultProviderName()).toBe("local_openai_compatible");
  });

  test("cloud is still reachable when nothing local is enabled", async () => {
    enabled.openai = true;
    enabled.gemini = true;
    expect(await getDefaultProviderName()).toBe("openai");
  });

  test("nothing enabled falls back to the historical default", async () => {
    expect(await getDefaultProviderName()).toBe("gemini");
  });
});
