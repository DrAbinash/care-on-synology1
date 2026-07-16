/**
 * copilotMeasurementModule.ts — viewer-measurement-completeness Copilot module
 * (MRI PR 2, §7). The viewer-measurement bridge already exists (ViewerMeasurements
 * / MeasurementAssistant / UsgMeasurementReview panels + the viewer_measurements
 * endpoints); this only ADDS an advisory check on the existing Copilot registry
 * (PR #83): a value the radiologist accepted from the viewer that never made it
 * into the report, or a report value that disagrees with an accepted measurement.
 *
 * Advisory only, pure, registered on import. The workspace supplies
 * `ctx.viewerMeasurements` from the existing useViewerMeasurements hook.
 */
import type { CopilotContext, CopilotItem } from "./copilotOrchestrator";
import { registerCopilotModule } from "./copilotModules";
import { resolveMeasurement } from "@workspace/measurements";

/** Numbers present in the report text, as a set of normalised strings ("7.2"). */
function reportNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) out.add(String(Number(m[0])));
  return out;
}

/**
 * All spellings under which a measurement may appear in report prose: its own
 * label plus, when the label resolves in the Universal Measurement Registry,
 * the canonical display name and every registered alias. This is what lets a
 * viewer "CBD Diameter" match a report that wrote "common bile duct" — the
 * canonical identity matches, not the string (Step 10).
 */
function labelForms(label: string): string[] {
  const forms = new Set<string>();
  const base = label.trim().toLowerCase();
  if (base.length >= 3) forms.add(base);
  const resolved = resolveMeasurement(label);
  if (resolved) {
    for (const alias of [resolved.definition.displayName, ...resolved.definition.aliases]) {
      const f = alias.trim().toLowerCase();
      if (f.length >= 3) forms.add(f);
    }
  }
  return [...forms];
}

export function measurementModuleItems(ctx: CopilotContext): CopilotItem[] {
  const measurements = (ctx.viewerMeasurements ?? []).filter((m) => m.imported && Number.isFinite(m.value));
  if (measurements.length === 0) return [];
  const reportText = `${ctx.findings}\n${ctx.impression.join("\n")}`;
  const reportLower = reportText.toLowerCase();
  const nums = reportNumbers(reportText);
  const items: CopilotItem[] = [];

  for (const m of measurements) {
    const valueStr = String(Number(m.value));
    const label = m.label || "measurement";
    const valueInReport = nums.has(valueStr);
    // Canonical-identity match: any registry alias of the label counts as
    // "discussed in the report", not just the exact viewer spelling.
    const labelInReport = labelForms(label).some((f) => reportLower.includes(f));

    if (!valueInReport) {
      // Accepted in the viewer, its value is nowhere in the report.
      items.push({
        id: `meas:omitted:${m.label}:${valueStr}`.replace(/\s+/g, "-"),
        category: "measurement", severity: "warning",
        title: `Imported measurement not in report: ${label}`,
        detail: `You accepted ${label} = ${valueStr} ${m.unit} from the viewer, but that value is not in the report.`,
        why: "Measurements captured in the viewer should be reflected in the report so the value and its provenance are preserved.",
        confidence: "high",
        insertText: `${label} measures approximately ${valueStr} ${m.unit}.`.replace(/^./, (c) => c.toUpperCase()),
        insertTarget: "findings",
      });
    } else if (labelInReport) {
      // The measurement's label is discussed and *a* number matches — fine.
      continue;
    }
  }

  // Value-disagreement: the report mentions a measurement's label (any
  // registry alias of it) with a *different* number than the accepted one,
  // near that label.
  for (const m of measurements) {
    const forms = labelForms(m.label || "");
    let key = "";
    let idx = -1;
    for (const f of forms) {
      const at = reportLower.indexOf(f);
      if (at >= 0) { key = f; idx = at; break; }
    }
    if (idx < 0) continue;
    const around = reportText.slice(idx, idx + key.length + 40);
    const near = [...around.matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm)?/g)].map((x) => Number(x[1]));
    if (near.length && !near.some((n) => Math.abs(n - m.value) < 0.05)) {
      items.push({
        id: `meas:mismatch:${m.label}`.replace(/\s+/g, "-"),
        category: "measurement", severity: "warning",
        title: `Report value may differ: ${m.label}`,
        detail: `The report gives a different value for ${m.label} than the accepted viewer measurement (${String(Number(m.value))} ${m.unit}).`,
        why: "A mismatch between the report and the accepted viewer measurement should be reconciled before signing.",
        confidence: "medium",
      });
    }
  }

  return items;
}

registerCopilotModule({
  id: "measurement-completeness",
  label: "Viewer measurement completeness",
  kind: "local",
  analyze: measurementModuleItems,
});
