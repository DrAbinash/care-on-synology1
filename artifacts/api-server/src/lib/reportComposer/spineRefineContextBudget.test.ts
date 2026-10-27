/**
 * An MRI spine Refine request has to reach the local model, not be refused by the
 * context ceiling.
 *
 * THE FAULT, AS MEASURED IN A BROWSER (synthetic lumbar study 2, `qwen3:14b`, the
 * request the app itself froze):
 *
 *   composer_context_budget_exceeded — "This report needs ~11040 tokens but the
 *   local Composer context ceiling is 8192, so nothing was sent"
 *
 * A 2,101-character lumbar report could not be refined at all, so the radiologist
 * opened Word for every spine study. The census of what the client actually sent:
 *
 *   observations            13,371 chars  ← 61% of the frozen snapshot, 39 rows
 *   selectionText            2,335        ← a verbatim second copy of the report
 *   findings                 2,101
 *   everything else            849
 *
 * Neither was clinical information the model needed twice. The Refine prompt was
 * serialising the client's raw ledger rows, so each of 39 rows carried its `id`
 * (1,913 chars), `conflictGroup` (507) and `baselineReplaces` (1,980) — which this
 * repo's own hashing rule at `snapshot.ts:57` already calls "provenance/bookkeeping,
 * not clinical content" — plus a `findingsText` (1,980) whose every sentence is
 * present in the Findings the same prompt already carries.
 *
 * THE THREE CUTS, all in prompt construction, none of them a limit raise:
 *   1. the ledger renders with `observationLedgerLines`, the shape the whole-report
 *      prompt has always used, instead of the client's row objects;
 *   2. a row whose sentence the report already states arrives with its slots
 *      (region, section, level, concept, laterality, severity) and not the sentence;
 *   3. the labelled whole draft stops being re-sent as a "selection" when the
 *      radiologist did not highlight anything.
 * Measured through the real builders on the snapshot the SERVER stored for the refused
 * request (21,460 characters): user prompt 19,024 → 5,665 characters, required
 * 11,109 → 6,101 tokens against the same 8,192 ceiling — refused → fits with 2,091
 * tokens to spare, with not one clinical value missing from the prompt. The longest
 * genuine spine report in this repo's audit corpus (MRI cervical, 2,872 characters of
 * Findings, 53 rows) prices at 5,972.
 *
 * WHAT MUST NOT BE TRADED AWAY: not one level, side, severity, measurement, concept,
 * region or sentence the report does not already state. The token limits are NOT
 * raised here either — the ceiling is still 8192, and a report genuinely too long for
 * it still refuses rather than silently truncating (see `composerContextBudget.ts`:
 * "the one outcome a radiology draft must never have").
 */
import { describe, expect, it } from "vitest";
import { buildUserPrompt } from "./composeEngine";
import { buildCareSystemPrompt } from "./persona";
import { planComposerTextContext } from "./composerContextBudget";
import { observationLedgerLines } from "./buildRadiologistDraftContext";
import { ComposerInputSnapshotSchema, type ComposerInputSnapshot } from "./types";
import type { ComposeObservation } from "./types";

/** The local window the clinic runs today (`ollama_composer_num_ctx`, clamped at 8192). */
const LOCAL_CEILING = 8192;

const LUMBAR_LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"];

/**
 * A lumbar report of the size the clinic actually reads: a per-level normal
 * scaffold of about two thousand characters, and one structured ledger row per
 * statement — the shape the browser froze (39 rows against 2,101 characters).
 */
