// ─────────────────────────────────────────────────────────────────────────────
// radiologyFindingMaterializer.ts — Radiology Roadmap Ticket D3.5 (Finding
// Materialization). PURE conversion of Quick-Select finding selections into
// canonical D1 finding/measurement/recommendation atoms, resolved through the
// B1/B2 catalog. Replaces D3's temporary extensions carrier with true
// findings[] whenever enough TRUTHFUL catalog information exists.
//
// NON-GOALS (hard constraints):
//   • No renderer, no prose generation. `sentence`/`impression_fragment` are the
//     catalog's STORED strings (finding_definitions.narrative / .impression),
//     copied VERBATIM (sentence_source = "content_pack_default") — not
//     interpolated (that is D4's job). A measurement `display` is a factual
//     "<value> <unit>", not clinical prose.
//   • Touches no renderer/patient_reports/UI/AI/billing.
//
// TRUTHFULNESS:
//   • A selected Quick-Select finding is an ABNORMALITY the radiologist asserted
//     by selecting it (the engine is literally "Abnormality-Driven Reporting").
//     So presence="present", certainty="definite", is_significant=true are the
//     DEFINITIONAL reading of that assertion — documented here, reversible in one
//     place — not fabricated clinical judgement.
//   • Every ref (definition/severity/location/measurement) is emitted ONLY when
//     it resolves in the catalog for THIS finding; an unmapped optional param is
//     omitted (null/[]), never invented.
//   • A finding that cannot be truthfully materialized (catalog can't resolve it,
//     or it has no stored narrative/impression) is SKIPPED and preserved for
//     audit (the adapter puts skips into extensions).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Finding,
  Measurement,
  Recommendation,
  InstanceProvenance,
  RecommendationPriority,
  LateralityValue,
  LateralityRef,
} from "./structuredReport/types";
import { RECOMMENDATION_PRIORITY_VALUES } from "./structuredReport/types";
import type { CatalogStore } from "./radiologyCatalog/store";

// ── Inputs ───────────────────────────────────────────────────────────────────

/** AbnormalityInstance-shaped params carried on each selection (all optional,
 *  free text). Additional keys are ignored. */
export interface FindingSelectionParams {
  side?: string;        // "" | left | right | bilateral
  severity?: string;    // "" | mild | moderate | severe
  chronicity?: string;  // "" | acute | chronic  (no D1 finding field — dropped truthfully)
  level?: string;       // e.g. "L4-L5"
  value?: string;       // measurement value, e.g. "8"
  [k: string]: unknown;
}

export interface FindingSelection {
  findingId: number; // radiology_quick_findings.id
  params: FindingSelectionParams;
  source: string; // quickselect | manual | voice | ...
}

/** The catalog data the materializer needs for one selection, already resolved.
 *  Keys are the raw catalog keys (no namespace prefix). */
export interface CatalogResolvedFinding {
  definitionKey: string;            // finding_definitions.key  → "finding.<key>"
  narrative: string | null;         // → sentence               (required, else skip)
  impression: string | null;        // → impression_fragment    (required, else skip)
  severityKeys: string[];           // finding_severity_bindings.key for this finding
  locationKeys: string[];           // finding_locations.key for this finding
  measurementBindings: Array<{ key: string; unit: string }>; // finding_measurement_bindings
  recommendations: Array<{ text: string; priority: string | null }>; // finding_recommendations
}

export interface FindingCatalogResolver {
  /** Resolve a Quick-Select selection to its canonical B1/B2 finding + bindings,
   *  or null when it cannot be resolved (missing quick-finding/alias/definition). */
  resolve(quickFindingId: number): Promise<CatalogResolvedFinding | null>;
}

/** Truthful provenance context (from the draft), stamped onto every atom. */
export interface MaterializationContext {
  actor: string;        // draft.createdBy
  createdAtIso: string; // draft.createdAt (ISO-8601)
}

// ── Output ───────────────────────────────────────────────────────────────────

export interface SkippedFindingSelection {
  finding_id: number;
  params: unknown;
  source: string;
  reason: string;
}

