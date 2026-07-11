import type { WriteStructuredReportInput } from "../writer";

// Decompose a full structured-report document (e.g. a D1 §17 fixture) back into
// the WriteStructuredReportInput "parts" the writer accepts, dropping the two
// writer-COMPUTED members (audit.content_sha256, signature.signed_content_sha256)
// so the writer recomputes them. Used by both the golden generator and the
// round-trip tests, so "the parts the test feeds the writer" and "the parts the
// golden was generated from" are guaranteed identical.

export function deriveWriterInput(doc: any): WriteStructuredReportInput {
  return {
    document_id: doc.document_id,
    schema_version: doc.schema_version,
    catalog_snapshot: doc.catalog_snapshot,
    study_context: doc.study_context,
    findings: doc.findings,
    measurements: doc.measurements,
    impression: doc.impression,
    recommendations: doc.recommendations,
    critical_flags: doc.critical_flags,
    sections: doc.sections,
    provenance: doc.provenance,
    ai: doc.ai,
    audit: {
      schema_version: doc.audit.schema_version,
      hash_algorithm: doc.audit.hash_algorithm,
      created_at: doc.audit.created_at,
      last_modified_at: doc.audit.last_modified_at,
      revision: doc.audit.revision,
      revisions: doc.audit.revisions,
      audit_log_ref: doc.audit.audit_log_ref,
      signature: {
        state: doc.audit.signature.state,
        signed_by: doc.audit.signature.signed_by,
        signed_role: doc.audit.signature.signed_role,
        signed_at: doc.audit.signature.signed_at,
        amends_document_id: doc.audit.signature.amends_document_id,
      },
    },
    extensions: doc.extensions,
  };
}
