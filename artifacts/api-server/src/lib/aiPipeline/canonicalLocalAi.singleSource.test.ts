import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CANONICAL_OLLAMA_ENDPOINT } from "./canonicalLocalAi";

// ─── Single source of truth for the canonical Local AI values ────────────────
// These two constants used to be declared twice — once in the provider library
// and once in the pipeline layer, joined by a "keep in sync" comment. Nothing
// enforced the comment. They now live in exactly one file, and both layers
// import it, so drift is impossible rather than merely discouraged.

/** Repo root, found by walking up to the workspace manifest. */
const REPO_ROOT = (() => {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("pnpm-workspace.yaml not found above the test file");
})();

/** Production TS sources only: no tests, no build output, no docs. */
function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".next" || entry === "generated") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) productionSources(full, acc);
    else if (entry.endsWith(".ts") && !entry.includes(".test.") && !entry.endsWith(".d.ts")) acc.push(full);
  }
  return acc;
}

const CANONICAL_FILE = join(REPO_ROOT, "lib", "ai-providers", "src", "canonicalLocalAi.ts");

/**
 * Comments may name the endpoint (the schema does, to explain the fallback
 * column); only code may DEFINE it. Strip comments before matching so the
 * contract is about duplicated values, not duplicated prose.
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function productionCode(rels: string[]): Array<{ path: string; code: string }> {
  return rels
    .flatMap((rel) => productionSources(join(REPO_ROOT, rel)))
    .map((file) => ({ path: file, code: codeOnly(readFileSync(file, "utf8")) }));
}

function relative(file: string): string {
  return file.replace(/\\/g, "/").slice(REPO_ROOT.replace(/\\/g, "/").length + 1);
}

describe("canonical Local AI constants have one definition", () => {
  it("is declared in exactly one production source file", () => {
    const declarers = productionCode(["lib", join("artifacts", "api-server", "src")])
      .filter(({ code }) =>
        /export const CANONICAL_(OLLAMA_ENDPOINT|LOCAL_CHAT_VISION_MODEL)\s*=/.test(code),
      )
      .map(({ path }) => relative(path));
    expect(declarers).toEqual(["lib/ai-providers/src/canonicalLocalAi.ts"]);
  });

  it("names the canonical endpoint in no other production code", () => {
    // Matched against the imported constant, not a literal: a hardcoded example
    // address here would silently stop testing anything the day the canonical
    // value changes, and this guard's whole job is to notice duplication.
    const holders = productionCode(["lib", join("artifacts", "api-server", "src")])
      .filter(({ path, code }) => path !== CANONICAL_FILE && code.includes(CANONICAL_OLLAMA_ENDPOINT))
      .map(({ path }) => relative(path));
    expect(holders).toEqual([]);
  });
});

describe("both layers agree on the values", () => {
  it("re-exports the same strings, unchanged", async () => {
    const leaf = await import("@workspace/ai-providers/canonical");
    const pipeline = await import("./canonicalLocalAi");
    expect(pipeline.CANONICAL_OLLAMA_ENDPOINT).toBe(leaf.CANONICAL_OLLAMA_ENDPOINT);
    expect(pipeline.CANONICAL_LOCAL_CHAT_VISION_MODEL).toBe(leaf.CANONICAL_LOCAL_CHAT_VISION_MODEL);
    expect(pipeline.CANONICAL_EMBEDDING_MODEL).toBe(leaf.CANONICAL_EMBEDDING_MODEL);

    // Effective production values are unchanged by the consolidation.
    // Loopback, not a clinic host — see canonicalLocalAi.test.ts for why the
    // shipped default may never be a site-specific address.
    expect(leaf.CANONICAL_OLLAMA_ENDPOINT).toBe("http://127.0.0.1:11434");
    expect(leaf.CANONICAL_LOCAL_CHAT_VISION_MODEL).toBe("qwen3-vl:8b");
    expect(leaf.CANONICAL_EMBEDDING_MODEL).toBe("nomic-embed-text");
  });

  it("still normalises empty and legacy values the same way", async () => {
    const pipeline = await import("./canonicalLocalAi");
    expect(pipeline.normalizeOllamaBaseUrl("")).toBe("http://127.0.0.1:11434");
    expect(pipeline.normalizeOllamaBaseUrl("http://10.0.0.9:11434/")).toBe("http://10.0.0.9:11434");
    expect(pipeline.normalizeLocalChatVisionModel("qwen3:8b")).toBe("qwen3-vl:8b");
    expect(pipeline.normalizeLocalChatVisionModel(null)).toBe("qwen3-vl:8b");
  });
});
