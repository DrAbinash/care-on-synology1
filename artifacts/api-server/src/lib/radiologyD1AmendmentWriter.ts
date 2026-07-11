// ─────────────────────────────────────────────────────────────────────────────
// radiologyD1AmendmentWriter.ts — Ticket D7 (Structured Report Amendment
// Chain). PURE preparation of an AMENDMENT: a brand-new signed D1 document
// that supersedes an existing signed one, linked via
// signature.amends_document_id (D1 §10, validator R14c).
//
// INVARIANTS (the whole point of D7):
//   • A signed report is NEVER modified in place. The parent document/row is
//     read, verified, and left byte-untouched; the amendment is a NEW document
//     with a NEW document_id in a disjoint id space.
//   • The chain is LINEAR: R14c rejects amending a document that has already
//     been amended (the route's linkage table additionally enforces this with
//     a UNIQUE constraint, so even a race cannot fork the chain).
//   • The amending document is itself a signed-FINAL document (the frozen D1
//     validator's R14 requires signature.state === "final" at finalize;
//     amendment-ness is expressed by amends_document_id being set — the
//     "addendum"/"amended" enum values remain unused schema capability).
//   • amendment_reason is MANDATORY and is carried in the sanctioned
//     extensions channel plus the finalize audit row's `reason` column.
//   • Authorship comes ONLY from the authenticated staff session (same
//     SignContext as D5 — no client author field exists).
//   • Rendering is D4 only; content hashing is D2 only.
//
// No DB access here: the route re-reads rows inside its transaction and
// injects validator ports (same honest-gap pattern as D5/D6).
// ─────────────────────────────────────────────────────────────────────────────

import {
  buildDraftD1WriterInput,
  noFindingsCatalogPort,
  type DraftD1Source,
} from "./radiologyD1DraftWriter";
import type { MaterializationOutput } from "./radiologyFindingMaterializer";
import { writeStructuredReport } from "./structuredReport/writer";
import { UnavailableAiRulesRegistryPort } from "./structuredReport/aiRulesRegistry";
import type { ValidationIssue, ValidationResult } from "./structuredReport/validator";
import { STRUCTURED_REPORT_KIND, DOCUMENT_ID_PATTERN, type StructuredReportDocument } from "./structuredReport/types";
import { verifyContentSha256 } from "./structuredReport/hash";
import { renderStructuredReport, type RenderResult } from "./structuredReport/renderer";
import { toLegacyReportShape, type LegacyReportShape } from "./structuredReport/rendererLegacyAdapter";
import {
  compareAgainstDraft,
  type DraftLegacyFields,
  type EquivalenceResult,
  type SignContext,
  type FinalValidationPorts,
} from "./radiologyD1FinalWriter";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Deterministic document_id for an AMENDMENT, derived from the reserved
 * patient_reports row id — in a DISJOINT id space from draft-derived ids:
 * draft documents (D3/D5) zero-pad and therefore always start with "0";
 * amendment ids always start with "A". Self-amendment and cross-space
 * collision are structurally impossible.
 */
export function deriveAmendmentDocumentId(reportRowId: number): string {
  if (!Number.isInteger(reportRowId) || reportRowId <= 0) {
    throw new Error(`deriveAmendmentDocumentId: reportRowId must be a positive integer, got ${reportRowId}`);
  }
  let n = reportRowId;
  let base32 = "";
  while (n > 0) {
    base32 = CROCKFORD_BASE32[n % 32] + base32;
    n = Math.floor(n / 32);
  }
  return "A" + base32.padStart(25, "0");
}

// ── Inputs / outputs ─────────────────────────────────────────────────────────

/** The parent (signed) report the amendment supersedes. */
export interface AmendmentParent {
  /** patient_reports.id of the signed row. */
  reportId: number;
  patientId: number;
  /** The signed structured document stored on that row (jsonb value). */
  document: unknown;
  /** Chain root carried from the linkage table (null → parent IS the root). */
  rootDocumentId?: string | null;
  rootReportId?: number | null;
  /** How many amendments precede this one in the chain (0 for the first). */
  priorAmendmentCount?: number;
}

