/**
 * localVisionModelsAb.live.test.ts — the three local vision models CARE can use,
 * measured on the same selected-image request.
 *
 * WHY THIS EXISTS
 * MedGemma 1.5 became selectable in CARE with this change, which raises a
 * question no unit test can answer: is it actually better at reading the images
 * a radiologist selects than the two models the clinic already has? CARE cannot
 * answer that with a mock, and the clinic should not answer it by pushing a
 * patient's study through a model nobody scored. So this file drives the SHIPPED
 * selected-image path — the real CARE persona prompt, the real user-prompt
 * builder, the real context planner, the real Ollama transport, the real JSON
 * contract — against each candidate with identical input, and prints the score.
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT
 * The test image is a drawn schematic carrying printed labels. A model that
 * reads it proves it conditioned its answer on the pixels it was sent; a model
 * that ignores it can only repeat the typed observations. That is a real
 * capability boundary and it is the only honest one available without patient
 * data: **this is not a measure of diagnostic accuracy.** Nothing here says
 * MedGemma can grade a stenosis. Judging that needs de-identified clinic images
 * read by a radiologist, and CARE deliberately does not pretend otherwise.
 *
 * The scoring axes are the ones that decide whether a model can be used at all:
 * did it answer in the structured form the Composer requires, did it keep every
 * level and side the radiologist typed, did it invent a measurement nobody
 * gave it (the prompt forbids this outright), did anything the typed
 * observations never mentioned — but the image did — reach the draft, and how
 * long did it take.
 *
 * OPT-IN, AND IT NEVER DOWNLOADS ANYTHING
 * RUN_LIVE_OLLAMA=1 to run. A candidate that is not in the local Ollama library
 * is skipped with a printed reason and counted in the summary, because pulling
 * gigabytes of weights onto a clinic PC is the operator's decision, not a test's.
 * With no candidate installed the file reports zero participants and fails, so a
 * silent no-op can never read as a pass.
 *
 *   ollama pull medgemma1.5:4b        # the operator runs this, not CARE
 *   RUN_LIVE_OLLAMA=1 pnpm vitest run \
 *     artifacts/api-server/src/lib/reportComposer/localVisionModelsAb.live.test.ts
 *
 * RECORDED 2026-10-11, two consecutive runs on the clinic AI PC (192.168.1.250),
 * num_ctx 4679 for one image: `medgemma1.5:4b` answered in the structured form
 * in 9.3–9.6 s keeping every typed level and the typed laterality; `gemma3:12b`
 * did the same in 39–41 s and additionally volunteered the image-only L5-S1
 * finding, which CARE's `level_change` guard then blocks; `qwen3-vl:8b` — the
 * model CARE still names as its local vision default — returned
 * `empty_model_response` on both runs after 66–81 s. One schematic is not a
 * diagnostic trial, but an empty answer is not a matter of opinion.
 */
