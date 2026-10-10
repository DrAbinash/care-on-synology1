/**
 * "Refine Report" — what the model is told, and what CARE refuses to accept back.
 *
 * The refinement flow itself (proposed revision, per-field Accept/Reject, durable
 * Apply, undo, the signed-report refusal) already existed and is covered by the
 * composer's own request suites. What is tested here is the part Prompt 2 needs:
 * a refinement must change wording and never change the medicine — so a rewrite
 * that deletes a finding has to be caught, while a rewrite that reorders, merges
 * or rewords must not be.
 */
import { describe, expect, it } from "vitest";
import type { AiComposeJobKind } from "@workspace/db/schema";
import { buildUserPrompt } from "./composeEngine";
import { buildCareSystemPrompt } from "./persona";
import { validateComposerOutput } from "./validateOutput";
import { buildTrackedChanges, materializeAcceptedText } from "./trackedChanges";
import { parseComposerSnapshot, type ComposerInputSnapshot } from "./types";

const L45_FACET = "Bilateral facet arthropathy at L4-L5 and L5-S1.";
const BASE_FINDINGS = [
  "Loss of lumbar lordosis.",
  "Disc desiccation at L2-L3, L3-L4, L4-L5 and L5-S1.",
  "Broad-based disc bulge at L4-L5 with bilateral lateral recess narrowing.",
  L45_FACET,
  "AP canal diameter 9 mm at L4-L5.",
].join("\n");

function snapshotFor(findings: string): ComposerInputSnapshot {
  return parseComposerSnapshot({
    modality: "MR", region: "LS Spine", family: "spine", spineSegment: "lumbar",
    reportTitle: "MRI LUMBOSACRAL SPINE",
    technique: "Multiplanar multisequence non-contrast MRI of the lumbosacral spine.",
    findings,
    impression: "Multilevel degenerative disc disease.",
    recommendation: "",
    observations: [
      { id: "o1", concept: "lordosis", findingsText: "Loss of lumbar lordosis." },
      { id: "o2", concept: "disc_desiccation", level: "L2-L3", findingsText: "Disc desiccation L2-L3." },
      { id: "o3", concept: "disc_contour", level: "L4-L5", laterality: "bilateral", findingsText: "Broad-based disc bulge L4-L5 with bilateral lateral recess narrowing." },
      { id: "o4", concept: "facet_arthropathy", level: "L4-L5", laterality: "bilateral", findingsText: L45_FACET },
      { id: "o5", concept: "canal_ap", level: "L4-L5", measurement: "9 mm", findingsText: "AP canal diameter 9 mm at L4-L5." },
    ],
    jobKindHint: "SECTION_EDIT",
  });
}

