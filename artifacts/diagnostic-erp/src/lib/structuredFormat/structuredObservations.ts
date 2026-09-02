/**
 * Structured Format → Canonical Observation Ledger adapter.
 *
 * Converts structured format field selections (from StructuredFormatPanel /
 * StructuredFormatBuilder) into `PendingPathologyPatch` entries that the
 * existing `applyPathologyOverlay` / `applyMacroBundle` store entrypoints
 * consume. This closes the "Structured Reporting → Ledger changes: NONE"
 * gap identified in PR #658.
 *
 * Architecture (§2 of the PR brief):
 *   StructuredFormatDoc → field selections
 *     → mapCanonicalKeyToConcept(canonicalKey)
 *     → PendingPathologyPatch[]
 *     → store.applyMacroBundle() (existing path)
 *       → observationLedger
 *         → Findings / Impression / AI Composer
 *
 * NO second store. NO StructuredObservation model. NO second compiler.
 * The structured format continues to generate narrative text via the
 * existing generateFromValues() path — this adapter ONLY creates the
 * canonical observation entries that the AI Composer and Impression refresh
 * need.
 *
 * Only ABNORMAL selections produce observations. Normal baseline text
 * remains the responsibility of the Full Report Format (§5).
 */
import type {
  FormatField,
  FormatOption,
  FormatSection,
  StructuredFormatDoc,
  StructuredValues,
  FieldValue,
  FindingsMap,
  ImpressionCandidate,
} from "./types";

/**
 * Map a structured-format canonicalKey to a CARE canonical observation concept.
 *
 * The structured format uses dot notation (e.g. "disc.bulge", "facet.arthropathy")
 * while CARE's observationSlot uses underscore notation (e.g. "disc_contour",
 * "facet_joint"). This function bridges the two.
 */
const CANONICAL_KEY_TO_CONCEPT: Record<string, string> = {
  // Disc
  "disc.normal": "disc_contour",
  "disc.bulge": "disc_contour",
  "disc.protrusion": "disc_contour",
  "disc.extrusion": "disc_contour",
  "disc.herniation": "disc_contour",
  "disc.desiccation": "disc_signal",
  "disc.height_reduction": "disc_height",
  // Canal
  "canal.normal": "canal_stenosis",
  "canal.stenosis.mild": "canal_stenosis",
  "canal.stenosis.moderate": "canal_stenosis",
  "canal.stenosis.severe": "canal_stenosis",
  // Foramina
  "foramina.narrowing": "foraminal_stenosis",
  // Facet
  "facet.arthropathy": "facet_joint",
  // Ligamentum flavum
  "lf.hypertrophy": "ligamentum_flavum",
  // Vertebra
  "vertebra.compression": "fracture",
  "vertebra.modic": "endplate",
  "vertebra.hemangioma": "hemangioma",
  "vertebra.schmorl": "schmorl",
  // Alignment
  "lumbar.lordosis.normal": "alignment",
  "lumbar.loss_of_lordosis": "alignment",
  "lumbar.scoliosis": "alignment",
  "lumbar.listhesis": "spondylolisthesis",
  // Root
  "root.exiting": "foraminal_stenosis",
  "root.traversing": "foraminal_stenosis",
};

export function mapCanonicalKeyToConcept(canonicalKey: string | undefined): string | null {
  if (!canonicalKey) return null;
  return CANONICAL_KEY_TO_CONCEPT[canonicalKey] ?? null;
}

/**
 * Determine the conflictGroup for a concept. In CARE's observationSlot,
 * the conflictGroup is typically the same as the concept name, but some
 * concepts share a conflictGroup (e.g. all disc contour variants share
 * "disc_contour").
 */
function conflictGroupForConcept(concept: string): string {
  return concept;
}

/**
 * Extract the level token from structured values (e.g. "L4-L5" from a
 * repeating group bound to "level").
 */
