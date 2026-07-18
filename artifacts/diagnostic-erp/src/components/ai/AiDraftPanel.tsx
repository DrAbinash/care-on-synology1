/**
 * AI Draft Panel — Phase P3 / Gate G11.
 *
 * A feature-flagged, fixed-position assistant panel that surfaces the SHADOW AI
 * draft for the current study. It renders NOTHING unless AI is visible for this
 * radiologist (pilot/production) — so on a default deployment it is invisible.
 * It shows grounded findings only, evidence/confidence, provenance, and an
 * Accept / Edit / Ignore workflow. It NEVER signs or writes the report — actions
 * only record feedback and optionally hand text to the report editor via
 * `onInsertText`. The radiologist remains the only signer.
 */
import { useEffect, useState, useCallback } from "react";
import { Bot, Check, Pencil, X, ChevronDown, ChevronUp, ShieldCheck, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { aiClient, type AiEnablement, type AiWorkspaceDraft } from "../../lib/aiClient";

interface Props {
  studyInstanceUid: string | null;
  modality: string | null;
  /** Optional hook for voice/editor integration: insert accepted AI text into the report. */
  onInsertText?: (text: string) => void;
}

export function AiDraftPanel({ studyInstanceUid, modality, onInsertText }: Props) {
  const [enablement, setEnablement] = useState<AiEnablement | null>(null);
  const [draft, setDraft] = useState<AiWorkspaceDraft | null>(null);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [handled, setHandled] = useState<Record<string, "accept" | "edit" | "ignore" | "reject">>({});

  // Resolve enablement (gates the whole panel).
  useEffect(() => {
    let alive = true;
    aiClient.getPolicy(modality).then((e) => { if (alive) setEnablement(e); }).catch(() => { if (alive) setEnablement(null); });
    return () => { alive = false; };
  }, [modality]);

  const loadDraft = useCallback(() => {
    if (!studyInstanceUid) return;
    aiClient.getDraft(studyInstanceUid, modality).then(setDraft).catch(() => setDraft(null));
  }, [studyInstanceUid, modality]);

  useEffect(() => {
    if (enablement?.visibleToRadiologist && studyInstanceUid) loadDraft();
  }, [enablement, studyInstanceUid, loadDraft]);

  const act = async (findingKey: string, action: "accept" | "edit" | "ignore" | "reject", text?: string) => {
    if (!draft) return;
    setHandled((h) => ({ ...h, [findingKey]: action }));
    if (action === "accept" && text && onInsertText) onInsertText(text);
    try {
      await aiClient.feedback(draft.draftId, { studyInstanceUid: draft.studyInstanceUid, findingKey, action, editedText: text });
    } catch { /* feedback is best-effort; never blocks the radiologist */ }
  };

  const generate = async () => {
    if (!studyInstanceUid) return;
    setBusy(true);
    try { await aiClient.generate(studyInstanceUid, modality); } finally { setBusy(false); }
  };

  // Hard gate: invisible unless AI is enabled AND visible for this radiologist.
  if (!enablement?.visibleToRadiologist || !studyInstanceUid) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-w-[95vw] rounded-lg border border-indigo-300 bg-white shadow-xl dark:bg-neutral-900 dark:border-indigo-700">
      <div className="flex items-center justify-between rounded-t-lg bg-indigo-600 px-3 py-2 text-white">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot size={16} /> AI Draft
          <span className="rounded bg-indigo-800/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            {enablement.mode} · shadow
          </span>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="opacity-90 hover:opacity-100" aria-label="toggle">
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

      {open && (
        <div className="max-h-[60vh] overflow-y-auto p-3 text-sm">
          <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
            <span>Radiologist approves — AI never signs.</span>
            <button onClick={generate} disabled={busy} className="rounded bg-indigo-50 px-2 py-1 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-950 dark:text-indigo-300">
              {busy ? "Queuing…" : "Generate"}
            </button>
          </div>

          {!draft && <div className="py-6 text-center text-neutral-400">No AI draft yet for this study.</div>}

          {draft && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                {draft.degraded
                  ? <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800"><AlertTriangle size={11} /> degraded (deterministic-only)</span>
                  : <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800"><ShieldCheck size={11} /> grounded</span>}
                {draft.qualityScore != null && <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600 dark:bg-neutral-800">quality {draft.qualityScore}</span>}
                {draft.quarantinedCount > 0 && <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">{draft.quarantinedCount} quarantined</span>}
              </div>

              {draft.findings.length === 0 && <div className="py-3 text-center text-neutral-400">No grounded findings.</div>}

              <ul className="space-y-2">
                {draft.findings.map((f) => {
                  const status = handled[f.key];
                  const conf = f.evidence.find((e) => e.confidence != null)?.confidence ?? null;
                  return (
                    <li key={f.key} className={`rounded border p-2 ${status ? "opacity-60" : ""} border-neutral-200 dark:border-neutral-700`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="text-neutral-800 dark:text-neutral-100">{f.text}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                            {f.laterality && f.laterality !== "none" && <span className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{f.laterality}</span>}
                            {conf != null && <span className="rounded bg-indigo-50 px-1 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">conf {conf}</span>}
                            {f.evidence.filter((e) => e.sopInstanceUid).map((e, i) => (
                              <span key={i} className="inline-flex items-center gap-0.5" title={`${e.seriesInstanceUid}/${e.sopInstanceUid} f${e.frameNumber ?? 1}`}>
                                <ImageIcon size={11} /> img
                              </span>
                            ))}
                            {f.evidence.filter((e) => e.measurementRef).map((e, i) => (
                              <span key={`m${i}`} className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">{e.measurementRef}</span>
                            ))}
                          </div>
                        </div>
                        {status
                          ? <span className="text-[11px] uppercase text-neutral-400">{status}</span>
                          : (
                            <div className="flex shrink-0 gap-1">
                              <button title="Accept (insert)" onClick={() => act(f.key, "accept", f.text)} className="rounded p-1 text-emerald-600 hover:bg-emerald-50"><Check size={14} /></button>
                              <button title="Edit" onClick={() => act(f.key, "edit", f.text)} className="rounded p-1 text-amber-600 hover:bg-amber-50"><Pencil size={14} /></button>
                              <button title="Ignore / reject" onClick={() => act(f.key, "reject")} className="rounded p-1 text-red-600 hover:bg-red-50"><X size={14} /></button>
                            </div>
                          )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {draft.impression.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase text-neutral-400">Impression</div>
                  <ul className="list-disc pl-4 text-neutral-700 dark:text-neutral-200">
                    {draft.impression.map((imp, i) => <li key={i}>{imp}</li>)}
                  </ul>
                </div>
              )}

              <div className="mt-3 border-t pt-2 text-[10px] text-neutral-400">
                model {draft.provenance.modelVersion} · prompt {draft.provenance.promptVersion} · rules {draft.provenance.rulesVersion}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
