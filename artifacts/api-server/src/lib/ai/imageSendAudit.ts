/**
 * STAGE 1 PR-A — one writer for the audit evidence of an image-bearing AI send.
 *
 * WHY THIS EXISTS
 * The interactive radiology path already files an audit row per send
 * (`routes/aiReporting.ts`, inserting into `ai_reporting_audit_logs` with
 * `numImages`). The two paths a radiologist's screenshots will actually travel —
 * the durable Composer job and the overnight/shadow gateway — filed nothing at all.
 * That is not a missing log line, it is a missing control: without a record of
 * which endpoint received which patient's pixels, "Stage 1 is local-only" is a
 * setting an operator believes, not a fact anyone can check afterwards.
 *
 * This writes to the SAME table the clinic already audits and already retains, so
 * there is one audit subsystem. It adds no second log, no new table, and no
 * parallel viewer.
 *
 * WHAT IT REFUSES TO STORE
 * Image bytes, base64 payloads, and prompt text. The type has no field for them,
 * and `scrubPayloadShaped` is a runtime backstop for the case a caller invents one:
 * a Composer prompt contains the radiologist's own sentences, and an audit table
 * is where you look for a leak, not where you keep it. `promptText` is left NULL
 * deliberately, unlike the interactive path's existing behaviour — that column's
 * history is a separate question this PR documents rather than quietly rewrites.
 */
import {
  classifyEffectiveLocality,
  PATIENT_DERIVED_IMAGE_SOURCES,
} from "@workspace/ai-providers";
import { db } from "@workspace/db";
import { aiReportingAuditLogsTable } from "@workspace/db/schema";

export type ImageSendEndpointLocality = "local" | "cloud" | "unknown";

export type ImageSendAuditRecord = {
  /** Who triggered the send, when a person did. */
  userId?: number | null;
  userName?: string | null;
  /** Patient/study identity, from the SERVER's row — never from a browser body. */
  patientId?: number | null;
  studyInstanceUID?: string | null;
  accessionNumber?: string | null;
  draftId?: number | null;
  /** The provider that ANSWERED, not the one that was configured. */
  provider: string;
  model: string | null;
  /**
   * The endpoint the bytes were addressed to. Locality is derived from this
   * inside the writer: a caller cannot report `local` about a public URL.
   */
  resolvedUrl: string | null;
  /**
   * `AiQueryResult.execution.locality` — the locality the SEND layer settled on
   * after resolving the endpoint. Preferred over deriving it here, because the
   * layer that opened the socket knows where the socket went; the caller's
   * settings do not. Only the send layer's own answer is accepted, never a label
   * the caller hoped for.
   */
  executedLocality?: "local" | "cloud" | null;
  numImages: number;
  imageSourceTypes?: readonly string[] | null;
  /** `compose_job:17` | `shadow_job:9` | `self_test:<iso>` — see the migration. */
  jobReference?: string | null;
  correlationId?: string | null;
  /** "The clinician was given usable text", which is what an auditor asks. */
  success: boolean;
  /** A safe, PHI-free reason. Never a provider body. */
  safeFailureReason?: string | null;
};

/** Longest field this writer will carry. Anything longer is not an identifier. */
const MAX_AUDIT_FIELD_CHARS = 300;

/**
 * A base64 image is long, unbroken, and alphabet-heavy; an identifier or a safe
 * error reason is none of those together. This is a backstop, not a parser: it
 * exists so that one careless future caller adding a payload field cannot turn the
 * audit table into image storage.
 *
 * The two signals are used together on purpose. Alphabet alone would flag a long
 * sentence of clinical prose (strip the spaces and prose is all letters); length
 * alone would flag any long error string. A picture is long AND has no room to
 * breathe — and a blob pasted after a label ("gpt-4o <400 KB>") still shows as
 * one unbroken run, which is the case that truncation would otherwise leak.
 */
export function isPayloadShaped(value: string): boolean {
  if (value.length < 512) return false;
  if (/^\s*(data:|base64,)/i.test(value)) return true;
  const whitespace = (value.match(/\s/g) ?? []).length;
  if (whitespace > value.length * 0.02) return false;
  return /[A-Za-z0-9+/=]{512,}/.test(value);
}