function spineRefineSnapshot(): ComposerInputSnapshot {
  const sections: Array<{ heading: string; sentences: string[] }> = [
    { heading: "Alignment", sentences: [
      "Normal lumbar lordosis is maintained.",
      "No listhesis or vertebral translation is seen."] },
    { heading: "Vertebral Bodies", sentences: [
      "Normal marrow signal throughout the lumbar vertebral bodies.",
      "No fracture, lytic or blastic lesion is identified."] },
    ...LUMBAR_LEVELS.map((level) => ({
      heading: `${level}:`,
      sentences: [
        `Disc height and signal are preserved at ${level}. No disc bulge or protrusion at ${level}.`,
        `The thecal sac and both neural foramina are patent at ${level}. No lateral recess stenosis at ${level}.`,
        `The facet joints at ${level} show no arthropathy or effusion, and the ligamentum flavum is not thickened.`,
        `Endplate marrow change is minimal at ${level}, without Modic type I or II signal.`,
        `The central canal caliber is normal at ${level}, with no cauda equina nerve root compression.`,
      ],
    })),
    { heading: "Conus Medullaris", sentences: [
      "Conus terminates at L1 with normal signal.",
      "The filum terminale is not thickened."] },
    { heading: "Paraspinal Soft Tissues", sentences: [
      "The paraspinal and psoas musculature is unremarkable.",
      "No presacral or paravertebral mass is seen."] },
    { heading: "Sacroiliac Joints", sentences: [
      "Both sacroiliac joints show normal signal.",
      "No erosive or inflammatory change is seen."] },
  ];
  const findings = sections
    .map((s) => `${s.heading}:\n${s.sentences.join(" ")}`)
    .join("\n\n");
  const rows: ComposeObservation[] = sections.flatMap((s, si) => s.sentences.map((line, li) => ({
    id: `baseline:mri-ls-standard-normal-r1:${si}-${li}`,
    concept: `structure_${si}_${li}`,
    region: "LS Spine",
    anatomicalSection: `section_${si}`,
    conflictGroup: `group_${si}`,
    baselineReplaces: line,
    source: "structured",
    findingsText: line,
    level: LUMBAR_LEVELS[si % LUMBAR_LEVELS.length],
    // Two rows carry the facts a spine report is judged on. They must survive.
    ...(si === 3 ? { laterality: "left", severity: "mild" } : {}),
    ...(si === 7 ? { measurement: "12.6 mm", laterality: "right" } : {}),
  })));
  const report = {
    modality: "MR",
    region: "LS Spine",
    regions: ["LS Spine"],
    bodyPart: "SPINE_LUMBAR",
    family: "spine",
    spineSegment: "lumbar",
    studyType: "MRI LS Spine",
    protocol: "Plain",
    reportTitle: "MRI LUMBOSACRAL SPINE",
    clinicalHistory: "Low back pain with left L5 radicular referral.",
    technique: "Multiplanar multisequence non-contrast MRI of the lumbar spine.",
    findings,
    impression: "Normal MRI of the lumbar spine. No disc herniation or canal stenosis.",
    recommendation: "Clinical correlation is advised.",
    observations: rows,
    jobKindHint: "SECTION_EDIT",
    aiMode: "TEXT_ONLY",
    selectedKeyImages: [],
  };
  return ComposerInputSnapshotSchema.parse({
    ...report,
    // No sentence was highlighted, so the target is the whole draft — which is what
    // `resolveRefineTarget` writes into `selectionText`, labels and all.
    selectionField: "FINDINGS",
    selectionText: [
      `FINDINGS:\n${report.findings}`,
      `IMPRESSION:\n${report.impression}`,
      `RECOMMENDATION:\n${report.recommendation}`,
    ].join("\n\n"),
    instruction: "Rewrite the findings in plainer English, keeping every clinical fact.",
  });
}

const textPlan = (snapshot: ComposerInputSnapshot) => planComposerTextContext({
  systemPrompt: buildCareSystemPrompt("SECTION_EDIT", snapshot),
  userPrompt: buildUserPrompt("SECTION_EDIT", snapshot, null),
  transport: "ollama",
  configuredNumCtx: LOCAL_CEILING,
});

/** Size a prompt pair the way the send does, so a fix can be priced against its own alternative. */
const planPrompts = (systemPrompt: string, userPrompt: string) => planComposerTextContext({
  systemPrompt,
  userPrompt,
  transport: "ollama",
  configuredNumCtx: LOCAL_CEILING,
});

