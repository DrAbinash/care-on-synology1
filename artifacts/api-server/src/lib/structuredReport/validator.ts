// ─────────────────────────────────────────────────────────────────────────────
// Pure validator for the canonical Structured Report JSON (Ticket D1, frozen
// spec revision 2 — docs/STRUCTURED_REPORT_JSON_SPEC_v1.md, §12).
//
// (document, catalogSnapshot, contentPackRegistries) → {ok, errors[], warnings[]}
// per D1 §19 item 2. Pure given its injected ports — no other IO — so it is
// exhaustively unit-testable with no live database, matching the B1/B2 and K1
// validation layers' own convention (packs/validator.ts, radiologyCatalog/validation.ts).
//
// Tier A = structural (would be caught by the JSON Schema, ./schema/
// structured-report-v1.schema.json — implemented here as direct TS checks
// rather than a generic schema evaluator, matching this codebase's existing
// hand-written "pure guards" convention). Tier B = semantic/referential (needs
// the pinned catalog / content-pack registries).
//
// Every rule below is annotated with its D1 §12 rule id and enforcement tier
// so a reader can trace each check back to the frozen spec. "Always" rules run
// on every write (draft save AND finalize); "Draft: warn / Finalize: reject"
// rules (R8, R15, R16) and finalize-only rules (R14, R14b, R14c, R13's
// signed_by-distinctness half) are gated by `ctx.mode`.
// ─────────────────────────────────────────────────────────────────────────────

import {
  DOCUMENT_ID_PATTERN,
  SCHEMA_VERSION_PATTERN,
  LATERALITY_VALUES,
  PRESENCE_VALUES,
  CERTAINTY_VALUES,
  SENTENCE_SOURCE_VALUES,
  INTERVAL_CHANGE_VALUES,
  VALUE_KIND_VALUES,
  MEASUREMENT_SOURCE_VALUES,
  PROVENANCE_ORIGIN_VALUES,
  IMPRESSION_FRAGMENT_SOURCE_VALUES,
  RECOMMENDATION_PRIORITY_VALUES,
  CRITICAL_FLAG_STATUS_VALUES,
  SIGNATURE_STATE_VALUES,
  HASH_ALGORITHM_VALUES,
  PARAMETER_KIND_VALUES,
  splitRef,
  type StructuredReportDocument,
  type Finding,
  type Measurement,
  type ParameterEntry,
  type Recommendation,
  type ImpressionFragment,
  type CriticalFlag,
  type InstanceProvenance,
  type InstanceAiBlock,
} from "./types";
import type { StructuredReportCatalogPort } from "./catalogAccess";
import type { AiRulesRegistryPort } from "./aiRulesRegistry";

export type ValidationMode = "draft" | "finalize";

