// ─────────────────────────────────────────────────────────────────────────────
// Content-pack AI rules registry port — for R15 (ai_contradiction_rules) and
// R16 (ai_completeness_rules), D1 §12.
//
// HONEST GAP (flagged, not papered over — matching D1 §11.3's own pattern of
// stating what is and isn't backed by a live table today): K1's validator
// (artifacts/api-server/src/lib/radiologyCatalog/packs/validator.ts) parses and
// validates `ai_contradiction_rules`/`ai_completeness_rules` from pack YAML at
// IMPORT TIME, but no B1/B2 table persists them — they are pack-authoring-time
// validation-only, exactly like `rec.`/`crit.`/`tpl.`/`combo.` (D1 §1.4, §11.3).
// There is today no live source this validator can query them from.
//
// Rather than (a) silently treating "no rules available" as "zero rules, R15/
// R16 pass clean" — which would be a false-confidence result masquerading as a
// real completeness/contradiction check — or (b) inventing a persistence layer
// this ticket does not own, R15/R16 are wired against this PORT. The default
// implementation below honestly reports unavailability, and the validator
// surfaces that as a structural warning rather than a silent pass. A future
// ticket that gives these rules a real queryable home (e.g. a
// finding_ai_rules B1/B2 table, or an importer-populated registry snapshot)
// plugs in by implementing this interface — no validator change required.
// ─────────────────────────────────────────────────────────────────────────────

export interface AiContradictionRule {
  id: string;
  message: string;
  when: string[]; // dot-path facts that must ALL hold
  forbid: string[]; // dot-path facts that must NOT also hold
}

export interface AiCompletenessRule {
  id: string;
  message: string;
  require: string[]; // dot-path facts that must ALL be present
}

export interface AiRulesForFinding {
  contradiction: AiContradictionRule[];
  completeness: AiCompletenessRule[];
}

export interface AiRulesLookupResult {
  /** false when no registry is wired at all (honest "we don't know" state). */
  available: boolean;
  rules: AiRulesForFinding;
}

/** Read-only port the validator queries for a finding's AI rules, by finding.<key>. */
export interface AiRulesRegistryPort {
  rulesForFinding(findingDefinitionRef: string): Promise<AiRulesLookupResult>;
}

/**
 * Default port: no live registry exists yet. Always reports `available: false`
 * so R15/R16 degrade to a structural warning ("content pack AI rules registry
 * is not available — completeness/contradiction not evaluated") instead of a
 * false pass. Swap in a real implementation once one exists.
 */
export class UnavailableAiRulesRegistryPort implements AiRulesRegistryPort {
  async rulesForFinding(): Promise<AiRulesLookupResult> {
    return { available: false, rules: { contradiction: [], completeness: [] } };
  }
}

/** In-memory implementation for tests, or for a future importer-populated snapshot. */
export class InMemoryAiRulesRegistryPort implements AiRulesRegistryPort {
  constructor(private byFindingRef: Map<string, AiRulesForFinding>) {}

  async rulesForFinding(findingDefinitionRef: string): Promise<AiRulesLookupResult> {
    const rules = this.byFindingRef.get(findingDefinitionRef);
    return { available: true, rules: rules ?? { contradiction: [], completeness: [] } };
  }
}
