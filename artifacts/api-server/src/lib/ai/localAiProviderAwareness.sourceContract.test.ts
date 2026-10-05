import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// ─── Architecture-freeze contract for the local AI surfaces ──────────────────
// CARE has two kinds of local AI: Ollama (its own native API) and any local
// server speaking the OpenAI wire format. This test pins the line between them
// so a future change cannot quietly start asking an OpenAI-wire server an
// Ollama question (/api/tags, `ollama pull`) — or stop asking Ollama its own.

const ROOT = (() => {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("pnpm-workspace.yaml not found");
})();

/**
 * Comments legitimately name the other protocol — the transport module explains
 * that Ollama answers /api/tags while an OpenAI-wire server answers /models.
 * The contract is about calls, so comments are stripped before matching.
 */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("Ollama keeps its native checks", () => {
  it("health, ops and runner diagnostics still use the Ollama API", () => {
    expect(code("artifacts/api-server/src/routes/aiPipelineHealth.ts")).toContain("/api/tags");
    expect(code("artifacts/api-server/src/lib/operationsChecks.ts")).toContain("${ctx.ollama.baseUrl}/api/tags");
    expect(code("artifacts/api-server/src/lib/ai/ollamaRunnerDiagnostics.ts")).toContain("/api/ps");
    expect(code("artifacts/api-server/src/lib/ai/ollamaDraftVerify.ts")).toContain("/api/tags");
    expect(code("scripts/verify-deployment.mjs")).toContain('path: "/api/tags"');
  });

  it("the Ollama remediation text still tells the operator to pull on Ollama", () => {
    expect(code("artifacts/api-server/src/lib/operationsChecks.ts")).toContain("ollama pull");
  });
});

describe("the OpenAI-wire local provider is never asked an Ollama question", () => {
  const compatFiles = [
    "lib/ai-providers/src/openAiCompatible.ts",
    "lib/ai-providers/src/openAiCompatibleProvider.ts",
    "artifacts/api-server/src/lib/reportComposer/providers/localOpenAiCompatibleComposerAdapter.ts",
    "artifacts/api-server/src/lib/reportComposer/providers/localOpenAiCompatibleConfig.ts",
  ];

  it.each(compatFiles)("%s contains no /api/tags or ollama pull call", (rel) => {
    const src = code(rel);
    expect(src).not.toMatch(/api\/tags/);
    expect(src).not.toMatch(/ollama pull/);
  });

  it("the shared transport exposes a /models probe and the compat provider uses it", () => {
    expect(code("lib/ai-providers/src/openAiCompatible.ts")).toMatch(
      /export async function probeOpenAiCompatibleModels/,
    );
    expect(code("lib/ai-providers/src/openAiCompatible.ts")).toMatch(/`\$\{base\}\/models`/);
    expect(code("lib/ai-providers/src/openAiCompatibleProvider.ts")).toContain(
      "probeOpenAiCompatibleModels(",
    );
  });

  it("ops has a separate, provider-named check that uses /models", () => {
    const src = code("artifacts/api-server/src/lib/operationsChecks.ts");
    expect(src).toContain('id: "ai.local_openai_compatible"');
    expect(src).toMatch(/\$\{ctx\.localOpenAi\.baseUrl\}\/models/);
  });

  it("the NAS verifier asks the compat server /models, not /api/tags", () => {
    const src = code("scripts/verify-deployment.mjs");
    expect(src).toContain('local_openai_compatible');
    expect(src).toMatch(/path: "\/models"/);
  });

  it("the pipeline self-test asks the routed provider its own way", () => {
    const src = code("artifacts/api-server/src/lib/ai/aiPipelineSelfTest.ts");
    expect(src).toContain('technical.provider === "local_openai_compatible"');
    expect(src).toContain("probeOpenAiCompatibleModels(");
  });
});

describe("architecture freeze held", () => {
  it("Composer still has exactly the five providers it had", () => {
    const src = code("artifacts/api-server/src/lib/reportComposer/providers/types.ts");
    const union = src.match(/export type ComposerProviderName =([^;]+);/s)?.[1] ?? "";
    const members = union
      .split("|")
      .map((s) => s.trim().replace(/["|]/g, ""))
      .filter(Boolean);
    expect(members.sort()).toEqual(
      ["deepseek", "local_openai_compatible", "ollama", "openai", "qwen"].sort(),
    );
  });

  it("no new AI client was added — the compat probe reuses the shared transport module", () => {
    const clients = code("lib/ai-providers/src/openAiCompatible.ts");
    // One OpenAI SDK construction point, unchanged in count by this PR.
    expect((clients.match(/new OpenAI\(/g) ?? []).length).toBe(1);
  });

  it("the only new lib module is the canonical leaf, exported through the package map", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "lib", "ai-providers", "package.json"), "utf8"));
    expect(pkg.exports["./canonical"]).toBe("./src/canonicalLocalAi.ts");
    expect(code("lib/ai-providers/src/canonicalLocalAi.ts")).not.toMatch(/^import /m);
  });
});
