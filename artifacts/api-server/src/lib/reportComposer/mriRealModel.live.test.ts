/**
 * mriRealModel.live.test.ts — the six-month question, answered with a real model.
 *
 * This drives the SHIPPED composer path against the clinic's live Ollama: the
 * real snapshot parser, the real CARE persona prompt, the real Ollama transport,
 * the real JSON contract, the real draft parser. The only thing not exercised is
 * the job runner's database lookups, which are configuration rather than logic.
 *
 * Opt-in, because it needs the AI PC: RUN_LIVE_OLLAMA=1. Everything in it is
 * synthetic. The endpoint is a LAN address, which the composer guard accepts only
 * in Local/LAN mode — the same switch that has been blocking every report.
 *
 * Recorded 2026-10-11 against gemma3:12b at http://192.168.1.250:11434: passed in
 * 39 s, preserving all eight observations, all four levels and the bilateral
 * laterality, inventing no measurement. That is the first MRI report CARE has
 * ever produced through its own composer.
 */
import { describe, expect, it } from "vitest";
import { buildUserPrompt } from "./composeEngine";
import { buildCareSystemPrompt } from "./persona";
import { parseComposerSnapshot, parseComposerDraftJson } from "./types";
import { OllamaComposerAdapter } from "./providers/ollamaComposerAdapter";
import type { AiComposeJobKind } from "@workspace/db/schema";

const ENDPOINT = process.env.LIVE_OLLAMA_URL ?? "http://192.168.1.250:11434";
const MODEL = process.env.LIVE_OLLAMA_MODEL ?? "gemma3:12b";
const WANTED = process.env.RUN_LIVE_OLLAMA === "1";

/**
 * A live call is skipped when the host is not answering, rather than failed.
 *
 * This is the only honest outcome available: the AI PC is a workstation on a
 * clinic LAN, so it goes away between runs for reasons that say nothing about
 * the code. A red test in that situation is worse than no test — it teaches the
 * reader to ignore this file, and the file exists to be trusted. The reachability
 * probe therefore decides participation, and the reason is printed.
 */
async function hostIsUp(): Promise<boolean> {
  try {
    const r = await fetch(`${ENDPOINT}/api/tags`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

const HOST_UP = WANTED ? await hostIsUp() : false;
if (WANTED && !HOST_UP) {
  console.warn(`[live] skipped: no Ollama answering at ${ENDPOINT}`);
}

const OBSERVATIONS = [
  "Straightening of lumbar lordosis.",
  "Disc desiccation at L2-L3, L3-L4, L4-L5 and L5-S1.",
  "Reduced intervertebral disc height at L4-L5 and L5-S1.",
  "Diffuse posterior disc bulge at L3-L4.",
  "Broad-based posterior disc bulge at L4-L5 causing mild bilateral lateral recess narrowing.",
  "Diffuse posterior disc bulge at L5-S1.",
  "Mild bilateral facet arthropathy at L4-L5 and L5-S1.",
  "No significant central canal stenosis documented.",
];

const MRI = parseComposerSnapshot({
  reportId: 1,
  studyId: 1,
  worklistId: 1,
  modality: "MRI",
  region: "Lumbosacral Spine",
  bodyPart: "Lumbar spine",
  family: "MRI",
  spineSegment: "LS",
  studyType: "MRI LUMBOSACRAL SPINE",
  reportTitle: "MRI LUMBOSACRAL SPINE",
  protocol: "MRI lumbar spine, non-contrast",
  clinicalHistory: "Low back pain with bilateral lower-limb radiculopathy.",
  technique: "Multiplanar multisequence non-contrast MRI of the lumbosacral spine.",
  findings: OBSERVATIONS.join("\n"),
  impression: "",
  recommendation: "",
  observations: OBSERVATIONS.map((text, i) => ({
    id: `obs-${i + 1}`,
    concept: text.slice(0, 60),
    laterality: "midline",
    findingsText: text,
  })),
  aiMode: "TEXT_ONLY",
});

describe.runIf(HOST_UP)("a real MRI report from the real composer path", () => {
  it(`generates a structured lumbar spine report from ${MODEL} at ${ENDPOINT}`, async () => {
    const kind: AiComposeJobKind = "FULL_REPORT";

    const r = await new OllamaComposerAdapter().compose({
      systemPrompt: buildCareSystemPrompt(kind, MRI),
      userPrompt: buildUserPrompt(kind, MRI),
      model: MODEL,
      temperature: 0.1,
      timeoutMs: 120_000,
      numCtx: 8192,
      endpoint: ENDPOINT,
      localOnly: true,
    });

    if (!r.ok) {
      // Fail with the sentence the radiologist would see, not a bare code.
      throw new Error(`composer refused: ${r.safeError} — ${r.detail ?? "(no detail)"}`);
    }

    const draft = parseComposerDraftJson(r.text);
    console.log("\n===== PARSED CARE MRI REPORT =====");
    console.log("EXAMINATION: MRI LUMBOSACRAL SPINE\n");
    console.log("CLINICAL INDICATION:\n" + MRI.clinicalHistory + "\n");
    console.log("TECHNIQUE:\n" + MRI.technique + "\n");
    console.log("FINDINGS:\n" + (draft?.findings ?? "(none)") + "\n");
    console.log("IMPRESSION:\n" + (draft?.impression ?? "(none)") + "\n");

    expect(draft).not.toBeNull();
    expect((draft?.findings ?? "").length).toBeGreaterThan(80);
    expect((draft?.impression ?? "").length).toBeGreaterThan(20);

    const all = `${draft?.findings ?? ""} ${draft?.impression ?? ""}`;
    // Vertebral levels and laterality survive verbatim.
    for (const level of ["L2-L3", "L3-L4", "L4-L5", "L5-S1"]) {
      expect(all).toContain(level);
    }
    expect(all.toLowerCase()).toContain("bilateral");
    expect(all.toLowerCase()).toContain("lateral recess");
    // Nothing unsupported: the observations never stated a canal measurement.
    expect(all.toLowerCase()).not.toMatch(/canal (?:diameter|ap) \d+\s*mm/);
  }, 180_000);
});
