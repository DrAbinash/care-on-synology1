/**
 * VoiceComposerPreview — compact change-plan review before apply.
 */
import { Button } from "@/components/ui/button";
import { Check, X, Pencil, Loader2, AlertTriangle, Shield } from "lucide-react";
import type { VoiceComposerPreview } from "@/hooks/useVoiceComposer";

export default function VoiceComposerPreviewPanel({
  preview,
  composing,
  error,
  phraseFallbackAvailable,
  onApply,
  onDiscard,
  onEditRaw,
  onPhraseFallback,
}: {
  preview: VoiceComposerPreview | null;
  composing: boolean;
  error: string | null;
  phraseFallbackAvailable?: boolean;
  onApply: (force?: boolean) => void;
  onDiscard: () => void;
  onEditRaw?: () => void;
  onPhraseFallback?: () => void;
}) {
  if (composing) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-t bg-blue-50/50 text-xs" data-testid="voice-composer-processing">
        <Loader2 size={12} className="animate-spin" />
        <span>Composing report changes…</span>
      </div>
    );
  }

  if (error && !preview) {
    return (
      <div className="flex flex-col gap-1.5 px-3 py-2 border-t bg-amber-50 text-amber-900 text-xs" data-testid="voice-composer-error">
        <span>{error}</span>
        <div className="flex gap-1 flex-wrap">
          {phraseFallbackAvailable && onPhraseFallback && (
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={onPhraseFallback} data-testid="voice-composer-phrase-fallback">
              Use phrase fallback
            </Button>
          )}
          {onEditRaw && (
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={onEditRaw}>
              Insert raw transcript
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!preview) return null;

  return (
    <div className="flex flex-col gap-2 px-3 py-2 border-t bg-emerald-50/40" data-testid="voice-composer-preview">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Voice change preview</div>
      <div className="text-xs text-muted-foreground">
        Heard: <span className="italic">"{preview.transcript}"</span>
      </div>

      {preview.removes.length > 0 && (
        <div className="text-xs">
          <span className="font-semibold text-amber-900">WILL REMOVE</span>
          <ul className="mt-0.5 space-y-0.5">
            {preview.removes.map((r) => (
              <li key={r} className="flex gap-1 text-amber-800">
                <X size={10} className="shrink-0 mt-0.5" />
                <span className="line-through">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.adds.length > 0 && (
        <div className="text-xs">
          <span className="font-semibold text-emerald-800">WILL ADD</span>
          <ul className="mt-0.5 space-y-0.5">
            {preview.adds.map((a) => (
              <li key={a} className="flex gap-1">
                <Check size={10} className="text-emerald-600 shrink-0 mt-0.5" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.impression && (
        <div className="text-xs">
          <span className="font-semibold text-violet-800">IMPRESSION</span>
          <p className="mt-0.5 text-muted-foreground">+ {preview.impression}</p>
        </div>
      )}

      {preview.untouched.length > 0 && (
        <div className="text-xs">
          <span className="font-semibold text-slate-700 flex items-center gap-1">
            <Shield size={10} /> UNTOUCHED
          </span>
          <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
            {preview.untouched.slice(0, 4).map((u) => (
              <li key={u} className="truncate">{u}</li>
            ))}
            {preview.untouched.length > 4 && (
              <li className="text-[10px]">+ {preview.untouched.length - 4} more preserved</li>
            )}
          </ul>
        </div>
      )}

      {preview.hasConflicts && preview.conflicts.length > 0 && (
        <div className="text-xs bg-red-50 border border-red-200 rounded p-2" data-testid="voice-composer-conflicts">
          <span className="font-semibold text-red-800 flex items-center gap-1">
            <AlertTriangle size={10} /> MANUAL / QUICK SELECT CONFLICT
          </span>
          <ul className="mt-1 space-y-0.5 text-red-700">
            {preview.conflicts.map((c) => (
              <li key={c} className="truncate">{c}</li>
            ))}
          </ul>
          <p className="text-[10px] mt-1">Apply will require explicit confirmation.</p>
        </div>
      )}

      {preview.diagnostics && (
        <div className="text-[10px] text-muted-foreground">
          {preview.diagnostics.model}
          {preview.diagnostics.requestId ? ` · ${preview.diagnostics.requestId.slice(0, 8)}` : ""}
          · {preview.diagnostics.latencyMs}ms
          {preview.diagnostics.fallbackUsed ? " (fallback model)" : ""}
          {preview.phraseFallback ? " · phrase catalog" : ""}
        </div>
      )}

      <div className="flex gap-1 flex-wrap">
        <Button
          size="sm"
          className="h-6 text-[10px] gap-1"
          data-testid="voice-composer-apply"
          onClick={() => onApply(preview.hasConflicts)}
        >
          <Check size={11} />
          {preview.hasConflicts ? "Confirm apply" : "Apply"}
        </Button>
        {onEditRaw && (
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={onEditRaw}>
            <Pencil size={11} /> Edit raw
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" data-testid="voice-composer-discard" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  );
}
