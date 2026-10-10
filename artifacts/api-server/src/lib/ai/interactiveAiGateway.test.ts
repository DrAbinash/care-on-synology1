/**
 * interactiveAiGateway.test.ts — C1's single owner of "which provider runs this".
 *
 * The gateway is where `/draft`'s old two-step went wrong: the route validated one
 * provider and `generateAiForTask` picked another. These tests run the REAL
 * provider layer with only configuration and sockets stubbed, so "refused before
 * any socket" and "this provider answered" are observed rather than asserted from
 * a source file.
 *
 * The last group is source-level, and deliberately so: it guards the two things a
 * pure test cannot see — that the route stopped resolving twice, and that a legacy
 * panel did not re-open the cloud bypass C1 closed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  taskRoutes: {} as Record<string, { provider: string; model?: string | null }>,
  geminiParts: [] as unknown[],
  geminiModels: [] as string[],
  sockets: [] as string[],
}));

const TABLES = vi.hoisted(() => {
  const col = (table: string, key: string) => ({ __table: table, __key: key });
  return {
    settings: {
      __table: "ai_provider_settings",
      provider: col("ai_provider_settings", "provider"),
      settingsJson: col("ai_provider_settings", "settings_json"),
    },
    routes: {
      __table: "ai_model_routes",
      taskKey: col("ai_model_routes", "task_key"),
      isActive: col("ai_model_routes", "is_active"),
    },
  };
});

vi.mock("@workspace/db", () => ({
  aiProviderSettingsTable: TABLES.settings,
  aiModelRoutesTable: TABLES.routes,
  db: {
    select: () => ({
      from: (table: { __table?: string }) => ({
        where: (cond: unknown) => ({
          limit: async () => {
            const flat = (Array.isArray(cond) ? cond : [cond]).flat() as Array<{
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
          },
        }),
        orderBy: () => ({ limit: async () => [] }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, value: unknown) => ({ __col: col, value }),
  and: (...parts: unknown[]) => parts.flat(),
}));

vi.mock("@workspace/crypto", () => ({ decryptSecret: (s: string) => `decrypted:${s}` }));

// Production code uses hardenedLocalRequest (DNS-pinned transport) instead of
// bare fetch. Skip the DNS validation and bound fetch — just delegate to global.fetch
// so existing mocks work. The security tests are in lib/ai-providers/.
vi.mock("@workspace/ai-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/ai-providers")>();
  return {
    ...actual,
    hardenedLocalRequest: async (url: string, init?: RequestInit) => {
      const response = await globalThis.fetch(url, init);
      return { response, boundIp: "127.0.0.1", originalHost: new URL(url).host };
    },
    createHardenedLocalFetch: (_opts: { enforceBinding: boolean }) => {
      return async (url: string | URL | Request, init?: RequestInit) => {
        return globalThis.fetch(url, init);
      };
    },
  };
});

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(opts: { model?: string }) {
      state.geminiModels.push(opts?.model ?? "");
      return {
        generateContent: async (parts: unknown) => {
          state.geminiParts.push(parts);
          return { response: { text: () => "IMPRESSION: No acute abnormality." } };
        },
      };
    }
  },
}));

import {
  executeInteractiveAiCall,
  resolveInteractiveTarget,
} from "./interactiveAiGateway";

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("pnpm-workspace.yaml not found");
}

/** Strip block/line comments so a docstring can never satisfy a code assertion. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const read = (rel: string) => code(readFileSync(join(repoRoot(), rel), "utf8"));

function providerRow(name: string, over: Record<string, unknown> = {}) {
  state.settings[name] = {
    provider: name,
    isEnabled: true,
    encryptedApiKey: "cipher-text",
    defaultModel: `${name}-configured-model`,
    endpointUrl: null,
    settingsJson: null,
    ...over,
  };
}

const PROMPT = "Write ONLY the IMPRESSION for THIS study.\nFindings: Normal study.";

beforeEach(() => {
  state.settings = {};
  state.taskRoutes = {};
  state.geminiParts = [];
  state.geminiModels = [];
  state.sockets = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      state.sockets.push(String(input));
      throw new TypeError("fetch failed: ECONNREFUSED");
    }) as never,
  );
});

describe("resolution — one owner, one answer", () => {
  it("a requested provider makes the task route inert", async () => {
    providerRow("gemini");
    providerRow("ollama", { isEnabled: true, encryptedApiKey: null });
    state.taskRoutes.radiology_draft = { provider: "ollama", model: "some-local-model" };

    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "gemini",
      defaultProvider: "openai",
    });
    expect(target).toMatchObject({ ok: true, provider: "gemini", providerSource: "request" });
  });

  it("with no request the task route decides, and says so", async () => {
    providerRow("ollama");
    providerRow("gemini");
    state.taskRoutes.radiology_draft = { provider: "ollama", model: "routed-model" };

    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      defaultProvider: "gemini",
    });
    expect(target).toMatchObject({ ok: true, provider: "ollama", providerSource: "task-route", model: "routed-model" });
  });

  it("with neither, the AI Reporting default decides — not a provider the code invented", async () => {
    providerRow("gemini");
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      defaultProvider: "gemini",
    });
    expect(target).toMatchObject({ ok: true, provider: "gemini", providerSource: "global-default" });
  });

  it("G6 — an unknown provider is refused before anything is loaded", async () => {
    providerRow("gemini");
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "not-a-provider",
      defaultProvider: "gemini",
    });
    expect(target).toMatchObject({ ok: false, httpStatus: 400, error: "Invalid provider." });
  });

  it("a disabled provider is refused with the sentence the UI already shows", async () => {
    providerRow("gemini", { isEnabled: false });
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "gemini",
    });
    expect(target).toMatchObject({
      ok: false,
      httpStatus: 400,
      error: "gemini provider is disabled or not configured.",
      failureCode: "DISABLED",
    });
  });

  it("a provider with no configuration row at all is refused, not defaulted around", async () => {
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "openai",
    });
    expect(target.ok).toBe(false);
  });
});

describe("execution — the provider recorded is the provider that ran", () => {
  it("G1/G4/G7 — executes the resolved provider and reports it back", async () => {
    providerRow("gemini", { defaultModel: "gemini-configured" });
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "gemini",
    });
    expect(target.ok).toBe(true);

    const call = await executeInteractiveAiCall({ target, prompt: PROMPT, images: [] });
    expect(call.identityVerified).toBe(true);
    expect(call.executedProvider).toBe("gemini");
    expect(state.geminiParts).toHaveLength(1);
    expect(state.sockets).toHaveLength(0);
    expect(call.failure).toBeNull();
    // The model the SDK was handed is the model reported — no label drift.
    expect(state.geminiModels).toEqual([call.executedModel]);
    expect(call.result.execution?.attempted).toBe(true);
  });

  it("G5 — a disabled provider never opens a socket", async () => {
    providerRow("gemini", { isEnabled: false });
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "gemini",
    });
    const call = await executeInteractiveAiCall({ target, prompt: PROMPT, images: [] });
    expect(call.identityVerified).toBe(false);
    expect(call.attempted).toBe(false);
    expect(call.failure).toMatchObject({ code: "DISABLED", message: "gemini provider is disabled or not configured." });
    expect(state.geminiParts).toHaveLength(0);
    expect(state.sockets).toHaveLength(0);
  });

  it("the task route cannot rescue a refused provider", async () => {
    // The exact shape of the old bug: the route checked gemini, the gateway would
    // have taken radiology_draft to ollama. Now a refusal stays a refusal.
    providerRow("gemini", { isEnabled: false });
    state.taskRoutes.radiology_draft = { provider: "ollama", model: "rescue-model" };
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "gemini",
    });
    const call = await executeInteractiveAiCall({ target, prompt: PROMPT, images: [] });
    expect(call.failure?.code).toBe("DISABLED");
    expect(state.sockets).toHaveLength(0);
  });

  it("G10 — cloud PHI policy is applied, and reported as a policy block", async () => {
    providerRow("gemini");
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "gemini",
    });
    const call = await executeInteractiveAiCall({
      target,
      prompt: "Patient: Test Patient\nDate of Birth: 1992-04-30\nSummarise.",
      images: [],
    });
    expect(call.failure).toMatchObject({ code: "PHI_POLICY_BLOCK", detailCode: "PHI_TEXT_CLOUD_BLOCKED" });
    expect(call.attempted).toBe(false);
    expect(state.geminiParts).toHaveLength(0);
  });

  it("G11/G14 — the local arm is not gated as cloud egress", async () => {
    providerRow("ollama", { isEnabled: true, endpointUrl: "http://127.0.0.1:1" });
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "ollama",
    });
    const call = await executeInteractiveAiCall({
      target,
      prompt: "Patient: Test Patient\nSummarise.",
      images: [],
      // An unreachable local endpoint: the attempt is what matters.
      options: { endpointUrl: "http://127.0.0.1:1" },
    });
    expect(call.failure?.code).not.toBe("PHI_POLICY_BLOCK");
    expect(call.attempted).toBe(true);
    expect(call.locality).toBe("local");
    expect(state.sockets).toHaveLength(1);
  });

  it("G19 — a provider that answers with an HTTP status normalizes to PROVIDER_HTTP_ERROR", async () => {
    providerRow("ollama");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ error: "the model failed to load" }),
        text: async () => '{"error":"the model failed to load"}',
      })) as never,
    );
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "ollama",
    });
    const call = await executeInteractiveAiCall({
      target,
      prompt: PROMPT,
      images: [],
      options: { endpointUrl: "http://127.0.0.1:1" },
    });
    expect(call.failure).toMatchObject({ code: "PROVIDER_HTTP_ERROR", detailCode: "HTTP_500" });
    expect(call.executedProvider).toBe("ollama");
    expect(call.result.success).toBe(false);
  });

  it("G20 — a machine that refuses the socket is UNKNOWN, not dressed up as an HTTP error", async () => {
    // Honest reporting matters more than a tidy category: nothing ever answered
    // with a status, so claiming PROVIDER_HTTP_ERROR would send an operator to look
    // for a provider response that never existed.
    providerRow("ollama");
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "ollama",
    });
    const call = await executeInteractiveAiCall({
      target,
      prompt: PROMPT,
      images: [],
      options: { endpointUrl: "http://127.0.0.1:1" },
    });
    expect(call.failure?.code).toBe("UNKNOWN");
    expect(call.attempted).toBe(true);
    expect(state.sockets).toHaveLength(1);
    expect(call.executedProvider).toBe("ollama");
  });

  it("G21 — a provider echoing its own credential never reaches the client", async () => {
    providerRow("ollama");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ error: "invalid api key sk-abcdefghijklmnopqrstuvwxyz1234 for model" }),
        text: async () => '{"error":"invalid api key sk-abcdefghijklmnopqrstuvwxyz1234 for model"}',
      })) as never,
    );
    const target = await resolveInteractiveTarget({
      taskKey: "radiology_draft",
      requestedProvider: "ollama",
    });
    const call = await executeInteractiveAiCall({
      target,
      prompt: PROMPT,
      images: [],
      options: { endpointUrl: "http://127.0.0.1:1" },
    });
    expect(call.failure?.code).toBe("PROVIDER_HTTP_ERROR");
    expect(call.failure?.message ?? "").not.toContain("abcdefghijklmnopqrstuvwxyz1234");
    expect(call.failure?.message ?? "").toContain("[REDACTED]");
    expect(call.result.error ?? "").toContain("abcdefghijklmnopqrstuvwxyz1234");
  });
});

describe("source contracts — the shape C1 must not regress into", () => {
  const ROUTE = "artifacts/api-server/src/routes/aiReporting.ts";
  const OLLAMA = "artifacts/api-server/src/routes/radiologyOllama.ts";
  const GATEWAY = "artifacts/api-server/src/lib/ai/interactiveAiGateway.ts";

  function draftHandler(src: string): string {
    const start = src.indexOf('router.post("/draft"');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("router.", start + 1);
    const slice = src.slice(start, end === -1 ? undefined : end);
    // Non-vacuity: a slice that silently came out empty would pass every negative
    // assertion below.
    expect(slice.length).toBeGreaterThan(1000);
    return slice;
  }

  it("the draft route resolves once and executes through the gateway", () => {
    const handler = draftHandler(read(ROUTE));
    expect(handler).toContain("resolveInteractiveTarget(");
    expect(handler).toContain("executeInteractiveAiCall(");
    // The defect this PR closed: the handler must not hand the draft to the
    // task-route-resolving entry point again.
    expect(handler).not.toMatch(/generateAiForTask\s*\(\s*["']radiology_draft/);
  });

  it("the draft route records the executed identity, not the requested one", () => {
    const handler = draftHandler(read(ROUTE));
    // Anchored on a syntactic marker, not a comment: the slice above is
    // comment-stripped, and a comment anchor would silently produce an empty
    // string that satisfies every negative assertion.
    const auditAt = handler.indexOf("await db.insert(aiReportingAuditLogsTable)");
    expect(auditAt).toBeGreaterThan(-1);
    const auditInsert = handler.slice(auditAt, handler.indexOf(".catch(", auditAt));
    expect(auditInsert.length).toBeGreaterThan(100);
    expect(auditInsert).toContain("call.executedProvider ?? providerName");
    expect(auditInsert).toContain("call.executedModel ?? (model || null)");
    // Positive control: the requested name is still in there as the fallback
    // operand, so these assertions are not matching an empty slice.
    expect(auditInsert).toContain("providerName");

    // Counted, not just present: every artefact an auditor or the next screen can
    // read has to carry the executed identity — diagnostics, the stored draft, the
    // audit row and the HTTP response. A single silent reversion is what C1 is here
    // to prevent, and a `toContain` would survive it.
    expect((handler.match(/call\.executedProvider/g) ?? [])).toHaveLength(4);
    expect((handler.match(/call\.executedModel/g) ?? [])).toHaveLength(4);
  });

  it("G13 — the interactive query prompt no longer composes a patient name", () => {
    // `/query` used to fetch firstName + lastName and write `Patient: <name>, Age,
    // Gender` into the prompt. Age and sex change what a finding means; a name does
    // not, and this prompt can be heading for a cloud provider.
    const src = read(ROUTE);
    const at = src.indexOf("if (includeDemographics && patientId && !shouldAnonymize)");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("if (shouldAnonymize)", at));
    expect(block.length).toBeGreaterThan(80);
    expect(block).not.toContain("firstName");
    expect(block).not.toContain("lastName");
    expect(block).not.toMatch(/Patient: \$\{/);
    expect(block).toContain("Age:");
    expect(block).toContain("Gender:");
  });

  it("the gateway executes the target's provider and verifies the returned identity", () => {
    const src = read(GATEWAY);
    expect(src).toMatch(/generateAiResponse\(\s*target\.provider/);
    expect(src).not.toMatch(/generateAiForTask\s*\(/);
    expect(src).toContain("execution.provider === target.provider");
  });

  it("G12 — no radiology-ollama handler imports a cloud SDK directly", () => {
    const src = read(OLLAMA);
    expect(src).not.toMatch(/integrations-gemini-ai/);
    expect(src).not.toMatch(/geminiGenerate\s*\(/);
    // Positive control: the cloud arm still exists, it just goes through policy.
    expect(src).toContain("resolveInteractiveTarget(");
    expect(src).toContain('requestedProvider: "gemini"');
    expect(src).toContain("executeInteractiveAiCall(");
  });

  it("the route hands the resolved target, never a fresh default, to the gateway", () => {
    const handler = draftHandler(read(ROUTE));
    expect(handler).toMatch(/defaultProvider:\s*globalSettings\.defaultProvider/);
    expect(handler).not.toMatch(/getDefaultProviderName\(\)/);
  });

  it("only a route that validated the AI Reporting default may inherit it", () => {
    // `/draft` and `/image-review` have always checked that row's enablement and
    // configuration, so on those paths the provider whose config was checked is the
    // provider that runs. `/polish` never validated it — it only ever printed
    // `getDefaultProviderName()` as a label — so letting it inherit the clinic
    // default would change which model an editorial screen talks to as a side
    // effect of an infrastructure change. Its precedence stays task route → global.
    const src = read(ROUTE);
    const slice = (marker: string) => {
      const start = src.indexOf(marker);
      expect(start, marker).toBeGreaterThan(-1);
      const end = src.indexOf("router.", start + 1);
      const out = src.slice(start, end === -1 ? undefined : end);
      // Non-vacuity, before any negative assertion can be satisfied by nothing.
      expect(out.length).toBeGreaterThan(400);
      return out;
    };

    expect(slice('router.post("/image-review"')).toMatch(/defaultProvider:\s*globalSettings\.defaultProvider/);

    const polish = slice('router.post("/polish"');
    expect(polish).toContain("resolveInteractiveTarget(");
    expect(polish).toMatch(/taskKey:\s*"report_enhancement"/);
    expect(polish).not.toMatch(/defaultProvider:/);
  });
});
