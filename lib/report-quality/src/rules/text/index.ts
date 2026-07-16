// rules/text/index.ts — the free-text (heuristic) tier evaluator.
//
// Emits one finding per legacy check, each carrying a STABLE catalog rule id
// (Q0xx/Q1xx) plus its category/severity/tier from ruleCatalog.ts. ALL findings
// are severity "warning" + tier "heuristic": free-text checks stay advisory and
// can NEVER become finalize blockers (only deterministic structured-tier rules
// may block — PR #101 block policy).
//
// This is one registry executor that emits findings for many catalog rules
// (the checks share text parsing); the per-finding ruleId is the analytics/
// override/suppression identity, not this executor's id.

import { registerRule } from "../../registry";
import { evaluateTextTier } from "../../text/evaluate";
import { RULE_CATALOG } from "../../ruleCatalog";
import type { QualityFinding, QualityRule } from "../../contract";
import type { RuleProvider } from "../../engine";

const EXECUTOR_ID = "text.legacy-consistency";

const textLegacyRule: QualityRule = {
  id: EXECUTOR_ID,
  category: "consistency",
  modalities: "*",
  tier: "heuristic",
  evaluate(ctx): QualityFinding[] {
    return evaluateTextTier(ctx.text).findings.map((f): QualityFinding => {
      const entry = RULE_CATALOG[f.ruleId];
      return {
        ruleId: f.ruleId,
        canonicalId: entry.canonicalId,
        category: entry.category,
        severity: entry.defaultSeverity,
        tier: entry.tier,
        // Carry the deduction weight so the parity scorer sums from findings
        // WITHOUT re-evaluating (Phase 2.5 single-evaluation fix).
        weight: f.deduct,
        message: f.message,
      };
    });
  },
};

// Backward compatibility: self-register on the default global engine so
// `import "@workspace/report-quality"` + runQualityEngine() work unchanged.
registerRule(textLegacyRule);

// Also expose as a composable provider so scoped engines can include the text
// tier explicitly: createQualityEngine({ providers: [coreTextProvider] }).
export const coreTextProvider: RuleProvider = {
  name: "care-core:text",
  rules: [textLegacyRule],
};

export { textLegacyRule, EXECUTOR_ID as TEXT_LEGACY_EXECUTOR_ID };