describe("a refinement cannot delete a finding", () => {
  const snap = snapshotFor(BASE_FINDINGS);

  it("catches the version that drops the facet arthropathy sentence", () => {
    const v = validateComposerOutput(snap, {
      findings: BASE_FINDINGS.replace(L45_FACET, "").replace(/\n{2,}/g, "\n"),
      impression: "Multilevel degenerative disc disease.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).toContain("observation_dropped");
    expect(v.ok).toBe(false);
    expect(v.warnings.join(" ")).toMatch(/facet arthropathy/);
  });

  it("catches it when the observation is reworded into nonsense instead of removed", () => {
    const v = validateComposerOutput(snap, {
      findings: BASE_FINDINGS.replace(L45_FACET, "Small joints are unremarkable."),
      impression: "Multilevel degenerative disc disease.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).toContain("observation_dropped");
  });

  it("passes a professional rewrite that keeps every statement", () => {
    const v = validateComposerOutput(snap, {
      findings: [
        "Loss of the normal lumbar lordosis.",
        "Desiccated discs from L2-L3 through L5-S1.",
        "Broad-based disc bulge at L4-L5, producing bilateral lateral recess narrowing.",
        L45_FACET,
        "The AP canal diameter measures 9 mm at L4-L5.",
      ].join("\n"),
      impression: "Multilevel degenerative disc disease, most marked at L4-L5.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).not.toContain("observation_dropped");
    expect(v.ok).toBe(true);
  });

  it("lets an impression-only refinement leave Findings alone", () => {
    const v = validateComposerOutput(snap, {
      findings: BASE_FINDINGS,
      impression: "Multilevel degenerative disc disease with bilateral L4-L5 lateral recess narrowing.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).not.toContain("observation_dropped");
    expect(v.ok).toBe(true);
  });

  it("counts an omitted field as untouched, because that is what Apply does", () => {
    // An empty field emits no tracked change, so the radiologist's own Findings
    // stand. Judging the raw draft instead would turn every "impression only"
    // response into an accusation that it deleted the Findings.
    const v = validateComposerOutput(snap, {
      findings: "",
      impression: "Multilevel degenerative disc disease.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).not.toContain("observation_dropped");
  });

  it("is not triggered by dropping a hedge with no clinical content of its own", () => {
    const withHedge = `${BASE_FINDINGS}\nFindings are as described above.`;
    const v = validateComposerOutput(snapshotFor(withHedge), {
      findings: BASE_FINDINGS,
      impression: "Multilevel degenerative disc disease.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).not.toContain("observation_dropped");
  });

  it("does not demand that every ledger row reach the prose", () => {
    // The ledger holds more rows than a report quotes. This guard protects text the
    // radiologist already wrote; it is not a completeness rule for the ledger.
    const snap = snapshotFor(BASE_FINDINGS);
    snap.observations = [
      ...(snap.observations ?? []),
      { id: "o9", concept: "sacralisation", level: "L5", findingsText: "Sacralisation of L5 with transitional vertebral segmentation." },
    ];
    const v = validateComposerOutput(snap, {
      findings: BASE_FINDINGS,
      impression: "Multilevel degenerative disc disease.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).not.toContain("observation_dropped");
  });

  it("stays out of TRANSLATE, which is expected to replace every English word", () => {
    const snap = snapshotFor(BASE_FINDINGS);
    snap.jobKindHint = "TRANSLATE";
    snap.targetLanguage = "de";
    const v = validateComposerOutput(snap, {
      findings: "Verlust der normalen Lendenlordose. Degenerative Discopathia in mehreren Segmenten.",
      impression: "Multilevel degenerative disc disease.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).not.toContain("observation_dropped");
  });

  it("reports a dropped measurement twice, by both rules that cover it", () => {
    const v = validateComposerOutput(snap, {
      findings: BASE_FINDINGS.replace("AP canal diameter 9 mm at L4-L5.", ""),
      impression: "Multilevel degenerative disc disease.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).toContain("measurement_mutation");
    expect(v.errors).toContain("observation_dropped");
  });
});

describe("the refinement instruction and target reach the model intact", () => {
  const instruction = "Organise the findings by anatomical level and add the canal measurement table";

  it("sends the instruction as the radiologist wrote it", () => {
    const snap = snapshotFor(BASE_FINDINGS);
    const prompt = buildUserPrompt("SECTION_EDIT" as AiComposeJobKind, {
      ...snap,
      instruction,
      selectionText: `FINDINGS:\n${BASE_FINDINGS}`,
      selectionField: "FINDINGS",
    });
    expect(prompt).toContain(instruction);
    expect(prompt).toContain(L45_FACET);
  });

  it("does not truncate a long target the way the old 800-character slice did", () => {
    const tail = "Incidental 14 mm exophytic cyst on the right lower pole of the kidney.";
    const long = `${Array.from({ length: 40 }, (_unused, i) => `Level position ${i}: preserved disc height and signal.`).join(" ")} ${tail}`;
    const snap = snapshotFor(BASE_FINDINGS);
    const prompt = buildUserPrompt("SECTION_EDIT" as AiComposeJobKind, {
      ...snap,
      instruction: "Expand the findings",
      selectionText: long,
      selectionField: "FINDINGS",
    });
    expect(long.length).toBeGreaterThan(1200);
    expect(prompt).toContain(tail);
  });

  it("tells the model what it may never do to clinical content", () => {
    const prompt = buildCareSystemPrompt("SECTION_EDIT" as AiComposeJobKind, snapshotFor(BASE_FINDINGS));
    expect(prompt).toMatch(/Refining wording never removes clinical content/);
    expect(prompt).toMatch(/an omitted\s+field is a deleted finding/);
    expect(prompt).toMatch(/never one merged block/);
    expect(prompt).toMatch(/do NOT comply and do NOT guess/);
    expect(prompt).toMatch(/say why in unresolvedQuestions/);
  });
});

/**
 * Step 6 of the second prompt: three instructions in a row, each applied to what
 * the previous accepted revision actually said. No conversation store — the draft
 * is the memory, so this proves the loop by rebuilding the snapshot from the
 * accepted text, exactly as the workspace does after Apply.
 */
describe("successive refinements work on the current draft", () => {
  const snap1 = snapshotFor(BASE_FINDINGS);

  it("instruction 2 sees the text instruction 1 produced", () => {
    // The first accepted revision moves the facet finding under its own sub-heading
    // and leaves it nowhere else — so from then on, that heading block is the only
    // place the statement exists.
    const revisedFindings = [
      BASE_FINDINGS.replace(L45_FACET, "").replace(/\n{2,}/g, "\n"),
      "Facets & Ligaments:",
      L45_FACET,
    ].join("\n");
    const changes = buildTrackedChanges({
      jobId: 1,
      originalFindings: snap1.findings,
      originalImpression: snap1.impression,
      originalRecommendation: snap1.recommendation,
      draft: {
        findings: revisedFindings, impression: snap1.impression, recommendation: "",
        unresolvedQuestions: [], warnings: [],
      },
    });
    const accepted = changes.map((c) => ({ ...c, reviewState: "ACCEPTED" as const }));
    const merged = materializeAcceptedText({
      currentFindings: snap1.findings,
      currentImpression: snap1.impression,
      currentRecommendation: snap1.recommendation,
      changes: accepted,
    });
    expect(merged.findings).toContain("Facets & Ligaments:");

    // The next instruction is built from what the editor now says — not from the
    // original draft, and not from anything cached about it.
    const snap2 = snapshotFor(merged.findings);
    const prompt = buildUserPrompt("SECTION_EDIT" as AiComposeJobKind, {
      ...snap2,
      instruction: "Shorten the impression",
      selectionText: `FINDINGS:\n${snap2.findings}\n\nIMPRESSION:\n${snap2.impression}`,
      selectionField: "FINDINGS",
    });
    expect(prompt).toContain("Facets & Ligaments:");

    // And the second-generation draft still cannot lose the facet finding, even
    // though it now sits under a heading the first pass invented.
    const v = validateComposerOutput(snap2, {
      findings: merged.findings
        .replace(L45_FACET, "")
        .replace("Facets & Ligaments:", "")
        .replace(/\n{2,}/g, "\n"),
      impression: "Multilevel degenerative disc disease.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).toContain("observation_dropped");
  });

  it("does not call a reworded finding lost because its sub-heading is the only match", () => {
    // Deliberate conservatism. The persona is told to organise spine findings under
    // sub-headings, so "Facets & Ligaments:" plus a body that says "hypertrophic
    // change with lateral recess narrowing" keeps the body-part word in the heading
    // while the statement is still there in other words. Refusing that would fail
    // the reorganisation the prompt asks for; the per-change review is the boundary
    // for a heading whose body really did go empty.
    const relocated = [
      BASE_FINDINGS.replace(L45_FACET, "").replace(/\n{2,}/g, "\n"),
      "Facets & Ligaments:",
      "Hypertrophic change at L4-L5 and L5-S1 with bilateral lateral recess narrowing.",
    ].join("\n");
    const v = validateComposerOutput(snapshotFor(BASE_FINDINGS), {
      findings: relocated,
      impression: "Multilevel degenerative disc disease.",
      recommendation: "",
      unresolvedQuestions: [],
      warnings: [],
    });
    expect(v.errors).not.toContain("observation_dropped");
  });
});
