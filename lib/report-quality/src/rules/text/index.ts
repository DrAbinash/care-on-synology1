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
        category: entry.category,
        severity: entry.defaultSeverity,
        tier: entry.tier,
        message: f.message,
      };
    });
  },
};

registerRule(textLegacyRule);

export { EXECUTOR_ID as TEXT_LEGACY_EXECUTOR_ID };