export interface ValidationIssue {
  rule: string; // D1 §12 rule id, e.g. "R1", "R2b", "R10w"
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean; // false if ANY error — no partial success
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** Content-pack registry namespaces validated only for well-formedness (§1.4, §11.3):
 * no live B1/B2 table backs rec./crit./tpl./combo. — they were already checked by
 * K1 at pack-import time. */
const CONTENT_PACK_ONLY_NAMESPACES = new Set(["rec", "crit", "tpl", "combo"]);
const GLOBAL_CATALOG_NAMESPACES = new Set(["finding", "param"]);
const FINDING_SCOPED_NAMESPACES = new Set(["sev", "loc", "meas"]);
const UNPINNED_AI_ALIASES = new Set(["latest", "prod"]);

/** Lightweight UCUM-plausibility check (R5) — not a full UCUM parser (out of
 * scope for this ticket). Accepts the unit tokens used throughout D1 §17's
 * worked examples (mm, cm/s, wk, %, 1, count, ...) and rejects obvious
 * non-units (empty string, free text with spaces). A real UCUM validator is a
 * follow-up ticket, not invented here. */
function looksLikeUcum(unit: string): boolean {
  return /^[a-zA-Z%\/.\-0-9]+$/.test(unit) && unit.length > 0;
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

class IssueCollector {
  errors: ValidationIssue[] = [];
  warnings: ValidationIssue[] = [];

  reject(rule: string, path: string, message: string): void {
    this.errors.push({ rule, severity: "error", path, message });
  }

  warn(rule: string, path: string, message: string): void {
    this.warnings.push({ rule, severity: "warning", path, message });
  }

  /** R8/R15/R16: warn on draft, reject on finalize. */
  warnOnDraftRejectOnFinalize(mode: ValidationMode, rule: string, path: string, message: string): void {
    if (mode === "finalize") this.reject(rule, path, message);
    else this.warn(rule, path, message);
  }
}

export interface ValidationContext {
  catalog: StructuredReportCatalogPort;
  aiRules: AiRulesRegistryPort;
  mode: ValidationMode;
  /** R14b: resolve whether a finalize-action audit_logs row records this
   * document_id + signed_content_sha256. Honest-gap pattern (see
   * aiRulesRegistry.ts): omit to skip the live-row check with a warning
   * instead of crashing — a future ticket wires the real audit_logs query. */
  auditLogLookup?: (documentId: string, signedContentSha256: string) => Promise<boolean>;
  /** R14c: resolve a prior document's signature state by document_id, and
   * whether it has already been amended by someone else. Same honest-gap
   * pattern; omit to skip with a warning. */
  amendsLookup?: (priorDocumentId: string) => Promise<{ state: string; alreadyAmendedBy: string | null } | null>;
}

export async function validateStructuredReport(doc: unknown, ctx: ValidationContext): Promise<ValidationResult> {
  const issues = new IssueCollector();

  // R0 (tier A, always): parses as an object at all.
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    issues.reject("R0", "$", "document is not a JSON object");
    return { ok: false, errors: issues.errors, warnings: issues.warnings };
  }
  const d = doc as Partial<StructuredReportDocument> & Record<string, unknown>;

  checkR0Envelope(d, issues);
  checkR18Identifiers(d, issues);
  checkR3LidUniqueness(d, issues);
  checkR10ProvenancePresence(d, issues);

  // Tier B checks assume the tier-A shape held; if R0 already rejected the
  // envelope outright we still attempt referential checks defensively (D1
  // §12: "Validation is pure given (document, catalog_snapshot,
  // content_pack_registries)" — it does not require short-circuiting after
  // the first structural failure, and surfacing every failure in one pass is
  // more useful to a writer than reject-on-first-error).
  await checkR1FindingAndParamRefs(d, ctx, issues);
  checkR2IntraDocRefs(d, issues);
  checkR2bMeasurementOwnership(d, issues);
  await checkR4SeverityLocationLaterality(d, ctx, issues);
  await checkR5MeasurementUnits(d, ctx, issues);
  await checkR6Parameters(d, ctx, issues);
  checkR7ClinicalConsistency(d, issues);
  await checkR8RequiredParameters(d, ctx, issues);
  checkR9DuplicateRecommendationRefs(d, issues);
  checkR10wOriginVocabulary(d, issues);
  checkR10bRevisionReconciliation(d, issues);
  checkR11AiLinkage(d, issues);
  checkR11bBidirectionalAiLinkage(d, issues);
  checkR11cAiFieldEquality(d, issues);
  checkR12UnpinnedAliasesAndDigests(d, issues);
  checkR13AutoSign(d, issues);
  await checkR13SignedByDistinctness(d, ctx, issues);
  checkR14FinalizeSignature(d, ctx, issues);
  await checkR14bAuditLogRef(d, ctx, issues);
  await checkR14cAmendmentChain(d, ctx, issues);
  await checkR15Contradictions(d, ctx, issues);
  await checkR16Completeness(d, ctx, issues);
  checkR17CriticalFlags(d, issues);

  return { ok: issues.errors.length === 0, errors: issues.errors, warnings: issues.warnings };
}

// ── R0 — structural envelope (tier A) ─────────────────────────────────────────

const TOP_LEVEL_REQUIRED = [
  "schema_version", "kind", "document_id", "catalog_snapshot", "study_context",
  "findings", "measurements", "recommendations", "critical_flags", "provenance", "ai", "audit",
] as const;
const TOP_LEVEL_ALLOWED = new Set([...TOP_LEVEL_REQUIRED, "sections", "impression", "extensions"]);

function checkR0Envelope(d: Record<string, unknown>, issues: IssueCollector): void {
  for (const key of TOP_LEVEL_REQUIRED) {
    if (!(key in d)) issues.reject("R0", `$.${key}`, `missing required top-level field "${key}"`);
  }
  for (const key of Object.keys(d)) {
    if (!TOP_LEVEL_ALLOWED.has(key) && !key.startsWith("x_")) {
      issues.reject("R0", `$.${key}`, `unknown top-level field "${key}" (not declared, not x_-prefixed)`);
    }
  }
  if (d.kind !== undefined && d.kind !== "radiology.structured_report") {
    issues.reject("R0", "$.kind", `kind must be "radiology.structured_report", got ${JSON.stringify(d.kind)}`);
  }
  if (!Array.isArray(d.findings)) issues.reject("R0", "$.findings", "findings must be an array");
  if (!Array.isArray(d.measurements)) issues.reject("R0", "$.measurements", "measurements must be an array");
  if (!Array.isArray(d.recommendations)) issues.reject("R0", "$.recommendations", "recommendations must be an array");
  if (!Array.isArray(d.critical_flags)) issues.reject("R0", "$.critical_flags", "critical_flags must be an array");
  if (d.ai !== undefined && (typeof d.ai !== "object" || d.ai === null)) {
    issues.reject("R0", "$.ai", "ai must be an object (D1 §1.1/§9.1: required even when empty)");
  } else if (d.ai) {
    const ai = d.ai as Record<string, unknown>;
    if (!("guarding" in ai) || typeof ai.guarding !== "object" || ai.guarding === null) {
      issues.reject("R0", "$.ai.guarding", "ai.guarding is required (§1.5)");
    }
    if (!Array.isArray(ai.runs)) issues.reject("R0", "$.ai.runs", "ai.runs must be an array");
  }
  for (const [i, f] of (Array.isArray(d.findings) ? d.findings : []).entries()) {
    checkFindingEnums(f as Partial<Finding>, `$.findings[${i}]`, issues);
  }
  for (const [i, m] of (Array.isArray(d.measurements) ? d.measurements : []).entries()) {
    checkMeasurementEnums(m as Partial<Measurement>, `$.measurements[${i}]`, issues);
  }
}

function checkFindingEnums(f: Partial<Finding>, path: string, issues: IssueCollector): void {
  if (f.presence !== undefined && !(PRESENCE_VALUES as readonly string[]).includes(f.presence)) {
    issues.reject("R0", `${path}.presence`, `invalid presence "${f.presence}"`);
  }
  if (f.certainty !== undefined && !(CERTAINTY_VALUES as readonly string[]).includes(f.certainty)) {
    issues.reject("R0", `${path}.certainty`, `invalid certainty "${f.certainty}"`);
  }
  if (f.sentence_source !== undefined && !(SENTENCE_SOURCE_VALUES as readonly string[]).includes(f.sentence_source)) {
    issues.reject("R0", `${path}.sentence_source`, `invalid sentence_source "${f.sentence_source}"`);
  }
  if (f.interval_change != null && !(INTERVAL_CHANGE_VALUES as readonly string[]).includes(f.interval_change)) {
    issues.reject("R0", `${path}.interval_change`, `invalid interval_change "${f.interval_change}"`);
  }
  if (f.laterality != null && !(LATERALITY_VALUES as readonly string[]).includes(String(f.laterality).replace(/^lat\./, ""))) {
    issues.reject("R0", `${path}.laterality`, `invalid laterality "${f.laterality}"`);
  }
}

function checkMeasurementEnums(m: Partial<Measurement>, path: string, issues: IssueCollector): void {
  if (m.value_kind !== undefined && !(VALUE_KIND_VALUES as readonly string[]).includes(m.value_kind)) {
    issues.reject("R0", `${path}.value_kind`, `invalid value_kind "${m.value_kind}"`);
  }
  if (m.value_kind === "derived" && (!m.components || m.components.length === 0)) {
    issues.reject("R0", `${path}.components`, `value_kind="derived" requires a non-empty components[] (§4)`);
  }
  if (m.value_kind === "date" && !m.value_iso) {
    issues.reject("R0", `${path}.value_iso`, `value_kind="date" requires value_iso (§4)`);
  }
  if (m.provenance?.source !== undefined && !(MEASUREMENT_SOURCE_VALUES as readonly string[]).includes(m.provenance.source)) {
    issues.reject("R0", `${path}.provenance.source`, `invalid measurement source "${m.provenance.source}"`);
  }
}

// ── R18 — identifiers (tier A) ────────────────────────────────────────────────

function checkR18Identifiers(d: Record<string, unknown>, issues: IssueCollector): void {
  if (typeof d.document_id !== "string" || !DOCUMENT_ID_PATTERN.test(d.document_id)) {
    issues.reject("R18", "$.document_id", `document_id must match ${DOCUMENT_ID_PATTERN} (Crockford Base32 ULID, 26 chars)`);
  }
  if (typeof d.schema_version !== "string" || !SCHEMA_VERSION_PATTERN.test(d.schema_version)) {
    issues.reject("R18", "$.schema_version", `schema_version must match ${SCHEMA_VERSION_PATTERN}`);
  }
}

// ── R3 — lid uniqueness across every array (tier A) ───────────────────────────

function checkR3LidUniqueness(d: Record<string, unknown>, issues: IssueCollector): void {
  const seen = new Map<string, string>(); // lid -> first path seen at
  const record = (lid: unknown, path: string): void => {
    if (typeof lid !== "string" || lid.length === 0) return;
    const prior = seen.get(lid);
    if (prior) {
      issues.reject("R3", path, `duplicate lid "${lid}" (also used at ${prior}) — lids must be unique document-wide`);
    } else {
      seen.set(lid, path);
    }
  };
  for (const [i, f] of asArray<Finding>(d.findings).entries()) record(f.lid, `$.findings[${i}].lid`);
  for (const [i, m] of asArray<Measurement>(d.measurements).entries()) record(m.lid, `$.measurements[${i}].lid`);
  for (const [i, r] of asArray<Recommendation>(d.recommendations).entries()) record(r.lid, `$.recommendations[${i}].lid`);
  for (const [i, c] of asArray<CriticalFlag>(d.critical_flags).entries()) record(c.lid, `$.critical_flags[${i}].lid`);
  const impression = d.impression as StructuredReportDocument["impression"] | undefined;
  for (const [i, fr] of (impression?.fragments ?? []).entries()) record(fr.lid, `$.impression.fragments[${i}].lid`);
  for (const [i, it] of (impression?.items ?? []).entries()) record(it.lid, `$.impression.items[${i}].lid`);
  const sections = (d.sections as StructuredReportDocument["sections"]) ?? [];
  for (const [i, s] of sections.entries()) record(s.lid, `$.sections[${i}].lid`);
}

// ── R10 — provenance presence (tier A) ────────────────────────────────────────

function checkR10ProvenancePresence(d: Record<string, unknown>, issues: IssueCollector): void {
  const check = (prov: InstanceProvenance | undefined, path: string): void => {
    if (!prov) {
      issues.reject("R10", path, "missing provenance");
      return;
    }
    if (typeof prov.origin !== "string" || prov.origin.length === 0) {
      issues.reject("R10", `${path}.origin`, "provenance.origin must be a non-empty string");
    }
    if (!isIsoDateTime(prov.created_at)) {
      issues.reject("R10", `${path}.created_at`, `provenance.created_at "${prov.created_at}" is not a valid ISO-8601 timestamp`);
    }
  };
  for (const [i, f] of asArray<Finding>(d.findings).entries()) check(f.provenance, `$.findings[${i}].provenance`);
  // Measurements carry their own provenance shape (§4: origin/source/confidence/
  // edited, no required created_at) — distinct from the InstanceProvenance shape
  // (§8.2) that findings/recommendations/impression-fragments/critical-flags use.
  // R10's created_at requirement therefore does not apply to measurements; only
  // the shared origin-non-empty requirement does.
  for (const [i, m] of asArray<Measurement>(d.measurements).entries()) {
    if (!m.provenance) {
      issues.reject("R10", `$.measurements[${i}].provenance`, "missing provenance");
    } else if (typeof m.provenance.origin !== "string" || m.provenance.origin.length === 0) {
      issues.reject("R10", `$.measurements[${i}].provenance.origin`, "provenance.origin must be a non-empty string");
    }
  }
  for (const [i, r] of asArray<Recommendation>(d.recommendations).entries()) check(r.provenance, `$.recommendations[${i}].provenance`);
  for (const [i, c] of asArray<CriticalFlag>(d.critical_flags).entries()) check(c.provenance, `$.critical_flags[${i}].provenance`);
  const impression = d.impression as StructuredReportDocument["impression"] | undefined;
  for (const [i, fr] of (impression?.fragments ?? []).entries()) check(fr.provenance, `$.impression.fragments[${i}].provenance`);
}

// ── R1 — finding./param. global resolution; rec./crit./tpl./combo. well-formed (tier B) ──

async function checkR1FindingAndParamRefs(
  d: Record<string, unknown>,
  ctx: ValidationContext,
  issues: IssueCollector,
): Promise<void> {
  const findings = asArray<Finding>(d.findings);
  for (const [i, f] of findings.entries()) {
    const path = `$.findings[${i}].definition_ref`;
    const split = splitRef(f.definition_ref ?? "");
    if (!split || split.namespace !== "finding") {
      issues.reject("R1", path, `definition_ref "${f.definition_ref}" is not a well-formed finding.<key> reference`);
      continue;
    }
    const resolved = await ctx.catalog.resolveFinding(split.key);
    if (!resolved) issues.reject("R1", path, `finding.${split.key} does not resolve in the live catalog`);

    for (const [pi, p] of (f.parameters ?? []).entries()) {
      const ppath = `$.findings[${i}].parameters[${pi}].param`;
      const psplit = splitRef(p.param ?? "");
      if (!psplit || psplit.namespace !== "param") {
        issues.reject("R1", ppath, `param "${p.param}" is not a well-formed param.<key> reference`);
        continue;
      }
      const group = await ctx.catalog.resolveParameterGroup(psplit.key);
      if (!group) issues.reject("R1", ppath, `param.${psplit.key} does not resolve in the live catalog`);
    }
  }

  for (const [i, r] of asArray<Recommendation>(d.recommendations).entries()) {
    if (r.recommendation_ref == null) continue;
    checkContentPackNamespace(r.recommendation_ref, "rec", `$.recommendations[${i}].recommendation_ref`, issues);
  }
  for (const [i, c] of asArray<CriticalFlag>(d.critical_flags).entries()) {
    checkContentPackNamespace(c.critical_ref, "crit", `$.critical_flags[${i}].critical_ref`, issues);
  }
  const studyContext = d.study_context as StructuredReportDocument["study_context"] | undefined;
  if (studyContext?.template_ref) {
    checkContentPackNamespace(studyContext.template_ref, "tpl", "$.study_context.template_ref", issues);
  }
  for (const [i, f] of findings.entries()) {
    if (f.included_from?.kind === "combo") {
      checkContentPackNamespace(f.included_from.ref, "combo", `$.findings[${i}].included_from.ref`, issues);
    }
  }
}

function checkContentPackNamespace(ref: string, expectedNs: string, path: string, issues: IssueCollector): void {
  const split = splitRef(ref);
  if (!split || split.namespace !== expectedNs || split.key.length === 0) {
    issues.reject("R1", path, `"${ref}" is not a well-formed ${expectedNs}.<key> reference (content-pack registry, §1.4/§11.3 — no live table backs this namespace)`);
  }
}

// ── R2 — intra-document reference integrity (tier B) ──────────────────────────

function checkR2IntraDocRefs(d: Record<string, unknown>, issues: IssueCollector): void {
  const findingLids = new Set(asArray<Finding>(d.findings).map((f) => f.lid));
  const measurementLids = new Set(asArray<Measurement>(d.measurements).map((m) => m.lid));
  const impression = d.impression as StructuredReportDocument["impression"] | undefined;
  const fragmentLids = new Set((impression?.fragments ?? []).map((fr) => fr.lid));

  for (const [i, f] of asArray<Finding>(d.findings).entries()) {
    for (const [ri, mref] of (f.measurement_refs ?? []).entries()) {
      if (!measurementLids.has(mref)) {
        issues.reject("R2", `$.findings[${i}].measurement_refs[${ri}]`, `measurement_refs entry "${mref}" does not match any measurements[].lid`);
      }
    }
  }
  for (const [i, m] of asArray<Measurement>(d.measurements).entries()) {
    if (m.finding_ref != null && !findingLids.has(m.finding_ref)) {
      issues.reject("R2", `$.measurements[${i}].finding_ref`, `finding_ref "${m.finding_ref}" does not match any findings[].lid`);
    }
  }
  for (const [i, r] of asArray<Recommendation>(d.recommendations).entries()) {
    for (const [ri, fref] of (r.finding_refs ?? []).entries()) {
      if (!findingLids.has(fref)) {
        issues.reject("R2", `$.recommendations[${i}].finding_refs[${ri}]`, `finding_refs entry "${fref}" does not match any findings[].lid`);
      }
    }
  }
  for (const [i, c] of asArray<CriticalFlag>(d.critical_flags).entries()) {
    if (!findingLids.has(c.finding_ref)) {
      issues.reject("R2", `$.critical_flags[${i}].finding_ref`, `finding_ref "${c.finding_ref}" does not match any findings[].lid`);
    }
  }
  for (const [i, fr] of (impression?.fragments ?? []).entries()) {
    if (fr.finding_ref != null && !findingLids.has(fr.finding_ref)) {
      issues.reject("R2", `$.impression.fragments[${i}].finding_ref`, `finding_ref "${fr.finding_ref}" does not match any findings[].lid`);
    }
  }
  for (const [i, it] of (impression?.items ?? []).entries()) {
    for (const [ri, fref] of (it.fragment_refs ?? []).entries()) {
      if (!fragmentLids.has(fref)) {
        issues.reject("R2", `$.impression.items[${i}].fragment_refs[${ri}]`, `fragment_refs entry "${fref}" does not match any impression.fragments[].lid`);
      }
    }
  }
  const audit = d.audit as StructuredReportDocument["audit"] | undefined;
  const amends = audit?.signature?.amends_document_id;
  if (amends != null && !DOCUMENT_ID_PATTERN.test(amends)) {
    issues.reject("R2", "$.audit.signature.amends_document_id", `amends_document_id "${amends}" is not a well-formed document_id`);
  }
}

// ── R2b — measurement ownership is 1:1, not "F or null" (tier B) ─────────────

function checkR2bMeasurementOwnership(d: Record<string, unknown>, issues: IssueCollector): void {
  const measurementByLid = new Map(asArray<Measurement>(d.measurements).map((m) => [m.lid, m]));
  for (const [i, f] of asArray<Finding>(d.findings).entries()) {
    for (const [ri, mlid] of (f.measurement_refs ?? []).entries()) {
      const m = measurementByLid.get(mlid);
      if (m && m.finding_ref !== f.lid) {
        issues.reject(
          "R2b",
          `$.findings[${i}].measurement_refs[${ri}]`,
          `measurement "${mlid}" is listed under finding "${f.lid}" but its own finding_ref is "${m.finding_ref}" — ownership must match exactly`,
        );
      }
    }
  }
}

// ── R4 — severity/locations/laterality are finding-scoped (tier B) ───────────

async function checkR4SeverityLocationLaterality(
  d: Record<string, unknown>,
  ctx: ValidationContext,
  issues: IssueCollector,
): Promise<void> {
  for (const [i, f] of asArray<Finding>(d.findings).entries()) {
    if (f.laterality != null) {
      const bare = String(f.laterality).replace(/^lat\./, "");
      if (!(LATERALITY_VALUES as readonly string[]).includes(bare)) {
        issues.reject("R4", `$.findings[${i}].laterality`, `laterality "${f.laterality}" is not a valid lat.* enum value`);
      }
    }
    const findingSplit = splitRef(f.definition_ref ?? "");
    if (!findingSplit) continue; // already reported by R1
    const resolvedFinding = await ctx.catalog.resolveFinding(findingSplit.key);
    if (!resolvedFinding) continue; // already reported by R1

    if (f.severity != null) {
      const sevSplit = splitRef(f.severity);
      if (!sevSplit || sevSplit.namespace !== "sev") {
        issues.reject("R4", `$.findings[${i}].severity`, `severity "${f.severity}" is not a well-formed sev.<key> reference`);
      } else {
        const bound = await ctx.catalog.resolveFindingSeverity(resolvedFinding.id, sevSplit.key);
        if (!bound) issues.reject("R4", `$.findings[${i}].severity`, `sev.${sevSplit.key} is not bound to finding.${findingSplit.key}`);
      }
    }
    for (const [li, loc] of (f.locations ?? []).entries()) {
      const locSplit = splitRef(loc);
      if (!locSplit || locSplit.namespace !== "loc") {
        issues.reject("R4", `$.findings[${i}].locations[${li}]`, `location "${loc}" is not a well-formed loc.<key> reference`);
        continue;
      }
      const bound = await ctx.catalog.resolveFindingLocation(resolvedFinding.id, locSplit.key);
      if (!bound) issues.reject("R4", `$.findings[${i}].locations[${li}]`, `loc.${locSplit.key} is not bound to finding.${findingSplit.key}`);
    }
  }
}

// ── R5 — measurement units (tier B) ───────────────────────────────────────────

async function checkR5MeasurementUnits(
  d: Record<string, unknown>,
  ctx: ValidationContext,
  issues: IssueCollector,
): Promise<void> {
  for (const [i, m] of asArray<Measurement>(d.measurements).entries()) {
    const path = `$.measurements[${i}]`;
    const measSplit = splitRef(m.measurement_ref ?? "");
    if (!measSplit || measSplit.namespace !== "meas") {
      issues.reject("R5", `${path}.measurement_ref`, `measurement_ref "${m.measurement_ref}" is not a well-formed meas.<key> reference`);
      continue;
    }
    if (m.finding_ref == null || m.finding_ref === "") {
      issues.reject("R5", `${path}.finding_ref`, "every meas.*-backed measurement must carry a non-null finding_ref (§4, no finding-independent measurement registry)");
      continue;
    }
    const findings = asArray<Finding>(d.findings);
    const owner = findings.find((f) => f.lid === m.finding_ref);
    if (!owner) continue; // already reported by R2
    const findingSplit = splitRef(owner.definition_ref ?? "");
    if (!findingSplit) continue;
    const resolvedFinding = await ctx.catalog.resolveFinding(findingSplit.key);
    if (!resolvedFinding) continue; // already reported by R1

    const bound = await ctx.catalog.resolveFindingMeasurement(resolvedFinding.id, measSplit.key);
    if (!bound) {
      issues.reject("R5", `${path}.measurement_ref`, `meas.${measSplit.key} is not bound to finding.${findingSplit.key}`);
      continue;
    }
    if (m.unit == null) continue;
    const hasConversionExtension = "x_unit_conversion" in (m as unknown as Record<string, unknown>);
    if (!looksLikeUcum(m.unit)) {
      issues.reject("R5", `${path}.unit`, `unit "${m.unit}" does not look UCUM-valid`);
    }
    if (!hasConversionExtension && m.unit !== bound.unit) {
      issues.reject(
        "R5",
        `${path}.unit`,
        `unit "${m.unit}" does not match the catalog binding's unit "${bound.unit}" for meas.${measSplit.key} (no x_unit_conversion present)`,
      );
    }
  }
}

// ── R6 — parameters (tier B) ──────────────────────────────────────────────────

async function checkR6Parameters(
  d: Record<string, unknown>,
  ctx: ValidationContext,
  issues: IssueCollector,
): Promise<void> {
  for (const [i, f] of asArray<Finding>(d.findings).entries()) {
    const seenGroups = new Map<string, number>();
    for (const [pi, p] of (f.parameters ?? []).entries()) {
      const path = `$.findings[${i}].parameters[${pi}]`;
      if (!(PARAMETER_KIND_VALUES as readonly string[]).includes(p.kind)) {
        issues.reject("R6", `${path}.kind`, `invalid parameter kind "${p.kind}"`);
        continue;
      }
      const psplit = splitRef(p.param ?? "");
      if (!psplit) continue; // already reported by R1
      const group = await ctx.catalog.resolveParameterGroup(psplit.key);
      if (!group) continue; // already reported by R1

      if (p.kind !== group.dataType) {
        issues.reject("R6", `${path}.kind`, `parameter kind "${p.kind}" does not match param.${psplit.key}'s catalog data_type "${group.dataType}"`);
      }
      if (p.kind === "option") {
        const opt = p as ParameterEntry & { option?: string };
        if (typeof opt.option !== "string" || opt.option.length === 0) {
          issues.reject("R6", `${path}.option`, "kind=option requires a non-empty option key");
        } else {
          const resolved = await ctx.catalog.resolveParameterOption(group.id, opt.option);
          if (!resolved) issues.reject("R6", `${path}.option`, `option "${opt.option}" does not exist in param.${psplit.key}'s catalog options`);
        }
      }
      const count = (seenGroups.get(psplit.key) ?? 0) + 1;
      seenGroups.set(psplit.key, count);
      if (count > 1 && !group.allowMultiple) {
        issues.reject("R6", path, `param.${psplit.key} appears ${count} times on this finding but its catalog binding does not allow_multiple`);
      }
    }
  }
}

// ── R7 — clinical consistency (tier B) ────────────────────────────────────────

function checkR7ClinicalConsistency(d: Record<string, unknown>, issues: IssueCollector): void {
  const measurementByLid = new Map(asArray<Measurement>(d.measurements).map((m) => [m.lid, m]));
  for (const [i, f] of asArray<Finding>(d.findings).entries()) {
    if (f.presence !== "absent" && f.presence !== "normal") continue;
    if (f.severity != null) {
      issues.reject("R7", `$.findings[${i}].severity`, `presence="${f.presence}" must not carry a positive severity`);
    }
    for (const [ri, mlid] of (f.measurement_refs ?? []).entries()) {
      const m = measurementByLid.get(mlid);
      if (m?.abnormal === true) {
        issues.reject("R7", `$.findings[${i}].measurement_refs[${ri}]`, `presence="${f.presence}" must not own an abnormal:true measurement ("${mlid}")`);
      }
    }
  }
}

// ── R8 — required parameters (tier B; draft:warn, finalize:reject) ───────────

async function checkR8RequiredParameters(
  d: Record<string, unknown>,
  ctx: ValidationContext,
  issues: IssueCollector,
): Promise<void> {
  for (const [i, f] of asArray<Finding>(d.findings).entries()) {
    const findingSplit = splitRef(f.definition_ref ?? "");
    if (!findingSplit) continue;
    const resolvedFinding = await ctx.catalog.resolveFinding(findingSplit.key);
    if (!resolvedFinding) continue;

    const required = await ctx.catalog.listRequiredParameterBindings(resolvedFinding.id);
    if (required.length === 0) continue;
    const presentGroupIds = new Set<number>();
    for (const p of f.parameters ?? []) {
      const psplit = splitRef(p.param ?? "");
      if (!psplit) continue;
      const group = await ctx.catalog.resolveParameterGroup(psplit.key);
      if (group) presentGroupIds.add(group.id);
    }
    for (const req of required) {
      if (!presentGroupIds.has(req.parameterGroupId)) {
        issues.warnOnDraftRejectOnFinalize(
          ctx.mode,
          "R8",
          `$.findings[${i}].parameters`,
          `finding.${findingSplit.key} is missing a value for a required parameter (catalog parameter_group #${req.parameterGroupId})`,
        );
      }
    }
  }
}

// ── R9 — duplicate recommendation_ref across shared finding_refs (tier B) ────

function checkR9DuplicateRecommendationRefs(d: Record<string, unknown>, issues: IssueCollector): void {
  const recs = asArray<Recommendation>(d.recommendations);
  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i];
      const b = recs[j];
      if (a.recommendation_ref == null || a.recommendation_ref !== b.recommendation_ref) continue;
      const sharesFinding = (a.finding_refs ?? []).some((f) => (b.finding_refs ?? []).includes(f));
      if (sharesFinding) {
        issues.reject(
          "R9",
          `$.recommendations[${j}].recommendation_ref`,
          `duplicate recommendation_ref "${b.recommendation_ref}" (also at recommendations[${i}]) sharing a finding_ref`,
        );
      }
    }
  }
}

