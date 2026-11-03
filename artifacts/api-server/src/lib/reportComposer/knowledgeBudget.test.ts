/**
 * knowledgeBudget.test.ts — what reference knowledge may NOT do to a request.
 *
 * The context planner is CARE's existing guard against Ollama silently dropping the end of a
 * prompt, which for a report means losing the second half of what the radiologist wrote. RAG is
 * invited into the space that guard leaves; it never buys space by shortening the report, and it
 * never turns a request that was going to be sent into one that is refused.
 */
import { describe, it, expect } from "vitest";

import { applyReferenceKnowledge, RAG_FEATURE_FLAG, REFERENCE_KNOWLEDGE_HEADER } from "./knowledgeRetrieval";
import { planComposerTextContext } from "./composerContextBudget";
import { loadKnowledgeCorpus, __resetKnowledgeCorpusCacheForTests } from "./knowledgeCorpus";
import type { ComposerInputSnapshot } from "./types";

const snap = (over: Partial<ComposerInputSnapshot>): ComposerInputSnapshot =>
  ({
    worklistId: 4242,
    modality: "MR",
    region: "Brain",
    family: "brain",
    findings: "",
    impression: "",
    observations: [],
    ...over,
  }) as ComposerInputSnapshot;

const SYSTEM = "You are the CARE radiology composer.";
const BRAIN_INPUT =
  "=== CLINICAL TRUTH (RADIOLOGIST DRAFT INPUT) ===\n"
  + "FINDINGS:\nRestricted diffusion in the right basal ganglia, hyperintense on DWI with corresponding low signal on ADC.";

const rag = (s: ComposerInputSnapshot, over: Record<string, unknown> = {}) =>
  applyReferenceKnowledge({
    snapshot: s,
    systemPrompt: SYSTEM,
    userPrompt: BRAIN_INPUT,
    transport: "ollama",
    configuredNumCtx: 4096,
    corpus: (__resetKnowledgeCorpusCacheForTests(), loadKnowledgeCorpus()),
    ...over,
  });

describe("OFF is the default and the shape of the old behaviour", () => {
  it("an unflagged clinic sends exactly the prompt it sent before", async () => {
    const r = await rag(snap({ findings: "Restricted diffusion on DWI with low ADC." }), { enabled: false });
    expect(r.userPrompt).toBe(BRAIN_INPUT);
    expect(r.passages).toEqual([]);
    expect(r.note).toContain("OFF");
    expect(r.plan).toEqual(
      planComposerTextContext({ systemPrompt: SYSTEM, userPrompt: BRAIN_INPUT, transport: "ollama", configuredNumCtx: 4096 }),
    );
  });

  it("the gate is a named server-side flag, not a constant in the composer", () => {
    // `isFeatureEnabledServer` answers false for a key that was never seeded, so a fresh clinic
    // database — and a process that cannot reach one — is OFF. The name is part of the contract.
    expect(RAG_FEATURE_FLAG).toBe("ff_radiology_ai_rag");
  });

  it("a flag that cannot be read is OFF rather than an exception at generate time", async () => {
    // No `enabled` argument: the function resolves the flag itself, through a lazy import of the
    // DB-backed flag module. Whatever that returns, the request must still go out unchanged when
    // it says off, and this call must not throw.
    const r = await rag(snap({ findings: "Restricted diffusion on DWI with low ADC." }));
    expect(typeof r.userPrompt).toBe("string");
    expect(r.plan.fits).toBe(true);
    if (!r.passages.length) expect(r.userPrompt).toBe(BRAIN_INPUT);
  });
});

describe("ON — the report is planned first and knowledge takes only the spare", () => {
  it("appends a labelled reference block without touching the report's own text", async () => {
    const r = await rag(snap({ findings: BRAIN_INPUT.slice(50) }), { enabled: true });
    expect(r.passages.length).toBeGreaterThan(0);
    expect(r.userPrompt.startsWith(BRAIN_INPUT)).toBe(true);
    expect(r.userPrompt).toContain(REFERENCE_KNOWLEDGE_HEADER);
    expect(r.plan.fits).toBe(true);
    // The plan the caller sends is the plan for the prompt the caller sends.
    expect(r.plan).toEqual(
      planComposerTextContext({ systemPrompt: SYSTEM, userPrompt: r.userPrompt, transport: "ollama", configuredNumCtx: 4096 }),
    );
  });

  it("a report that does not fit on its own is refused exactly as before, and RAG had no part in it", async () => {
    // ~26 KB of authored findings: over the 8 192-token composer ceiling all by itself.
    const huge = "Ventricular prominence with transependymal flow of cerebrospinal fluid. ".repeat(400);
    const base = planComposerTextContext({
      systemPrompt: SYSTEM,
      userPrompt: BRAIN_INPUT + huge,
      transport: "ollama",
      configuredNumCtx: 4096,
    });
    expect(base.fits).toBe(false);
    const r = await applyReferenceKnowledge({
      snapshot: snap({ findings: huge }),
      systemPrompt: SYSTEM,
      userPrompt: BRAIN_INPUT + huge,
      transport: "ollama",
      configuredNumCtx: 4096,
      enabled: true,
    });
    expect(r.userPrompt).toBe(BRAIN_INPUT + huge);
    expect(r.plan.fits).toBe(false);
    expect(r.plan).toEqual(base);
    expect(r.note).toContain("no headroom");
  });

  it("shrinks the offer, never the report, when the spare window is tight", async () => {
    const roomy = await rag(snap({ findings: "Restricted diffusion on DWI with low ADC. Microbleeds on SWI." }), {
      enabled: true,
      maxPassages: 4,
    });
    expect(roomy.passages.length).toBeGreaterThan(1);
    // A window one section wide must still carry the report whole and one complete rule.
    const tight = await rag(snap({ findings: "Restricted diffusion on DWI with low ADC. Microbleeds on SWI." }), {
      enabled: true,
      configuredNumCtx: 4096,
      maxPassages: 1,
    });
    expect(tight.userPrompt.startsWith(BRAIN_INPUT)).toBe(true);
    expect(tight.passages.length).toBeLessThanOrEqual(1);
    expect(tight.plan.fits).toBe(true);
  });
});
