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
import { describe, expect, it } from "vitest";
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
