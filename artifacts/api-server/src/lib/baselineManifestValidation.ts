/**
 * Server-side baselineManifest integrity (shared rules with ERP validator).
 * Structural validation only — does not require observationSlot / concept canon.
 *
 * A format WITHOUT baselineManifest remains valid (omit / undefined / null).
 */
export const FULL_REPORT_BASELINE_KIND = "care.full_report_baseline.v1" as const;
export const SUPPORTED_BASELINE_MANIFEST_VERSION = 1 as const;

export type BaselineManifestObservationInput = {
  id?: unknown;
  field?: unknown;
  concept?: unknown;
  conflictGroup?: unknown;
  anatomicalSection?: unknown;
  level?: unknown;
  laterality?: unknown;
  renderedText?: unknown;
};

export type BaselineManifestInput = {
  kind?: unknown;
  version?: unknown;
  revision?: unknown;
  observations?: unknown;
};

export type BaselineManifestServerValidation = {
  ok: boolean;
  status: 400 | 422;
  reason: string;
  details?: string[];
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function slotIdentity(o: {
  field: string;
  concept: string;
  level?: string;
  laterality?: string;
}): string {
  return [
    o.field,
    o.concept.trim().toLowerCase(),
    (o.level ?? "*").trim().toLowerCase() || "*",
    (o.laterality ?? "*").trim().toLowerCase() || "*",
  ].join("|");
}

/**
 * Validate an optional baselineManifest on report-format CREATE/UPDATE.
 * - missing/null/undefined → ok (legacy formats)
 * - present → must be supported kind/version with well-formed ownership entries
 */
export function validateBaselineManifestForPersistence(opts: {
  findings?: string;
  impression?: string;
  baselineManifest?: BaselineManifestInput | null;
}): BaselineManifestServerValidation {
  const manifest = opts.baselineManifest;
  if (manifest == null) {
    return { ok: true, status: 400, reason: "ok" };
  }
  if (typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, status: 400, reason: "baselineManifest must be an object" };
  }

  if (manifest.kind == null || manifest.kind === "") {
    return { ok: false, status: 400, reason: "baselineManifest.kind is required" };
  }
  if (manifest.kind !== FULL_REPORT_BASELINE_KIND) {
    return {
      ok: false,
      status: 422,
      reason: `Unsupported baselineManifest.kind: ${String(manifest.kind)}`,
    };
  }

  if (manifest.version == null) {
    return { ok: false, status: 400, reason: "baselineManifest.version is required" };
  }
  if (manifest.version !== SUPPORTED_BASELINE_MANIFEST_VERSION) {
    return {
      ok: false,
      status: 422,
      reason: `Unsupported baselineManifest.version: ${String(manifest.version)} (supported: ${SUPPORTED_BASELINE_MANIFEST_VERSION})`,
    };
  }

  if (!isNonEmptyString(manifest.revision)) {
    return { ok: false, status: 400, reason: "baselineManifest.revision is required" };
  }

  if (!Array.isArray(manifest.observations)) {
    return { ok: false, status: 400, reason: "baselineManifest.observations must be an array" };
  }

  const findings = opts.findings ?? "";
  const impression = opts.impression ?? "";
  const details: string[] = [];
  const slots = new Set<string>();

  for (let i = 0; i < manifest.observations.length; i++) {
    const entry = manifest.observations[i] as BaselineManifestObservationInput;
    const path = `observations[${i}]`;
    if (!entry || typeof entry !== "object") {
      details.push(`${path}: must be an object`);
      continue;
    }
    if (!isNonEmptyString(entry.id)) details.push(`${path}.id is required`);
    if (entry.field !== "findings" && entry.field !== "impression") {
      details.push(`${path}.field must be "findings" or "impression"`);
    }
    if (!isNonEmptyString(entry.concept)) details.push(`${path}.concept is required`);
    if (!isNonEmptyString(entry.conflictGroup)) details.push(`${path}.conflictGroup is required`);
    if (typeof entry.anatomicalSection !== "string") {
      details.push(`${path}.anatomicalSection is required (string; may be empty for impression)`);
    }
    if (!isNonEmptyString(entry.renderedText)) details.push(`${path}.renderedText is required`);

    if (isNonEmptyString(entry.renderedText) && (entry.field === "findings" || entry.field === "impression")) {
      const fieldText = entry.field === "findings" ? findings : impression;
      if (!fieldText.includes(entry.renderedText)) {
        details.push(`${path}.renderedText missing from format.${entry.field}`);
      }
    }

    if (isNonEmptyString(entry.concept) && (entry.field === "findings" || entry.field === "impression")) {
      const slot = slotIdentity({
        field: entry.field,
        concept: entry.concept,
        level: typeof entry.level === "string" ? entry.level : undefined,
        laterality: typeof entry.laterality === "string" ? entry.laterality : undefined,
      });
      if (slots.has(slot)) details.push(`${path}: duplicate ownership slot ${slot}`);
      slots.add(slot);
    }
  }

  if (details.length) {
    return {
      ok: false,
      status: 400,
      reason: "baselineManifest failed integrity validation",
      details,
    };
  }
  return { ok: true, status: 400, reason: "ok" };
}