// ── R10w — origin vocabulary (tier B, warn only) ──────────────────────────────

function checkR10wOriginVocabulary(d: Record<string, unknown>, issues: IssueCollector): void {
  const documented = new Set<string>(PROVENANCE_ORIGIN_VALUES as readonly string[]);
  const check = (origin: string | undefined, path: string): void => {
    if (typeof origin === "string" && origin.length > 0 && !documented.has(origin)) {
      issues.warn("R10w", path, `provenance.origin "${origin}" is not in the documented list (§18) — forward-compatible, not rejected`);
    }
  };
  for (const [i, f] of asArray<Finding>(d.findings).entries()) check(f.provenance?.origin, `$.findings[${i}].provenance.origin`);
  for (const [i, m] of asArray<Measurement>(d.measurements).entries()) check(m.provenance?.origin, `$.measurements[${i}].provenance.origin`);
  for (const [i, r] of asArray<Recommendation>(d.recommendations).entries()) check(r.provenance?.origin, `$.recommendations[${i}].provenance.origin`);
  for (const [i, c] of asArray<CriticalFlag>(d.critical_flags).entries()) check(c.provenance?.origin, `$.critical_flags[${i}].provenance.origin`);
}

// ── R10b — provenance.revision === audit.revision (tier B) ──────────────────

