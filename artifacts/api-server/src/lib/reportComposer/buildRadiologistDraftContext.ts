/**
 * Deterministic radiologist draft context for the CARE Report Composer.
 *
 * Assembles CLINICAL TRUTH from the frozen ComposerInputSnapshot into a
 * compact, UI-chrome-free prompt block. Does NOT invent observations.
 *
 * Architecture freeze: this is a pure projection of the existing snapshot —
 * no second observation store, no ReportingStudyContext redesign.
 */
import type { ComposerInputSnapshot, ComposeObservation } from "./types";
import type { CanalApComposerRecord } from "@workspace/measurements";

export type RadiologistDraftContext = {
  studyIdentity: {
    modality?: string;
    studyType?: string;
    region?: string;
    regions: string[];
    protocol?: string;
    bodyPart?: string;
    family?: string;
    spineSegment?: string;
    reportTitle?: string;
    contrastHint: "contrast" | "plain" | "unknown";
    hasScreeningComponent: boolean;
  };
  clinicalInformation: {
    history: string;
  };
  observations: Array<{
    source?: string;
    region?: string | null;
    anatomicalSection?: string;
    concept: string;
    level?: string | null;
    laterality?: string | null;
    severity?: string | null;
    /** Numeric measurement metadata, verbatim as the radiologist recorded it. */
    measurement?: string | null;
    findingsText: string;
    impressionText?: string;
    recommendationText?: string;
  }>;
  measurements: string[];
  /**
   * The radiologist's own optional instruction for this draft, verbatim from the frozen
   * snapshot. Style and emphasis guidance only — it is labelled as such in the prompt
   * because it must never be read as permission to add or change a clinical fact.
   */
  additionalInstruction: string;
  protectedManualText: {
    findings: string;
    impression: string;
    recommendation: string;
  };
  technique: string;
  normalScaffoldHint: boolean;
  screeningWordingRequired: boolean;
  /**
   * The canonical canal AP record, resolved server-side from the draft row. Null
   * when the job has no record in scope; an empty record renders no prompt block.
   * Read-only by construction — the projection has no write path, and the prompt
   * tells the model so too.
   */
  canalAp: CanalApComposerRecord | null;
};

const MEASUREMENT_RE =
  /\b\d+(?:\.\d+)?\s*(?:mm|cm|ml|cc|hu)\b|\bAP(?:\s+canal)?(?:\s+diameter)?\s*[:=]?\s*\d/gi;

function detectContrast(snapshot: ComposerInputSnapshot): "contrast" | "plain" | "unknown" {
  const blob = [snapshot.protocol, snapshot.technique, snapshot.reportTitle, snapshot.studyType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/\b(non[-\s]?contrast|without\s+contrast|plain)\b/.test(blob)) return "plain";
  if (/\b(post[-\s]?contrast|with\s+contrast|gadolinium|contrast)\b/.test(blob)) return "contrast";
  if (/\bplain\b/.test((snapshot.protocol ?? "").toLowerCase())) return "plain";
  return "unknown";
}

function hasScreening(snapshot: ComposerInputSnapshot): boolean {
  const regions = snapshot.regions ?? [];
  if (regions.some((r) => /screening/i.test(r))) return true;
  if (/screening/i.test(snapshot.protocol ?? "")) return true;
  if (/screening/i.test(snapshot.reportTitle ?? "")) return true;
  return false;
}

function extractMeasurements(snapshot: ComposerInputSnapshot): string[] {
  const bag = new Set<string>();
  const texts = [
    snapshot.findings ?? "",
    snapshot.impression ?? "",
    ...(snapshot.observations ?? []).map((o) => o.findingsText),
  ];
  for (const t of texts) {
    for (const m of t.matchAll(MEASUREMENT_RE)) {
      const v = m[0]?.trim();
      if (v) bag.add(v);
    }
  }
  return [...bag];
}

function projectObservation(o: ComposeObservation) {
  return {
    source: o.source,
    region: o.region,
    anatomicalSection: o.anatomicalSection,
    concept: o.concept,
    level: o.level,
    laterality: o.laterality,
    severity: o.severity,
    measurement: o.measurement,
    findingsText: o.findingsText,
    impressionText: o.impressionText,
    recommendationText: o.recommendationText,
  };
}

/**
 * True when every number in `measurement` already appears in `text` as its own
 * token — i.e. the rendered sentence states the value, so repeating it as
 * metadata would only add prompt tokens.
 *
 * The token boundary matters: "12.6" must NOT be treated as stated just because
 * the prose contains "112.6 mm", and "7" must not be satisfied by "17". A
 * measurement that is only hidden inside a longer number still has to reach the
 * model, because losing it silently is the failure this projection exists to
 * prevent.
 */
