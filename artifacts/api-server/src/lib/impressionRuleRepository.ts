/**
 * impressionRuleRepository.ts — Unified Impression Rule Engine: repository layer (Ticket C1).
 *
 * Reads the EXISTING `radiology_impression_rules` table (Phase 5,
 * lib/db/src/schema/radiologySmartFindings.ts) and maps its rows into the
 * canonical ImpressionRule model (impressionRuleModel.ts). No new table, no
 * migration to the existing schema — this ticket only adds a read path and a
 * mapping layer on top of data that already exists.
 *
 * Gated end-to-end by ff_radiology_impression_engine: loadActiveImpressionRules()
 * returns an empty array whenever the flag is off, so this module is inert —
 * safe to import — even before anything is wired to call it. No production
 * code calls this module yet; that wiring is explicitly out of scope for this
 * ticket (see the ticket's "NOT: report rendering replacement").
 *
 * Deliberately NOT mapped from the DB row into the canonical model yet:
 *   - `severity` (mild/moderate/severe) — the canonical ImpressionRule has no
 *     equivalent field. The ticket's "Outputs" section doesn't ask for a
 *     severity output, so this is left for whichever future ticket needs it.
 *   - `ruleName`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt` — display/
 *     audit metadata, not needed for evaluation.
 * `order` (required by the canonical model for deterministic tie-breaking)
 * has no DB equivalent either; the row's own numeric `id` is used, which
 * preserves creation order as the tie-break within a priority band.
 */

import { and, eq } from "drizzle-orm";
import { db, radiologyImpressionRulesTable } from "@workspace/db";
import { isFeatureEnabledServer } from "./featureFlags";
import {
  isRulePriority,
  type ComparisonOperator,
  type ConditionGroup,
  type ConditionValue,
  type ImpressionRule,
} from "./impressionRuleModel";

export const IMPRESSION_ENGINE_FLAG_KEY = "ff_radiology_impression_engine";

/** The shape Drizzle returns for one `radiology_impression_rules` row —
 *  narrowed to exactly the columns this mapper reads. */
export interface ImpressionRuleDbRow {
  id: number;
  builderType: string;
  conditions: { field: string; operator: string; value: string | string[] }[];
  generatedText: string;
  priority: string | null;
  version: string;
  isActive: boolean;
}

/**
 * Maps one legacy DB row's flat, implicitly-ANDed `conditions` array into the
 * canonical model's nested condition tree — a single top-level AND group of
 * leaves. Pure; exported for direct unit testing without mocking the DB.
 *
 * An empty `conditions` array maps to an empty AND group, which
 * impressionRuleValidation.ts's validateRuleSet() flags as invalid_condition_tree
 * (empty groups aren't allowed) — such a rule is excluded from evaluation and
 * surfaced in `blockedRules` rather than silently treated as "always matches".
 * This is the safe default for an impression engine: an ambiguous rule blocks
 * itself with a clear reason instead of firing unconditionally.
 */
export function mapDbRowToImpressionRule(row: ImpressionRuleDbRow): ImpressionRule {
  const condition: ConditionGroup = {
    kind: "group",
    logic: "AND",
    children: row.conditions.map((c) => ({
      kind: "leaf" as const,
      field: c.field,
      operator: c.operator as ComparisonOperator,
      value: c.value as ConditionValue,
    })),
  };

  return {
    id: String(row.id),
    version: row.version,
    builderType: row.builderType,
    isActive: row.isActive,
    priority: isRulePriority(row.priority) ? row.priority : "normal",
    order: row.id,
    condition,
    fragments: [{ id: `${row.id}.impression`, text: row.generatedText }],
    recommendations: [],
    warnings: [],
  };
}

/**
 * Loads active impression rules for a builder type (or all builder types if
 * omitted), mapped to the canonical model, ready for
 * impressionRuleEngine.ts's evaluateImpressionRules(). Returns `[]` — never
 * throws — when ff_radiology_impression_engine is disabled.
 */
export async function loadActiveImpressionRules(builderType?: string): Promise<ImpressionRule[]> {
  if (!(await isFeatureEnabledServer(IMPRESSION_ENGINE_FLAG_KEY))) return [];

  const conditions = [eq(radiologyImpressionRulesTable.isActive, true)];
  if (builderType) conditions.push(eq(radiologyImpressionRulesTable.builderType, builderType));

  const rows = await db
    .select()
    .from(radiologyImpressionRulesTable)
    .where(and(...conditions));

  return rows.map((row) =>
    mapDbRowToImpressionRule({
      id: row.id,
      builderType: row.builderType,
      conditions: row.conditions,
      generatedText: row.generatedText,
      priority: row.priority,
      version: row.version,
      isActive: row.isActive,
    }),
  );
}
