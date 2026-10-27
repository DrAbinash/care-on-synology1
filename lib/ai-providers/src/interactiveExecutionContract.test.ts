/**
 * C1 — the interactive AI execution contract.
 *
 * WHY THIS FILE EXISTS
 *   `POST /api/ai-reporting/draft` resolves a provider, checks that provider's
 *   configuration and enablement, then labels the stored draft, the audit row
 *   and the HTTP response with it — and finally calls
 *   `generateAiForTask(taskKey, prompt, images, { model })` WITHOUT the provider.
 *   The gateway resolves the provider a second time from the task route or the
 *   global default. So the provider that answered the request is whichever one
 *   the route table named, while every record says the one the caller asked for
 *   and had its enablement checked. A provider disabled in Settings can answer,
 *   and the audit trail cannot say which model produced the words.
 *
 *   These tests drive the REAL gateway. "Which provider executed" is observed as
 *   which socket was opened, not read out of a source file.
 *
 * WHAT IS STUBBED, AND WHY THAT IS ENOUGH
 *   - `@workspace/db` — provider settings and task routes are configuration, and
 *     the defect is exactly a configuration-versus-execution disagreement.
 *   - `@google/generative-ai` — the cloud socket.
 *   - `global.fetch` / `AbortSignal.timeout` — the local socket and the deadline
 *     that governs it.
 *   Nothing in resolution, policy, timeout or identity is stubbed.
 */
import { beforeEach, describe, expect, it, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: {} as Record<
    string,
    {
      provider: string;
      isEnabled: boolean;
      encryptedApiKey: string | null;
      defaultModel: string | null;
      endpointUrl: string | null;
      settingsJson: string | null;
    }
  >,
  taskRoutes: {} as Record<string, { provider: string; model?: string | null }>,
  geminiParts: [] as unknown[],
  geminiModels: [] as string[],
  ollamaUrls: [] as string[],
  abortTimeouts: [] as unknown[],
}));

// `vi.mock` factories are hoisted above module scope, so the table stubs have to
// come from `vi.hoisted` — a plain `const` here would not be initialised yet.
// Columns are objects, not strings, so the `where()` stub can tell which table
// and which column an `eq()` referred to. The real schema is never imported here.
const TABLES = vi.hoisted(() => {
  const col = (table: string, key: string) => ({ __table: table, __key: key });
  return {
    settings: {
      __table: "ai_provider_settings",
      provider: col("ai_provider_settings", "provider"),
      settingsJson: col("ai_provider_settings", "settings_json"),
      encryptedApiKey: col("ai_provider_settings", "encrypted_api_key"),
      endpointUrl: col("ai_provider_settings", "endpoint_url"),
      defaultModel: col("ai_provider_settings", "default_model"),
    },
    routes: {
      __table: "ai_model_routes",
      taskKey: col("ai_model_routes", "task_key"),
      provider: col("ai_model_routes", "provider"),
      model: col("ai_model_routes", "model"),
      isActive: col("ai_model_routes", "is_active"),
    },
  };
});

vi.mock("@workspace/db", () => ({
  aiProviderSettingsTable: TABLES.settings,
  aiModelRoutesTable: TABLES.routes,
  db: {
    select: () => {
      const rowsFor = (table: { __table?: string }, conds: unknown[]) => {
        const flat = (Array.isArray(conds) ? conds : [conds]).flat() as Array<{
          __col?: { __table?: string; __key?: string };
          value?: unknown;
        }>;
        if (table?.__table === "ai_model_routes") {
          const byTask = flat.find((c) => c.__col?.__key === "task_key");
          const route = byTask ? state.taskRoutes[String(byTask.value)] : undefined;
          return route ? [{ provider: route.provider, model: route.model }] : [];
        }
        const hit = flat.find((c) => c.__col?.__table === "ai_provider_settings");
        const row = state.settings[String(hit?.value ?? "")];
        return row ? [row] : [];
      };
      const chain = (table: { __table?: string }, conds: unknown[]) => ({
        limit: async (_n?: number) => rowsFor(table, conds),
      });
      return {
        from: (table: { __table?: string }) => ({
          where: (cond: unknown) => ({
            limit: async (_n?: number) => rowsFor(table, [cond]),
            orderBy: () => ({ limit: async () => rowsFor(table, [cond]) }),
          }),
          orderBy: () => ({ limit: async () => rowsFor(table, []) }),
          limit: async () => rowsFor(table, []),
        }),
      };
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, value: unknown) => ({ __col: col, value }),
  and: (...parts: unknown[]) => parts.flat(),
}));

vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => `decrypted:${s}` }));