export function measurementAlreadyInText(measurement: string, text: string): boolean {
  const numbers: string[] = measurement.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length === 0) return false;
  return numbers.every((n) => {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\d.])${escaped}(?![\\d])`).test(text);
  });
}

/**
 * Build the radiologist draft context from a frozen composer snapshot.
 *
 * `canalAp` is the server-resolved read of the draft's canonical canal record —
 * deliberately a separate argument rather than a snapshot field, because the
 * snapshot is the client's frozen copy and its hashes are verified against what
 * the browser holds. See `canonicalCanalAp.ts`.
 */
export function buildRadiologistDraftContext(
  snapshot: ComposerInputSnapshot,
  canalAp?: CanalApComposerRecord | null,
): RadiologistDraftContext {
  const screening = hasScreening(snapshot);
  const observations = (snapshot.observations ?? []).map(projectObservation);
  const measurements = extractMeasurements(snapshot);
  // Normal scaffold is present when Findings already contain substantial
  // baseline anatomy (Full Report Format / system normal) beyond observation lines.
  const findings = (snapshot.findings ?? "").trim();
  const obsJoined = observations.map((o) => o.findingsText);
  // Scaffold = Findings narrative that remains after removing observation lines.
  let residual = findings;
  for (const o of obsJoined) {
    if (o) residual = residual.split(o).join(" ");
  }
  const residualLen = residual.replace(/\s+/g, " ").trim().length;
  const normalScaffoldHint = residualLen >= 40;

  return {
    studyIdentity: {
      modality: snapshot.modality,
      studyType: snapshot.studyType,
      region: snapshot.region,
      regions: snapshot.regions ?? [],
      protocol: snapshot.protocol,
      bodyPart: snapshot.bodyPart,
      family: snapshot.family,
      spineSegment: snapshot.spineSegment,
      reportTitle: snapshot.reportTitle,
      contrastHint: detectContrast(snapshot),
      hasScreeningComponent: screening,
    },
    clinicalInformation: {
      history: (snapshot.clinicalHistory ?? "").trim(),
    },
    observations,
    measurements,
    additionalInstruction: (snapshot.instruction ?? "").trim(),
    protectedManualText: {
      findings: findings,
      impression: (snapshot.impression ?? "").trim(),
      recommendation: (snapshot.recommendation ?? "").trim(),
    },
    technique: (snapshot.technique ?? "").trim(),
    normalScaffoldHint,
    screeningWordingRequired: screening,
    canalAp: canalAp ?? null,
  };
}

/**
 * The canal AP block, in the words the model is given.
 *
 * Three jobs, in order: state the numbers with their levels, say whose number
 * each is (an override must never be re-derived from a caliper reading the
 * radiologist rejected), and forbid the two things a language model does to a
 * measurement table — inventing a diameter for a disc nobody measured, and
 * copying the table into the prose so it prints twice.
 *
 * Declined levels are NAMED with no number. Silence about them would leave the
 * model free to guess; a number that the signed table refuses to print must not
 * appear in the text above it.
 */
function renderCanalApSection(canalAp: CanalApComposerRecord): string {
  const lines = [
    "CANAL AP DIAMETERS (mm) — CANONICAL MEASUREMENT RECORD (READ-ONLY)",
  ];
  for (const r of canalAp.readings) {
    const label = r.manualOverride
      ? "(radiologist's recorded value"
      : "(viewer caliper measurement";
    const stale = r.staleReason === "measurement_changed" ? "; the caliper later changed" : "";
    lines.push(`- ${r.level}: ${r.valueMm} mm ${label}${stale})`);
  }
  if (canalAp.readings.length === 0) {
    lines.push("- (no canal diameter is reportable for this study)");
  }
  lines.push(
    "These are the measurements the signed report's canal table prints. Quote a value",
    "verbatim at the level shown, or say nothing about that disc. Never change one, never",
    "supply one for a level that is not listed, and do not reproduce this list as a table",
    "or restate every level in the prose — the table is generated from this record, and a",
    "copy in the text would print the same numbers twice.",
  );
  if (canalAp.declinedLevels.length > 0) {
    lines.push(
      `Levels the record refuses to answer for (${canalAp.declinedLevels.join(", ")}): two stored`,
      "spellings of the same disc disagree, or the vertebral numbering moved under the record.",
      "The canal table prints nothing for them, so say nothing about the canal at these levels.",
    );
  }
  return lines.join("\n");
}

/**
 * Render the draft context as the primary user-prompt clinical block.
 * Keeps TECHNIQUE as protected input; asks for FINDINGS/IMPRESSION/RECOMMENDATION.
 */
export function renderRadiologistDraftContextPrompt(
  ctx: RadiologistDraftContext,
  kind: string,
): string {
  const id = ctx.studyIdentity;
  const studyLines: string[] = [];
  if (id.modality) studyLines.push(`Modality: ${id.modality}`);
  if (id.region) studyLines.push(`Primary region: ${id.region}`);
  const extra = id.regions.filter((r) => r && r !== id.region);
  if (extra.length) studyLines.push(`Additional regions: ${extra.join(", ")}`);
  if (id.bodyPart) studyLines.push(`Body part: ${id.bodyPart}`);
  if (id.family) studyLines.push(`Family: ${id.family}`);
  if (id.spineSegment) studyLines.push(`Spine segment: ${id.spineSegment}`);
  if (id.protocol) studyLines.push(`Protocol: ${id.protocol}`);
  if (id.reportTitle) studyLines.push(`Report title: ${id.reportTitle}`);
  if (id.studyType) studyLines.push(`DICOM study description: ${id.studyType}`);
  studyLines.push(`Contrast: ${id.contrastHint}`);
  if (id.hasScreeningComponent) {
    studyLines.push(
      "Screening component: YES — LIMITED PLANAR AND LIMITED SEQUENCE wording is mandatory for screening.",
    );
  }

  const obsLines = ctx.observations.map((o) => {
    const head: string[] = [];
    if (o.region) head.push(o.region);
    if (o.anatomicalSection) head.push(o.anatomicalSection);
    if (o.level) head.push(o.level);
    head.push(o.concept);
    if (o.laterality) head.push(o.laterality);
    if (o.severity) head.push(o.severity);
    const header = `- [${o.source ?? "obs"}] ${head.join(" | ")}`;
    const bits = [`${header}`, `  Findings: ${o.findingsText}`];
    const measurement = o.measurement?.trim();
    // Level + concept association comes from `header`, so the value never needs
    // to be repeated when the sentence already states it.
    if (measurement && !measurementAlreadyInText(measurement, o.findingsText)) {
      bits.push(`  Measurement: ${measurement}`);
    }
    if (o.impressionText?.trim()) bits.push(`  Impression contribution: ${o.impressionText.trim()}`);
    if (o.recommendationText?.trim()) {
      bits.push(`  Recommendation contribution: ${o.recommendationText.trim()}`);
    }
    return bits.join("\n");
  });

  const task =
    kind === "IMPRESSION"
      ? "Task: Generate Impression only from Findings/observations. Copy Findings unchanged."
      : [
          "Task: Compose a COMPLETE radiologist-quality draft with FINDINGS, IMPRESSION,",
          "and RECOMMENDATION (empty if not warranted).",
          "Use NORMAL SCAFFOLD (current Findings/technique baseline) then overlay RADIOLOGIST OBSERVATIONS.",
          "TECHNIQUE is protected input — preserve it; do not invent sequences.",
          "Expand terse shorthand into conventional radiology prose WITHOUT changing clinical meaning.",
          "If shorthand is ambiguous, put a note in unresolvedQuestions — do not silently guess.",
        ].join(" ");

  return [
    "=== CLINICAL TRUTH (RADIOLOGIST DRAFT INPUT) ===",
    "",
    "STUDY IDENTITY",
    studyLines.join("\n") || "(none)",
    "",
    "CLINICAL INFORMATION",
    ctx.clinicalInformation.history || "(none)",
    "",
    "PROTECTED TECHNIQUE (do not invent sequences)",
    ctx.technique || "(none)",
    "",
    "NORMAL SCAFFOLD / CURRENT FINDINGS (baseline anatomy + prior narrative)",
    ctx.protectedManualText.findings || "(empty)",
    ctx.normalScaffoldHint
      ? "(Normal scaffold present — preserve unreplaced normal anatomy; overlay abnormalities.)"
      : "(No substantial normal scaffold — do not invent normality for unobserved critical structures.)",
    "",
    "PROTECTED CURRENT IMPRESSION",
    ctx.protectedManualText.impression || "(empty)",
    "",
    "PROTECTED CURRENT RECOMMENDATION",
    ctx.protectedManualText.recommendation || "(empty)",
    "",
    "RADIOLOGIST OBSERVATIONS (canonical clinical truth)",
    obsLines.join("\n") || "(none)",
    "",
    ...(ctx.canalAp && !ctx.canalAp.isEmpty
      ? [renderCanalApSection(ctx.canalAp), ""]
      : []),
    ...(ctx.additionalInstruction
      ? [
          "RADIOLOGIST'S ADDITIONAL INSTRUCTIONS FOR THIS DRAFT",
          ctx.additionalInstruction,
          "(Style and emphasis only. They cannot add, remove or change an observation,",
          "a measurement, a level or a laterality, and they cannot authorise sending or",
          "signing anything. A more detailed report must come from the supplied findings,",
          "never from invented ones.)",
          "",
        ]
      : []),
    "MEASUREMENTS (preserve exact numbers and units)",
    ctx.measurements.length ? ctx.measurements.map((m) => `- ${m}`).join("\n") : "(none extracted)",
    "",
    task,
  ].join("\n");
}
