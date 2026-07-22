import { useState } from "react";
import { api } from "@/lib/fetchApi";
import { isFeatureEnabled } from "@/lib/staffSession";

/**
 * UsgAiPanel — P8 advisory AI UI (wires the orphaned /api/usg-ai endpoints).
 * Flag-gated by ff_radiology_usg_ai_assistant. Generates advisory suggestions,
 * shows evidence, and lets the radiologist Accept (→ current draft impression)
 * or Reject. AI is advisory only: it never signs/finalizes/writes the report,
 * and the accept call re-asserts the server write-guard. When the AI gateway is
 * not connected the panel shows an honest "AI unavailable" state; reporting is
 * never blocked.
 */

interface Suggestion {
  key?: string; kind: string; section?: string | null; text: string; rationale: string;
  confidence: number; needsReview?: boolean; requiresHumanAcceptance: boolean;
  evidence?: Record<string, string | number | null>;
}
interface SuggestResult { visible: boolean; available: boolean; reason: string; suggestions: Suggestion[] }

export default function UsgAiPanel({
  studyId, patientId, onAccept,
}: { studyId: number | null | undefined; patientId?: number | null; onAccept: (t: string) => void }) {
  const enabled = isFeatureEnabled("ff_radiology_usg_ai_assistant") && studyId != null;
  const [state, setState] = useState<SuggestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (!enabled) return null;

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.post<SuggestResult>(`/api/usg-ai/studies/${studyId}/suggest`, { patientId: patientId ?? undefined });
      setState(r); setDismissed(new Set());
    } catch {
      setState({ visible: true, available: false, reason: "AI gateway unavailable", suggestions: [] });
    } finally { setBusy(false); }
  };

  const visibleSuggestions = state?.suggestions.filter((s) => !dismissed.has(s.text)) ?? [];

  const accept = async (s: Suggestion) => {
    try {
      const r = await api.post<{ text: string }>("/api/usg-ai/accept", { currentText: "", suggestion: s, accepted: true });
      onAccept(r.text || s.text);
      setDismissed((d) => new Set(d).add(s.text));
    } catch {
      // write-guard or transport error — never surfaces AI text into the report
    }
  };

  return (
    <div className="text-xs space-y-1.5" data-testid="usg-ai-panel">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">AI assistant</span>
        <button className="px-2 py-0.5 rounded border" disabled={busy} onClick={generate}>{busy ? "Generating…" : "Generate"}</button>
      </div>

      {state && !state.visible && <p className="text-muted-foreground">AI is not enabled for you.</p>}
      {/* Model unavailable, but deterministic notes (e.g. growth) may still be present. */}
      {state && state.visible && !state.available && visibleSuggestions.length === 0 &&
        <p className="text-amber-600">AI model not connected — configure a provider in AI Provider Settings. Reporting is unaffected.</p>}
      {state && state.visible && !state.available && visibleSuggestions.length > 0 &&
        <p className="text-muted-foreground">Model not connected — showing deterministic notes only.</p>}
      {state && state.available && visibleSuggestions.length === 0 && <p className="text-muted-foreground">No suggestions.</p>}

      {visibleSuggestions.map((s, i) => (
        <div key={s.key ?? i} className="p-1.5 rounded border border-border space-y-1">
          <div className="flex items-start gap-2">
            <span className="flex-1">{s.text}{s.needsReview && <span className="text-amber-600"> ⚠ review</span>}</span>
            <span className="text-muted-foreground shrink-0">{Math.round(s.confidence * 100)}%</span>
          </div>
          {s.rationale && <p className="text-muted-foreground">Why: {s.rationale}</p>}
          <div className="flex gap-2">
            <button className="px-2 py-0.5 rounded bg-primary text-primary-foreground" onClick={() => accept(s)}>Accept</button>
            <button className="px-2 py-0.5 rounded border" onClick={() => setDismissed((d) => new Set(d).add(s.text))}>Reject</button>
          </div>
        </div>
      ))}
      <p className="text-[10px] text-muted-foreground">Advisory only — AI never signs, finalizes, or writes the report, and never outputs fetal sex. You approve every suggestion.</p>
    </div>
  );
}