function checkR10bRevisionReconciliation(d: Record<string, unknown>, issues: IssueCollector): void {
  const provenance = d.provenance as StructuredReportDocument["provenance"] | undefined;
  const audit = d.audit as StructuredReportDocument["audit"] | undefined;
  if (provenance && audit && provenance.revision !== audit.revision) {
    issues.reject("R10b", "$.provenance.revision", `provenance.revision (${provenance.revision}) must equal audit.revision (${audit.revision})`);
  }
}

// ── R11 / R11b / R11c — AI linkage (tier B) ───────────────────────────────────

interface AiCarrier {
  provenance?: InstanceProvenance;
  ai?: InstanceAiBlock | null;
}

function collectAiCarriers(d: Record<string, unknown>): Array<{ lid: string; path: string; carrier: AiCarrier }> {
  const out: Array<{ lid: string; path: string; carrier: AiCarrier }> = [];
  for (const [i, f] of asArray<Finding>(d.findings).entries()) out.push({ lid: f.lid, path: `$.findings[${i}]`, carrier: f });
  for (const [i, r] of asArray<Recommendation>(d.recommendations).entries()) out.push({ lid: r.lid, path: `$.recommendations[${i}]`, carrier: r });
  const impression = d.impression as StructuredReportDocument["impression"] | undefined;
  for (const [i, fr] of (impression?.fragments ?? []).entries()) out.push({ lid: fr.lid, path: `$.impression.fragments[${i}]`, carrier: fr });
  return out;
}

