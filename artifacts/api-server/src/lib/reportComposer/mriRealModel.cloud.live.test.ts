/**
 * mriRealModel.cloud.live.test.ts — the cloud arm, prepared and gated.
 *
 * STATUS, stated before anything else: NOT EXECUTED. As of 2026-10-11 this
 * workstation has no cloud credential at all — `OPENAI_API_KEY`, `QWEN_API_KEY`,
 * `DEEPSEEK_API_KEY` and `DASHSCOPE_API_KEY` are absent from the shell and from
 * `.env`, and there is no `ai_provider_settings` row — so every case here SKIPS,
 * and the only thing proven about this file is that it collects and reports the
 * reason it skipped. Configuration tests elsewhere in this directory prove the
 * seams (a provider switched OFF is refused before any socket opens, an unknown
 * provider name is refused rather than run as Ollama, the output ceiling reaches
 * the transport). They are not evidence that live cloud inference works, and this
 * file exists so that the difference cannot be blurred later.
 *
 * Opt-in twice over, because it sends clinical-shaped text off the machine:
 *   RUN_LIVE_CLOUD=1                  — the operator has decided cloud is allowed
 *   LIVE_CLOUD_PROVIDERS=openai,qwen  — which configured providers to try
 * and it still refuses to dial a provider whose key CARE cannot resolve. Nothing
 * here takes an API key from the command line, and no credential is ever printed
 * or asserted on.
 *
 * All content is synthetic. If a real study is ever routed through this path it
 * must be because the PHI gate and the locality classification were reviewed for
 * that provider, not because this file was convenient.
 */
import { describe, expect, it } from "vitest";
import type { AiComposeJobKind } from "@workspace/db/schema";
import { buildCareSystemPrompt } from "./persona";
import { buildUserPrompt, runReportComposer } from "./composeEngine";
import {
  resolveCloudComposerConfig,
  type CloudComposerProvider,
} from "./providers/cloudComposerConfig";
import { planComposerTextContext } from "./composerContextBudget";
import { validateComposerOutput } from "./validateOutput";
import { parseComposerSnapshot } from "./types";

const WANTED = process.env.RUN_LIVE_CLOUD === "1";
/**
 * Only the three providers CARE treats as cloud. A name outside this list is
 * reported and dropped rather than dialled — `local_openai_compatible` is a local
 * endpoint, and sending synthetic-but-realistic clinical text to something because
 * a list happened to name it is the mistake this gate exists to prevent.
 */
