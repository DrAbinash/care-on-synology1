/**
 * PR 1 — the model must not be handed unreviewed template statements labelled as
 * confirmed clinical observations (owner brief, Phase 1).
 *
 * The prompt had one observations section, `RADIOLOGIST OBSERVATIONS (canonical
 * clinical truth)`, and the workspace ledger's Complete-Normal scaffold rows were
 * indistinguishable inside it because the composer contract carried no role. The
 * sentences themselves already reached the model a second time, verbatim, as the
 * `NORMAL SCAFFOLD / CURRENT FINDINGS` narrative — so a row can be reclassified
 * as provisional without losing a single word of the report, and without touching
 * `snapshot.observations`, which eight grounding checks in `validateOutput.ts`
 * read as their whitelist. Reclassifying at the payload level would have made
 * every preserved normal sentence look invented.
 */
import { describe, expect, it } from "vitest";
import {
  buildRadiologistDraftContext,
  renderRadiologistDraftContextPrompt,
} from "./buildRadiologistDraftContext";
import type { ComposerInputSnapshot } from "./types";

const BRAIN_NORMALS = [
  "Brain parenchyma shows normal signal intensity.",
  "No acute infarct, hemorrhage, or mass lesion.",
  "Ventricular system and cisternal spaces are normal.",
  "No midline shift.",
  "Cortical sulci normal for age.",
  "Basal cisterns unremarkable.",
  "No restricted diffusion on DWI/ADC.",
  "Flow voids in major intracranial vessels are normal.",
  "Basal ganglia are normal in signal intensity.",
  "Pituitary gland and sellar region are unremarkable.",
  "Brainstem and cerebellum are normal.",
  "Orbits and both optic pathways are unremarkable.",
];

const INFARCT = "Restricted diffusion in the right MCA territory on DWI/ADC, consistent with acute infarct.";

function scaffoldOnly(): ComposerInputSnapshot {
  return {
    modality: "MR", region: "Brain", regions: ["Brain"], bodyPart: "BRAIN", family: "brain",
    studyType: "MRI Brain Plain", reportTitle: "MRI BRAIN PLAIN",
    technique: "MRI brain on 3T. T1W, T2W, FLAIR, DWI, ADC.",
    findings: BRAIN_NORMALS.join(" "),
    impression: "Normal MRI brain. No acute intracranial abnormality.",
    recommendation: "",
    observations: BRAIN_NORMALS.map((t, i) => ({
      concept: `normal_${i}`,
      region: "Brain",
      source: "normal-template",
      role: "baseline",
      findingsText: t,
    })),
    aiMode: "TEXT_ONLY",
    selectedKeyImages: [],
  } as never;
}

function withInfarct(): ComposerInputSnapshot {
  const s = scaffoldOnly();
  // The two normals the infarct falsifies are already retired by the click, which
  // is the ledger state the composer is handed.
  const retired = new Set(["No restricted diffusion on DWI/ADC.", "No acute infarct, hemorrhage, or mass lesion."]);
  const surviving = s.observations.filter((o) => !retired.has(o.findingsText));
  return {
    ...s,
    findings: `${INFARCT} ${surviving.map((o) => o.findingsText).join(" ")}`,
    observations: [
      ...surviving,
      {
        concept: "infarct", region: "Brain", level: null, laterality: "right",
        source: "quick-select", role: "finding", findingsText: INFARCT,
        impressionText: "Acute right MCA territory infarct.",
      },
    ],
  } as never;
}

const TRUTH_HEADING = "RADIOLOGIST OBSERVATIONS (canonical clinical truth)";

