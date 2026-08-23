/**
 * VoiceComposerPreview — compact change-plan review before apply.
 */
import { Button } from "@/components/ui/button";
import { Check, X, Pencil, Loader2 } from "lucide-react";
import type { VoiceComposerPreview } from "@/hooks/useVoiceComposer";

export default function VoiceComposerPreviewPanel({
  preview,
  composing,
  error,
  onApply,
  onDiscard,
  onEditRaw,
}: {
  preview: VoiceComposerPreview | null;
  composing: boolean;
  error: string | null;
  onApply: () => void;
  onDiscard: () => void;
  onEditRaw?: () => void;
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
      <div className="flex items-center gap-2 px-3 py-2 border-t bg-amber-50 text-amber-900 text-xs" data-testid="voice-composer-error">
        <span>{error}</span>
        {onEditRaw && (
          <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={onEditRaw}>
            Insert raw transcript
          </Button>
        )}
      </div>
    );
  }

  if (!preview) return null;

  return (
    <div className="flex flex-col gap-2 px-3 py-2 border-t bg-emerald-50/40" data-testid="voice-composer-preview">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Voice change</div>
      <div className="text-xs text-muted-foreground">
        Heard: <span className="italic">"{preview.transcript}"</span>
      </div>
      {preview.adds.length > 0 && (
        <div className="text-xs">
          <span className="font-medium">Add:</span>
          <ul className="mt-0.5 space-y-0.5">
            {preview.adds.map((a) => (
              <li key={a} className="flex gap-1"><Check size={10} className="text-emerald-600 shrink-0 mt-0.5" /><span>{a}</span></li>
            ))}
          </ul>
        </div>
      )}
      {preview.removes.length > 0 && (
        <div className="text-xs">
          <span className="font-medium">Replace/remove baseline:</span>
          <ul className="mt-0.5 space-y-0.5">
            {preview.removes.map((r) => (
              <li key={r} className="flex gap-1 text-amber-800"><X size={10} className="shrink-0 mt-0.5" /><span className="line-through">{r}</span></li>
            ))}
          </ul>
        </div>
      )}
      {preview.impression && (
        <div className="text-xs">
          <span className="font-medium">Impression:</span>
          <p className="mt-0.5 text-muted-foreground">+ {preview.impression}</p>
        </div>
      )}
      {preview.diagnostics && (
        <div className="text-[10px] text-muted-foreground">
          {preview.diagnostics.model} · {preview.diagnostics.latencyMs}ms
          {preview.diagnostics.fallbackUsed ? " (fallback)" : ""}
        </div>
      )}
      <div className="flex gap-1 flex-wrap">
        <Button size="sm" className="h-6 text-[10px] gap-1" data-testid="voice-composer-apply" onClick={onApply}>
          <Check size={11} /> Apply
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
