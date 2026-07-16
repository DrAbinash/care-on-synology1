// rules/text/index.ts — the free-text (heuristic) tier rule.
//
// Emits one advisory finding per legacy computeQualityScore "issue" (empty
// sections, consistency/laterality/terminology warnings, checklist, missing
// measurements), so the engine's findings match the legacy badge issue list
// exactly. ALL findings are severity "warning" and tier "heuristic": free-text
// checks stay advisory and can NEVER become finalize blockers (only
// deterministic structured-tier rules may block — PR #101 block policy).
//
// Phase 1 keeps this as one aggregate rule to guarantee parity; later phases
// may split it into granular per-check rules once parity is locked.

import { registerRule } from "../../registry";
import { computeTextQualityScore } from "../../text/legacy";
import type { QualityCategory, QualityFinding, QualityRule } from "../../contract";

const RULE_ID = "text.legacy-consistency";

function classify(message: string): QualityCategory {
  const m = message.toLowerCase();
  if (m.includes("laterality")) return "laterality";
  if (m.includes("terminology")) return "terminology";
  if (m.includes("measurement")) return "measurement";
  if (m.includes("checklist")) return "completeness";
  if (
    m.startsWith("findings section is empty") ||
    m.startsWith("impression section is empty") ||
    m.startsWith("technique not documented") ||
    m.startsWith("clinical history not documented") ||
    m.startsWith("no recommendation") ||
    m.includes("impression section is empty")
  ) {
    return "completeness";
  }
  return "consistency";
}

const textLegacyRule: QualityRule = {
  id: RULE_ID,
  category: "consistency",
  modalities: "*",
  tier: "heuristic",
  evaluate(ctx): QualityFinding[] {
    const { issues } = computeTextQualityScore(ctx.text);
    return issues.map((message): QualityFinding => ({
      ruleId: RULE_ID,
      category: classify(message),
      severity: "warning",
      tier: "heuristic",
      message,
    }));
  },
};

registerRule(textLegacyRule);

export { RULE_ID as TEXT_LEGACY_RULE_ID };
