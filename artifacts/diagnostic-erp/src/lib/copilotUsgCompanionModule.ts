/**
 * copilotUsgCompanionModule.ts — CARE USG Companion (Phase 1) Copilot module.
 *
 * The Companion does NOT build a second Copilot. It threads its machine-
 * measurement outcome into the EXISTING CopilotContext (`ctx.usgCompanion`) and
 * this one advisory module — registered on import, exactly like
 * copilotMeasurementModule / copilotComparisonModule — turns that into Copilot
 * items: measurements the machine gave that are missing from the report,
 * measurements the radiologist rejected that may still be echoed in the text,
 * and expected measurements that were never captured.
 *
 * Advisory only, pure, no core-file changes. No-op when `ctx.usgCompanion`
 * is absent (i.e. non-USG studies).
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";

/** Numbers present in the report text, normalised ("7.20" → "7.2"). */
function reportNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) out.add(String(Number(m[0])));
  return out;
}

/** First numeric token in a machine value string ("78.5 mm" → "78.5"). */
function firstNumber(value: string): string | null {
  const m = value.match(/\d+(?:\.\d+)?/);
  return m ? String(Number(m[0])) : null;
}

export function usgCompanionModuleItems(ctx: CopilotContext): CopilotItem[] {
  const c = ctx.usgCompanion;
  if (!c) return [];
  const reportText = `${ctx.findings}\n${ctx.impression.join("\n")}`;
  const reportLower = reportText.toLowerCase();
  const nums = reportNumbers(reportText);
  const items: CopilotItem[] = [];

  // 1) Imported machine measurements whose value never made it into the report.
  for (const m of c.imported) {
    const n = firstNumber(m.value);
    if (n && !nums.has(n)) {
      items.push({
        id: `usg-companion:omitted:${m.label}`.replace(/\s+/g, "-"),
        category: "measurement", severity: "warning",
        title: `Imported measurement not in report: ${m.label}`,
        detail: `The machine reported ${m.label} = ${m.value}, imported by the Companion, but that value is not in the report text.`,
        why: "Machine measurements imported by the Companion should be reflected in the report so their value and provenance are preserved.",
        confidence: "high",
        insertText: `${m.label}: ${m.value}.`,
        insertTarget: "findings",
      });
    }
  }

  // 2) Rejected measurements whose value still appears in the report.
  for (const m of c.rejected) {
    const n = firstNumber(m.value);
    if (n && nums.has(n)) {
      items.push({
        id: `usg-companion:rejected-echo:${m.label}`.replace(/\s+/g, "-"),
        category: "measurement", severity: "warning",
        title: `Rejected measurement still in report: ${m.label}`,
        detail: `You rejected the machine value ${m.label} = ${m.value}, but a matching number is still present in the report. Confirm the report reflects your corrected value.`,
        why: "A rejected machine value that remains in the report can mislead — reconcile it before signing.",
        confidence: "medium",
      });
    }
  }

  // 3) Auto-populated content the radiologist should confirm (Phase 2).
  const auto = c.autoPopulated ?? [];
  if (auto.length > 0) {
    const ruleLines = auto.filter((a) => a.kind === "rule");
    if (ruleLines.length > 0) {
      items.push({
        id: `usg-companion:auto-impression`,
        category: "impression", severity: "info",
        title: `${ruleLines.length} rule-based impression line(s) auto-populated`,
        detail: `The Companion added a rule-based impression: ${ruleLines.map((l) => `"${l.text}"`).join("; ")}. Confirm or edit before finalizing.`,
        why: "Auto-populated impression text is deterministic but must be verified by the radiologist.",
        confidence: "high",
      });
    }
    const machineLines = auto.filter((a) => a.kind === "machine");
    if (machineLines.length >= 3) {
      items.push({
        id: `usg-companion:auto-machine`,
        category: "measurement", severity: "info",
        title: `${machineLines.length} machine measurements auto-populated into Findings`,
        detail: `Review the auto-populated measurement values against the images.`,
        why: "Machine-derived values should be verified against the source images before signing.",
        confidence: "high",
      });
    }
  }

  // 4) Expected measurements that were never captured for this study type.
  if (c.missing.length > 0) {
    items.push({
      id: `usg-companion:missing:${c.studyType}`,
      category: "missing", severity: "info",
      title: `${c.missing.length} expected measurement(s) not captured`,
      detail: `For a ${c.studyType.replace(/_/g, " ").toLowerCase()} study, the Companion did not detect: ${c.missing.join(", ")}. Add them manually if clinically applicable.`,
      why: "Complete measurements improve report quality and downstream comparison.",
      confidence: "medium",
    });
  }

  return items;
}

registerCopilotModule({
  id: "usg-companion",
  label: "USG Companion measurement review",
  kind: "local",
  analyze: usgCompanionModuleItems,
});
