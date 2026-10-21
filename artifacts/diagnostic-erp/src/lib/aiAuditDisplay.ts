/**
 * aiAuditDisplay.ts — how one AI audit row is READ, kept out of the page so the
 * reading can be tested without a browser.
 *
 * `ai_reporting_audit_logs` already carries `endpoint_locality`,
 * `image_source_types`, `job_reference` and `correlation_id` (written by
 * `recordImageSendAudit`, served verbatim by `GET /api/ai-reporting/audit-log`).
 * The page showed none of them, so the clinic had evidence it could not look at.
 * These helpers only present what the row says. They decide nothing about
 * egress — the policy that clears a send lives in
 * `lib/ai-providers/src/cloudImagePolicy.ts` and runs before the request.
 *
 * Three rules the shapes below are built around, because an audit surface that
 * breaks them is worse than no surface:
 *
 *   1. **Locality is never inferred here.** It is the classification the send
 *      layer settled on, which came from the resolved endpoint — not from the
 *      provider or model name. A missing value renders as UNKNOWN in the refusal
 *      colour, never as LOCAL, and never as blank: "we cannot say where this
 *      went" is not the same as "it stayed inside the clinic".
 *   2. **Text-only and vision are different events.** `num_images` is the count
 *      that left, so 0 means no pixels were involved in this row at all, and the
 *      provenance question does not arise for it.
 *   3. **Image provenance is read the way the gate reads it.** Anything that is
 *      not exactly the operator-supplied label is treated as a real patient's
 *      picture, and a stored list that is absent or shorter than the number of
 *      images sent is UNVERIFIED — not a clean list. That is the same asymmetry
 *      the policy uses (`s !== OPERATOR_SUPPLIED_IMAGE_SOURCE`), so the table and
 *      the gate cannot disagree about one send.
 */

/** The one label that means "nobody's patient" in `source_type`. */
export const OPERATOR_SUPPLIED_IMAGE_SOURCE = "OPERATOR_SUPPLIED";

/** Stable, human-stable keys for the four things the page renders. */
export type AuditTone = "local" | "cloud" | "unknown" | "ok" | "muted" | "patient";

export interface AuditBadgeView {
  readonly label: string;
  readonly tone: AuditTone;
  /** One sentence for the detail panel and the cell's title attribute. */
  readonly note: string;
}

/**
 * `endpoint_locality` as stored: `"local" | "cloud" | "unknown"`, or NULL for a
 * row written before the column existed / by a writer that never resolved a URL.
 */
export function localityView(raw: string | null | undefined): AuditBadgeView {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "local") {
    return {
      label: "LOCAL",
      tone: "local",
      note: "Endpoint resolved to a private / LAN address at the time of the send.",
    };
  }
  if (value === "cloud") {
    return {
      label: "CLOUD",
      tone: "cloud",
      note: "Endpoint resolved to a public address — this send left the clinic.",
    };
  }
  return {
    label: "LOCALITY UNKNOWN",
    tone: "unknown",
    note: value === "unknown"
      ? "No endpoint was resolved when this send was filed, so it cannot be shown as local."
      : "This row carries no locality at all (it predates the column, or its writer never recorded one). Absence is not proof the data stayed inside the clinic.",
  };
}

/** TEXT-ONLY vs VISION, from the pixel count the row itself carries. */
export function egressModeView(numImages: number | null | undefined): AuditBadgeView {
  const count = Number(numImages ?? 0);
  if (count > 0) {
    return { label: "VISION", tone: "cloud", note: `${count} image(s) were sent with this request.` };
  }
  return { label: "TEXT-ONLY", tone: "muted", note: "No image pixels were part of this request." };
}

/**
 * The same count arrives on a live AI response (`numImages`), and a reporting surface
 * that shows only the provider hides the one fact that changes how the text should be
 * read: `viewer · 3 img` and `viewer` with zero images look like the same event to the
 * radiologist, but one reviewed pictures and the other did not.
 *
 * Measured 2026-10-21 in a real browser against the local model with the study's images
 * requested: the answer came back `numImages: 0`, `failure: null`, and the drawer's only
 * on-screen cue was the word "ollama" — while the model itself replied that it could not
 * interpret an examination it had been given no report or images for. A draft like that
 * must not be able to look like a picture review.
 */
export function aiImagesReachedModel(numImages: number | null | undefined): boolean {
  return Number(numImages ?? 0) > 0;
}

export const AI_NO_IMAGES_SENT =
  "No images reached the model for this request. The text below was written from your question and the clinical history alone — it is not a review of this study's images.";

export interface ImageSourceView {
  readonly badges: readonly AuditBadgeView[];
  /** True when the row cannot account for the images it says were sent. */
  readonly unverified: boolean;
  /** True when at least one image is treated as a real patient's picture. */
  readonly patientDerived: boolean;
}

/**
 * `image_source_types` is stored as one comma-joined string, one entry per image
 * sent — from `radiology_report_key_images.source_type`.
 */