function extractLevel(values: StructuredValues, section?: FormatSection): string | undefined {
  // Check for explicit level in values (repeating group item token)
  if (section?.repeat?.groupId) {
    const levelVal = values["level"];
    if (typeof levelVal === "string" && levelVal.trim()) return levelVal.trim();
  }
  // Check for level in field values
  for (const key of Object.keys(values)) {
    if (key.startsWith("level.") || key === "level") {
      const v = values[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return undefined;
}

/**
 * Extract laterality from structured values.
 */
function extractLaterality(values: StructuredValues): string | undefined {
  const side = values["side"] ?? values["laterality"];
  if (typeof side === "string" && side.trim()) {
    const lower = side.toLowerCase();
    if (lower === "l" || lower === "left") return "left";
    if (lower === "r" || lower === "right") return "right";
    if (lower === "bil" || lower === "bilateral") return "bilateral";
    return lower;
  }
  return undefined;
}

/**
 * Extract severity from structured values or option metadata.
 */
function extractSeverity(values: StructuredValues, opt?: FormatOption): string | undefined {
  if (opt?.severity && opt.severity !== "normal") return opt.severity;
  const sev = values["severity"];
  if (typeof sev === "string" && sev.trim() && sev !== "normal") return sev;
  return undefined;
}

/**
 * Check whether an option represents a normal baseline (not an active pathology).
 * Normal selections do NOT produce canonical observations (§5).
 */
function isNormalOption(opt: FormatOption | undefined): boolean {
  if (!opt) return false;
  if (opt.severity === "normal") return true;
  const v = `${opt.value} ${opt.label} ${opt.id}`.toLowerCase();
  return /\bnormal\b/.test(v) && !/\babnormal\b/.test(v);
}

/**
 * A structured-format-derived observation patch. This is a subset of
 * PendingPathologyPatch with only the fields that the structured format
 * can populate. Callers wrap this into a full PendingPathologyPatch before
 * calling applyPathologyOverlay.
 */
export type StructuredObservationPatch = {
  concept: string;
  conflictGroup: string;
  findingsText: string;
  impressionText?: string;
  level?: string;
  laterality?: string;
  severity?: string;
  region: string;
  source: "structured-template";
  /** The canonicalKey from the structured format option. */
  canonicalKey?: string;
  /** Whether this observation should contribute to Impression. */
  contributesToImpression: boolean;
};

/**
 * Derive canonical observation patches from a structured format's
 * field selections.
 *
 * Only ABNORMAL selections produce patches. Normal baseline options are
 * skipped (§5 — Full Report Format owns normal baseline narrative).
 *
 * Each abnormal selection with a `canonicalKey` produces one patch.
 * Selections WITHOUT a canonicalKey are skipped (they are free-text or
 * measurement fields that don't map to canonical concepts).
 *
 * @param doc     The structured format document (sections + fields).
 * @param values  The current field values from the UI.
 * @param region  The reporting region (from ReportingStudyContext).
 * @returns       Array of structured observation patches.
 */
export function deriveStructuredObservations(
  doc: StructuredFormatDoc,
  values: StructuredValues,
  region: string,
): StructuredObservationPatch[] {
  const patches: StructuredObservationPatch[] = [];
  const seenKeys = new Set<string>();

  for (const section of doc.sections) {
    const level = extractLevel(values, section);
    for (const field of section.fields) {
      const selectedIds = selectedOptionIds(field, values[field.id]);
      if (selectedIds.length === 0) continue;

      for (const optId of selectedIds) {
        const opt = field.options.find((o) => o.id === optId);
        if (!opt) continue;
        if (isNormalOption(opt)) continue; // §5: skip normal baseline
        if (!opt.canonicalKey) continue; // skip fields without canonical identity

        const concept = mapCanonicalKeyToConcept(opt.canonicalKey);
        if (!concept) continue;

        const laterality = extractLaterality(values);
        const severity = extractSeverity(values, opt);
        const findingsText = opt.outputSentence?.trim() ?? "";
        if (!findingsText) continue;

        const impressionText = opt.impressionSentence?.trim() || undefined;
        const contributesToImpression =
          (opt.impressionWeight ?? 0) > 0 || Boolean(impressionText);

        // Dedupe: same concept + level + laterality → one observation.
        const dedupeKey = [concept, level ?? "", laterality ?? ""].join("|");
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        patches.push({
          concept,
          conflictGroup: conflictGroupForConcept(concept),
          findingsText,
          impressionText,
          level,
          laterality,
          severity,
          region,
          source: "structured-template",
          canonicalKey: opt.canonicalKey,
          contributesToImpression,
        });
      }
    }
  }

  return patches;
}

/**
 * Helper: extract selected option IDs from a field value.
 * (Mirrors the logic in generate.ts but exported for reuse.)
 */
function selectedOptionIds(field: FormatField, value: FieldValue | undefined): string[] {
  if (value == null || value === false || value === "") return [];
  if (field.type === "checkbox" || field.type === "toggle") {
    return value === true || value === "true" || value === "yes"
      ? [field.options[0]?.id].filter(Boolean) as string[]
      : [];
  }
  if (field.type === "multi_select") {
    const ids = Array.isArray(value) ? value.map(String) : String(value).split(",").map((s) => s.trim());
    return ids.filter((id) => field.options.some((o) => o.id === id || o.value === id));
  }
  const raw = String(value);
  const hit = field.options.find((o) => o.id === raw || o.value === raw);
  return hit ? [hit.id] : [];
}

/**
 * P0-C: Compute the set of structured observation IDs that should be REMOVED
 * from the canonical ledger because the corresponding structured format
 * toggle/selection was turned OFF.
 *
 * SCOPING (PR #660 hardening): Removal is scoped to the SAME region as the
 * newly derived patches. This prevents accidentally removing structured
 * observations created by another structured template, another anatomical
 * section, or another region (e.g. Brain structured apply must NOT remove
 * LS Spine structured observations).
 *
 * For IDs that were previously owned by structured reporting in the same
 * region but are no longer in the newly derived set, the caller should call
 * removeObservation on the EXISTING safe removal path — but ONLY if:
 *   - the observation is still owned by structured-template (not overridden
 *     by QS/Voice/Macro)
 *   - the observation is not protected/manual
 *   - the observation is in the SAME region as the new patches
 *
 * @param existingPatches  The current appliedPathologyPatches from the store.
 * @param newPatches        The newly derived StructuredObservationPatch[].
 * @returns                 Array of observation IDs to remove.
 */
export function computeStructuredRemovals(
  existingPatches: Array<{ id: string; source: string; protected?: boolean; region?: string | null }>,
  newPatches: StructuredObservationPatch[],
): string[] {
  // The region of the new patches (all new patches share the same region
  // because deriveStructuredObservations takes a single region parameter).
  const newRegion = newPatches.length > 0 ? (newPatches[0]!.region ?? "").toLowerCase() : "";

  // Build the set of new structured observation IDs.
  // IDs include region to prevent cross-region collisions.
  const newIds = new Set(
    newPatches.map((p) =>
      `structured-${p.region}-${p.concept}-${p.level ?? ""}-${p.laterality ?? ""}`,
    ),
  );

  // Find existing structured-template observations that are no longer in the
  // new set. Only remove observations that:
  //   1. Were created by structured-template (source === "structured-template")
  //   2. Are NOT protected (manual edits survive)
  //   3. Are NOT in the new set (toggle was turned off)
  //   4. Are in the SAME region as the new patches (cross-region protection)
  const toRemove: string[] = [];
  for (const patch of existingPatches) {
    if (patch.source !== "structured-template") continue;
    if (patch.protected) continue;
    // SCOPE: only remove observations in the same region as the current
    // structured format apply. Brain structured apply must NOT remove
    // LS Spine structured observations.
    if (newRegion) {
      const patchRegion = (patch.region ?? "").toLowerCase();
      if (patchRegion !== newRegion) continue;
    }
    if (!newIds.has(patch.id)) {
      toRemove.push(patch.id);
    }
  }
  return toRemove;
}