import { describe, expect, it, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import sharp from "sharp";
import { buildUserPrompt } from "./composeEngine";
import { buildCareSystemPrompt } from "./persona";
import { planComposerVisionContext } from "./composerContextBudget";
import { parseComposerSnapshot, parseComposerDraftJson } from "./types";
import { OllamaComposerAdapter } from "./providers/ollamaComposerAdapter";
import type { AiComposeJobKind } from "@workspace/db/schema";

const WANTED = process.env.RUN_LIVE_OLLAMA === "1";
const ENDPOINT = process.env.LIVE_OLLAMA_URL ?? "http://192.168.1.250:11434";
const CANDIDATES = (
  process.env.LIVE_OLLAMA_MODELS ?? "gemma3:12b,medgemma1.5:4b,qwen3-vl:8b"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** The three levels the radiologist actually typed. */
const OBSERVED_LEVELS = ["L2-L3", "L3-L4", "L4-L5"];
/**
 * The one finding that exists ONLY in the image. A model that never looks at
 * the pixels cannot produce it; a model that does must decide whether it is
 * allowed to say it, because CARE's prompt puts typed observations first.
 */
const IMAGE_ONLY_FEATURE = "L5-S1";

async function installedModels(): Promise<string[]> {
  try {
    const r = await fetch(`${ENDPOINT.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { models?: Array<{ name: string }> };
    return (j.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * A drawn sagittal lumbar schematic with printed level labels, an R marker, and
 * one finding written into the picture and nowhere in the typed observations.
 * Synthetic by construction: no patient, no DICOM, nothing from the archive.
 */
async function syntheticSagittalLumbarPng(): Promise<string> {
  const bodies = [0, 1, 2, 3]
    .map((i) => {
      const y = 170 + i * 190;
      const vertebra = `L${i + 2}`;
      // The three discs the radiologist typed as unremarkable, plus the L5-S1
      // disc drawn red below — that one is the image-only finding.
      const disc =
        i < 3
          ? `<rect x="150" y="${y + 138}" width="300" height="44" rx="20" fill="#5b6d8c"/>
  <text x="486" y="${y + 168}" fill="#9fb6dd" font-family="DejaVu Sans, sans-serif" font-size="26">${vertebra}-L${i + 3}: normal height, no bulge</text>`
          : `<rect x="150" y="${y + 138}" width="300" height="44" rx="20" fill="#8c3b3b"/>
  <text x="486" y="${y + 168}" fill="#ff9d9d" font-family="DejaVu Sans, sans-serif" font-size="26" font-weight="bold">${vertebra}-S1: broad-based posterior disc bulge, left</text>`;
      return `<rect x="150" y="${y}" width="300" height="130" rx="26" fill="#d8d8de"/>
  <rect x="168" y="${y + 18}" width="264" height="94" rx="18" fill="#2b2b31"/>
  <text x="96" y="${y + 74}" fill="#e8e8ea" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="bold" text-anchor="end">${vertebra}</text>
  ${disc}`;
    })
    .join("\n  ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="980" viewBox="0 0 760 980">
  <rect width="760" height="980" fill="#0b0b0d"/>
  <text x="24" y="44" fill="#e8e8ea" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="bold">MRI LUMBAR SPINE - SAGITTAL T2 (SCHEMATIC)</text>
  <text x="24" y="80" fill="#9a9aa2" font-family="DejaVu Sans, sans-serif" font-size="22">SYNTHETIC TEACHING IMAGE - NOT A PATIENT STUDY</text>
  <text x="700" y="130" fill="#ffd54a" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="bold" text-anchor="end">R</text>
  ${bodies}
</svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return buf.toString("base64");
}

const OBSERVATIONS = [
  "Straightening of lumbar lordosis.",
  "Disc desiccation at L2-L3, L3-L4 and L4-L5.",
  "Reduced disc height at L4-L5.",
  "Diffuse posterior disc bulge at L3-L4.",
  "Broad-based posterior disc bulge at L4-L5 causing mild left lateral recess narrowing.",
  "Mild left facet arthropathy at L4-L5.",
];

function buildSnapshot(images: Array<{ base64: string; mimeType: string }>) {
  return parseComposerSnapshot({
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
    protocol: "Multiplanar multisequence non-contrast MRI, lumbosacral spine.",
    clinicalHistory: "Mechanical low back pain, left greater than right, no radiculopathy.",
    technique: "Sagittal T1/T2 and axial T2 through L2-S1.",
    findings: OBSERVATIONS.join("\n"),
    impression: "",
    recommendation: "",
    observations: OBSERVATIONS.map((text, i) => ({
      id: `obs-${i + 1}`,
      concept: text.slice(0, 60),
      laterality: text.toLowerCase().includes("left") ? "left" : "midline",
      findingsText: text,
    })),
    aiMode: "SELECTED_IMAGES",
    selectedKeyImages: images.map((_, i) => ({
      keyImageId: i + 1,
      caption: `sagittal lumbar schematic ${i + 1}`,
      observationId: null,
    })),
  });
}

type Row = {
  model: string;
  participated: boolean;
  ok: boolean;
  safeError: string;
  ms: number;
  parsed: boolean;
  rawLength: number;
  levelsKept: string;
  laterality: string;
  sawTheImage: string;
  inventedMeasurements: string;
};

const rows: Row[] = [];

describe(`local vision models on one real selected-image request (${ENDPOINT})`, () => {
  it.skipIf(!WANTED)(
    "scores every installed candidate on the same synthetic lumbar selection",
    async () => {
      const have = await installedModels();
      if (have.length === 0) {
        console.warn(`[ab] no Ollama answering at ${ENDPOINT} — nothing measured`);
      }

      const base64 = await syntheticSagittalPngSafe();
      const images = [{ base64, mimeType: "image/png" } as const];
      const snapshot = buildSnapshot(images);
      const kind: AiComposeJobKind = "FULL_REPORT";
      const systemPrompt = buildCareSystemPrompt(kind, snapshot);
      const userPrompt = buildUserPrompt(kind, snapshot);
      // The shipped planner sizes the window for this exact prompt + image set,
      // so every model is asked the same question with a fair budget.
      const plan = planComposerVisionContext({
        imageCount: images.length,
        systemPrompt,
        userPrompt,
        configuredNumCtx: 4096,
      });

      for (const model of CANDIDATES) {
        const present = have.some((m) => m === model || m.startsWith(`${model}:`));
        if (!present) {
          console.log(
            `[ab] SKIP ${model} — not in the local Ollama library (CARE will not pull it)`,
          );
          rows.push({
            model,
            participated: false,
            ok: false,
            safeError: "not_installed",
            ms: 0,
            parsed: false,
            rawLength: 0,
            levelsKept: "-",
            laterality: "-",
            sawTheImage: "-",
            inventedMeasurements: "-",
          });
          continue;
        }

        const t0 = Date.now();
        const r = await new OllamaComposerAdapter().compose({
          systemPrompt,
          userPrompt,
          model,
          temperature: 0.1,
          timeoutMs: 180_000,
          numCtx: Math.max(4096, plan.numCtx),
          endpoint: ENDPOINT,
          localOnly: true,
          images,
        });
        const ms = Date.now() - t0;
        const text = r.ok ? (r.text ?? "") : "";
        const draft = r.ok ? parseComposerDraftJson(text) : null;
        const all = `${draft?.findings ?? ""} ${draft?.impression ?? ""}`;

        rows.push({
          model,
          participated: true,
          ok: r.ok,
          safeError: r.ok ? "-" : `${r.safeError ?? "compose_failed"}${r.detail ? ` (${String(r.detail).slice(0, 60)})` : ""}`,
          ms,
          parsed: !!draft,
          rawLength: text.length,
          levelsKept: OBSERVED_LEVELS.filter((l) => all.includes(l)).join(",") || "none",
          laterality: all.toLowerCase().includes("left")
            ? all.toLowerCase().includes("right")
              ? "left + right (check)"
              : "left (as typed)"
            : "left dropped",
          sawTheImage: all.includes(IMAGE_ONLY_FEATURE) ? "mentioned L5-S1" : "silent on image-only finding",
          inventedMeasurements: `${(all.match(/\d+(?:\.\d+)?\s*mm/gi) ?? []).length}`,
        });
      }

      const pad = (s: string | number, n: number) => String(s).padEnd(n);
      console.log("\n===== LOCAL VISION MODEL A/B — same prompt, same synthetic image =====");
      console.log(`num_ctx used: ${plan.fits ? plan.numCtx : `plan says ${plan.reason}`}`);
      console.log(
        [
          pad("model", 18),
          pad("ok", 6),
          pad("ms", 7),
          pad("json", 6),
          pad("levels kept", 18),
          pad("laterality", 20),
          pad("image-only", 28),
          pad("invented mm", 12),
          "outcome / reason",
        ].join(" "),
      );
      for (const row of rows) {
        if (!row.participated) {
          console.log(`${pad(row.model, 18)} SKIPPED — ${row.safeError}`);
          continue;
        }
        console.log(
          [
            pad(row.model, 18),
            pad(row.ok ? "yes" : "no", 6),
            pad(row.ms, 7),
            pad(row.parsed ? "yes" : "no", 6),
            pad(row.levelsKept, 18),
            pad(row.laterality, 20),
            pad(row.sawTheImage, 28),
            pad(row.inventedMeasurements, 12),
            row.ok ? "structured draft" : row.safeError,
          ].join(" "),
        );
      }
      console.log(
        "\nReading this table: 'invented mm' should be 0 — the observations supplied no\n" +
          "measurement and the prompt forbids estimating one from a screenshot. 'image-only'\n" +
          "is the pixel-conditioning signal, not a correctness signal: mentioning L5-S1 means\n" +
          "the model read the drawing, and CARE's own guard would then block that level as\n" +
          "unobserved (see selectedImages.composer.test.ts). Diagnostic quality is NOT\n" +
          "measurable here and needs a radiologist reading de-identified studies.\n",
      );

      const participated = rows.filter((x) => x.participated);
      expect(participated.length, "no candidate model is installed locally").toBeGreaterThan(0);
      for (const row of participated) {
        // Every participating model must answer with a named outcome and a real
        // duration — never a hang, never an unlabelled failure.
        expect(row.ms).toBeGreaterThan(0);
        if (!row.ok) expect(row.safeError).not.toBe("compose_failed");
        if (row.ok && !row.parsed) {
          console.log(`[ab] ${row.model} answered ok but the draft did not parse (prose answer)`);
        }
      }
    },
    900_000,
  );
});

/** Kept separate so a sharp/SVG failure is visible as itself, not as a model fault. */
async function syntheticSagittalPngSafe(): Promise<string> {
  try {
    return await syntheticSagittalLumbarPng();
  } catch (e) {
    throw new Error(`synthetic test image could not be built: ${String(e)}`);
  }
}

/* ==========================================================================
 * BENCHMARK — the same shipped selected-image path, several synthetic cases,
 * each repeated. Opt-in twice over: `RUN_LIVE_OLLAMA=1` enables this file, and
 * `RUN_VISION_BENCH=1` adds this matrix so the single-case A/B stays cheap.
 *
 * WHY A MATRIX AND NOT THE ONE CASE ABOVE
 * One schematic answers "did it answer at all". A model that is right once and
 * empty twice is not a model CARE can put in front of a patient, and a ranking
 * built on a single prompt is a ranking of that prompt. So every axis here is
 * counted over N runs and reported as a rate, with the individual runs kept so a
 * spread is visible rather than averaged away.
 *
 * WHY EVERY AXIS IS A STRING TEST
 * The owner's rule: a model is not the authority on whether a model may be
 * trusted. Each axis below is decided by comparing the draft against what the
 * case actually contains — typed levels, the typed measurement, the labels
 * printed inside the drawing — never by asking a model to grade one.
 *
 * WHAT THIS IS NOT
 * These are drawings with printed labels, not studies. Nothing here measures
 * diagnostic accuracy, sensitivity or specificity, and no ranking from this
 * table justifies changing the clinic's configured model. It answers the
 * operational question only: which of these models reliably completes the
 * shipped contract on this machine.
 * ========================================================================== */

type BenchCase = {
  id: string;
  label: string;
  svg: () => string;
  observations: string[];
  history: string;
  technique: string;
  /** Level tokens the radiologist typed; a draft that drops one lost content. */
  typedLevels: string[];
  /** The measurement the radiologist typed, verbatim, or null if none was typed. */
  typedMeasurement: string | null;
  /** Numbers printed INSIDE the drawing — repeating one is grounding, not invention. */
  imageNumbers: string[];
  /** The one finding that exists only in the pixels. */
  imageOnlyFeature: string;
  /** The side the truth is on, when the case has a side at all. */
  trueSide: "left" | "right" | null;
};

const BENCH_CASES: BenchCase[] = [
  {
    id: "lumbar-sagittal",
    label: "MRI lumbar sagittal — three typed levels, one image-only level",
    svg: sagittalLumbarSvg,
    observations: OBSERVATIONS,
    history: "Mechanical low back pain, left greater than right, no radiculopathy.",
    technique: "Sagittal T1/T2 and axial T2 through L2-S1.",
    typedLevels: OBSERVED_LEVELS,
    typedMeasurement: null,
    imageNumbers: [],
    imageOnlyFeature: IMAGE_ONLY_FEATURE,
    trueSide: "left",
  },
  {
    id: "brain-axial-right",
    label: "CT brain axial — typed report says nothing about the image's collection",
    svg: brainAxialSvg,
    observations: [
      "No acute infarct.",
      "Mild age-related volume loss.",
      "Ventricles and sulci are symmetric.",
    ],
    history: "65-year-old, fall, on warfarin, headache.",
    technique: "Non-contrast CT head.",
    typedLevels: [],
    typedMeasurement: null,
    // The drawing prints "8 mm" for the collection thickness.
    imageNumbers: ["8 mm"],
    imageOnlyFeature: "extra-axial",
    trueSide: "right",
  },
  {
    id: "knee-typed-measurement",
    label: "X-ray knee — the typed 14 mm lesion must survive an image that prints 2.1 mm",
    svg: kneeRadiographSvg,
    observations: [
      "Osteophytes at the medial tibial and femoral margins.",
      "Marked medial joint space loss.",
      "14 mm complex effusion.",
    ],
    history: "Knee pain, worse on the right, mechanical.",
    technique: "Weight-bearing AP and lateral right knee.",
    typedLevels: [],
    typedMeasurement: "14 mm",
    // 2.1 mm is printed in the picture. Saying it is not invention; using it IN
    // PLACE OF the typed 14 mm is a content loss, scored separately.
    imageNumbers: ["2.1 mm"],
    imageOnlyFeature: "enthesophyte",
    trueSide: "right",
  },
];

/** Sagittal lumbar schematic — the same drawing the single-case A/B uses. */
function sagittalLumbarSvg(): string {
  const bodies = [0, 1, 2, 3]
    .map((i) => {
      const y = 170 + i * 190;
      const vertebra = `L${i + 2}`;
      const disc =
        i < 3
          ? `<rect x="150" y="${y + 138}" width="300" height="44" rx="20" fill="#5b6d8c"/>
  <text x="486" y="${y + 168}" fill="#9fb6dd" font-family="DejaVu Sans, sans-serif" font-size="26">${vertebra}-L${i + 3}: normal height, no bulge</text>`
          : `<rect x="150" y="${y + 138}" width="300" height="44" rx="20" fill="#8c3b3b"/>
  <text x="486" y="${y + 168}" fill="#ff9d9d" font-family="DejaVu Sans, sans-serif" font-size="26" font-weight="bold">${vertebra}-S1: broad-based posterior disc bulge, left</text>`;
      return `<rect x="150" y="${y}" width="300" height="130" rx="26" fill="#d8d8de"/>
  <rect x="168" y="${y + 18}" width="264" height="94" rx="18" fill="#2b2b31"/>
  <text x="96" y="${y + 74}" fill="#e8e8ea" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="bold" text-anchor="end">${vertebra}</text>
  ${disc}`;
    })
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="980" viewBox="0 0 760 980">
  <rect width="760" height="980" fill="#0b0b0d"/>
  <text x="24" y="44" fill="#e8e8ea" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="bold">MRI LUMBAR SPINE - SAGITTAL T2 (SCHEMATIC)</text>
  <text x="24" y="80" fill="#9a9aa2" font-family="DejaVu Sans, sans-serif" font-size="22">SYNTHETIC TEACHING IMAGE - NOT A PATIENT STUDY</text>
  <text x="700" y="130" fill="#ffd54a" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="bold" text-anchor="end">R</text>
  ${bodies}
</svg>`;
}

/**
 * Axial CT schematic. The collection is drawn and labelled on the RIGHT and
 * nowhere in the typed observations, so a draft that describes it is reading
 * pixels; a draft that calls it LEFT failed laterality on a case whose whole
 * point is laterality.
 */
function brainAxialSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="760" viewBox="0 0 760 760">
  <rect width="760" height="760" fill="#0b0b0d"/>
  <text x="24" y="44" fill="#e8e8ea" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="bold">CT HEAD AXIAL (SCHEMATIC)</text>
  <text x="24" y="80" fill="#9a9aa2" font-family="DejaVu Sans, sans-serif" font-size="22">SYNTHETIC TEACHING IMAGE - NOT A PATIENT STUDY</text>
  <text x="120" y="400" fill="#ffd54a" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="bold">R</text>
  <text x="640" y="400" fill="#9a9aa2" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="bold">L</text>
  <ellipse cx="380" cy="400" rx="250" ry="215" fill="#2b2b31" stroke="#d8d8de" stroke-width="6"/>
  <path d="M 205 300 A 200 200 0 0 1 330 205 L 320 300 Z" fill="#e8e8ea"/>
  <text x="150" y="250" fill="#ff9d9d" font-family="DejaVu Sans, sans-serif" font-size="24" font-weight="bold">RIGHT fronto-parietal extra-axial collection, 8 mm thick</text>
  <line x1="380" y1="200" x2="400" y2="600" stroke="#ffd54a" stroke-width="3"/>
  <text x="330" y="660" fill="#9fb6dd" font-family="DejaVu Sans, sans-serif" font-size="22">midline shifted to the LEFT</text>
</svg>`;
}

/**
 * Knee radiograph schematic. The typed report carries a 14 mm effusion; the
 * drawing prints a 2.1 mm joint space and an enthesophyte that the typed
 * observations never mention.
 */
function kneeRadiographSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="760" viewBox="0 0 760 760">
  <rect width="760" height="760" fill="#0b0b0d"/>
  <text x="24" y="44" fill="#e8e8ea" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="bold">X-RAY KNEE AP WEIGHT-BEARING (SCHEMATIC)</text>
  <text x="24" y="80" fill="#9a9aa2" font-family="DejaVu Sans, sans-serif" font-size="22">SYNTHETIC TEACHING IMAGE - NOT A PATIENT STUDY</text>
  <text x="690" y="130" fill="#ffd54a" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="bold" text-anchor="end">R</text>
  <rect x="250" y="120" width="260" height="200" rx="30" fill="#d8d8de"/>
  <rect x="250" y="440" width="260" height="200" rx="30" fill="#d8d8de"/>
  <rect x="250" y="330" width="260" height="100" fill="#0b0b0d"/>
  <rect x="250" y="378" width="120" height="6" fill="#5b6d8c"/>
  <text x="120" y="382" fill="#ff9d9d" font-family="DejaVu Sans, sans-serif" font-size="24" font-weight="bold" text-anchor="end">medial joint space 2.1 mm</text>
  <path d="M 500 440 l 40 -18 l 0 36 Z" fill="#e8e8ea"/>
  <text x="548" y="452" fill="#9fb6dd" font-family="DejaVu Sans, sans-serif" font-size="22">patellar enthesophyte</text>
</svg>`;
}

type RunRow = {
  model: string;
  caseId: string;
  run: number;
  ok: boolean;
  structured: boolean;
  ms: number;
  rawLength: number;
  safeError: string;
  typedLevelsKept: boolean;
  typedMeasurementKept: boolean;
  typedMeasurementLost: boolean;
  mentionsTrueSide: boolean;
  mentionsWrongSideOnly: boolean;
  groundedOnImageOnly: boolean;
  inventedNumbers: string;
  sizeVramGb: number | null;
};

const BENCH_WANTED = process.env.RUN_VISION_BENCH === "1";
const BENCH_RUNS = Math.max(1, Number(process.env.RUN_VISION_BENCH_REPEATS ?? 2));
const benchRows: RunRow[] = [];

/**
 * A case that declares no typed level cannot fail to keep one, and a run that
 * produced no draft cannot fail to keep a measurement either: both checks are
 * absence tests, and an absence test passes on an empty string. Scored the naive
 * way this table reported "meas kept 8/9" for a model that answered twice out of
 * nine. Every preservation column is therefore scored over the runs that COULD
 * have failed it — usable runs, in the cases that declare the fact — and an empty
 * denominator prints as `n/a`, never as a pass.
 */
type PreservationColumn = "levels" | "meas" | "side";
const caseById = new Map(BENCH_CASES.map((c) => [c.id, c]));

function scoreableRun(r: RunRow, col: PreservationColumn): boolean {
  if (!r.ok) return false;
  const c = caseById.get(r.caseId);
  if (!c) return false;
  if (col === "levels") return c.typedLevels.length > 0;
  if (col === "meas") return !!c.typedMeasurement;
  return !!c.trueSide;
}

function fracScored(
  rows: RunRow[],
  col: PreservationColumn,
  f: (r: RunRow) => boolean,
): string {
  const den = rows.filter((r) => scoreableRun(r, col));
  return den.length ? `${den.filter(f).length}/${den.length}` : "n/a";
}

function rowOver(caseId: string, over: Partial<RunRow>): RunRow {
  return {
    model: "m", caseId, run: 1, ok: true, structured: true, ms: 1000, rawLength: 100,
    safeError: "-", typedLevelsKept: true, typedMeasurementKept: true,
    typedMeasurementLost: false, mentionsTrueSide: true, mentionsWrongSideOnly: false,
    groundedOnImageOnly: false, inventedNumbers: "0", sizeVramGb: null,
    ...over,
  };
}

test("a preservation column is never credited to a run or a case that could not fail it", () => {
  // The bug this guards: a timeout answers with nothing, every absence test
  // passes, and the table reads as if the model preserved the measurement.
  const timedOut = rowOver("knee-typed-measurement", {
    ok: false, structured: false, safeError: "ollama_timeout",
  });
  expect(fracScored([timedOut], "meas", (r) => r.typedMeasurementKept)).toBe("n/a");

  // And the other half: a usable draft in a case that never typed a level says
  // nothing about levels, so it must not inflate that column either.
  expect(fracScored([rowOver("brain-axial-right")], "levels", (r) => r.typedLevelsKept)).toBe("n/a");

  // Positive controls — the denominator really is the case that declares the fact.
  const knee = fracScored(
    [rowOver("knee-typed-measurement"), rowOver("knee-typed-measurement", { typedMeasurementKept: false })],
    "meas",
    (r) => r.typedMeasurementKept,
  );
  expect(knee).toBe("1/2");
  expect(fracScored([rowOver("lumbar-sagittal")], "levels", (r) => r.typedLevelsKept)).toBe("1/1");
});

/** Ollama's own answer about what is resident, or null when it says nothing. */
async function loadedVramGb(endpoint: string, model: string): Promise<number | null> {
  try {
    const r = await fetch(`${endpoint.replace(/\/$/, "")}/api/ps`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { models?: Array<{ name: string; size_vram?: number; size?: number }> };
    const hit = (j.models ?? []).find((m) => m.name === model || m.name.startsWith(`${model}:`));
    const bytes = hit?.size_vram ?? hit?.size ?? null;
    return bytes == null ? null : Number((bytes / 1e9).toFixed(2));
  } catch {
    return null;
  }
}

function benchSnapshot(c: BenchCase, images: Array<{ base64: string; mimeType: string }>) {
  return parseComposerSnapshot({
    reportId: 1,
    studyId: 1,
    worklistId: 1,
    modality: c.id === "knee-typed-measurement" ? "XR" : c.id === "brain-axial-right" ? "CT" : "MRI",
    region: c.id === "knee-typed-measurement" ? "Knee" : c.id === "brain-axial-right" ? "Brain" : "Lumbosacral Spine",
    bodyPart: c.id === "knee-typed-measurement" ? "Knee" : c.id === "brain-axial-right" ? "Head" : "Lumbar spine",
    family: c.id === "knee-typed-measurement" ? "XR" : c.id === "brain-axial-right" ? "CT" : "MRI",
    spineSegment: c.id === "lumbar-sagittal" ? "LS" : undefined,
    studyType: c.label,
    reportTitle: c.label,
    protocol: c.technique,
    clinicalHistory: c.history,
    technique: c.technique,
    findings: c.observations.join("\n"),
    impression: "",
    recommendation: "",
    observations: c.observations.map((text, i) => ({
      id: `obs-${i + 1}`,
      concept: text.slice(0, 60),
      laterality: text.toLowerCase().includes("left") ? "left" : text.toLowerCase().includes("right") ? "right" : "midline",
      findingsText: text,
    })),
    aiMode: "SELECTED_IMAGES",
    selectedKeyImages: images.map((_, i) => ({
      keyImageId: i + 1,
      caption: `${c.id} schematic ${i + 1}`,
      observationId: null,
    })),
  });
}

describe(`vision benchmark — every installed candidate × ${BENCH_CASES.length} synthetic cases × ${BENCH_RUNS} runs (${ENDPOINT})`, () => {
  it.skipIf(!WANTED || !BENCH_WANTED)(
    "measures reliability, grounding, laterality, measurement preservation and cost",
    async () => {
      const have = await installedModels();
      expect(have.length, `no Ollama answering at ${ENDPOINT}`).toBeGreaterThan(0);

      for (const c of BENCH_CASES) {
        const buf = await sharp(Buffer.from(c.svg())).png().toBuffer();
        const images = [{ base64: buf.toString("base64"), mimeType: "image/png" } as const];
        const snapshot = benchSnapshot(c, images);
        const kind: AiComposeJobKind = "FULL_REPORT";
        const systemPrompt = buildCareSystemPrompt(kind, snapshot);
        const userPrompt = buildUserPrompt(kind, snapshot);
        const plan = planComposerVisionContext({
          imageCount: images.length,
          systemPrompt,
          userPrompt,
          configuredNumCtx: 4096,
        });

        for (const model of CANDIDATES) {
          if (!have.some((m) => m === model || m.startsWith(`${model}:`))) continue;
          for (let run = 1; run <= BENCH_RUNS; run += 1) {
            const t0 = Date.now();
            const r = await new OllamaComposerAdapter().compose({
              systemPrompt,
              userPrompt,
              model,
              temperature: 0.1,
              timeoutMs: 180_000,
              numCtx: Math.max(4096, plan.numCtx),
              endpoint: ENDPOINT,
              localOnly: true,
              images,
            });
            const ms = Date.now() - t0;
            const text = r.ok ? (r.text ?? "") : "";
            const draft = r.ok ? parseComposerDraftJson(text) : null;
            const all = `${draft?.findings ?? ""} ${draft?.impression ?? ""}`;
            const lower = all.toLowerCase();
            const wrongSide = c.trueSide === "left" ? "right" : "left";
            // Any mm figure that is in neither the typed observations nor the
            // drawing's own printed labels was produced from nothing.
            const allowed = new Set(
              [...c.typedLevels, c.typedMeasurement, ...c.imageNumbers]
                .filter(Boolean)
                .map((s) => String(s).toLowerCase()),
            );
            const numbers = [...all.matchAll(/(\d+(?:\.\d+)?)\s*(?:mm|cms?)\b/gi)]
              .map((m) => `${m[1]} mm`.toLowerCase())
              .filter((n) => ![...allowed].some((a) => a.includes(n)));

            benchRows.push({
              model,
              caseId: c.id,
              run,
              ok: r.ok,
              structured: !!draft && (draft.findings ?? "").trim().length > 0,
              ms,
              rawLength: text.length,
              safeError: r.ok
                ? "-"
                : `${r.safeError ?? "compose_failed"}${r.detail ? ` (${String(r.detail).slice(0, 50)})` : ""}`,
              typedLevelsKept: c.typedLevels.every((l) => all.includes(l)),
              typedMeasurementKept: !c.typedMeasurement || all.includes(c.typedMeasurement),
              typedMeasurementLost:
                !!c.typedMeasurement &&
                !all.includes(c.typedMeasurement) &&
                c.imageNumbers.some((n) => all.includes(n)),
              mentionsTrueSide: !c.trueSide || lower.includes(c.trueSide),
              mentionsWrongSideOnly:
                !!c.trueSide && lower.includes(wrongSide) && !lower.includes(c.trueSide),
              groundedOnImageOnly: lower.includes(c.imageOnlyFeature),
              inventedNumbers: numbers.join(",") || "0",
              sizeVramGb: await loadedVramGb(ENDPOINT, model),
            });
          }
        }
      }

      const pad = (s: string | number, n: number) => String(s).padEnd(n);
      console.log(`\n===== VISION BENCHMARK — ${benchRows.length} runs over ${BENCH_CASES.length} cases =====`);
      console.log(
        [
          pad("model", 18), pad("runs", 5), pad("usable", 8), pad("structured", 12),
          pad("levels kept*", 12), pad("meas kept*", 11), pad("meas lost*", 11),
          pad("names side*", 13), pad("SIDE WRONG*", 13), pad("grounded", 10),
          pad("invented", 9), pad("ms mean", 8), pad("ms max", 8), pad("vram GB", 9),
          "failures",
        ].join(" "),
      );
      for (const model of CANDIDATES) {
        const rs = benchRows.filter((r) => r.model === model);
        if (!rs.length) {
          console.log(`${pad(model, 18)} not installed on ${ENDPOINT} — skipped, never pulled`);
          continue;
        }
        const n = rs.length;
        const yes = (f: (r: RunRow) => boolean) => rs.filter(f).length;
        const usable = rs.filter((r) => r.ok);
        const times = rs.map((r) => r.ms).sort((a, b) => a - b);
        const vrams = rs.map((r) => r.sizeVramGb).filter((v): v is number => v != null);
        const fails = rs.filter((r) => !r.ok || !r.structured);
        console.log(
          [
            pad(model, 18), pad(n, 5),
            pad(yes((r) => r.ok && r.structured), 8), pad(yes((r) => r.structured), 12),
            pad(fracScored(rs, "levels", (r) => r.typedLevelsKept), 12),
            pad(fracScored(rs, "meas", (r) => r.typedMeasurementKept), 11),
            pad(fracScored(rs, "meas", (r) => r.typedMeasurementLost), 11),
            pad(fracScored(rs, "side", (r) => r.mentionsTrueSide), 13),
            pad(fracScored(rs, "side", (r) => r.mentionsWrongSideOnly), 13),
            pad(usable.length ? `${usable.filter((r) => r.groundedOnImageOnly).length}/${usable.length}` : "n/a", 10),
            pad(yes((r) => r.inventedNumbers !== "0"), 9),
            pad(Math.round(times.reduce((a, b) => a + b, 0) / n), 8),
            pad(times[times.length - 1], 8),
            pad(vrams.length ? Math.max(...vrams) : "-", 9),
            fails.length ? [...new Set(fails.map((f) => f.caseId + "#" + f.run + " " + f.safeError))].join("; ").slice(0, 90) : "none",
          ].join(" "),
        );
      }
      console.log(
        "\nReading this table: a '*' column is scored only over runs that could have failed it —\n" +
          "usable drafts, in the cases that declare the fact. 'levels kept' is exercised by\n" +
          "lumbar-sagittal (3 typed levels), 'meas kept/lost' by knee-typed-measurement (14 mm),\n" +
          "'names side' by all three. 'n/a' means nothing was scoreable, which is NOT a pass.\n" +
          "'grounded' counts usable runs where a finding that exists ONLY in the drawing reached\n" +
          "the draft — a pixel-conditioning signal, not correctness. 'SIDE WRONG' counts runs\n" +
          "naming the opposite side and never the true one. 'invented' counts runs carrying an mm\n" +
          "figure present in neither the typed observations nor the drawing. None of this measures\n" +
          "diagnostic accuracy; a radiologist reading de-identified studies does. Do not change the\n" +
          "clinic's configured model on this table alone.\n",
      );

      expect(benchRows.length, "no model participated in the benchmark").toBeGreaterThan(0);
      for (const r of benchRows) {
        expect(r.ms, `${r.model} ${r.caseId}#${r.run} reported no duration`).toBeGreaterThan(0);
        if (!r.ok) expect(r.safeError, `${r.model} failed without a named reason`).not.toBe("compose_failed");
      }
      fs.writeFileSync(
        path.join(process.cwd(), "tmp", "vision-benchmark.json"),
        JSON.stringify({ endpoint: ENDPOINT, cases: BENCH_CASES.map((c) => c.id), runs: BENCH_RUNS, rows: benchRows }, null, 2),
      );
    },
    3_600_000,
  );
});
