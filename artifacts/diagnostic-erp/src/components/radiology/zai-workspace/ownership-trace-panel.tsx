import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  buildOwnershipTrace,
  formatOwnershipTraceClipboard,
  ownershipTraceEnabled,
} from "@/lib/ownershipTrace";
import { Button } from "@/components/ui/button";

/** Hidden unless localStorage care_ownership_trace=1 or ?ownershipTrace=1. */
export function OwnershipTracePanel() {
  const enabled = useMemo(() => ownershipTraceEnabled(), []);
  const patches = useWorkspace((s) => s.appliedPathologyPatches);
  const [copied, setCopied] = useState(false);
  if (!enabled) return null;

  const rows = patches.filter((p) => p.observation).map((p) => buildOwnershipTrace({
    id: p.id,
    observation: p.observation!,
    templates: p.templates,
    lastRendered: p.lastRendered,
    replacedBaseline: p.replacedBaseline ?? { findings: [], impression: [] },
    source: p.source,
    protected: Boolean(p.protected),
  })).filter((r) => r.slotKey);

  const copy = async () => {
    const text = formatOwnershipTraceClipboard(rows);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      data-testid="ownership-trace-panel"
      className="mt-2 rounded-md border border-slate-300 bg-slate-50/80 p-2 text-[10px] text-slate-700"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wide">Ownership trace (diagnostic)</span>
        <Button type="button" size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => void copy()} data-testid="copy-ownership-trace">
          <Copy size={10} className="mr-1" /> {copied ? "Copied" : "Copy ownership trace"}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No active observations.</p>
      ) : (
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {rows.map((r) => (
            <pre key={r.id} className="whitespace-pre-wrap rounded bg-white p-1 font-mono leading-snug" data-testid="ownership-trace-row">
              {r.slotKey} · {r.source} · protected={String(r.protected)} · concept={r.concept ?? "∅"} ({r.conceptSource})
              {r.bundleId ? ` · bundle=${r.bundleId}` : ""}
              {r.legacyFallback ? " · legacy-fallback" : ""}
              {"\n"}replaced: {(r.replacedFindings[0] ?? "").slice(0, 80) || "—"}
            </pre>
          ))}
        </div>
      )}
    </div>
  );
}
