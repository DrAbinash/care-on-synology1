/**
 * AI input preview — what the Report Composer will actually receive, shown BEFORE anything
 * is sent.
 *
 * This is a pure projection of the frozen `ComposerInputSnapshot` that
 * `useReportComposer.buildSnapshot()` produces, which is the same object `enqueue()` sends
 * and the server freezes into the job row. It reads no second store and re-derives no
 * clinical fact: every line below comes from the canonical observation ledger or from the
 * study context the workspace already resolved.
 *
 * It is deliberately NOT a copy of the server prompt renderer
 * (`api-server/src/lib/reportComposer/buildRadiologistDraftContext.ts`) — duplicating that
 * projection in the browser would guarantee the two drift and the preview would start
 * lying. This shows the INPUT (what the model is given), the server owns the PROMPT (how it
 * is phrased).
 */
import type { ComposeObservation, ComposerInputSnapshot } from "./types";

export type ComposerInputPreview = {
  /** Counts for the collapsed one-liner in the panel. */
  observationCount: number;
  measurementCount: number;
  sourceCounts: Record<string, number>;
  supersededNormalCount: number;
  /** Screening is a limited study — the prompt must carry the qualifier. */
  screening: boolean;
  /** "Ollama (this session)" | "DeepSeek · model (this session)" | "Clinic default routing". */
  providerLabel: string;
  imageCount: number;
  aiMode: "TEXT_ONLY" | "SELECTED_IMAGES";
  /** Short fingerprints the server recomputes from the frozen snapshot. */
  reportRevision: string;
  inputHash: string;
  /** The whole input, as readable text, for the expandable block. */
  text: string;
};

const norm = (s: string | null | undefined): string =>
  (s ?? "").replace(/\s+/g, " ").trim();

const SHORT_HASH = 12;

function providerLabelOf(snapshot: ComposerInputSnapshot): string {
  const provider = norm(snapshot.sessionProvider);
  if (!provider) return "Clinic default routing (AI Settings → Model Routing)";
  const model = norm(snapshot.sessionModel);
  return `${provider}${model ? ` · ${model}` : ""} (this session only)`;
}