describe("a spine Refine request fits the window the clinic actually runs", () => {
  it("the measured lumbar shape now fits under 8192, unfilled", () => {
    const snapshot = spineRefineSnapshot();
    // The fixture has to stay the size of the request that was refused, or the fit
    // below proves nothing. Measured in the browser: 2,101 characters of Findings and
    // a 39-row ledger, needing ~11,040 tokens against a ceiling of 8,192.
    expect(String(snapshot.findings).length).toBeGreaterThan(2000);
    expect(snapshot.observations?.length).toBeGreaterThanOrEqual(35);
    const plan = textPlan(snapshot);
    expect(plan.fits).toBe(true);
    expect(plan.requiredTokens).toBeLessThanOrEqual(LOCAL_CEILING);
    // Guard against the fix being "raise the ceiling": this is the ceiling the
    // refusal named, and the planner's own reason says so.
    expect(plan.ceilingTokens).toBe(LOCAL_CEILING);
  });

  it("not one clinical value is dropped on the way", () => {
    const snapshot = spineRefineSnapshot();
    const prompt = buildUserPrompt("SECTION_EDIT", snapshot, null);
    const missing: string[] = [];
    for (const o of snapshot.observations ?? []) {
      for (const [field, value] of Object.entries(o)) {
        if (typeof value !== "string" || !value.trim()) continue;
        if (["id", "conflictGroup", "baselineReplaces"].includes(field)) continue;
        if (!prompt.includes(value)) missing.push(`${field}=${value.slice(0, 48)}`);
      }
    }
    expect(missing).toEqual([]);
    // Spinal levels, sides, severities and a measured value are the facts a spine
    // report is judged on; name them rather than trusting the loop above.
    for (const level of LUMBAR_LEVELS) expect(prompt).toContain(level);
    expect(prompt).toContain("left");
    expect(prompt).toContain("mild");
    expect(prompt).toContain("12.6 mm");
    expect(prompt).toContain("right");
  });

  it("the bookkeeping columns are what left, and only they", () => {
    const snapshot = spineRefineSnapshot();
    const prompt = buildUserPrompt("SECTION_EDIT", snapshot, null);
    expect(prompt).not.toContain("baseline:mri-ls-standard-normal-r1:0-0");
    expect(prompt).not.toContain("group_0");
    // Read the request the way the model receives it: the JSON it is told to answer,
    // not a substring hunt through an escaped string (a real newline never appears in
    // the serialised form).
    const sent = JSON.parse(prompt) as {
      observations: string[];
      observationCount: number;
      groundingFindings: string;
    };
    expect(sent.groundingFindings).toBe(snapshot.findings);
    expect(sent.groundingFindings).toContain("No disc bulge or protrusion at L4-L5.");
    expect(sent.observationCount).toBe(snapshot.observations?.length);
    // The ledger the model sees is exactly the shared rendering — the same lines the
    // whole-report prompt sends, so one spine report reads itself the same way at
    // both doors, including the row-level rule that a sentence the report already
    // carries is not carried a second time.
    expect(sent.observations).toEqual(
      observationLedgerLines(
        snapshot.observations ?? [],
        [snapshot.findings, snapshot.impression, snapshot.recommendation].join("\n"),
      ),
    );
    expect(sent.observations.length).toBe(snapshot.observations?.length);
  });

  it("a real selection still reaches the model, in full", () => {
    const base = spineRefineSnapshot();
    const selected = "Disc height and signal are preserved at L3-L4.";
    const snapshot = ComposerInputSnapshotSchema.parse({
      ...base,
      selectionText: selected,
      selectionField: "FINDINGS",
    });
    const prompt = buildUserPrompt("SECTION_EDIT", snapshot, null);
    expect(prompt).toContain(selected);
    expect(prompt).toContain("answerScope");
    expect(prompt).toContain("COMPLETE FINDINGS section");
  });

  it("the labelled whole draft is not sent a second time as a selection", () => {
    const snapshot = spineRefineSnapshot();
    const parsed = JSON.parse(buildUserPrompt("SECTION_EDIT", snapshot, null)) as {
      selectionText?: string;
      selectionField?: string;
      groundingFindings: string;
    };
    expect(parsed.selectionText).toBeUndefined();
    // The target is still named: which field it is, and that the answer must be the
    // whole section rather than one reworded sentence.
    expect(parsed.selectionField).toBe("FINDINGS");
    expect(parsed.groundingFindings).toBe(snapshot.findings);
    expect(buildUserPrompt("SECTION_EDIT", snapshot, null)).toContain("COMPLETE FINDINGS section");
  });

  it("a report genuinely too long for the window is still refused, never truncated", () => {
    const base = spineRefineSnapshot();
    const huge = ComposerInputSnapshotSchema.parse({
      ...base,
      findings: `${base.findings}\n${"Additional operative note sentence with levels L2-L4 and L5-S1. ".repeat(900)}`,
    });
    const plan = textPlan(huge);
    expect(plan.fits).toBe(false);
    expect(plan.requiredTokens).toBeGreaterThan(LOCAL_CEILING);
    // The refusal must name a way out that does not lose text.
    expect(plan.reason).toMatch(/nothing was sent|ceiling/i);
    // …and the prompt itself still carries the whole report, because cutting is not
    // what answers an oversized request.
    expect(buildUserPrompt("SECTION_EDIT", huge, null)).toContain("Additional operative note");
  });
});

