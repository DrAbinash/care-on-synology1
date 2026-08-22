import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  isOllamaRuntimeEndpointResolverBound,
  resetOllamaRuntimeEndpointResolverForTests,
} from "@workspace/ai-providers";

/**
 * Prove the canonical Ollama binder cannot race behind cron/worker startup.
 * worker.ts previously imported cron without app.ts — overnight could resolve
 * stale ai_provider_settings before any binder ran.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname);

function read(name: string): string {
  return readFileSync(join(SRC, name), "utf8");
}

describe("canonical Ollama binder bootstrap order", () => {
  test("bootstrapLocalAi binds and does not invoke generate/createAi at module body", () => {
    const boot = read("bootstrapLocalAi.ts");
    const code = boot
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*") && !l.trim().startsWith("//"))
      .join("\n");
    expect(boot).toContain("bindCanonicalOllamaRuntimeResolver()");
    expect(code).not.toMatch(/\bgenerateAiResponse\b|\bcreateAiProviderFromDb\b/);
  });

  test("index.ts imports bootstrapLocalAi before app and cron", () => {
    const src = read("index.ts");
    const boot = src.indexOf('import "./bootstrapLocalAi"');
    const app = src.indexOf('import app from "./app"');
    const cron = src.indexOf('from "./cron"');
    expect(boot).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(boot);
    expect(cron).toBeGreaterThan(boot);
  });

  test("worker.ts imports bootstrapLocalAi before cron (no app.ts path)", () => {
    const src = read("worker.ts");
    const boot = src.indexOf('import "./bootstrapLocalAi"');
    const cron = src.indexOf('from "./cron"');
    expect(boot).toBeGreaterThan(-1);
    expect(cron).toBeGreaterThan(boot);
    expect(src).not.toMatch(/from ["']\.\/app["']/);
  });

  test("app.ts imports bootstrapLocalAi before routes", () => {
    const src = read("app.ts");
    const boot = src.indexOf('import "./bootstrapLocalAi"');
    const routes = src.indexOf('from "./routes"');
    expect(boot).toBeGreaterThan(-1);
    expect(routes).toBeGreaterThan(boot);
  });

  test("importing bootstrapLocalAi binds the resolver (behavioral)", async () => {
    resetOllamaRuntimeEndpointResolverForTests();
    expect(isOllamaRuntimeEndpointResolverBound()).toBe(false);
    await import("./bootstrapLocalAi");
    expect(isOllamaRuntimeEndpointResolverBound()).toBe(true);
  });
});
