import { z } from "zod";

/**
 * Canonical request contract for POST /api/ai-reporting/query.
 *
 * `promptText` is the canonical prompt field (what every ERP workstation
 * surface sends). `prompt` is kept as a legacy alias for backward
 * compatibility with older callers (e.g. pre-contract DicomViewer builds);
 * when both are present, `promptText` wins.
 *
 * Images are NEVER supplied by the client: the server resolves them from
 * Orthanc by StudyInstanceUID via its own image-selection code, so the only
 * image-related inputs are the study/series UIDs (format-validated below)
 * and a count cap. Clients cannot inject file paths or URLs.
 */

// DICOM UIDs are dot-separated numeric components (PS3.5 §9.1).
const dicomUid = z
  .string()
  .max(128)
  .regex(/^\d+(\.\d+)*$/, "Invalid DICOM UID format");

export const AiReportingQueryRequestSchema = z.object({
  studyInstanceUID: dicomUid.nullish(),
  accessionNumber: z.string().max(64).nullish(),
  patientId: z.number().int().positive().nullish(),
  seriesUIDs: z.array(dicomUid).max(50).optional(),
  // "study" | "series" | "limited" today; kept open for existing callers.
  scope: z.string().max(32).optional(),
  provider: z.string().max(64).optional(),
  model: z.string().max(128).optional(),
  /** Canonical prompt field — the radiologist's findings/instructions. */
  promptText: z.string().max(20_000).nullish(),
  /** Legacy alias, still accepted; promptText wins when both are sent. */
  prompt: z.string().max(20_000).nullish(),
  templateName: z.string().max(200).nullish(),
  clinicalHistory: z.string().max(5_000).nullish(),
  anonymize: z.boolean().optional(),
  includeDemographics: z.boolean().optional(),
  /** 0 = text-only query (no images fetched). Server clamps to ≤ 20. */
  maxImages: z.number().int().min(0).optional(),
  /**
   * PR-A2B — the clinician's own confirmation that THIS request may put its images
   * in front of a cloud provider. Required only in Clinical security mode;
   * Development mode does not ask, because there the administrator's cloud-vision
   * opt-in is the decision.
   *
   * What this key is NOT: authorisation. `cloudVisionAllowed` is never read from a
   * body — the server resolves it from the clinic's stored settings — and whose
   * confirmation this is comes from the session, not from anything the caller
   * types. A browser can claim a person confirmed; it cannot choose which person
   * the audit row names, and it cannot turn the clinic's flag on.
   */
  attestCloudImageEgress: z.boolean().optional(),
});

export type AiReportingQueryRequest = z.infer<typeof AiReportingQueryRequestSchema>;

/** Where the effective prompt came from — returned for safe debugging. */
export type AiPromptSource = "request" | "template" | "settings-default";

/**
 * Canonical request contract for POST /api/ai-reporting/draft.
 *
 * `/draft` was the last AI route still hand-destructuring `req.body`, so a key
 * the workstation sent and the handler did not read was invisible: Ctrl+I posted
 * `field: "impression"` for years while the server generated a whole report.
 * Declaring the contract here makes that class of drift a reviewable fact.
 *
 * `studyInstanceUID` is deliberately a plain bounded string rather than the
 * `dicomUid` regex `/query` uses. `/draft` confirms it against `radiology_worklist`
 * and `radiology_studies` before it fetches a single frame, and reads the frames
 * through a parameterised query, so tightening the shape would start rejecting
 * worklist rows carrying non-standard UIDs — a behaviour change this contract is
 * not here to make. The confirmation is the binding, and it is a bound rather than
 * a hint: a UID no row of this clinic carries is refused (TASK E-1), never fetched.
 */
export const AiReportingDraftRequestSchema = z.object({
  worklistId: z.number().int().positive().nullish(),
  studyInstanceUID: z.string().max(128).nullish(),
  modality: z.string().max(16).nullish(),
  studyDescription: z.string().max(200).nullish(),
  /** Canonical key for the radiologist's typed Findings. */
  reportBody: z.string().max(20_000).nullish(),
  /** Legacy alias older workstation bundles send; `reportBody` wins. */
  findings: z.string().max(20_000).nullish(),
  impression: z.string().max(20_000).nullish(),
  clinicalHistory: z.string().max(5_000).nullish(),
  provider: z.string().max(64).nullish(),
  /**
   * The single section the caller will consume. Absent means "both sections".
   * Only "impression" is sent today, by the workspace's Ctrl+I.
   */
  field: z.enum(["findings", "impression"]).nullish(),
  /**
   * The caller declares this request is a provider warm-up, not a draft a human
   * asked for. The model is still loaded and exercised — that is the point —
   * and the audit row is still written, but nothing is persisted to
   * `ai_reporting_drafts`.
   *
   * The reporting workspace's next-study preload sends this. Without it, every
   * study switch asked the model for a full report on a study nobody had opened
   * yet, from a prompt carrying no findings whatsoever, stored the answer, and
   * left it retrievable through GET /drafts/:studyInstanceUID by whoever opened
   * that study next.
   */
  warmUpOnly: z.boolean().optional(),
  /**
   * PR-A2B — the radiologist's confirmation that this draft may send the study's
   * images to a cloud provider. Only consulted in Clinical security mode, and only
   * ever an attestation: the clinic's cloud-vision opt-in is read from stored
   * settings server-side, and the identity this confirmation is filed under comes
   * from the session token, not from this body.
   */
  attestCloudImageEgress: z.boolean().optional(),
});