export function scrubPayloadShaped(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value);
  if (isPayloadShaped(trimmed)) return "[redacted:payload-shaped-value]";
  return trimmed.length > MAX_AUDIT_FIELD_CHARS
    ? `${trimmed.slice(0, MAX_AUDIT_FIELD_CHARS)}…[truncated]`
    : trimmed;
}

/**
 * Derived, never declared. `unknown` is a real answer and is written as one: an
 * empty locality would read as "nothing left the clinic" on a send whose endpoint
 * was never resolved.
 *
 * Preference order matters for the audit's value as evidence: the locality the
 * send layer settled on wins (it is a fact about a socket), then the caller's
 * resolved URL, then `unknown`. A caller that reports neither is recorded as an
 * unproven send rather than given the benefit of the doubt.
 */
export function resolveAuditLocality(
  provider: string,
  resolvedUrl: string | null,
  executedLocality?: "local" | "cloud" | null,
): ImageSendEndpointLocality {
  if (executedLocality === "local" || executedLocality === "cloud") return executedLocality;
  if (resolvedUrl == null || resolvedUrl.trim() === "") return "unknown";
  return classifyEffectiveLocality(provider, resolvedUrl).locality;
}

export function deriveEndpointLocality(
  provider: string,
  resolvedUrl: string | null,
): ImageSendEndpointLocality {
  return resolveAuditLocality(provider, resolvedUrl);
}

/**
 * True when at least one image is a real patient's picture rather than something
 * an operator supplied. Kept here so the audit and the policy read provenance the
 * same way.
 */
export function hasPatientDerivedImage(sourceTypes?: readonly string[] | null): boolean {
  if (!sourceTypes || sourceTypes.length === 0) return true; // unknown provenance is not clearance
  return sourceTypes.some((s) =>
    (PATIENT_DERIVED_IMAGE_SOURCES as readonly string[]).includes(s),
  );
}

/**
 * Files one row. Deliberately non-blocking: an audit failure must not stop a
 * radiologist from getting a draft, and the clinic's existing image-send audit
 * behaves the same way. Unlike the existing writer, a failure here is logged —
 * a silent missing row is exactly what made this gap hard to see.
 */
export async function recordImageSendAudit(
  record: ImageSendAuditRecord,
  log?: (message: string, fields: Record<string, unknown>) => void,
): Promise<void> {
  const locality = resolveAuditLocality(
    record.provider,
    record.resolvedUrl,
    record.executedLocality,
  );
  try {
    await db.insert(aiReportingAuditLogsTable).values({
      userId: record.userId ?? null,
      userName: scrubPayloadShaped(record.userName),
      patientId: record.patientId ?? null,
      studyInstanceUID: scrubPayloadShaped(record.studyInstanceUID),
      accessionNumber: scrubPayloadShaped(record.accessionNumber),
      // The provider that answered. A row that names a provider which never
      // received the request is worse than no row: it is evidence against the
      // clinician's own account of what happened.
      provider: record.provider,
      model: scrubPayloadShaped(record.model),
      // No prompt text. See the file header.
      promptText: null,
      numImages: record.numImages,
      // The single honest value today: nothing in CARE strips identifiers from an
      // image before sending it (`DICOM_REDACTION_PERFORMED = false`), and an
      // audit row may not claim otherwise because a writer forgot a column.
      anonymized: false,
      includedDemographics: false,
      wasInsertedToReport: false,
      draftId: record.draftId ?? null,
      success: record.success,
      errorMessage: scrubPayloadShaped(record.safeFailureReason),
      endpointLocality: locality,
      jobReference: scrubPayloadShaped(record.jobReference),
      correlationId: scrubPayloadShaped(record.correlationId),
      imageSourceTypes: scrubPayloadShaped(
        record.imageSourceTypes && record.imageSourceTypes.length > 0
          ? record.imageSourceTypes.join(",")
          : null,
      ),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "audit_write_failed";
    (log ?? ((m, f) => console.warn(m, f)))("ai_image_send_audit_failed", {
      provider: record.provider,
      locality,
      message,
    });
  }
}