function sourceCountsOf(observations: ComposeObservation[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of observations) {
    const key = o.source ?? "structured";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * One observation, exactly as the model is given it: identity parts first, then the
 * radiologist's sentence, then anything the sentence alone does not carry (the numeric
 * measurement, the protected instruction, the impression/recommendation contribution).
 */
function renderObservation(o: ComposeObservation, index: number): string {
  const identity = [norm(o.region), norm(o.anatomicalSection), norm(o.level), o.concept, norm(o.laterality)]
    .filter(Boolean)
    .join(" | ");
  const bits = [`${index + 1}. [${o.source ?? "obs"}] ${identity}`, `   Findings: ${norm(o.findingsText)}`];
  if (norm(o.severity)) bits.push(`   Severity: ${norm(o.severity)}`);
  if (norm(o.measurement)) bits.push(`   Measurement: ${norm(o.measurement)}`);
  if (norm(o.impressionText)) bits.push(`   Impression contribution: ${norm(o.impressionText)}`);
  if (norm(o.recommendationText)) bits.push(`   Recommendation contribution: ${norm(o.recommendationText)}`);
  if (norm(o.baselineReplaces)) bits.push(`   Replaces this normal (do NOT keep it): ${norm(o.baselineReplaces)}`);
  return bits.join("\n");
}

export function buildComposerInputPreview(
  snapshot: ComposerInputSnapshot,
  hashes: { reportRevision: string; inputHash: string },
): ComposerInputPreview {
  const observations = snapshot.observations ?? [];
  const images = snapshot.selectedKeyImages ?? [];
  const screening =
    (snapshot.regions ?? []).some((r) => /screening/i.test(r)) ||
    /screening/i.test(snapshot.protocol ?? "") ||
    /screening/i.test(snapshot.reportTitle ?? "");
  const measurementList = observations.map((o) => norm(o.measurement)).filter(Boolean);

  const studyLines = [
    norm(snapshot.modality) && `Modality: ${norm(snapshot.modality)}`,
    norm(snapshot.region) && `Region: ${norm(snapshot.region)}`,
    (snapshot.regions ?? []).filter((r) => norm(r) && r !== snapshot.region).length > 0 &&
      `Additional regions: ${(snapshot.regions ?? []).filter((r) => norm(r) && r !== snapshot.region).join(", ")}`,
    norm(snapshot.bodyPart) && `Body part: ${norm(snapshot.bodyPart)}`,
    norm(snapshot.family) && `Family: ${norm(snapshot.family)}`,
    norm(snapshot.spineSegment) && `Spine segment: ${norm(snapshot.spineSegment)}`,
    norm(snapshot.protocol) && `Protocol: ${norm(snapshot.protocol)}`,
    norm(snapshot.reportTitle) && `Report title: ${norm(snapshot.reportTitle)}`,
    screening && "Screening component: YES — limited-planar / limited-sequence wording required",
  ]
    .filter(Boolean)
    .join("\n");

  const sections: string[] = [
    "STUDY IDENTITY",
    studyLines || "(none)",
    "",
    "CLINICAL HISTORY",
    norm(snapshot.clinicalHistory) || "(none)",
    "",
    "TECHNIQUE (protected — the AI may not invent sequences)",
    norm(snapshot.technique) || "(none)",
    "",
    `CONFIRMED OBSERVATIONS (${observations.length}) — from the canonical ledger`,
    observations.length
      ? observations.map(renderObservation).join("\n")
      : "(none — the AI has only the narrative below)",
    "",
    "MEASUREMENTS",
    measurementList.length ? measurementList.map((m) => `- ${m}`).join("\n") : "(none recorded)",
    "",
    "CURRENT REPORT TEXT THE AI MAY REWRITE",
    `Findings: ${norm(snapshot.findings) || "(empty)"}`,
    `Impression: ${norm(snapshot.impression) || "(empty)"}`,
    `Recommendation: ${norm(snapshot.recommendation) || "(empty)"}`,
  ];

  if (norm(snapshot.instruction)) {
    sections.push(
      "",
      "YOUR ADDITIONAL INSTRUCTIONS",
      norm(snapshot.instruction),
      "(style and emphasis only — they cannot change an observation or a measurement)",
    );
  }

  if (snapshot.aiMode === "SELECTED_IMAGES") {
    sections.push(
      "",
      `SELECTED IMAGES (${images.length})`,
      images.length
        ? images
            .map((r, i) =>
              [
                `${i + 1}. key image #${r.keyImageId}`,
                norm(r.seriesDescription) && `(${norm(r.seriesDescription)})`,
                norm(r.caption) && `— "${norm(r.caption)}"`,
                norm(r.sopInstanceUid) && `[SOP ${norm(r.sopInstanceUid)}]`,
              ]
                .filter(Boolean)
                .join(" "),
            )
            .join("\n")
        : "(none selected — this draft would be refused)",
    );
  } else {
    sections.push("", "SELECTED IMAGES", "(none — text-only draft from your observations)");
  }

  const text = [
    "=== WHAT THE AI RECEIVES ===",
    "",
    ...sections,
    "",
    "This is the clinical snapshot CARE freezes for the job — it is NOT necessarily the",
    "bytes that leave for a cloud provider. A cloud request passes CARE's PHI gate on top",
    "of this, which can redact text or refuse the send. Local Ollama is not gated as cloud.",
  ].join("\n");

  return {
    observationCount: observations.length,
    measurementCount: measurementList.length,
    sourceCounts: sourceCountsOf(observations),
    supersededNormalCount: observations.filter((o) => norm(o.baselineReplaces)).length,
    screening,
    providerLabel: providerLabelOf(snapshot),
    imageCount: images.length,
    aiMode: snapshot.aiMode === "SELECTED_IMAGES" ? "SELECTED_IMAGES" : "TEXT_ONLY",
    reportRevision: hashes.reportRevision.slice(0, SHORT_HASH),
    inputHash: hashes.inputHash.slice(0, SHORT_HASH),
    text,
  };
}

/** The collapsed one-liner: enough to know whether anything reached the AI at all. */
export function composerInputSummaryLine(preview: ComposerInputPreview): string {
  const parts = [`Observations ${preview.observationCount}`];
  if (preview.measurementCount > 0) parts.push(`Measurements ${preview.measurementCount}`);
  if (preview.imageCount > 0) parts.push(`Images ${preview.imageCount}`);
  return parts.join(" · ");
}