function checkR11AiLinkage(d: Record<string, unknown>, issues: IssueCollector): void {
  const runById = new Map((d.ai as StructuredReportDocument["ai"] | undefined)?.runs?.map((r) => [r.run_id, r]) ?? []);
  for (const { path, carrier } of collectAiCarriers(d)) {
    if (carrier.provenance?.origin !== "ai_suggestion") continue;
    if (!carrier.ai || carrier.ai.suggested !== true) {
      issues.reject("R11", `${path}.ai`, `provenance.origin="ai_suggestion" requires ai.suggested=true`);
      continue;
    }
    if (!runById.has(carrier.ai.run_id)) {
      issues.reject("R11", `${path}.ai.run_id`, `ai.run_id "${carrier.ai.run_id}" is not present in ai.runs[]`);
    }
    if (!carrier.ai.model_ref || !carrier.ai.prompt_ref || carrier.ai.prompt_version == null) {
      issues.reject("R11", `${path}.ai`, "ai block requires model_ref, prompt_ref, and prompt_version");
    }
  }
}

function checkR11bBidirectionalAiLinkage(d: Record<string, unknown>, issues: IssueCollector): void {
  const carriers = collectAiCarriers(d);
  const byLid = new Map(carriers.map((c) => [c.lid, c]));
  const runs = (d.ai as StructuredReportDocument["ai"] | undefined)?.runs ?? [];

  const claimedByRun = new Map<string, string>(); // lid -> run_id that claims it
  for (const run of runs) {
    for (const lid of run.output_lids ?? []) {
      const c = byLid.get(lid);
      if (!c) {
        issues.reject("R11b", `$.ai.runs[?].output_lids`, `run "${run.run_id}" claims output_lid "${lid}" which does not exist in the document`);
        continue;
      }
      if (c.carrier.provenance?.origin !== "ai_suggestion" || c.carrier.ai?.run_id !== run.run_id) {
        issues.reject(
          "R11b",
          `${c.path}`,
          `atom "${lid}" is listed in run "${run.run_id}"'s output_lids but does not have provenance.origin="ai_suggestion" with a matching ai.run_id`,
        );
      }
      const already = claimedByRun.get(lid);
      if (already && already !== run.run_id) {
        issues.reject("R11b", `${c.path}`, `atom "${lid}" appears in output_lids of two different runs ("${already}" and "${run.run_id}")`);
      }
      claimedByRun.set(lid, run.run_id);
    }
  }
  for (const { lid, path, carrier } of carriers) {
    if (carrier.provenance?.origin === "ai_suggestion" && !claimedByRun.has(lid)) {
      issues.reject("R11b", path, `atom "${lid}" has provenance.origin="ai_suggestion" but does not appear in any run's output_lids`);
    }
  }
}

