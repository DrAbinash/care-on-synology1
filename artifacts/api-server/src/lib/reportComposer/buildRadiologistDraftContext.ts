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
    findingsText: string;
    impressionText?: string;
    recommendationText?: string;
  }>;
  measurements: string[];
  protectedManualText: {
    findings: string;
    impression: string;
    recommendation: string;
  };
  technique: string;
  normalScaffoldHint: boolean;
  screeningWordingRequired: boolean;
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
    findingsText: o.findingsText,
    impressionText: o.impressionText,
    recommendationText: o.recommendationText,
  };
}

/**
 * Build the radiologist draft context from a frozen composer snapshot.
 */
export function buildRadiologistDraftContext(
  snapshot: ComposerInputSnapshot,
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
    protectedManualText: {
      findings: findings,
      impression: (snapshot.impression ?? "").trim(),
      recommendation: (snapshot.recommendation ?? "").trim(),
    },
    technique: (snapshot.technique ?? "").trim(),
    normalScaffoldHint,
    screeningWordingRequired: screening,
  };
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
    "MEASUREMENTS (preserve exact numbers and units)",
    ctx.measurements.length ? ctx.measurements.map((m) => `- ${m}`).join("\n") : "(none extracted)",
    "",
    task,
  ].join("\n");
}
