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

/** Numbers present in the report text, as a set of normalised strings ("7.2"). */
function reportNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) out.add(String(Number(m[0])));
  return out;
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
    const key = label.toLowerCase();
    const valueInReport = nums.has(valueStr);
    const labelInReport = key.length >= 3 && reportLower.includes(key);

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

  // Value-disagreement: the report mentions a measurement's label with a *different*
  // number than the accepted one, near that label.
  for (const m of measurements) {
    const key = (m.label || "").toLowerCase();
    if (key.length < 3) continue;
    const idx = reportLower.indexOf(key);
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