function checkR11cAiFieldEquality(d: Record<string, unknown>, issues: IssueCollector): void {
  const runById = new Map((d.ai as StructuredReportDocument["ai"] | undefined)?.runs?.map((r) => [r.run_id, r]) ?? []);
  for (const { path, carrier } of collectAiCarriers(d)) {
    if (!carrier.ai) continue;
    const run = runById.get(carrier.ai.run_id);
    if (!run) continue; // already reported by R11
    if (carrier.ai.model_ref !== run.model_ref) {
      issues.reject("R11c", `${path}.ai.model_ref`, `ai.model_ref "${carrier.ai.model_ref}" does not equal run "${run.run_id}"'s model_ref "${run.model_ref}"`);
    }
    if (carrier.ai.prompt_ref !== run.prompt_ref) {
      issues.reject("R11c", `${path}.ai.prompt_ref`, `ai.prompt_ref "${carrier.ai.prompt_ref}" does not equal run "${run.run_id}"'s prompt_ref "${run.prompt_ref}"`);
    }
    if (carrier.ai.prompt_version !== run.prompt_version) {
      issues.reject("R11c", `${path}.ai.prompt_version`, `ai.prompt_version ${carrier.ai.prompt_version} does not equal run "${run.run_id}"'s prompt_version ${run.prompt_version}`);
    }
  }
}

