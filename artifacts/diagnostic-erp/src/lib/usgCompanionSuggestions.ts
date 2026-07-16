/**
 * usgCompanionSuggestions.ts — CARE USG Companion (Phase 2)
 *
 * Deterministic, DB-driven Companion Suggestions + live checklist + report
 * confidence. NOTHING here is hardcoded clinical content — suggestions are
 * computed from the EXISTING quick-select data (`QuickFinding.suggests`
 * co-occurrence + `questionsJson` structured follow-ups), exactly the same
 * mechanism `QuickFindingsPanel` already uses. Admins edit the content in the
 * DB; this only composes it.
 *
 * Pure + alias-free (root-testable).
 */

export interface SuggestionFinding {
  id: number;
  studyType: string;
  label: string;
  suggests: string;        // comma-separated related labels
  questionsJson: string;   // structured follow-up questions ("[]" if none)
  isActive: boolean;
}

export interface CompanionSuggestion {
  id: string;
  kind: "cooccurrence" | "followup";
  label: string;
  detail: string;
  sourceLabel?: string;
}

function norm(s: string): string {
  return (s ?? "").trim().toLowerCase();
}

function parseQuestionLabels(questionsJson: string): string[] {
  try {
    const arr = JSON.parse(questionsJson) as { label?: string; key?: string }[];
    if (!Array.isArray(arr)) return [];
    return arr.map((q) => (q.label || q.key || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Findings "present" in the study = explicitly selected by the radiologist, OR
 * whose label appears in the current report text. Mirrors how a senior
 * radiologist would treat something they've already written.
 */
export function detectedFindings(
  findings: SuggestionFinding[],
  selectedIds: number[],
  reportText: string,
): SuggestionFinding[] {
  const selected = new Set(selectedIds);
  const text = norm(reportText);
  const out: SuggestionFinding[] = [];
  const seen = new Set<number>();
  for (const f of findings) {
    if (!f.isActive) continue;
    const hit = selected.has(f.id) || (f.label.length >= 4 && text.includes(norm(f.label)));
    if (hit && !seen.has(f.id)) { seen.add(f.id); out.push(f); }
  }
  return out;
}

export function buildCompanionSuggestions(opts: {
  findings: SuggestionFinding[];
  region: string | null;
  selectedIds: number[];
  reportText: string;
}): CompanionSuggestion[] {
  const { findings, region, selectedIds, reportText } = opts;
  const active = findings.filter((f) => f.isActive);
  const byLabel = new Map<string, SuggestionFinding[]>();
  for (const f of active) {
    const k = norm(f.label);
    if (!byLabel.has(k)) byLabel.set(k, []);
    byLabel.get(k)!.push(f);
  }

  const detected = detectedFindings(active, selectedIds, reportText);
  const detectedIds = new Set(detected.map((d) => d.id));
  const detectedLabelSet = new Set(detected.map((d) => norm(d.label)));
  const suggestions: CompanionSuggestion[] = [];
  const emitted = new Set<string>();

  for (const f of detected) {
    // (1) Co-occurrence follow-ups via the existing `suggests` field.
    for (const raw of (f.suggests || "").split(",")) {
      const key = norm(raw);
      if (!key) continue;
      const candidates = byLabel.get(key) ?? [];
      const pick = candidates.find((c) => norm(c.studyType) === norm(region ?? c.studyType))
        ?? candidates[0];
      if (!pick || detectedIds.has(pick.id) || detectedLabelSet.has(norm(pick.label))) continue;
      const dedupe = `co:${pick.id}`;
      if (emitted.has(dedupe)) continue;
      emitted.add(dedupe);
      suggestions.push({
        id: dedupe,
        kind: "cooccurrence",
        label: pick.label,
        detail: `Often reported with ${f.label}. Consider adding "${pick.label}".`,
        sourceLabel: f.label,
      });
    }
    // (2) Structured follow-ups the machine can't answer — via `questionsJson`.
    const qLabels = parseQuestionLabels(f.questionsJson);
    if (qLabels.length) {
      const dedupe = `fu:${f.id}`;
      if (!emitted.has(dedupe)) {
        emitted.add(dedupe);
        suggestions.push({
          id: dedupe,
          kind: "followup",
          label: `${f.label}: ${qLabels.join(", ")}`,
          detail: `Specify ${qLabels.join(", ").toLowerCase()} for ${f.label}.`,
          sourceLabel: f.label,
        });
      }
    }
  }
  return suggestions;
}

// ── Live checklist ────────────────────────────────────────────────────────────

export interface ChecklistItem {
  key: string;
  label: string;
  status: "ok" | "warn" | "pending";
  detail?: string;
}

export interface ChecklistInput {
  templateSelected: boolean;
  protocolSelected: boolean;
  measurementsFound: number;
  measurementsExpected: number;
  historyPresent: boolean;
  findingsPresent: boolean;
  impressionPresent: boolean;
  recommendationPresent: boolean;
  missingMeasurements: string[];
  checklistRemaining: string[];   // protocol checklist topics not yet addressed
  mismatches: string[];           // study/template/protocol mismatch messages
}

export function buildLiveChecklist(input: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  items.push({ key: "template", label: "Template loaded", status: input.templateSelected ? "ok" : "pending" });
  items.push({ key: "protocol", label: "Protocol loaded", status: input.protocolSelected ? "ok" : "pending" });
  items.push({
    key: "measurements",
    label: "Measurements",
    status: input.measurementsExpected === 0 || input.measurementsFound >= input.measurementsExpected ? "ok" : "warn",
    detail: input.measurementsExpected > 0 ? `${input.measurementsFound}/${input.measurementsExpected}` : "n/a",
  });
  items.push({ key: "history", label: "Clinical history", status: input.historyPresent ? "ok" : "pending" });
  items.push({ key: "findings", label: "Findings", status: input.findingsPresent ? "ok" : "pending" });
  items.push({ key: "impression", label: "Impression", status: input.impressionPresent ? "ok" : "warn", detail: input.impressionPresent ? undefined : "incomplete" });
  items.push({ key: "recommendation", label: "Recommendation", status: input.recommendationPresent ? "ok" : "warn", detail: input.recommendationPresent ? undefined : "incomplete" });

  for (const m of input.missingMeasurements) {
    items.push({ key: `missing:${m}`, label: `${m} missing`, status: "warn" });
  }
  for (const c of input.checklistRemaining) {
    items.push({ key: `checklist:${c}`, label: `${c} not addressed`, status: "warn" });
  }
  for (const mm of input.mismatches) {
    items.push({ key: `mismatch:${mm}`, label: mm, status: "warn" });
  }
  return items;
}

// ── Report confidence (workflow metrics — NOT AI confidence) ───────────────────

export interface ReportConfidence {
  machineCompleteness: number;   // 0-100: measurements found / expected
  clinicalCompleteness: number;  // 0-100: report sections present
  reportCompleteness: number;    // 0-100: overall readiness
  readyForFinalization: boolean;
}

export function computeReportConfidence(input: {
  measurementsFound: number;
  measurementsExpected: number;
  findingsPresent: boolean;
  impressionPresent: boolean;
  recommendationPresent: boolean;
  techniquePresent: boolean;
  readinessScore: number;
  locked: boolean;
  hasBlockingWarnings: boolean;
}): ReportConfidence {
  const machineCompleteness = input.measurementsExpected === 0
    ? 100
    : Math.round((Math.min(input.measurementsFound, input.measurementsExpected) / input.measurementsExpected) * 100);
  const sections = [input.techniquePresent, input.findingsPresent, input.impressionPresent, input.recommendationPresent];
  const clinicalCompleteness = Math.round((sections.filter(Boolean).length / sections.length) * 100);
  const reportCompleteness = Math.max(0, Math.min(100, Math.round(input.readinessScore)));
  const readyForFinalization =
    !input.locked &&
    !input.hasBlockingWarnings &&
    input.findingsPresent &&
    input.impressionPresent &&
    machineCompleteness >= 100;
  return { machineCompleteness, clinicalCompleteness, reportCompleteness, readyForFinalization };
}