export interface AmendmentMeta {
  amendsDocumentId: string;
  amendsReportId: number;
  rootDocumentId: string;
  rootReportId: number;
  sequenceNumber: number; // 1-based amendment number in the chain
  reason: string;
  revision: number;
}

export interface PrepareStructuredAmendmentInput {
  parent: AmendmentParent;
  /** Truthful source built from the AMENDMENT draft (same shape as D5). */
  source: DraftD1Source;
  /** D3.5 materialization of the amendment draft's finding instances. */
  materialized: MaterializationOutput;
  /** The amendment draft's own legacy fields (equivalence policy, as D5). */
  draftLegacy: DraftLegacyFields;
  /** Session-derived signer + the reserved audit-chain id (as D5). */
  sign: SignContext;
  /** MANDATORY human reason for the amendment. */
  reason: string;
  /** The reserved patient_reports id for the NEW row (document_id derives from it). */
  newReportId: number;
  /** Sequence of the amendment patient row's patientId (cross-patient guard). */
  draftPatientId: number | null;
  validationPorts?: FinalValidationPorts;
}

export type PrepareStructuredAmendmentResult =
  | {
      ok: true;
      document: StructuredReportDocument;
      contentSha256: string;
      renderedBody: string;
      render: RenderResult;
      legacyShape: LegacyReportShape;
      equivalence: EquivalenceResult;
      validation: ValidationResult;
      amendment: AmendmentMeta;
    }
  | {
      ok: false;
      stage:
        | "invalid_parent"
        | "reason_required"
        | "cross_patient"
        | "timestamp_not_monotonic"
        | "adapter_skip"
        | "validation_failed"
        | "render_empty";
      detail?: string;
      skipReasons?: string[];
      validationErrors?: ValidationIssue[];
      equivalence?: EquivalenceResult;
    };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Build, sign-stamp, validate, and render the AMENDMENT document. Pure; no
 * DB, no clock (timestamps come from `sign`), no mutation of the parent.
 */