// ── R12 — no unpinned AI aliases; prompt_digest present (tier B) ─────────────

function checkR12UnpinnedAliasesAndDigests(d: Record<string, unknown>, issues: IssueCollector): void {
  const runs = (d.ai as StructuredReportDocument["ai"] | undefined)?.runs ?? [];
  for (const [i, run] of runs.entries()) {
    const path = `$.ai.runs[${i}]`;
    if (UNPINNED_AI_ALIASES.has(run.model_ref?.toLowerCase())) {
      issues.reject("R12", `${path}.model_ref`, `model_ref "${run.model_ref}" is an unpinned alias — pin an exact model identifier/tag`);
    }
    const promptKey = splitRef(run.prompt_ref ?? "")?.key ?? run.prompt_ref;
    if (promptKey && UNPINNED_AI_ALIASES.has(promptKey.toLowerCase())) {
      issues.reject("R12", `${path}.prompt_ref`, `prompt_ref "${run.prompt_ref}" is an unpinned alias`);
    }
    if (!run.prompt_digest) {
      issues.reject("R12", `${path}.prompt_digest`, "prompt_digest is required on every AI run (reproducibility — the prompt template row is mutable)");
    }
  }
}

// ── R13 — AI never auto-signs (tier A) + signed_by distinctness (tier B, finalize only) ──

function checkR13AutoSign(d: Record<string, unknown>, issues: IssueCollector): void {
  const ai = d.ai as StructuredReportDocument["ai"] | undefined;
  if (ai?.guarding?.auto_sign !== false) {
    issues.reject("R13", "$.ai.guarding.auto_sign", `ai.guarding.auto_sign must be exactly false, got ${JSON.stringify(ai?.guarding?.auto_sign)}`);
  }
}

async function checkR13SignedByDistinctness(
  d: Record<string, unknown>,
  ctx: ValidationContext,
  issues: IssueCollector,
): Promise<void> {
  if (ctx.mode !== "finalize") return;
  const audit = d.audit as StructuredReportDocument["audit"] | undefined;
  const signedBy = audit?.signature?.signed_by;
  if (!signedBy) return; // R14 already rejects a finalize without signed_by
  const runs = (d.ai as StructuredReportDocument["ai"] | undefined)?.runs ?? [];
  // D1 §9.2 states distinctness is checked against "every ai.runs[].actor/provider" —
  // the aiRun object (§9.1) has no `actor` field (only `provider`); this is a gap in
  // the frozen spec itself, not a D1-vs-code conflict. Smallest compatible reading:
  // check against the field that actually exists (`provider`).
  for (const run of runs) {
    if (run.provider && run.provider.toLowerCase() === signedBy.toLowerCase()) {
      issues.reject(
        "R13",
        "$.audit.signature.signed_by",
        `signed_by "${signedBy}" must be a human staff identity distinct from every ai.runs[].provider (matched "${run.provider}")`,
      );
    }
  }
}

// ── R14 — finalize signature (tier B, finalize only) ──────────────────────────

function checkR14FinalizeSignature(d: Record<string, unknown>, ctx: ValidationContext, issues: IssueCollector): void {
  if (ctx.mode !== "finalize") return;
  const audit = d.audit as StructuredReportDocument["audit"] | undefined;
  const sig = audit?.signature;
  if (sig?.state !== "final") {
    issues.reject("R14", "$.audit.signature.state", `finalize requires signature.state="final", got "${sig?.state}"`);
    return;
  }
  if (!sig.signed_content_sha256) {
    issues.reject("R14", "$.audit.signature.signed_content_sha256", "finalize requires signed_content_sha256");
    return;
  }
  if (sig.signed_content_sha256 !== audit?.content_sha256) {
    issues.reject(
      "R14",
      "$.audit.signature.signed_content_sha256",
      `signed_content_sha256 "${sig.signed_content_sha256}" must equal content_sha256 "${audit?.content_sha256}" (recomputed with audit.hash_algorithm) — the writer/hasher, not this validator, computes content_sha256; this rule only checks the two stamped values agree`,
    );
  }
  if (audit && !(HASH_ALGORITHM_VALUES as readonly string[]).includes(audit.hash_algorithm)) {
    issues.reject("R14", "$.audit.hash_algorithm", `unknown hash_algorithm "${audit.hash_algorithm}"`);
  }
}

