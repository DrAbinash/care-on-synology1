import { describe, it, expect, beforeEach } from "vitest";
import {
  registerCopilotModule, unregisterCopilotModule, getCopilotModules,
  localCopilotModules, aiCopilotModules, runLocalModules, runAiModules,
  type CopilotModule,
} from "./copilotModules";
import { buildCopilotAiPrompt, parseCopilotAiResponse, AI_REASONER_MODULE } from "./copilotAiModule";
import type { CopilotContext } from "./copilotOrchestrator";

const ctx: CopilotContext = {
  modality: "MR", studyDescription: "MRI Brain", clinicalHistory: "Seizure",
  findings: "Ring-enhancing lesion in the left parietal lobe.", impression: [],
  recommendation: "", technique: "", selectedFindingLabels: [],
};

// Clean registry between tests, but always keep the built-in AI reasoner.
beforeEach(() => {
  for (const m of getCopilotModules()) if (m.id !== "ai-reasoner") unregisterCopilotModule(m.id);
});

describe("copilot module registry (Part 20)", () => {
  it("registers, lists and unregisters a local module", () => {
    const mod: CopilotModule = {
      id: "guideline", label: "Guideline", kind: "local",
      analyze: () => [{ id: "g:1", category: "suggestion", severity: "info", title: "T", detail: "d", why: "w", confidence: "low" }],
    };
    registerCopilotModule(mod);
    expect(localCopilotModules().map((m) => m.id)).toContain("guideline");
    expect(runLocalModules(ctx).map((i) => i.id)).toContain("g:1");
    unregisterCopilotModule("guideline");
    expect(localCopilotModules().map((m) => m.id)).not.toContain("guideline");
  });

  it("a throwing local module contributes nothing, never breaks the merge", () => {
    registerCopilotModule({ id: "bad", label: "Bad", kind: "local", analyze: () => { throw new Error("boom"); } });
    registerCopilotModule({ id: "ok", label: "Ok", kind: "local", analyze: () => [{ id: "ok:1", category: "missing", severity: "info", title: "T", detail: "d", why: "w", confidence: "low" }] });
    expect(runLocalModules(ctx).map((i) => i.id)).toEqual(["ok:1"]);
  });

  it("the built-in AI reasoner is registered and classified as an ai module", () => {
    expect(aiCopilotModules().map((m) => m.id)).toContain("ai-reasoner");
  });

  it("runAiModules calls each ai module via the injected ask and merges items", async () => {
    const ask = async () => "DIFFERENTIAL: NCC | Tuberculoma\nRECOMMENDATION: Contrast MRI advised.";
    const items = await runAiModules(ctx, ask);
    expect(items.some((i) => i.category === "differential")).toBe(true);
    expect(items.some((i) => i.category === "recommendation" && i.insertTarget === "recommendation")).toBe(true);
  });

  it("a failing ai module is skipped, not thrown", async () => {
    registerCopilotModule({ id: "flaky", label: "Flaky", kind: "ai", run: async () => { throw new Error("provider down"); } });
    const ask = async () => "IMPRESSION: Acute infarct, right MCA territory.";
    const items = await runAiModules(ctx, ask);
    expect(items.some((i) => i.category === "impression")).toBe(true); // ai-reasoner still worked
  });
});

describe("AI reasoner — prompt + parser (pure)", () => {
  it("prompt includes the study, history and findings", () => {
    const p = buildCopilotAiPrompt(ctx);
    expect(p).toMatch(/MRI Brain/);
    expect(p).toMatch(/Seizure/);
    expect(p).toMatch(/Ring-enhancing/);
    expect(p).toMatch(/DIFFERENTIAL:/);
  });

  it("parses each prefixed line into the right category, insertable where useful", () => {
    const items = parseCopilotAiResponse([
      "DIFFERENTIAL: Neurocysticercosis | Tuberculoma | Metastasis",
      "MISSING: Perilesional oedema",
      "RECOMMENDATION: Contrast-enhanced MRI is advised.",
      "IMPRESSION: Ring-enhancing lesion, left parietal lobe — infective vs neoplastic.",
      "garbage line ignored",
    ].join("\n"));
    expect(items.map((i) => i.category)).toEqual(["differential", "missing", "recommendation", "impression"]);
    expect(items.find((i) => i.category === "recommendation")!.insertTarget).toBe("recommendation");
    expect(items.find((i) => i.category === "impression")!.insertTarget).toBe("impression");
    expect(items.find((i) => i.category === "differential")!.detail).toMatch(/Neurocysticercosis · Tuberculoma/);
  });

  it("tolerates an empty or prose-only reply", () => {
    expect(parseCopilotAiResponse("")).toEqual([]);
    expect(parseCopilotAiResponse("No suggestions at this time.")).toEqual([]);
  });

  it("the module runs the full ask → parse pipeline", async () => {
    const items = await AI_REASONER_MODULE.run(ctx, async (prompt) => {
      expect(prompt).toMatch(/senior radiologist/);
      return "RECOMMENDATION: MR spectroscopy advised.";
    });
    expect(items).toHaveLength(1);
    expect(items[0].insertText).toMatch(/spectroscopy/);
  });
});
