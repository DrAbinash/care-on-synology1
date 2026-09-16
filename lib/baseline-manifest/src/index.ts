/**
 * Shared baselineManifest structural invariants — no clinical concept canon.
 *
 * Used by:
 * - API persistence boundary (`validateBaselineManifestForPersistence`)
 * - ERP domain materialize gate (`validateBaselineManifest`) for kind/version/
 *   revision/shape/renderedText + ownership-slot uniqueness (pre-canon)
 *
 * Domain materialization still runs `buildCanonicalObservation` for runtime
 * slotKey (canon-aware). Persistence slot identity matches the non-canon
 * dimensions of that key: region | concept | level | laterality.
 */

export const FULL_REPORT_BASELINE_KIND = "care.full_report_baseline.v1" as const;
export const SUPPORTED_BASELINE_MANIFEST_VERSION = 1 as const;

export const SLOT_WILDCARD = "*";

const REGIONAL_LEVEL_BUCKETS = new Set(["cervical", "dorsal", "lumbar"]);

export function normalizeSlotPart(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Canonical spine level / regional bucket. Empty if none. */
export function normalizeLevel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().toUpperCase().replace(/[–—]/g, "-");
  if (!t) return "";
  const bucket = t.toLowerCase();
  if (REGIONAL_LEVEL_BUCKETS.has(bucket) || bucket === "thoracic") {
    return bucket === "thoracic" ? "dorsal" : bucket;
  }
  const compact = t.replace(/\s+/g, "").replace(/\//g, "-").replace(/T/g, "D");
  const paired = compact.match(/^([LCDS])(\d{1,2})-?([LCDS])?(\d{1,2})$/);
  if (paired) {
    const a = paired[1]!;
    const aN = paired[2]!;
    const b = paired[3] || a;
    const bN = paired[4]!;
    return `${a}${aN}-${b}${bN}`;
  }
  const embedded = t.match(/\b([LCDST])\s*(\d{1,2})\s*[-\/]\s*([LCDST])?\s*(\d{1,2})\b/i);
  if (embedded) {
    const a = embedded[1]!.toUpperCase().replace("T", "D");
    const b = (embedded[3] || embedded[1]!).toUpperCase().replace("T", "D");
    return `${a}${embedded[2]}-${b}${embedded[4]}`;
  }
  return "";
}

/** left | right | bilateral only — medial/lateral are concepts, not laterality. */
export function normalizeLaterality(raw: string | null | undefined): string {
  const n = normalizeSlotPart(raw);
  if (n === "left" || n === "right" || n === "bilateral") return n;
  if (n === "l") return "left";
  if (n === "r") return "right";
  if (n === "b/l" || n === "bilat" || n === "bl") return "bilateral";
  return "";
}

/**
 * Ownership uniqueness key shared by persistence + domain pre-canon checks.
 * Matches `buildSlotKey` dimensions (region|concept|level|laterality).
 * Does NOT include field — findings vs impression of the same concept share a slot family.
 */
export function persistenceOwnershipSlotKey(parts: {
  region?: string | null;
  concept: string;
  level?: string | null;
  laterality?: string | null;
}): string {
  const region = (parts.region ?? "").trim() || SLOT_WILDCARD;
  const concept = (parts.concept || "").trim() || SLOT_WILDCARD;
  const level = normalizeLevel(parts.level) || SLOT_WILDCARD;
  const laterality = normalizeLaterality(parts.laterality) || SLOT_WILDCARD;
  return `${region}|${concept}|${level}|${laterality}`;
}

export type BaselineManifestObservationLike = {
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

export type BaselineManifestLike = {
  kind?: unknown;
  version?: unknown;
  revision?: unknown;
  observations?: unknown;
};

export type StructuralValidationResult = {
  ok: boolean;
  /** Machine-stable reason for API mapping. */
  reason: string;
  details: string[];
  /** Unsupported kind/version → treat as 422; else 400 when failed. */
  unsupported?: boolean;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Structural + ownership-slot integrity for a present baselineManifest.
 * Caller decides legacy-ok when manifest is null/undefined.
 */
export function validateBaselineManifestStructure(opts: {
  findings?: string;
  impression?: string;
  /** Format bodyPart used when observation.region is omitted. */
  defaultRegion?: string;
  baselineManifest: BaselineManifestLike;
}): StructuralValidationResult {
  const manifest = opts.baselineManifest;
  if (typeof manifest !== "object" || manifest == null || Array.isArray(manifest)) {
    return { ok: false, reason: "baselineManifest must be an object", details: [] };
  }

  if (manifest.kind == null || manifest.kind === "") {
    return { ok: false, reason: "baselineManifest.kind is required", details: [] };
  }
  if (manifest.kind !== FULL_REPORT_BASELINE_KIND) {
    return {
      ok: false,
      unsupported: true,
      reason: `Unsupported baselineManifest.kind: ${String(manifest.kind)}`,
      details: [],
    };
  }

  if (manifest.version == null) {
    return { ok: false, reason: "baselineManifest.version is required", details: [] };
  }
  if (manifest.version !== SUPPORTED_BASELINE_MANIFEST_VERSION) {
    return {
      ok: false,
      unsupported: true,
      reason: `Unsupported baselineManifest.version: ${String(manifest.version)} (supported: ${SUPPORTED_BASELINE_MANIFEST_VERSION})`,
      details: [],
    };
  }

  if (!isNonEmptyString(manifest.revision)) {
    return { ok: false, reason: "baselineManifest.revision is required", details: [] };
  }

  if (!Array.isArray(manifest.observations)) {
    return { ok: false, reason: "baselineManifest.observations must be an array", details: [] };
  }

  const findings = opts.findings ?? "";
  const impression = opts.impression ?? "";
  const defaultRegion = (opts.defaultRegion ?? "").trim();
  const details: string[] = [];
  const slots = new Set<string>();

  for (let i = 0; i < manifest.observations.length; i++) {
    const entry = manifest.observations[i] as BaselineManifestObservationLike;
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
      const region =
        typeof entry.region === "string" && entry.region.trim()
          ? entry.region.trim()
          : defaultRegion;
      const slot = persistenceOwnershipSlotKey({
        region,
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
      reason: "baselineManifest failed integrity validation",
      details,
    };
  }
  return { ok: true, reason: "ok", details: [] };
}
