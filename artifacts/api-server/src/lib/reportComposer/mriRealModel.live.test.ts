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
 * 41.7 s on head `ac3d4bd0`, preserving all eight observations, all four levels and
 * the bilateral laterality, inventing no measurement. That is the first MRI report
 * CARE has ever produced through its own composer.
 *
 * RECORDED 2026-10-11 on head `ac3d4bd0` (this branch merged through #920) — the
 * six cases × the installed local text models, every answer scored by the shipped
 * validator, on the clinic AI PC. Seconds are wall time for the model call; tokens
 * are the prompt+completion the vendor reported. Generated from the run's own log
 * by `node tmp/919-live-table.cjs <log>`, not transcribed.
 *
 *   operation                                   gemma3:12b    medgemma1.5:4b    qwen3:14b
 *   professionalize / MRI LS spine              29.4s / 2248  accepted          7.1s / 2177 accepted   25.8s / 2210 accepted
 *   rephrase / MRI cervical                     14.8s / 1953  accepted          2.9s / 1922 accepted    8.6s / 1902 accepted
 *   professionalize / MRI brain                 14.9s / 2035  accepted          2.8s / 1998 accepted    9.0s / 2009 accepted
 *   professionalize / whole-spine screening     21.5s / 2125  accepted          3.4s / 2067 accepted   11.2s / 2081 accepted
 *   combine / cervical + lumbar                 36.4s / 2409  accepted          3.3s BLOCKED           15.9s / 2321 accepted
 *   observations / dictated shorthand            5.9s BLOCKED  9.0s / 2407 accepted (4 rows)           26.0s / 2422 accepted (4 rows)
 *
 * 16 of those 18 model calls were accepted, and the two that were not are the
 * guard working, not the harness failing: `gemma3:12b` turned a four-fact dictation
 * into ONE observation row (losing the 8.2 mm canal, the recess narrowing and its
 * location), and `medgemma1.5:4b` answered the COMBINE with the cervical report
 * only, discarding the lumbar study it was handed.
 *
 * The two defects this head fixed were found by THIS run, not by my fixtures. Both
 * `qwen3:14b` and `medgemma1.5:4b` now produce four accepted rows for Operation 1 —
 * they had been producing them all along, but the row pruner deleted the canal row
 * because the model had filed "canal 8.2 mm" under the canonical concept "canal
 * stenosis", a word the dictation never used. And three answers had been blocked
 * for "inventing a normal spinal cord" in reports that dictated `Cord signal
 * normal.`, because the guard compared the model's longer wording against the
 * radiologist's shorter one. Both are pinned by cases in
 * `reportingAssistant.relations.test.ts`, transcribed from these answers.
 *
 * The two refusals above were invisible before any of this: the added report was
 * not part of what the checks considered "supplied", and nothing required the rows
 * to COVER the dictation — only to stay inside it. The same first run exposed the
 * merged study being reported as invented content (`level_change` /
 * `unsupported_abnormality` on a faithful merge) and "hemorrhage" counted as an
 * invented abnormality against a dictation that said "haemorrhage".
 */
import { describe, expect, it } from "vitest";
import { buildUserPrompt } from "./composeEngine";
import { buildCareSystemPrompt } from "./persona";
import { planComposerTextContext } from "./composerContextBudget";
import { validateComposerOutput } from "./validateOutput";
import { parseComposerSnapshot, parseComposerDraftJson } from "./types";
import { OllamaComposerAdapter } from "./providers/ollamaComposerAdapter";
import type { AiComposeJobKind } from "@workspace/db/schema";

const ENDPOINT = process.env.LIVE_OLLAMA_URL ?? "http://192.168.1.250:11434";
const MODEL = process.env.LIVE_OLLAMA_MODEL ?? "gemma3:12b";
const WANTED = process.env.RUN_LIVE_OLLAMA === "1";
/**
 * The text-operations matrix runs on every candidate that is actually installed
 * (same rule as the vision A/B file: nothing is pulled onto a clinic PC by a
 * test). These are text-only models — this file measures transformation of
 * prose the radiologist wrote, not image reading.
 */
const TEXT_MODEL_CANDIDATES = (
  process.env.LIVE_OLLAMA_TEXT_MODELS ?? "gemma3:12b,medgemma1.5:4b,qwen3:14b"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/** The clinic's configured composer window, mirrored from AI Reporting Settings. */
const CONFIGURED_NUM_CTX = Number(process.env.LIVE_OLLAMA_NUM_CTX ?? 8192);

/**
 * A live call is skipped when the host is not answering, rather than failed.
 *
 * This is the only honest outcome available: the AI PC is a workstation on a
 * clinic LAN, so it goes away between runs for reasons that say nothing about
 * the code. A red test in that situation is worse than no test — it teaches the
 * reader to ignore this file, and the file exists to be trusted. The reachability
 * probe therefore decides participation, and the reason is printed.
 */
async function hostIsUp(): Promise<{ up: boolean; why: string }> {
  try {
    const r = await fetch(`${ENDPOINT}/api/tags`, { signal: AbortSignal.timeout(8000) });
    return { up: r.ok, why: `HTTP ${r.status}` };
  } catch (e) {
    return { up: false, why: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

const PROBE = WANTED ? await hostIsUp() : { up: false, why: "RUN_LIVE_OLLAMA not set" };
const HOST_UP = PROBE.up;
if (WANTED && !HOST_UP) {
  console.warn(`[live] skipped: no Ollama answering at ${ENDPOINT} — ${PROBE.why}`);
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

/**
 * ── The three reporting-assistant operations, on the same live path ─────────
 *
 * The single case above answers "can CARE's composer write an MRI report at
 * all?". These answer the questions that decide whether the feature is usable:
 *
 *  - PROFESSIONALIZE: given a complete, deterministic report, does a local model
 *    improve the prose WITHOUT losing a level, a side or a measurement?
 *  - REPHRASE / COMBINE: same promise under an instruction, and across two
 *    reports that have to be merged without either one winning.
 *  - OBSERVATIONS: given dictated shorthand, does the model return structured
 *    rows that say what was said — and nothing more?
 *
 * Every run is scored by the SHIPPED validator (`validateComposerOutput`), not
 * by a local assertion, so a live draft that drops the 8.2 mm canal measurement
 * fails for the same reason the job queue would refuse it. That is the point:
 * this file measures what the clinic would get, and the printed table is the
 * evidence for "which installed model is good enough at text transformation".
 *
 * Nothing here measures diagnostic accuracy, and no patient data is used.
 */

type TextCase = {
  name: string;
  kind: AiComposeJobKind;
  snapshot: ReturnType<typeof parseComposerSnapshot>;
  /** Strings that must appear in the answer — levels, sides, measurements. */
  mustContain: string[];
  /** A measurement or diagnosis the input never stated, so it must not appear. */
  mustNotMatch: RegExp[];
};

const LS_PRO = parseComposerSnapshot({
  reportId: 11,
  studyId: 11,
  worklistId: 11,
  modality: "MRI",
  region: "Lumbosacral Spine",
  family: "MRI",
  spineSegment: "LS",
  reportTitle: "MRI LUMBOSACRAL SPINE",
  protocol: "MRI lumbar spine, non-contrast",
  clinicalHistory: "Low back pain with left S1 radiculopathy.",
  technique: "Multiplanar multisequence non-contrast MRI of the lumbosacral spine at 1.5T.",
  findings: [
    "Lumbar lordosis is loss of normal curvature with straightening.",
    "Disc desiccation and reduced height at L4-L5 and L5-S1.",
    "Diffuse posterior disc bulge at L3-L4.",
    "Broad-based posterior disc bulge at L4-L5 with bilateral lateral recess narrowing, AP canal diameter 8.2 mm.",
    "Right paramedian disc extrusion at L5-S1 compressing the right S1 traversing root.",
    "Mild bilateral facet arthropathy at L4-L5.",
    "Conus ends at L1, normal signal.",
  ].join("\n"),
  impression:
    "L4-L5 diffuse disc bulge with bilateral recess narrowing and canal stenosis (AP 8.2 mm). "
    + "Right paramedian disc extrusion at L5-S1 compressing the right S1 root.",
  recommendation: "",
  observations: [],
  aiMode: "TEXT_ONLY",
});

const CERVICAL = parseComposerSnapshot({
  reportId: 12,
  studyId: 12,
  worklistId: 12,
  modality: "MRI",
  region: "Cervical Spine",
  family: "MRI",
  spineSegment: "C",
  reportTitle: "MRI CERVICAL SPINE",
  protocol: "MRI cervical spine, non-contrast",
  clinicalHistory: "Neck pain with left C6 radiculopathy.",
  technique: "Multiplanar multisequence non-contrast MRI of the cervical spine.",
  findings: [
    "Loss of cervical lordosis.",
    "Disc desiccation at C5-C6 and C6-C7.",
    "Left foraminal disc protrusion at C5-C6 narrowing the left C6 foramen.",
    "Central disc bulge at C6-C7, no cord compression.",
    "Cord signal normal. No syrinx.",
  ].join("\n"),
  impression: "Left C5-C6 foraminal protrusion contacting the left C6 root.",
  recommendation: "",
  observations: [],
  aiMode: "TEXT_ONLY",
});

const BRAIN = parseComposerSnapshot({
  reportId: 13,
  studyId: 13,
  worklistId: 13,
  modality: "MRI",
  region: "Brain",
  family: "MRI",
  reportTitle: "MRI BRAIN",
  protocol: "MRI brain, non-contrast",
  clinicalHistory: "68-year-old with new headache.",
  technique: "Multiplanar multisequence non-contrast MRI of the brain.",
  findings: [
    "No acute infarct or haemorrhage. No mass lesion or midline shift.",
    "Periventricular and deep white matter T2/FLAIR hyperintensities, Fazekas grade 2.",
    "Ventricles and sulci normal for age. No hydrocephalus.",
    "Pituitary normal. No sellar mass.",
  ].join("\n"),
  impression: "Grade 2 small-vessel ischaemic change. No acute intracranial pathology.",
  recommendation: "",
  observations: [],
  aiMode: "TEXT_ONLY",
});

const WHOLE_SPINE = parseComposerSnapshot({
  reportId: 14,
  studyId: 14,
  worklistId: 14,
  modality: "MRI",
  region: "Whole Spine",
  family: "MRI",
  spineSegment: "TOTAL",
  reportTitle: "MRI WHOLE SPINE SCREENING",
  protocol: "Whole spine screening, limited sequences",
  clinicalHistory: "Pre-operative scoliosis screening.",
  technique: "Sagittal T1 and T2 screening sequences of the whole spine; limited planar study.",
  findings: [
    "Cervical: loss of lordosis; C4-C5 and C5-C6 disc bulges, no cord compression.",
    "Dorsal: mild right thoracic curvature, no cord signal abnormality.",
    "Lumbar: L3-L4 disc bulge; L4-L5 broad-based bulge with bilateral recess narrowing; L5-S1 disc protrusion.",
    "Conus and filum terminale normal.",
  ].join("\n"),
  impression: "Multilevel degenerative disc disease of the whole spine without cord compression.",
  recommendation: "",
  observations: [],
  aiMode: "TEXT_ONLY",
});

const DICTATION_TEXT = "L4-5 diffuse bulge, bilateral recess narrowing, LF hypertrophy, canal 8.2 mm.";

const DICTATION = parseComposerSnapshot({
  reportId: 15,
  studyId: 15,
  worklistId: 15,
  modality: "MRI",
  region: "Lumbosacral Spine",
  family: "MRI",
  spineSegment: "LS",
  reportTitle: "MRI LUMBOSACRAL SPINE",
  protocol: "MRI lumbar spine, non-contrast",
  technique: "Multiplanar multisequence non-contrast MRI of the lumbosacral spine.",
  // The radiologist's own words, exactly as the brief dictates them: shorthand,
  // no sentences, no structure. This is the input Operation 1 must turn into
  // rows without adding a fact.
  findings: DICTATION_TEXT,
  impression: "",
  recommendation: "",
  observations: [],
  aiMode: "TEXT_ONLY",
});

const COMBINED = parseComposerSnapshot({
  ...CERVICAL,
  reportId: 16,
  studyId: 16,
  worklistId: 16,
  reportTitle: "MRI CERVICAL + LUMBAR SPINE",
  additionalReports: [
    {
      label: "MRI LUMBOSACRAL SPINE (same patient, same day)",
      modality: "MRI",
      region: "Lumbosacral Spine",
      findings: LS_PRO.findings,
      impression: LS_PRO.impression,
    },
  ],
});

const TEXT_CASES: TextCase[] = [
  {
    name: "professionalize / MRI LS spine",
    kind: "PROFESSIONALIZE",
    snapshot: LS_PRO,
    mustContain: ["L3-L4", "L4-L5", "L5-S1", "bilateral", "8.2", "right", "S1"],
    mustNotMatch: [/left\s+(?:S1|paramedian)/i],
  },
  {
    name: "rephrase / MRI cervical (instruction: make more professional)",
    kind: "REPHRASE",
    snapshot: CERVICAL,
    mustContain: ["C5-C6", "C6-C7", "left"],
    // The input says the left C6 foramen and a normal cord. A side flip or a cord
    // signal abnormality would be invented, not paraphrased.
    mustNotMatch: [/right\s+(?:C5|C6|foraminal)/i, /myelomalacia/i],
  },
  {
    name: "professionalize / MRI brain",
    kind: "PROFESSIONALIZE",
    snapshot: BRAIN,
    mustContain: ["Fazekas", "no acute"],
    mustNotMatch: [/haemorrhage (?:is present|noted)/i, /\b(aneurysm|metastasis|abscess)\b/i],
  },
  {
    name: "professionalize / whole-spine screening",
    kind: "PROFESSIONALIZE",
    snapshot: WHOLE_SPINE,
    mustContain: ["C4-C5", "C5-C6", "L3-L4", "L4-L5", "L5-S1"],
    mustNotMatch: [],
  },
  {
    name: "combine / cervical + lumbar",
    kind: "COMBINE",
    snapshot: COMBINED,
    mustContain: ["C5-C6", "L4-L5", "bilateral", "8.2", "left"],
    mustNotMatch: [],
  },
  {
    name: "observations / dictated shorthand",
    kind: "OBSERVATIONS",
    snapshot: DICTATION,
    mustContain: [],
    mustNotMatch: [],
  },
];

async function installedModels(): Promise<string[]> {
  try {
    const r = await fetch(`${ENDPOINT.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.warn(`[live] /api/tags HTTP ${r.status}`);
      return [];
    }
    const body = (await r.json()) as { models?: Array<{ name?: string }> };
    return (body.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  } catch (e) {
    console.warn(`[live] /api/tags failed: ${e instanceof Error ? `${e.name}: ${e.message}` : e}`);
    return [];
  }
}

const INSTALLED = HOST_UP ? await installedModels() : [];
const TEXT_MODELS = TEXT_MODEL_CANDIDATES.filter((m) => INSTALLED.includes(m));
const MISSING_MODELS = TEXT_MODEL_CANDIDATES.filter((m) => !INSTALLED.includes(m));
if (HOST_UP && MISSING_MODELS.length > 0) {
  console.warn(`[live] not installed, skipped (nothing is pulled by a test): ${MISSING_MODELS.join(", ")}`);
}

type ScoreRow = {
  model: string;
  case: string;
  seconds: string;
  tokens: string;
  verdict: string;
};

const scoreRows: ScoreRow[] = [];

describe.runIf(HOST_UP && TEXT_MODELS.length > 0)(
  "the three reporting-assistant operations on live local models",
  () => {
    for (const model of TEXT_MODELS) {
      for (const c of TEXT_CASES) {
        it(`${c.name} — ${model}`, async () => {
          const systemPrompt = buildCareSystemPrompt(c.kind, c.snapshot);
          const userPrompt = buildUserPrompt(c.kind, c.snapshot);

          // The bounded-context plan runs before the send, exactly as the job
          // path does. A report that does not fit is a refusal with a named
          // ceiling — never a truncated request.
          const plan = planComposerTextContext({
            systemPrompt,
            userPrompt,
            transport: "ollama",
            configuredNumCtx: CONFIGURED_NUM_CTX,
          });
          expect(plan.fits, plan.reason).toBe(true);

          const r = await new OllamaComposerAdapter().compose({
            systemPrompt,
            userPrompt,
            model,
            temperature: 0.1,
            timeoutMs: 240_000,
            numCtx: plan.numCtx,
            maxTokens: plan.maxTokens,
            endpoint: ENDPOINT,
            localOnly: true,
          });
          const seconds = (r.latencyMs / 1000).toFixed(1);

          if (!r.ok) {
            scoreRows.push({ model, case: c.name, seconds, tokens: "-", verdict: `refused: ${r.safeError}` });
            throw new Error(`${model} / ${c.name}: composer refused — ${r.safeError} ${r.detail ?? ""}`);
          }

          const draft = parseComposerDraftJson(r.text);
          if (!draft) {
            scoreRows.push({ model, case: c.name, seconds, tokens: "-", verdict: "unparseable answer" });
            throw new Error(`${model} / ${c.name}: answered outside the structured form.`);
          }

          // Counted BEFORE validation: the shipped validator prunes ungrounded
          // rows in place, so reading the count afterwards cannot tell a model
          // that returned one row from one that returned four and had three
          // dropped by the guard.
          const rowsReturned = (draft.observations ?? []).length;

          // The shipped gate: invention AND, for these kinds, loss.
          const validation = validateComposerOutput(c.snapshot, draft, { kind: c.kind });
          const rowsKept = (draft.observations ?? []).length;
          const tokenText =
            r.usage?.totalTokens != null ? String(r.usage.totalTokens) : "-";
          const answer =
            c.kind === "OBSERVATIONS"
              ? (draft.observations ?? [])
                  .map((o) => [o.level, o.laterality, o.concept, o.measurement, o.findingsText]
                    .filter(Boolean)
                    .join(" | "))
                  .join("\n")
              : `${draft.findings}\n${draft.impression}`;

          scoreRows.push({
            model,
            case: c.name,
            seconds,
            tokens: tokenText,
            verdict:
              (c.kind === "OBSERVATIONS" ? `rows ${rowsReturned}→${rowsKept}, ` : "")
              + (validation.ok ? "accepted" : `blocked: ${(validation.errors ?? []).join(", ")}`),
          });

          console.log(
            `\n===== ${c.name} — ${model} (${seconds}s, ${tokenText} tokens`
            + (c.kind === "OBSERVATIONS" ? `, ${rowsReturned} rows returned` : "")
            + ") =====\n"
            + (c.kind === "OBSERVATIONS" ? answer : `FINDINGS + IMPRESSION:\n${answer}\n`)
            + (validation.warnings.length ? `\nwarnings: ${validation.warnings.join(" | ")}` : ""),
          );

          expect(
            validation.ok,
            `${model} lost or invented clinical content: ${(validation.errors ?? []).join(", ")}`,
          ).toBe(true);

          if (c.kind === "OBSERVATIONS") {
            expect(
              rowsKept,
              `${model} returned ${rowsReturned} row(s) for a dictation that states four facts`,
            ).toBeGreaterThanOrEqual(3);
            expect(answer, `${model} lost the canal measurement`).toContain("8.2");
            expect(answer.toLowerCase(), `${model} lost "bilateral"`).toContain("bilateral");
            // The prompt tells the model to keep the radiologist's own wording, so
            // either the expansion or the shorthand is a correct answer here.
            expect(answer, `${model} dropped the LF hypertrophy`).toMatch(
              /ligamentum flavum|\bLF\b/i,
            );
            // Not in the dictation: no facet arthropathy, no listhesis, no L3-L4.
            expect(answer).not.toMatch(/L3-?L?4\b/i);
            expect(answer.toLowerCase()).not.toContain("facet");
          } else {
            const lower = answer.toLowerCase();
            for (const needle of c.mustContain) {
              expect(lower, `${model} dropped "${needle}"`).toContain(needle.toLowerCase());
            }
            for (const forbidden of c.mustNotMatch) {
              expect(lower, `${model} invented ${forbidden}`).not.toMatch(forbidden);
            }
          }
        }, 300_000);
      }
    }

    it("prints the measured table", () => {
      console.log("\n===== LIVE LOCAL MODEL SCORE (synthetic cases, shipped validator) =====");
      console.table(scoreRows);
      // A matrix that silently ran nothing would otherwise read as a green file.
      expect(scoreRows.length, "no live case executed").toBeGreaterThan(0);
      if (scoreRows.length !== TEXT_MODELS.length * TEXT_CASES.length) {
        console.warn(
          `[live] partial run (${scoreRows.length} of ${TEXT_MODELS.length * TEXT_CASES.length} cases) `
          + "— a name filter, not a defect.",
        );
      }
    });
  },
);