// Production code uses hardenedLocalRequest (DNS-pinned transport) instead of
// bare fetch. Delegate to global.fetch so existing mocks work.
vi.mock("./hardenedTransport", () => ({
  hardenedLocalRequest: async (url: string, init?: RequestInit) => {
    const response = await globalThis.fetch(url, init);
    return { response, boundIp: "127.0.0.1", originalHost: new URL(url).host };
  },
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(opts: { model?: string }) {
      state.geminiModels.push(opts?.model ?? "");
      return {
        generateContent: async (parts: unknown) => {
          state.geminiParts.push(parts);
          return { response: { text: () => "IMPRESSION: No acute intracranial abnormality." } };
        },
      };
    }
  },
}));

import { generateAiForTask, generateAiResponse, resolveRequestTimeoutMs } from "./index";

const CLEAN_PROMPT =
  "Write ONLY the IMPRESSION for THIS study.\nFindings: No mass, no haemorrhage, no infarct.";

function configure(opts: {
  providers: Record<
    string,
    {
      enabled?: boolean;
      key?: string | null;
      defaultModel?: string | null;
      endpointUrl?: string | null;
    }
  >;
  routes?: Record<string, { provider: string; model?: string | null }>;
  globalSettings?: Record<string, unknown>;
}) {
  state.settings = {};
  if (opts.globalSettings) {
    state.settings.__global__ = {
      provider: "__global__",
      isEnabled: true,
      encryptedApiKey: null,
      defaultModel: null,
      endpointUrl: null,
      settingsJson: JSON.stringify(opts.globalSettings),
    };
  }
  for (const [name, cfg] of Object.entries(opts.providers)) {
    state.settings[name] = {
      provider: name,
      isEnabled: cfg.enabled ?? true,
      encryptedApiKey: cfg.key === undefined ? "cipher-text" : cfg.key,
      defaultModel: cfg.defaultModel ?? null,
      endpointUrl: cfg.endpointUrl ?? null,
      settingsJson: null,
    };
  }
  state.taskRoutes = opts.routes ?? {};
}

/** A provider row shaped like "the clinic never configured this one". */
const ABSENT = { enabled: false, key: null } as const;

beforeEach(() => {
  state.geminiParts = [];
  state.geminiModels = [];
  state.ollamaUrls = [];
  state.abortTimeouts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      state.ollamaUrls.push(String(input));
      // Behave like a machine with nothing listening: the attempt is the evidence.
      throw new TypeError("fetch failed: ECONNREFUSED");
    }) as never,
  );
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: unknown) => {
    state.abortTimeouts.push(ms);
    return { reason: undefined, throwIfAborted() {} } as never;
  });
});