export type AiReportingDraftRequest = z.infer<typeof AiReportingDraftRequestSchema>;

/**
 * Grounding verdict for one AI draft.
 *
 * Produced by the background composer's existing validator
 * (`artifacts/api-server/src/lib/reportComposer/validateOutput.ts`) so the
 * interactive draft path and the composer cannot drift apart on what counts as
 * an invented finding. `notChecked` is part of the contract, not decoration:
 * a validator that quietly cannot see half the report is worse than no
 * validator, because the green label is then a claim nobody tested.
 */
export interface AiDraftValidation {
  ok: boolean;
  /**
   * Always false today. Whether any of these should hard-block a draft is the
   * open product-owner decision in docs/report-quality-engine/ARCHITECTURE.md
   * §8.1; the composer's own structured rules carry `blockingEligibility: false`
   * for the same reason. Declared so callers render a badge, not a wall.
   */
  blocking: boolean;
  errors: string[];
  warnings: string[];
  /** Clinical terms in the AI output with no support in the supplied text. */
  unsupportedMentions: string[];
  lateralitySwaps: string[];
  levelChanges: string[];
  severityEscalations: string[];
  /** Name of the validator that produced this, so the label is traceable. */
  validator: "reportComposer.validateComposerOutput";
  /** Checks this path structurally cannot perform, stated rather than implied. */
  notChecked: string[];
  /** How many images actually went to the model for this draft. */
  imagesSentToModel: number;
}

export interface AiReportingQueryResponse {
  aiResponse: string;
  provider: string;
  model: string | null;
  numImages: number;
  anonymized: boolean;
  /** Debug metadata (no prompt content): source + length of effective prompt. */
  promptSource: AiPromptSource;
  promptChars: number;
  /** C1 — mirror of the fields below, see `AiExecutedIdentity`. */
  executed?: AiExecutedIdentity;
  failure?: AiNormalizedFailure | null;
  /**
   * The `correlation_id` of the audit row this request just filed. A radiologist
   * reporting a bad answer has to be able to name the record, and a screen that
   * shows nothing cannot quote it. `/draft` has returned this as `requestId`
   * since C1; the other interactive routes now do the same.
   */
  requestId?: string;
}

/**
 * C1 wire mirror of `AiExecutionIdentity` in `@workspace/ai-providers`.
 *
 * Declared here rather than imported because this package is the leaf contract
 * the browser also compiles against — it must not pull provider SDKs into a
 * client bundle. `aiFailureContract` / `interactiveAiGateway` are the authority;
 * the two lists are pinned equal by
 * `lib/ai-providers/src/aiFailureContract.test.ts`, because a mirrored union that
 * is allowed to drift is worse than no union at all.
 */
export interface AiExecutedIdentity {
  provider: string;
  model: string | null;
  locality: "local" | "cloud";
  timeoutMs: number;
  attempted: boolean;
}

export type AiFailureWireCode =
  | "DISABLED"
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "PROVIDER_HTTP_ERROR"
  | "MALFORMED_RESPONSE"
  | "PHI_POLICY_BLOCK"
  | "IMAGE_EGRESS_BLOCK"
  | "EMPTY_RESPONSE"
  | "UNKNOWN";

/** C1 — the one small stable answer to "why did the model not answer?". */
export interface AiNormalizedFailure {
  code: AiFailureWireCode;
  /** Secret-free, bounded to 240 characters. */
  message: string;
  provider: string;
  model: string | null;
  locality: "local" | "cloud";
  attempted: boolean;
  timeoutMs: number;
  /** The provider layer's own code/class, preserved so nothing is lost. */
  detailCode: string | null;
}

/**
 * Query contract for GET /api/radiology-copilot/prior-studies.
 * Express query params arrive as strings, so numbers are coerced.
 */
export const PriorStudiesQuerySchema = z.object({
  patientId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Current study id — excluded from results so a study never lists itself. */
  excludeStudyId: z.coerce.number().int().positive().optional(),
});

export type PriorStudiesQuery = z.infer<typeof PriorStudiesQuerySchema>;

/**
 * One prior study as consumed by ComparisonPanel / RadiologyCopilotPanel.
 * Field names intentionally match the panels' existing PriorStudy interface.
 */
export interface PriorStudySummary {
  id: number;
  accessionNumber: string;
  modality: string;
  bodyPart: string | null;
  studyDate: string;
  testName: string;
  testCode: string | null;
  impression: string | null;
  /** Final report text; falls back to the prelim text (status disambiguates). */
  finalReport: string | null;
  reportedBy: string | null;
  reportedAt: string | null;
  status: string;
  /** Linked patient_reports row (signed preferred), when one exists. */
  reportId: number | null;
  reportStatus: string | null;
}

export interface PriorStudiesResponse {
  studies: PriorStudySummary[];
}
