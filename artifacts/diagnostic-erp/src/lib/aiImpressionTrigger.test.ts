/**
 * aiImpressionTrigger.test.ts — one trigger, always current (audit F-17/F-23).
 *
 * F-17: the global keydown effect deliberately omitted triggerAiImpression
 * from its dependency list (its own comment admitted the stale closure), so
 * in renders where no tracked dependency changed, Ctrl+I posted the live
 * findings under the PREVIOUS study's captured context while the response
 * guard compared against the live store identity and could pass.
 *
 * F-23: the copilot rail and the command palette both called
 * `triggerAiImpression?.() ?? window.dispatchEvent(new KeyboardEvent(
 * "keydown", { key: "i", ctrlKey: true }))`. The store function returns
 * void, so the nullish fallback ALWAYS fired after the trigger had already
 * run, and the window capture listener caught the synthetic event: two
 * generations raced per click.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
const read = (rel: string) => readFileSync(resolve(PKG_DIR, rel), "utf8").replace(/\r\n/g, "\n");

const COMMANDS = "src/hooks/radiology-workspace/useWorkspaceCommands.ts";
const COPILOT = "src/components/radiology/zai-workspace/copilot-rail.tsx";
const PALETTE = "src/components/radiology/zai-workspace/command-palette.tsx";

const commands = read(COMMANDS);
const copilot = read(COPILOT);
const palette = read(PALETTE);

describe("F-17: Ctrl+I reads the trigger through an always-current ref", () => {
  it("declares a ref that tracks the latest handler", () => {
    expect(commands).toMatch(
      /const triggerAiImpressionRef = useRef\(triggerAiImpression\);\s*triggerAiImpressionRef\.current = triggerAiImpression;/,
    );
  });

  it("the keydown handler calls the ref, not the captured prop", () => {
    expect(commands).toMatch(/preventDefault\(\); triggerAiImpressionRef\.current\(\); return;/);
    expect(commands).not.toMatch(/preventDefault\(\); triggerAiImpression\(\); return;/);
  });
});

describe("F-23: the rail and palette fire the trigger exactly once", () => {
  it.each([
    ["copilot-rail", copilot],
    ["command-palette", palette],
  ])("%s guards the trigger instead of the void-??-dispatch shape", (_name, rawSrc) => {
    // Comments are stripped first: this test's own commentary quotes the defect
    // shape on purpose, and so does the fix's explanation in the palette.
    const src = rawSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    // The defect shape: run the trigger, THEN dispatch the synthetic Ctrl+I too.
    expect(src).not.toMatch(/triggerAiImpression\?\.\(\)\s*\?\?/);
    // The replacement: null-guard first, dispatch only when the store has no trigger.
    expect(src).toMatch(/const (t|trigger) = useWorkspace\.getState\(\)\.triggerAiImpression;/);
    expect(src).toMatch(/if \((t|trigger)\) (t|trigger)\(\);/);
  });
});