export async function prepareStructuredAmendment(
  input: PrepareStructuredAmendmentInput,
): Promise<PrepareStructuredAmendmentResult> {
  const { parent, source, materialized, draftLegacy, sign, reason, newReportId } = input;

  // ── Guards (Phase 5) ────────────────────────────────────────────────────────
  if (!reason?.trim()) {
    return { ok: false, stage: "reason_required", detail: "amendment_reason is mandatory" };
  }

  // Parent must be a shape-valid, signed-FINAL, hash-verified document — a
  // tampered or unsigned parent is never amended (it must be investigated).
  const parentDoc = parent.document;
  if (!isPlainObject(parentDoc) || parentDoc.kind !== STRUCTURED_REPORT_KIND) {
    return { ok: false, stage: "invalid_parent", detail: "parent row does not carry a structured report document" };
  }
  const parentTyped = parentDoc as unknown as StructuredReportDocument;
  if (parentTyped.audit?.signature?.state !== "final") {
    return { ok: false, stage: "invalid_parent", detail: `parent signature.state is "${parentTyped.audit?.signature?.state}", expected "final"` };
  }
  if (!DOCUMENT_ID_PATTERN.test(parentTyped.document_id ?? "")) {
    return { ok: false, stage: "invalid_parent", detail: "parent document_id is malformed" };
  }
  const parentHash = verifyContentSha256(parentTyped);
  if (!parentHash.ok) {
    return { ok: false, stage: "invalid_parent", detail: "parent content_sha256 does not verify — refusing to amend a tampered document" };
  }

  // Cross-patient guard: the amendment draft must belong to the same patient.
  if (input.draftPatientId != null && input.draftPatientId !== parent.patientId) {
    return { ok: false, stage: "cross_patient", detail: `amendment draft patient ${input.draftPatientId} does not match report patient ${parent.patientId}` };
  }

  // Timestamp monotonicity: the amendment is signed strictly AFTER the parent.
  const parentSignedAt = parentTyped.audit.signature.signed_at;
  if (parentSignedAt && !(new Date(sign.signedAtIso).getTime() > new Date(parentSignedAt).getTime())) {
    return { ok: false, stage: "timestamp_not_monotonic", detail: `amendment signed_at ${sign.signedAtIso} is not after parent signed_at ${parentSignedAt}` };
  }

  // ── Assemble the NEW document ───────────────────────────────────────────────
  const adapted = buildDraftD1WriterInput({ ...source, materialized });
  if (!adapted.ok) return { ok: false, stage: "adapter_skip", skipReasons: adapted.skipReasons };

  const newDocumentId = deriveAmendmentDocumentId(newReportId);
  // Structural self-amend impossibility, asserted anyway (Phase 5).
  if (newDocumentId === parentTyped.document_id) {
    return { ok: false, stage: "invalid_parent", detail: "amendment document_id collides with the parent document_id" };
  }

  const revision = parentTyped.audit.revision + 1; // monotonic across the chain
  const rootDocumentId = parent.rootDocumentId ?? parentTyped.document_id;
  const rootReportId = parent.rootReportId ?? parent.reportId;
  const sequenceNumber = (parent.priorAmendmentCount ?? 0) + 1;

  const writerInput = {
    ...adapted.input,
    document_id: newDocumentId,
    audit: {
      ...adapted.input.audit,
      last_modified_at: sign.signedAtIso,
      revision,
      // Full milestone history: the parent's log, plus this amendment.
      revisions: [
        ...parentTyped.audit.revisions,
        { revision, at: sign.signedAtIso, by: sign.signedBy, action: "amended" },
      ],
      audit_log_ref: sign.auditLogRef,
      signature: {
        state: "final" as const, // frozen-validator R14 contract; see header
        signed_by: sign.signedBy,
        signed_role: sign.signedRole,
        signed_at: sign.signedAtIso,
        amends_document_id: parentTyped.document_id,
      },
    },
    extensions: {
      ...(adapted.input.extensions ?? {}),
      // Sanctioned open channel (D1 §11.1): chain metadata D1 has no core
      // fields for. root/sequence make chain queries self-describing; the
      // reason also lands on the finalize audit row's `reason` column.
      x_care_amendment: {
        root_document_id: rootDocumentId,
        root_report_id: rootReportId,
        amends_report_id: parent.reportId,
        sequence_number: sequenceNumber,
        amendment_reason: reason.trim(),
      },
    },
  };

  const hasFindings = materialized.findings.length > 0;
  const result = await writeStructuredReport(writerInput, {
    mode: "finalize",
    validation: {
      catalog: hasFindings ? (input.validationPorts?.catalogPort ?? noFindingsCatalogPort) : noFindingsCatalogPort,
      aiRules: new UnavailableAiRulesRegistryPort(),
      auditLogLookup: input.validationPorts?.auditLogLookup,
      amendsLookup: input.validationPorts?.amendsLookup,
    },
  });

  if (!result.validation || !result.validation.ok) {
    return { ok: false, stage: "validation_failed", validationErrors: result.validation?.errors ?? [] };
  }

  const render = renderStructuredReport(result.document);
  const legacyShape = toLegacyReportShape(render);
  if (!render.body.trim()) return { ok: false, stage: "render_empty" };

  const equivalence = compareAgainstDraft(render, draftLegacy);

  return {
    ok: true,
    document: result.document,
    contentSha256: result.contentSha256,
    renderedBody: render.body,
    render,
    legacyShape,
    equivalence,
    validation: result.validation,
    amendment: {
      amendsDocumentId: parentTyped.document_id,
      amendsReportId: parent.reportId,
      rootDocumentId,
      rootReportId,
      sequenceNumber,
      reason: reason.trim(),
      revision,
    },
  };
}
