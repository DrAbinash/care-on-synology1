/**
 * Default routing semantics for Local OpenAI-Compatible.
 * Provider seeding (Bonsai-friendly Settings pre-fill) MUST NOT create task routes.
 * CARE default without explicit route/override remains Ollama.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type InsertCall = [unknown, Record<string, unknown>];
const insertCalls: InsertCall[] = [];
const selectLimit = vi.fn(async (): Promise<Array<{ id: number }>> => []);

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (_n?: number) => selectLimit(),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: async (vals: Record<string, unknown>) => {
        insertCalls.push([table, vals]);
      },
    }),
  },
  aiProviderSettingsTable: { __name: "ai_provider_settings" },
  aiModelRoutesTable: { __name: "ai_model_routes" },
}));

vi.mock("@workspace/ai-providers", async () => {
  const actual = await vi.importActual<typeof import("@workspace/ai-providers")>(
    "@workspace/ai-providers",
  );
  return {
    ...actual,
    getProviderApiKey: vi.fn(async () => null),
    getProviderEndpointUrl: vi.fn(async () => null),
    loadProviderConfig: vi.fn(async () => null),
    readEnvBaseUrl: vi.fn(() => null),
    readEnvApiKey: vi.fn(() => null),
  };
});

describe("ensureLocalOpenAiCompatibleDefaults — provider seed only", () => {
  beforeEach(() => {
    insertCalls.length = 0;
    selectLimit.mockReset();
    selectLimit.mockResolvedValue([]);
  });

  it("seeds provider row with Bonsai-friendly defaults when absent", async () => {
    const { ensureLocalOpenAiCompatibleDefaults, LOCAL_OPENAI_DEFAULT_MODEL } =
      await import("./localOpenAiCompatibleConfig");
    await ensureLocalOpenAiCompatibleDefaults();
    expect(insertCalls).toHaveLength(1);
    const [, vals] = insertCalls[0]!;
    expect(vals.provider).toBe("local_openai_compatible");
    expect(vals.defaultModel).toBe(LOCAL_OPENAI_DEFAULT_MODEL);
    expect(vals.isDefault).toBe(false);
    const settings = JSON.parse(String(vals.settingsJson));
    expect(settings.displayName).toBe("Bonsai 2 27B");
    expect(settings.supportsVision).toBe(true);
    expect(settings.jsonMode).toBe(false);
  });

  it("does NOT insert any ai_model_routes rows", async () => {
    const { ensureLocalOpenAiCompatibleDefaults } = await import(
      "./localOpenAiCompatibleConfig"
    );
    await ensureLocalOpenAiCompatibleDefaults();
    for (const [table, vals] of insertCalls) {
      const named = table as { __name?: string };
      expect(named.__name).not.toBe("ai_model_routes");
      expect(vals.taskKey).toBeUndefined();
    }
  });

  it("does not overwrite an existing provider row", async () => {
    selectLimit.mockResolvedValueOnce([{ id: 42 }]);
    const { ensureLocalOpenAiCompatibleDefaults } = await import(
      "./localOpenAiCompatibleConfig"
    );
    await ensureLocalOpenAiCompatibleDefaults();
    expect(insertCalls).toHaveLength(0);
  });
});

describe("source freeze — Settings soft-seed never writes task routes", () => {
  it("ensureLocalOpenAiCompatibleDefaults source does not reference ai_model_routes", () => {
    const src = readFileSync(
      join(__dirname, "localOpenAiCompatibleConfig.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/aiModelRoutesTable/);
    expect(src).not.toMatch(/report_composer/);
    expect(src).not.toMatch(/selected_image_vision/);
    expect(src).toMatch(/aiProviderSettingsTable/);
  });

  it("GET settings soft-seed comment documents no routing side effect", () => {
    const src = readFileSync(
      join(__dirname, "../../../routes/aiReporting.ts"),
      "utf8",
    );
    expect(src).toMatch(/Never creates\/modifies ai_model_routes/);
    expect(src).toMatch(/ensureLocalOpenAiCompatibleDefaults/);
  });
});

describe("composeEngine provider resolution order (source contract)", () => {
  it("defaults providerName to ollama and only overrides via session or task route", () => {
    const src = readFileSync(join(__dirname, "../composeEngine.ts"), "utf8");
    // Ollama is the clinic default, reached by assigning it in the branch where
    // nobody named a provider. It used to be the initialiser of `providerName`
    // AND the value an unrecognised name was coerced to — the second is now a
    // refusal, so the default lives in its own branch.
    expect(src).toMatch(/providerName = "ollama"/);
    expect(src).toMatch(/resolveTaskRoute\(taskKey\)/);
    expect(src).toMatch(/sessionProvider/);
    // A name CARE has no adapter for is refused rather than run as something else.
    expect(src).toMatch(/parseComposerProviderName/);
    expect(src).toMatch(/composer_provider_not_supported/);
    // Must not hard-code Bonsai as the compose default.
    expect(src).not.toMatch(/providerName\s*=\s*"local_openai_compatible"/);
  });
});