/**
 * The row-level rule that buys the second half of the headroom: a ledger row whose
 * sentence the report already carries arrives with its slots and not its sentence.
 * Everything here is about what the rule must NOT do — fold a row the report does not
 * state, lose the level↔concept association, or drop a measurement only the row holds.
 */
describe("a row whose sentence the report already states", () => {
  const prose = [
    "Lumbar spine:\nDisc height and signal are preserved at L4-L5.",
    "The central canal caliber is normal at L4-L5.",
  ].join("\n\n");

  const row = (over: Partial<ComposeObservation>): ComposeObservation => ({
    id: "baseline:mri-ls-standard-normal-r1:0-0",
    concept: "disc_height",
    region: "LS Spine",
    source: "structured",
    findingsText: "Disc height and signal are preserved at L4-L5.",
    level: "L4-L5",
    ...over,
  });

  it("keeps every row the report does not state, verbatim", () => {
    const dictated = row({
      source: "voice",
      concept: "facet_arthropathy",
      findingsText: "Facet arthropathy with moderate effusion at L4-L5.",
      laterality: "left",
      severity: "moderate",
    });
    const lines = observationLedgerLines([row({}), dictated], prose);
    expect(lines[0]).not.toContain("Findings:");     // stated in the report already
    expect(lines[1]).toContain("Findings: Facet arthropathy with moderate effusion at L4-L5.");
    expect(lines[1]).toContain("| left | moderate");
  });

  it("keeps the level, region, concept and side association of the folded row", () => {
    const [line] = observationLedgerLines(
      [row({ laterality: "right", severity: "mild" })],
      prose,
    );
    expect(line).toBe("- [structured] LS Spine | L4-L5 | disc_height | right | mild");
  });

  it("keeps a measurement the sentence does not state", () => {
    const canal = row({
      concept: "canal_ap_diameter",
      findingsText: "The central canal caliber is normal at L4-L5.",
      measurement: "12.6 mm",
    });
    const [line] = observationLedgerLines([canal], prose);
    expect(line).toContain("Measurement: 12.6 mm");
  });

  it("still folds when the report wraps the sentence across lines", () => {
    const wrapped = "Disc height and signal are preserved\nat L4-L5.";
    expect(observationLedgerLines([row({ findingsText: wrapped })], prose)[0])
      .not.toContain("Findings:");
  });

  it("folds nothing at all when no report text is supplied", () => {
    // The function's own default: a caller that passes no prose gets the old rendering,
    // so the rule can only ever fire where the report is demonstrably present.
    expect(observationLedgerLines([row({})])[0])
      .toContain("Findings: Disc height and signal are preserved at L4-L5.");
  });

  it("carries the clinic's largest real spine report inside the window with room left", () => {
    // The shape of the longest genuine spine report in the audit corpus: an MRI
    // cervical study of 2,872 characters of Findings in 53 sentences, one ledger row
    // per sentence. Sized to match, because a fixture half the clinic's report says
    // nothing about the ceiling.
    const levels = ["C1-C2", "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1", "T1-T2", "T2-T3"];
    const linesPerLevel = [
      "Disc height and signal are preserved.",
      "No disc bulge, protrusion or extrusion is seen.",
      "The thecal sac and both neural foramina are patent.",
      "No lateral recess stenosis or nerve root compression is seen.",
      "The facet joints show no arthropathy or effusion.",
      "The ligamentum flavum is not thickened.",
    ];
    const findings = levels
      .map((l) => `${l}:\n${linesPerLevel.map((s) => `${s} at ${l}.`).join(" ")}`)
      .join("\n\n");
    const rows: ComposeObservation[] = levels.flatMap((level) =>
      linesPerLevel.map((s, i) => ({
        id: `baseline:mri-cvs-standard-normal-r1:${level}-${i}`,
        concept: `cervical_${i}`,
        region: "Cervical spine",
        source: "structured",
        level,
        findingsText: `${s} at ${level}.`,
      })),
    );
    const snapshot = ComposerInputSnapshotSchema.parse({
      modality: "MR", region: "Cervical spine", regions: ["Cervical spine"],
      bodyPart: "SPINE_CERVICAL", family: "spine", spineSegment: "cervical",
      studyType: "MRI Cervical Spine", protocol: "Plain",
      reportTitle: "MRI CERVICAL SPINE",
      technique: "Multiplanar multisequence non-contrast MRI of the cervical spine.",
      findings,
      impression: "Normal MRI of the cervical spine.",
      recommendation: "",
      observations: rows,
      selectionField: "FINDINGS",
      selectionText: `FINDINGS:\n${findings}\n\nIMPRESSION:\nNormal MRI of the cervical spine.`,
      instruction: "Rewrite in plainer English, keep every clinical fact.",
      jobKindHint: "SECTION_EDIT",
      aiMode: "TEXT_ONLY",
      selectedKeyImages: [],
    }) as ComposerInputSnapshot;

    expect(findings.length).toBeGreaterThanOrEqual(2600);
    expect(rows.length).toBeGreaterThanOrEqual(50);
    const plan = textPlan(snapshot);
    expect(plan.fits).toBe(true);
    expect(plan.requiredTokens).toBeLessThanOrEqual(LOCAL_CEILING);
    // Room left over, in the planner's own arithmetic — the number that decides
    // whether the next longer report is served or refused. Priced against the same
    // request with every row's sentence re-attached: the fold is not what turned this
    // report from refused to sent (the ledger rewrite was), it is the room that keeps
    // the next, longer study off the refusal list.
    const unfolded = JSON.stringify({
      ...JSON.parse(buildUserPrompt("SECTION_EDIT", snapshot, null)),
      observations: observationLedgerLines(rows),
    }, null, 0);
    const unfoldedPlan = planPrompts(buildCareSystemPrompt("SECTION_EDIT", snapshot), unfolded);
    expect(unfoldedPlan.requiredTokens - plan.requiredTokens).toBeGreaterThanOrEqual(1000);
    // At least 1,000 tokens spare on a report the size of the corpus's longest. In
    // the estimator's own arithmetic that is ~1,700 further characters of Findings
    // before the clinic's 8192 window bites again.
    expect(LOCAL_CEILING - plan.requiredTokens).toBeGreaterThanOrEqual(1000);

    const prompt = buildUserPrompt("SECTION_EDIT", snapshot, null);
    const missing: string[] = [];
    for (const o of snapshot.observations ?? []) {
      for (const [field, value] of Object.entries(o)) {
        if (typeof value !== "string" || !value.trim()) continue;
        if (["id", "conflictGroup", "baselineReplaces"].includes(field)) continue;
        if (!prompt.includes(value)) missing.push(`${field}=${value.slice(0, 40)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/**
 * The whole-report door (Generate Professional Report / Generate Impression) renders
 * through `renderRadiologistDraftContextPrompt`, which now folds the same way. Pinned
 * here because a door nobody tests is a door that silently regresses: this one sends
 * the report as a protected baseline AND the ledger, so the duplicate was the same
 * 2.4 KB of prose on the composing path too.
 */
describe("the whole-report door folds the identical way", () => {
  it("sends a sentence once and a row the report has not absorbed in full", () => {
    const base = spineRefineSnapshot();
    const rows = [...(base.observations ?? []), {
      id: "voice:unabsorbed-1",
      concept: "facet_arthropathy",
      region: "LS Spine",
      source: "voice",
      level: "L4-L5",
      laterality: "left",
      severity: "moderate",
      findingsText: "Facet arthropathy with moderate left-sided effusion at L4-L5.",
    }];
    const snapshot = ComposerInputSnapshotSchema.parse({ ...base, observations: rows });
    const prompt = buildUserPrompt("FULL_REPORT", snapshot, null);

    const alreadyStated = "Conus terminates at L1 with normal signal.";
    expect(prompt.split(alreadyStated).length - 1).toBe(1);
    expect(prompt).toContain(`Findings: ${rows[rows.length - 1].findingsText}`);
    expect(prompt).toContain("| left | moderate");
    // The baseline itself is never what gets folded: it is the protected text.
    expect(prompt).toContain(String(base.findings).slice(0, 120));
  });
});