function section(prompt: string, heading: string): string {
  const start = prompt.indexOf(heading);
  if (start < 0) return "";
  const rest = prompt.slice(start + heading.length);
  const next = rest.search(/^\n[A-Z][A-Z \/\-()]+$/m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

describe("PR 1 — provisional normals leave clinical truth in the composer prompt", () => {
  it("a scaffold-only report presents zero confirmed observations", () => {
    const ctx = buildRadiologistDraftContext(scaffoldOnly());
    expect(ctx.observations).toHaveLength(0);
    expect(ctx.provisionalNormals).toHaveLength(BRAIN_NORMALS.length);
  });

  it("no template sentence is rendered under canonical clinical truth", () => {
    const prompt = renderRadiologistDraftContextPrompt(
      buildRadiologistDraftContext(scaffoldOnly()),
      "FULL_REPORT",
    );
    const truth = section(prompt, TRUTH_HEADING);
    expect(truth).not.toContain("Ventricular system and cisternal spaces are normal");
    expect(truth.replace(/\s+/g, " ")).not.toContain("No midline shift");
  });

  it("the abnormalities a radiologist confirmed still arrive as truth", () => {
    const ctx = buildRadiologistDraftContext(withInfarct());
    expect(ctx.observations.map((o) => o.concept)).toEqual(["infarct"]);
    expect(ctx.provisionalNormals).toHaveLength(BRAIN_NORMALS.length - 2);
    const truth = section(renderRadiologistDraftContextPrompt(ctx, "FULL_REPORT"), TRUTH_HEADING);
    // `observationLedgerLines` suppresses a row's prose when the same sentence is
    // already printed in full in the narrative above, so the row is named by its
    // identity parts, not repeated as text.
    expect(truth).toContain("[quick-select] Brain | infarct | right");
    expect(truth).toContain("Acute right MCA territory infarct.");
    for (let i = 0; i < BRAIN_NORMALS.length; i += 1) {
      expect(truth, `scaffold concept normal_${i} leaked into clinical truth`).not.toContain(`normal_${i}`);
    }
  });

  it("a confirmed finding the narrative does not carry prints its own sentence", () => {
    const snapshot = {
      ...withInfarct(),
      findings: BRAIN_NORMALS.slice(2).join(" "),
    } as never;
    const truth = section(renderRadiologistDraftContextPrompt(buildRadiologistDraftContext(snapshot), "FULL_REPORT"), TRUTH_HEADING);
    expect(truth).toContain(`Findings: ${INFARCT}`);
  });

  it("nothing is lost: every provisional sentence still reaches the model, exactly once", () => {
    const prompt = renderRadiologistDraftContextPrompt(
      buildRadiologistDraftContext(withInfarct()),
      "FULL_REPORT",
    );
    for (const sentence of ["No midline shift.", "Flow voids in major intracranial vessels are normal."]) {
      const hits = prompt.split(sentence).length - 1;
      expect(hits, sentence).toBe(1);
    }
    expect(prompt).toMatch(/provisional/i);
  });

  it("an auto-normal report is recognised as a scaffold (the residual it strips is now confirmed rows only)", () => {
    // On main this computed FALSE for exactly the report that is nothing but
    // scaffold, because every scaffold sentence was also an observation line and
    // the residual subtraction erased the report from itself. The prompt then
    // told the model "No substantial normal scaffold — do not invent normality".
    const ctx = buildRadiologistDraftContext(scaffoldOnly());
    expect(ctx.normalScaffoldHint).toBe(true);
    const prompt = renderRadiologistDraftContextPrompt(ctx, "FULL_REPORT");
    expect(prompt).toContain("PROVISIONAL NORMAL-TEMPLATE SENTENCES: 12");
    expect(prompt).toMatch(/not also listed as a\s+RADIOLOGIST OBSERVATION/);
    expect(prompt).not.toContain("No substantial normal scaffold");
    // With no scaffold rows the original instruction is still the one rendered.
    const confirmedOnly = renderRadiologistDraftContextPrompt(
      buildRadiologistDraftContext({
        ...scaffoldOnly(),
        observations: [{ concept: "infarct", findingsText: INFARCT, source: "manual", role: "finding" }],
      } as never),
      "FULL_REPORT",
    );
    expect(confirmedOnly).toContain("preserve unreplaced normal anatomy");
  });

  it("the frozen payload the grounding checks read is untouched", () => {
    const snapshot = withInfarct();
    const ctx = buildRadiologistDraftContext(snapshot);
    // 11 rows in, 11 rows still in the payload — reclassification happens at
    // render time, so `validateOutput.ts` keeps its full whitelist.
    expect(snapshot.observations).toHaveLength(11);
    expect(ctx.observations.length + ctx.provisionalNormals.length).toBe(11);
    expect(snapshot.observations.every((o) => Boolean(o.role))).toBe(true);
  });

  it("a screening limitation is provisional too, and its wording rule still fires", () => {
    const snapshot = {
      ...scaffoldOnly(),
      regions: ["Brain"],
      observations: [
        { concept: "normal_0", region: "Brain", source: "normal-template", role: "baseline", findingsText: BRAIN_NORMALS[0] },
        { concept: "screening_limitation", region: "Brain", source: "normal-template", role: "screening", findingsText: "Limited planar, limited sequence screening of the whole brain." },
      ],
    } as never;
    const ctx = buildRadiologistDraftContext(snapshot);
    expect(ctx.observations).toHaveLength(0);
    expect(ctx.provisionalNormals.map((o) => o.concept)).toEqual(["normal_0", "screening_limitation"]);
  });
});
