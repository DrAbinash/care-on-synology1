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
});

export type AiReportingQueryRequest = z.infer<typeof AiReportingQueryRequestSchema>;

/** Where the effective prompt came from — returned for safe debugging. */
export type AiPromptSource = "request" | "template" | "settings-default";

export interface AiReportingQueryResponse {
  aiResponse: string;
  provider: string;
  model: string | null;
  numImages: number;
  anonymized: boolean;
  /** Debug metadata (no prompt content): source + length of effective prompt. */
  promptSource: AiPromptSource;
  promptChars: number;
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