export interface MaterializationOutput {
  findings: Finding[];
  measurements: Measurement[];
  recommendations: Recommendation[];
  skipped: SkippedFindingSelection[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_LAT = new Set<LateralityValue>(["left", "right", "bilateral"]);

/** Normalize a free-text token to the catalog key convention
 *  (lower(trim), spaces/hyphens → underscore) so "L4-L5" matches key "l4_l5". */
export function normalizeCatalogToken(v: string): string {
  return v.toLowerCase().trim().replace(/[\s-]+/g, "_");
}

/** D1 origin values are underscored (§18); the route/dual-write uses
 *  "quickselect". Map to the documented origin so R10w does not warn. */
function normalizeOrigin(source: string): string {
  return source === "quickselect" ? "quick_select" : source;
}

function mapPriority(p: string | null): RecommendationPriority {
  return (RECOMMENDATION_PRIORITY_VALUES as readonly string[]).includes(p ?? "")
    ? (p as RecommendationPriority)
    : "routine";
}

// ── Materializer (pure) ──────────────────────────────────────────────────────

/**
 * Convert finding selections into canonical D1 atoms. Pure and deterministic:
 * given the same selections + resolver results + context, produces byte-stable
 * output. Skips (with a reason) any selection that cannot be truthfully
 * materialized; the caller preserves skips in extensions for audit.
 */
export async function materializeFindings(
  selections: FindingSelection[],
  resolver: FindingCatalogResolver,
  ctx: MaterializationContext,
): Promise<MaterializationOutput> {
  const findings: Finding[] = [];
  const measurements: Measurement[] = [];
  const recommendations: Recommendation[] = [];
  const skipped: SkippedFindingSelection[] = [];

  const skip = (sel: FindingSelection, reason: string) =>
    skipped.push({ finding_id: sel.findingId, params: sel.params, source: sel.source, reason });

  for (let i = 0; i < selections.length; i++) {
    const sel = selections[i];
    const resolved = await resolver.resolve(sel.findingId);
    if (!resolved) { skip(sel, "catalog_unresolved"); continue; }
    if (!resolved.narrative || resolved.narrative.trim() === "") { skip(sel, "no_catalog_narrative"); continue; }
    if (!resolved.impression || resolved.impression.trim() === "") { skip(sel, "no_catalog_impression"); continue; }

    const findingLid = `f${i + 1}`;
    const params = sel.params ?? {};
    const provenance: InstanceProvenance = {
      origin: normalizeOrigin(sel.source),
      actor: ctx.actor,
      created_at: ctx.createdAtIso,
      edited: false,
    };

    // laterality — only a valid, closed lat.* value (Side is left|right|bilateral).
    const sideNorm = typeof params.side === "string" ? params.side.toLowerCase().trim() : "";
    const laterality: LateralityRef | null = VALID_LAT.has(sideNorm as LateralityValue)
      ? (`lat.${sideNorm as LateralityValue}` as LateralityRef)
      : null;

    // severity — only when THIS finding has a matching severity binding.
    const sevNorm = typeof params.severity === "string" ? normalizeCatalogToken(params.severity) : "";
    const severity = sevNorm && resolved.severityKeys.map(normalizeCatalogToken).includes(sevNorm)
      ? `sev.${resolved.severityKeys.find((k) => normalizeCatalogToken(k) === sevNorm)}`
      : null;

    // locations — only when params.level matches a location binding key.
    const lvlNorm = typeof params.level === "string" ? normalizeCatalogToken(params.level) : "";
    const matchedLoc = lvlNorm ? resolved.locationKeys.find((k) => normalizeCatalogToken(k) === lvlNorm) : undefined;
    const locations = matchedLoc ? [`loc.${matchedLoc}`] : [];

    // measurement — only an UNAMBIGUOUS numeric value against exactly one binding.
    const measurementRefs: string[] = [];
    const rawValue = typeof params.value === "string" ? params.value.trim() : "";
    const numValue = rawValue === "" ? NaN : Number(rawValue);
    if (Number.isFinite(numValue) && resolved.measurementBindings.length === 1) {
      const binding = resolved.measurementBindings[0];
      const measLid = `m${i + 1}`;
      measurementRefs.push(measLid);
      measurements.push({
        lid: measLid,
        measurement_ref: `meas.${binding.key}`,
        finding_ref: findingLid,
        site: null,
        laterality,
        value: numValue,
        unit: binding.unit,
        value_kind: "scalar",
        value_iso: null,
        range: null,
        components: null,
        normal_range: null,
        abnormal: false,
        prior_value: null,
        prior_measurement_ref_document: null,
        change_pct: null,
        provenance: {
          origin: normalizeOrigin(sel.source),
          source: "manual", // a value typed into the Quick-Select measurement chip
          confidence: 1,
          edited: false,
        },
        display: `${numValue} ${binding.unit}`, // factual value+unit, not prose
      });
    }

    findings.push({
      lid: findingLid,
      definition_ref: `finding.${resolved.definitionKey}`,
      presence: "present",   // definitional: a selected abnormality is present
      certainty: "definite", // definitional: selecting asserts the abnormality
      laterality,
      locations,
      severity,
      interval_change: null,
      parameters: [], // AbnormalityInstance carries no catalog param-group values
      measurement_refs: measurementRefs,
      sentence: resolved.narrative,             // catalog default, verbatim
      impression_fragment: resolved.impression, // catalog default, verbatim
      sentence_source: "content_pack_default",
      status_flags: { is_significant: true, is_critical: false, is_incidental: false },
      included_from: null,
      provenance,
      ai: null,
      order: (i + 1) * 10,
    });

    // recommendations — catalog free-text (no code column → recommendation_ref null).
    for (let r = 0; r < resolved.recommendations.length; r++) {
      const rec = resolved.recommendations[r];
      recommendations.push({
        lid: `r${i + 1}_${r + 1}`,
        recommendation_ref: null,
        finding_refs: [findingLid],
        text: rec.text,
        priority: mapPriority(rec.priority),
        provenance: { origin: "content_pack_default", actor: ctx.actor, created_at: ctx.createdAtIso, edited: false },
        ai: null,
      });
    }
  }

  return { findings, measurements, recommendations, skipped };
}

// ── CatalogStore-backed resolver ─────────────────────────────────────────────

/** Resolve a Quick-Select finding id to its label. In production this is a
 *  radiology_quick_findings lookup; in tests, an in-memory map. Kept injectable
 *  so the resolver has no direct DB dependency (and the whole module stays unit-
 *  testable without a database, per this repo's convention). */
export type QuickFindingLabelLookup = (quickFindingId: number) => Promise<{ label: string } | null>;

/**
 * Resolves selections through the real B1/B2 catalog: Quick-Select finding →
 * label → finding_aliases (normalized) → finding_definitions + its bindings.
 * Returns null (→ the selection is skipped) at the first missing hop, so a
 * dormant/partially-seeded catalog simply materializes nothing rather than
 * fabricating.
 */
export class CatalogStoreFindingResolver implements FindingCatalogResolver {
  constructor(
    private readonly store: CatalogStore,
    private readonly quickFindingLookup: QuickFindingLabelLookup,
  ) {}

  async resolve(quickFindingId: number): Promise<CatalogResolvedFinding | null> {
    const qf = await this.quickFindingLookup(quickFindingId);
    if (!qf || typeof qf.label !== "string" || qf.label.trim() === "") return null;

    // finding_aliases.normalized = lower(trim(aliasKey)); match the same way.
    const normalized = qf.label.toLowerCase().trim();
    const alias = await this.store.findOne("finding_aliases", { normalized });
    if (!alias || alias.findingId == null) return null;

    const def = await this.store.getById("finding_definitions", alias.findingId as number);
    if (!def) return null;

    const findingId = def.id;
    const [severity, locations, measurements, recs] = await Promise.all([
      this.store.list("finding_severity_bindings", { where: { findingId } }),
      this.store.list("finding_locations", { where: { findingId } }),
      this.store.list("finding_measurement_bindings", { where: { findingId } }),
      this.store.list("finding_recommendations", { where: { findingId } }),
    ]);

    return {
      definitionKey: def.key as string,
      narrative: (def.narrative as string | null) ?? null,
      impression: (def.impression as string | null) ?? null,
      severityKeys: severity.map((r) => r.key as string),
      locationKeys: locations.map((r) => r.key as string),
      measurementBindings: measurements.map((r) => ({ key: r.key as string, unit: (r.unit as string) ?? "mm" })),
      recommendations: recs.map((r) => ({
        text: r.recommendationText as string,
        priority: (r.priority as string | null) ?? null,
      })),
    };
  }
}