const CLOUD_NAMES: readonly CloudComposerProvider[] = ["openai", "qwen", "deepseek"];
const REQUESTED = (process.env.LIVE_CLOUD_PROVIDERS ?? CLOUD_NAMES.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PROVIDERS = REQUESTED.filter((n): n is CloudComposerProvider =>
  (CLOUD_NAMES as readonly string[]).includes(n),
);
for (const ignored of REQUESTED.filter((n) => !PROVIDERS.includes(n as CloudComposerProvider))) {
  console.warn(`[cloud-live] "${ignored}" is not a CARE cloud provider — not dialled.`);
}

/** Why a provider was not tried, printed instead of silently skipped. */
const skipped: Array<{ provider: string; reason: string }> = [];

const LS_FINDINGS = [
  "Loss of normal lumbar lordosis.",
  "Disc desiccation at L2-L3, L3-L4 and L4-L5.",
  "Broad-based posterior disc bulge at L4-L5 with mild bilateral lateral recess narrowing.",
  "AP canal diameter 8.2 mm at L4-L5.",
  "Right paramedian disc extrusion at L5-S1 compressing the right S1 traversing root.",
  "No significant central canal stenosis at L1-L2.",
].join("\n");

const snapshotFor = (kind: AiComposeJobKind, over: Record<string, unknown> = {}) =>
  parseComposerSnapshot({
    modality: "MRI",
    region: "Lumbosacral Spine",
    spineSegment: "LS",
    studyType: "MRI LUMBOSACRAL SPINE",
    reportTitle: "MRI LUMBOSACRAL SPINE",
    protocol: "MRI lumbar spine, non-contrast",
    clinicalHistory: "Low back pain with bilateral lower-limb radiculopathy.",
    technique: "Multiplanar multisequence non-contrast MRI of the lumbosacral spine at 1.5T.",
    findings: LS_FINDINGS,
    impression: "Multilevel degenerative disc disease at L4-L5 with an AP canal diameter of 8.2 mm.",
    recommendation: "",
    observations: [],
    aiMode: "TEXT_ONLY",
    ...over,
  });

const OPS: Array<{ kind: AiComposeJobKind; label: string; extra?: Record<string, unknown> }> = [
  { kind: "PROFESSIONALIZE", label: "professionalize the lumbar report" },
  {
    kind: "COMBINE",
    label: "combine cervical and lumbar",
    extra: {
      findings: "Loss of normal cervical lordosis.\nC5-C6 disc protrusion contacting the left C6 root.",
      impression: "C5-C6 disc protrusion contacting the left C6 root.",
      additionalReports: [
        {
          label: "MRI LUMBOSACRAL SPINE (same patient, same day)",
          modality: "MRI",
          region: "Lumbosacral Spine",
          findings: LS_FINDINGS,
          impression: "Degenerative change at L4-L5 with 8.2 mm canal.",
        },
      ],
    },
  },
  {
    kind: "OBSERVATIONS",
    label: "structure dictated shorthand",
    extra: {
      findings:
        "L4-5 diffuse disc bulge bilateral LR narrowing canal 8.2 mm. L5-S1 right paracentral extrusion compressing the right S1 root.",
      impression: "",
    },
  },
];

describe.runIf(WANTED)("the three operations against a configured cloud provider", () => {
  for (const name of PROVIDERS) {
    it(`${name}: answers, is attributed correctly, and loses nothing`, async () => {
      const cfg = await resolveCloudComposerConfig(name);
      if (cfg.enabled === false) {
        skipped.push({ provider: name, reason: "the admin has switched it OFF" });
        return;
      }
      if (!cfg.apiKey) {
        skipped.push({ provider: name, reason: "no key resolves from ai_provider_settings or env" });
        return;
      }

      for (const op of OPS) {
        const snapshot = snapshotFor(op.kind, op.extra ?? {});
        const run = await runReportComposer({
          kind: op.kind,
          snapshot,
          providerOverride: name,
          allowDeterministicFallback: false,
        });

        // Attribution first, because the failure this whole area was rebuilt to
        // remove is an answer that cannot be traced to the model that produced it.
        expect(run.ok, `${op.kind}: ${run.safeError ?? "ok"}`).toBe(true);
        expect(run.provider, `${op.kind}: which provider answered`).toBe(name);
        if (!run.ok) continue;

        // Token usage must come back as numbers, not as a shape that only looks
        // like usage. A vendor that reports nothing reports null, not zero.
        expect(typeof (run.usage?.totalTokens ?? 0)).toBe("number");

        const validation = validateComposerOutput(snapshot, run.draft!, { kind: op.kind });
        expect(
          validation.errors,
          `${op.kind} on ${name} lost or invented clinical content: ${validation.errors.join(", ")}`,
        ).toEqual([]);
      }
    });
  }
});

describe.runIf(WANTED)("what a cloud provider does when the request does not fit", () => {
  it("refuses instead of truncating, and reports the ceiling", async () => {
    // The defect #919 removed on the local path was a silently withheld back half
    // of a report. Same test on the cloud arm: with a deliberately tiny ceiling the
    // job must FAIL with the reason named, and the model must never be shown half
    // the report and graded on it.
    for (const name of PROVIDERS) {
      const cfg = await resolveCloudComposerConfig(name);
      if (!cfg.apiKey || cfg.enabled === false) continue;

      const longFindings = `${LS_FINDINGS}\n`.repeat(40);
      const snapshot = snapshotFor("PROFESSIONALIZE", { findings: longFindings });
      const systemPrompt = buildCareSystemPrompt("PROFESSIONALIZE", snapshot);
      const userPrompt = buildUserPrompt("PROFESSIONALIZE", snapshot);
      const plan = planComposerTextContext({
        systemPrompt,
        userPrompt,
        transport: "cloud",
        configuredNumCtx: 1024,
      });
      expect(plan.fits, "a 1,024-token window cannot hold this report").toBe(false);

      const run = await runReportComposer({
        kind: "PROFESSIONALIZE",
        snapshot,
        providerOverride: name,
        allowDeterministicFallback: false,
      });
      expect(run.ok).toBe(false);
      expect(run.safeError).toBe("composer_context_budget_exceeded");
    }
  });
});

it("reports which cloud providers were not tried, and why", () => {
  // The gate must be visible. Without this, a file that skipped everything reads
  // as a suite that passed, which is exactly how "cloud tested" became false
  // confidence elsewhere in CARE's AI history.
  if (!WANTED) {
    console.warn(
      `[cloud-live] NOT RUN: set RUN_LIVE_CLOUD=1 and configure a provider in AI Provider Settings. Tried list: ${PROVIDERS.join(", ")}`,
    );
    expect(skipped.length).toBe(0);
    return;
  }
  for (const s of skipped) console.warn(`[cloud-live] ${s.provider}: ${s.reason}`);
  if (skipped.length === PROVIDERS.length) {
    console.warn("[cloud-live] no configured provider had a resolvable key — nothing was dialled.");
  }
});