// ── R14b — audit_log_ref linkage (tier B, finalize only) ─────────────────────

async function checkR14bAuditLogRef(d: Record<string, unknown>, ctx: ValidationContext, issues: IssueCollector): Promise<void> {
  if (ctx.mode !== "finalize") return;
  const audit = d.audit as StructuredReportDocument["audit"] | undefined;
  if (audit?.audit_log_ref == null) {
    issues.reject("R14b", "$.audit.audit_log_ref", "finalize requires a non-null audit_log_ref linking into the audit_logs hash chain (E0.2)");
    return;
  }
  if (!ctx.auditLogLookup) {
    issues.warn("R14b", "$.audit.audit_log_ref", "audit_log_ref is present but no auditLogLookup was provided to the validator — live audit_logs row existence was not verified");
    return;
  }
  const sig = audit?.signature;
  if (!sig?.signed_content_sha256) return; // already reported by R14
  const found = await ctx.auditLogLookup(String(d.document_id), sig.signed_content_sha256);
  if (!found) {
    issues.reject("R14b", "$.audit.audit_log_ref", `audit_log_ref ${audit.audit_log_ref} does not resolve to an audit_logs row (action="finalize") recording this document_id + signed_content_sha256`);
  }
}

// ── R14c — amendment chain integrity (tier B, finalize only) ─────────────────

async function checkR14cAmendmentChain(d: Record<string, unknown>, ctx: ValidationContext, issues: IssueCollector): Promise<void> {
  if (ctx.mode !== "finalize") return;
  const audit = d.audit as StructuredReportDocument["audit"] | undefined;
  const amends = audit?.signature?.amends_document_id;
  if (amends == null) return;
  if (!ctx.amendsLookup) {
    issues.warn("R14c", "$.audit.signature.amends_document_id", "amends_document_id is present but no amendsLookup was provided to the validator — prior-document chain integrity was not verified");
    return;
  }
  const prior = await ctx.amendsLookup(amends);
  if (!prior) {
    issues.reject("R14c", "$.audit.signature.amends_document_id", `amends_document_id "${amends}" does not resolve to any prior document`);
    return;
  }
  if (prior.state !== "final") {
    issues.reject("R14c", "$.audit.signature.amends_document_id", `amends_document_id "${amends}" resolves to a document whose signature.state is "${prior.state}", not "final"`);
  }
  if (prior.alreadyAmendedBy) {
    issues.reject("R14c", "$.audit.signature.amends_document_id", `document "${amends}" has already been amended by "${prior.alreadyAmendedBy}" — an amendment chain is linear, never forked`);
  }
}

// ── R15 / R16 — content-pack AI rules (tier B; draft:warn, finalize:reject) ──

async function checkR15Contradictions(d: Record<string, unknown>, ctx: ValidationContext, issues: IssueCollector): Promise<void> {
  const findings = asArray<Finding>(d.findings);
  const facts = buildFactBag(d);
  for (const [i, f] of findings.entries()) {
    const lookup = await ctx.aiRules.rulesForFinding(f.definition_ref ?? "");
    if (!lookup.available) {
      issues.warn("R15", `$.findings[${i}]`, "content-pack AI rules registry is not available — contradiction rules were not evaluated (see aiRulesRegistry.ts)");
      continue;
    }
    for (const rule of lookup.rules.contradiction) {
      const whenHolds = rule.when.every((path) => Boolean(getFact(facts, path)));
      const forbidHolds = rule.forbid.some((path) => Boolean(getFact(facts, path)));
      if (whenHolds && forbidHolds) {
        issues.warnOnDraftRejectOnFinalize(ctx.mode, "R15", `$.findings[${i}]`, `contradiction rule "${rule.id}" fired: ${rule.message}`);
      }
    }
  }
}

async function checkR16Completeness(d: Record<string, unknown>, ctx: ValidationContext, issues: IssueCollector): Promise<void> {
  const findings = asArray<Finding>(d.findings);
  const facts = buildFactBag(d);
  for (const [i, f] of findings.entries()) {
    const lookup = await ctx.aiRules.rulesForFinding(f.definition_ref ?? "");
    if (!lookup.available) {
      issues.warn("R16", `$.findings[${i}]`, "content-pack AI rules registry is not available — completeness rules were not evaluated (see aiRulesRegistry.ts)");
      continue;
    }
    for (const rule of lookup.rules.completeness) {
      const missing = rule.require.filter((path) => !getFact(facts, path));
      if (missing.length > 0) {
        issues.warnOnDraftRejectOnFinalize(ctx.mode, "R16", `$.findings[${i}]`, `completeness rule "${rule.id}" unmet (missing: ${missing.join(", ")}): ${rule.message}`);
      }
    }
  }
}

/** Flattens a document into dot-path facts for R15/R16's `when`/`forbid`/`require`
 * conditions (matching the impressionRuleModel.ts "safe dot-path fact resolution"
 * convention already used elsewhere in this codebase for rule evaluation). */
function buildFactBag(d: Record<string, unknown>): Record<string, unknown> {
  return d;
}

function getFact(bag: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, bag);
}

// ── R17 — critical flags well-formed + no duplicate critical key per finding (tier B) ──

// Well-formedness of critical_ref is already checked by R1 (checkR1FindingAndParamRefs,
// which covers rec./crit./tpl./combo. uniformly per D1 §12's R1 text). R17 adds the one
// thing R1 does not: no duplicate critical registry key per finding.
function checkR17CriticalFlags(d: Record<string, unknown>, issues: IssueCollector): void {
  const byFinding = new Map<string, Set<string>>();
  for (const [i, c] of asArray<CriticalFlag>(d.critical_flags).entries()) {
    const path = `$.critical_flags[${i}]`;
    const key = splitRef(c.critical_ref)?.key ?? c.critical_ref;
    const seen = byFinding.get(c.finding_ref) ?? new Set<string>();
    if (seen.has(key)) {
      issues.reject("R17", `${path}.critical_ref`, `duplicate critical registry key "${key}" for finding "${c.finding_ref}"`);
    }
    seen.add(key);
    byFinding.set(c.finding_ref, seen);
  }
}

// ── small helpers ──────────────────────────────────────────────────────────────

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
