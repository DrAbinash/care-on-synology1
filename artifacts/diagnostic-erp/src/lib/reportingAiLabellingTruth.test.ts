/**
 * A control labelled "AI" has to actually consult a model.
 *
 * `command-palette.tsx` used to offer "Suggest with AI at cursor", which inserted
 * the fixed sentence "Findings concerning for acute abnormality." with no model
 * call, and every clinical editor carried a button labelled "AI" whose handler is
 * a regex over the typed text. Both are removed/renamed by this PR; these tests
 * are the fence that keeps them from coming back.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const here = "artifacts/diagnostic-erp/src/components/radiology";
const read = (rel: string) => code(readFileSync(join(repoRoot(), rel), "utf8"));

describe("no radiologist-facing control claims AI it does not have", () => {
  it("the fake 'Suggest with AI at cursor' command is gone", () => {
    const src = read(`${here}/zai-workspace/command-palette.tsx`);
    expect(src).not.toMatch(/Suggest with AI/);
    expect(src).not.toMatch(/ai-ghost/);
  });

  it("no palette command injects a hardcoded clinical sentence", () => {
    const src = read(`${here}/zai-workspace/command-palette.tsx`);
    expect(src).not.toMatch(/setGhostText\(\s*["'`]/);
    expect(src).not.toMatch(/concerning for acute abnormality/i);
  });

  it("the palette's remaining AI command is the real one", () => {
    const src = read(`${here}/zai-workspace/command-palette.tsx`);
    expect(src).toMatch(/triggerAiImpression/);
  });

  it("the editor's deterministic phrase helper no longer calls itself AI", () => {
    const src = read(`${here}/zai-workspace/findings-editor.tsx`);
    expect(src).not.toMatch(/title="AI ghost/i);
    expect(src).not.toMatch(/>\s*AI\s*</);
    // The helper itself still exists — only the claim was removed.
    expect(src).toMatch(/setGhost\(s, s \? field : null\)/);
  });

  it("the Findings placeholder does not promise AI either", () => {
    const src = read(`${here}/workspace/ReportCanvas.tsx`);
    expect(src).not.toMatch(/for AI ghost/i);
  });

  it("ghost text still requires an explicit Accept and says so", () => {
    const src = read(`${here}/reporting-canvas/GhostLayer.tsx`);
    expect(src).toMatch(/Not in ledger until Accept/);
    expect(src).toMatch(/Accept \(Tab\)/);
  });

  it("the real AI impression path still posts to the model endpoint", () => {
    const src = read("artifacts/diagnostic-erp/src/hooks/radiology-workspace/useTriggerAiImpression.ts");
    expect(src).toMatch(/\/api\/ai-reporting\/draft/);
  });
});
