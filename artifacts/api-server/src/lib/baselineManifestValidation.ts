/**
 * Server persistence gate for optional baselineManifest on report formats.
 *
 * Structural + ownership-slot invariants live in `@workspace/baseline-manifest`
 * (shared with the ERP domain pre-canon check). This wrapper only maps those
 * results to HTTP status codes and treats missing/null as legacy-ok.
 *
 * Domain materialize (`validateBaselineManifest` in diagnostic-erp) additionally
 * runs concept-canon-aware slotKeys via `buildCanonicalObservation`. Persistence
 * intentionally does NOT depend on the clinical concept canon.
 */
import {
  FULL_REPORT_BASELINE_KIND,
  SUPPORTED_BASELINE_MANIFEST_VERSION,
  validateBaselineManifestStructure,
  type BaselineManifestLike,
} from "@workspace/baseline-manifest";

export { FULL_REPORT_BASELINE_KIND, SUPPORTED_BASELINE_MANIFEST_VERSION };

export type BaselineManifestObservationInput = {
  id?: unknown;
  field?: unknown;
  concept?: unknown;
  conflictGroup?: unknown;
  anatomicalSection?: unknown;
  level?: unknown;
  laterality?: unknown;
  region?: unknown;
  renderedText?: unknown;
};

export type BaselineManifestInput = BaselineManifestLike;

export type BaselineManifestServerValidation = {
  ok: boolean;
  status: 400 | 422;
  reason: string;
  details?: string[];
};

/**
 * Validate an optional baselineManifest on report-format CREATE/UPDATE.
 * - missing/null/undefined → ok (legacy formats)
 * - present → must be supported kind/version with well-formed ownership entries
 */
export function validateBaselineManifestForPersistence(opts: {
  findings?: string;
  impression?: string;
  /** Format bodyPart used when observation.region is omitted. */
  defaultRegion?: string;
  baselineManifest?: BaselineManifestInput | null;
}): BaselineManifestServerValidation {
  const manifest = opts.baselineManifest;
  if (manifest == null) {
    return { ok: true, status: 400, reason: "ok" };
  }

  const structural = validateBaselineManifestStructure({
    findings: opts.findings,
    impression: opts.impression,
    defaultRegion: opts.defaultRegion,
    baselineManifest: manifest,
  });

  if (structural.ok) {
    return { ok: true, status: 400, reason: "ok" };
  }

  return {
    ok: false,
    status: structural.unsupported ? 422 : 400,
    reason: structural.reason,
    ...(structural.details.length ? { details: structural.details } : {}),
  };
}