describe("reproduction — the gateway replaces the provider nobody asked for", () => {
  test("a task route silently answers for the provider the route validated", async () => {
    // Exactly the call `/draft` makes today: gemini resolved and checked, only
    // `{ model }` handed to the gateway.
    configure({
      providers: { gemini: { enabled: true, defaultModel: "gemini-1.5-pro" }, ollama: ABSENT },
      routes: { radiology_draft: { provider: "ollama", model: "llama3.1" } },
    });

    const res = await generateAiForTask("radiology_draft", CLEAN_PROMPT, [], {
      model: "gemini-1.5-pro",
    });

    // The cloud provider whose configuration was validated was never contacted…
    expect(state.geminiParts).toHaveLength(0);
    // …and the request went to the provider named by the task route instead.
    expect(state.ollamaUrls).toHaveLength(1);
    expect(state.ollamaUrls[0]).toMatch(/\/api\/chat$/);
    expect(res.success).toBe(false);
  });

  test("a provider disabled in Settings still executes when a task route names it", async () => {
    // `ollama` above has isEnabled:false and no key. The gateway's Ollama arm
    // never consults enablement, so "disabled" only ever stopped the caller that
    // checked — not the executor.
    configure({
      providers: { gemini: { enabled: true }, ollama: ABSENT },
      routes: { radiology_draft: { provider: "ollama", model: "llama3.1" } },
    });
    expect(state.settings.ollama.isEnabled).toBe(false);

    await generateAiForTask("radiology_draft", CLEAN_PROMPT, [], { model: "gemini-1.5-pro" });
    expect(state.ollamaUrls).toHaveLength(1);
  });

  test("the execution layer reports identity, so no caller has to guess", async () => {
    // This is the assertion that made C1 necessary: before it, nothing in the
    // result stated what ran, so `/draft` recorded the provider IT had resolved
    // into the draft row, the audit row and the response body.
    configure({ providers: { gemini: { enabled: true, defaultModel: "gemini-1.5-pro" }, ollama: ABSENT } });
    const res = await generateAiResponse("gemini", CLEAN_PROMPT, []);
    expect(res.success).toBe(true);
    expect(res.execution).toMatchObject({
      provider: "gemini",
      model: "gemini-1.5-pro",
      locality: "cloud",
      timeoutMs: resolveRequestTimeoutMs(undefined),
      attempted: true,
    });
  });
});