export function imageSourcesView(
  raw: string | null | undefined,
  numImages: number | null | undefined,
): ImageSourceView {
  const count = Number(numImages ?? 0);
  const tokens = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (count <= 0) {
    // A text-only row that still lists sources is contradictory, and saying
    // "no images" while hiding the list would make the table lie by omission.
    if (tokens.length > 0) {
      return {
        unverified: true,
        patientDerived: false,
        badges: [{
          label: "SOURCE LIST WITHOUT IMAGES",
          tone: "unknown",
          note: `This row records 0 images sent but lists ${tokens.length} image source(s) — the two columns disagree.`,
        }],
      };
    }
    return { unverified: false, patientDerived: false, badges: [] };
  }

  if (tokens.length === 0 || tokens.length !== count) {
    return {
      unverified: true,
      patientDerived: true,
      badges: [{
        label: "PROVENANCE UNVERIFIED",
        tone: "unknown",
        note: tokens.length === 0
          ? `${count} image(s) were sent and the row says nothing about where they came from.`
          : `${count} image(s) were sent but only ${tokens.length} source(s) are recorded, so the remaining images are unaccounted for.`,
      }],
    };
  }

  const patientDerived = tokens.some((t) => t !== OPERATOR_SUPPLIED_IMAGE_SOURCE);
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return {
    unverified: false,
    patientDerived,
    badges: [...counts].map(([token, n]) => sourceTokenBadge(token, n)),
  };
}

/** Repeats collapse into one badge (`DICOM ×4`) so four images do not print four
 *  identical chips and hide the count the row is actually reporting. */
function sourceTokenBadge(token: string, count: number): AuditBadgeView {
  const label = (base: string) => (count > 1 ? `${base} ×${count}` : base);
  if (token === OPERATOR_SUPPLIED_IMAGE_SOURCE) {
    return { label: label("OPERATOR-SUPPLIED"), tone: "ok", note: "A phantom or synthetic image an operator supplied, not a patient's examination." };
  }
  switch (token.toUpperCase()) {
    case "DICOM":
      return { label: label("DICOM"), tone: "patient", note: "Rendered from the patient's archived DICOM." };
    case "PACS_SCREENSHOT":
      return { label: label("PACS SCREENSHOT"), tone: "patient", note: "Still captured from the PACS viewer." };
    case "VIEWPORT_CAPTURE":
      return { label: label("VIEWPORT CAPTURE"), tone: "patient", note: "Captured from the reporting viewport." };
    case "UPLOAD":
      return { label: label("UPLOAD"), tone: "patient", note: "A file attached to the report." };
    default:
      // Kept verbatim rather than mapped to a known source: an unrecognised value
      // is counted as patient-derived by the rule above, but the table must not
      // invent a meaning for a token it has never seen.
      return { label: label(token.toUpperCase()), tone: "unknown", note: "Not a source type CARE recognises — read the row, do not assume." };
  }
}

export interface JobReferenceView {
  readonly label: string;
  /** The id part alone — empty when the reference carries none, so a caller can
   *  print the label by itself instead of repeating the prefix. */
  readonly value: string;
  /** False when the row carries nothing to trace by. */
  readonly present: boolean;
}

/**
 * `job_reference` is a text pointer, not a foreign key — production values are
 * `compose_job:<id>`, `ai_shadow_job:<id>` and `ai_self_test`. An unknown prefix
 * is shown verbatim instead of being guessed at, so a new writer never silently
 * borrows an existing label.
 */
export function jobReferenceView(raw: string | null | undefined): JobReferenceView {
  const value = (raw ?? "").trim();
  if (!value) return { label: "No job reference", value: "", present: false };
  const [prefix, ...rest] = value.split(":");
  const id = rest.join(":").trim();
  switch (prefix) {
    case "compose_job":
      return { label: "Composer job", value: id, present: true };
    case "ai_shadow_job":
      return { label: "Shadow draft job", value: id, present: true };
    case "ai_self_test":
      return { label: "AI pipeline self-test", value: id, present: true };
    // The interactive routes and the comparison run each name their own writer, so
    // one table can say which of its `success` values is a generation and which is
    // a human choice. Unlisted here they would render as "Reference (unrecognised)",
    // which reads like a defect in the data rather than a new writer.
    case "ai_query":
      return { label: "AI query answer", value: id, present: true };
    case "ai_polish":
      return { label: "AI language polish", value: id, present: true };
    case "ai_image_review":
      return { label: "AI image review", value: id, present: true };
    case "ai_compare":
      return { label: "AI report comparison", value: id, present: true };
    case "ai_comparison_run":
      return { label: "Model comparison, arm", value: id, present: true };
    case "ai_comparison_winner":
      return { label: "Answer the clinician kept (not a generation)", value: id, present: true };
    default:
      return { label: "Reference (unrecognised)", value, present: true };
  }
}

/** Searchable text for one row, including the four newly-surfaced columns. */
export function auditRowSearchText(row: {
  userName?: string | null;
  provider?: string | null;
  model?: string | null;
  studyInstanceUID?: string | null;
  accessionNumber?: string | null;
  endpointLocality?: string | null;
  jobReference?: string | null;
  correlationId?: string | null;
}): string {
  return [
    row.userName, row.provider, row.model, row.studyInstanceUID, row.accessionNumber,
    row.endpointLocality, row.jobReference, row.correlationId,
  ].filter(Boolean).join(" ").toLowerCase();
}
