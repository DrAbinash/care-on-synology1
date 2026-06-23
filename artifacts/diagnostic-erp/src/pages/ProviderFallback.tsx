// Phase 7A: Provider Fallback
// Configurable fallback chain when primary AI provider fails.

import { useState } from "react";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, AlertTriangle, ArrowDown, Check, Loader2 } from "lucide-react";

const DEFAULT_CHAIN = ["gemini", "openai", "anthropic", "ollama"];
const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI / GPT",
  anthropic: "Anthropic Claude",
  ollama: "Ollama (Local)",
};

export default function ProviderFallback() {
  const { toast } = useToast();
  const [chain, setChain] = useState<string[]>([...DEFAULT_CHAIN]);
  const [saving, setSaving] = useState(false);

  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...chain];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    setChain(next);
  };

  const moveDown = (i: number) => {
    if (i === chain.length - 1) return;
    const next = [...chain];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    setChain(next);
  };

  const toggleProvider = (name: string) => {
    setChain((prev) => {
      if (prev.includes(name)) return prev.filter((p) => p !== name);
      return [...prev, name];
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.post("/api/ai-reporting/fallback-chain", { chain });
      toast({ title: "Fallback chain saved" });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provider Fallback"
        subtitle="Configure the fallback chain when primary AI provider fails. The system tries each provider in order until one succeeds."
      />

      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Fallback ensures AI services remain available even when the primary provider is down. All fallback events are logged in the audit trail.
        </span>
      </div>

      {/* Fallback chain */}
      <div className="bg-card border rounded-xl p-5 space-y-4">
        <div className="text-sm font-medium">Fallback Chain</div>
        <div className="space-y-2">
          {chain.map((provider, i) => (
            <div key={provider} className="flex items-center gap-3 border rounded-lg p-3 bg-background">
              <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                {i + 1}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">{PROVIDER_LABELS[provider] ?? provider}</div>
                <div className="text-[11px] text-muted-foreground">
                  {i === 0 ? "Primary provider" : `Fallback ${i}`}
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => moveUp(i)}>
                  <ArrowDown className="h-3 w-3 rotate-180" />
                </Button>
                <Button variant="ghost" size="sm" disabled={i === chain.length - 1} onClick={() => moveDown(i)}>
                  <ArrowDown className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Available providers */}
      <div className="bg-card border rounded-xl p-5 space-y-4">
        <div className="text-sm font-medium">Available Providers</div>
        <div className="space-y-2">
          {Object.entries(PROVIDER_LABELS).map(([name, label]) => (
            <label key={name} className="flex items-center justify-between px-3 py-2 rounded-lg border border-card-border bg-muted/20 cursor-pointer">
              <div className="text-sm font-medium">{label}</div>
              <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${chain.includes(name) ? "bg-primary" : "bg-muted-foreground/40"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${chain.includes(name) ? "translate-x-5" : "translate-x-1"}`} />
              </span>
              <input type="checkbox" className="sr-only" checked={chain.includes(name)} onChange={() => toggleProvider(name)} />
            </label>
          ))}
        </div>
      </div>

      <Button onClick={save} disabled={saving} className="w-full">
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
        Save Fallback Chain
      </Button>

      <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded p-2 flex items-center gap-2">
        <AlertTriangle className="h-3 w-3" />
        Fallback events are logged in the AI audit trail for medico-legal compliance.
      </div>
    </div>
  );
}