describe("canonical execution contract — the provider that runs is the provider that is named", () => {
  test("G1/G4/G7 — an explicit provider is executed, not re-resolved", async () => {
    configure({
      providers: {
        gemini: { enabled: true, defaultModel: "gemini-1.5-pro" },
        ollama: ABSENT,
      },
      // A conflicting task route must be inert once the caller names a provider.
      routes: { radiology_draft: { provider: "ollama", model: "llama3.1" } },
    });

    const res = await generateAiForTask(
      "radiology_draft",
      CLEAN_PROMPT,
      [],
      { provider: "gemini", model: "gemini-1.5-pro" },
    );

    expect(state.ollamaUrls).toHaveLength(0);
    expect(state.geminiParts).toHaveLength(1);
    expect(res.success).toBe(true);
    expect(res.execution?.provider).toBe("gemini");
    expect(res.execution?.model).toBe("gemini-1.5-pro");
    expect(res.execution?.locality).toBe("cloud");
    expect(res.execution?.attempted).toBe(true);
  });

  test("the model sent to the provider is the model reported back", async () => {
    configure({ providers: { gemini: { enabled: true, defaultModel: "gemini-1.5-pro" } } });
    const res = await generateAiForTask("radiology_draft", CLEAN_PROMPT, [], {
      provider: "gemini",
      model: "gemini-1.5-pro",
    });
    expect(state.geminiModels).toEqual(["gemini-1.5-pro"]);
    expect(res.execution?.model).toBe(state.geminiModels[0]);
  });

  test("G4 — when the caller sends no model, the reported model is the one resolved", async () => {
    configure({ providers: { gemini: { enabled: true, defaultModel: "gemini-1.5-pro" } } });
    const res = await generateAiResponse("gemini", CLEAN_PROMPT, []);
    expect(res.execution?.model).toBe("gemini-1.5-pro");
    expect(state.geminiModels).toEqual(["gemini-1.5-pro"]);
  });

  test("G6 — an unknown provider fails closed and opens no socket", async () => {
    configure({ providers: { gemini: { enabled: true } } });
    const res = await generateAiResponse("does-not-exist", CLEAN_PROMPT, []);
    expect(res.success).toBe(false);
    expect(res.diagnostics?.errorCode).toBe("PROVIDER_NOT_CONFIGURED");
    expect(res.execution?.provider).toBe("does-not-exist");
    expect(res.execution?.attempted).toBe(false);
    expect(state.geminiParts).toHaveLength(0);
    expect(state.ollamaUrls).toHaveLength(0);
  });

  test("a provider with no credential fails closed and is not silently replaced", async () => {
    configure({ providers: { gemini: { enabled: true, key: null } } });
    // No env key either: the arm must report the gap rather than fall through to
    // whichever provider the global default names.
    const res = await generateAiResponse("gemini", CLEAN_PROMPT, []);
    expect(res.success).toBe(false);
    expect(res.diagnostics?.errorCode).toBe("PROVIDER_NOT_CONFIGURED");
    expect(state.ollamaUrls).toHaveLength(0);
  });

  test("G8 — the deadline the gateway reports is the deadline the provider applied", async () => {
    configure({ providers: { gemini: { enabled: true } } });
    const res = await generateAiResponse("ollama", CLEAN_PROMPT, [], {
      endpointUrl: "http://127.0.0.1:1",
    });
    expect(res.execution?.timeoutMs).toBe(resolveRequestTimeoutMs(undefined));
    expect(state.abortTimeouts).toContain(res.execution?.timeoutMs);
    expect(res.execution?.locality).toBe("local");
    expect(res.execution?.attempted).toBe(true);
  });

  test("an explicit timeout is honoured verbatim by both execution and the report", async () => {
    configure({ providers: { gemini: { enabled: true } } });
    const res = await generateAiResponse("ollama", CLEAN_PROMPT, [], {
      endpointUrl: "http://127.0.0.1:1",
      timeoutMs: 45_000,
    });
    expect(res.execution?.timeoutMs).toBe(45_000);
    expect(state.abortTimeouts).toContain(45_000);
  });

  test("the identity is reported on the policy-refusal paths too", async () => {
    configure({ providers: { gemini: { enabled: true } } });
    const PHI = "Patient: Test Patient\nID: EXP-2610-0016\nDate of Birth: 1992-04-30";
    const res = await generateAiResponse("gemini", PHI, []);
    expect(res.success).toBe(false);
    expect(res.diagnostics?.errorCode).toBe("PHI_TEXT_CLOUD_BLOCKED");
    expect(res.execution?.provider).toBe("gemini");
    expect(res.execution?.attempted).toBe(false);
    expect(res.execution?.locality).toBe("cloud");
  });

  test("G14 — cloud image egress stays refused, and says which provider was refused", async () => {
    configure({ providers: { gemini: { enabled: true } } });
    const res = await generateAiResponse(
      "gemini",
      CLEAN_PROMPT,
      ["aGVsbG8td29ybGQ="],
      { model: "gemini-1.5-pro" },
    );
    expect(res.success).toBe(false);
    expect(res.diagnostics?.errorClass).toBe("PhiImageCloudBlocked");
    expect(res.execution?.provider).toBe("gemini");
    expect(res.execution?.attempted).toBe(false);
    expect(state.geminiParts).toHaveLength(0);
  });

  test("G11 — the on-prem provider is not subjected to cloud egress behaviour", async () => {
    configure({ providers: { ollama: ABSENT } });
    const PHI = "Patient: Test Patient\nDate of Birth: 1992-04-30";
    const res = await generateAiResponse("ollama", PHI, [], {
      endpointUrl: "http://127.0.0.1:1",
      model: "qwen3-vl:8b",
    });
    expect(res.diagnostics?.errorCode).not.toBe("PHI_TEXT_CLOUD_BLOCKED");
    expect(res.execution?.locality).toBe("local");
    // It was allowed to try; only the machine refused it.
    expect(state.ollamaUrls).toHaveLength(1);
  });
});
