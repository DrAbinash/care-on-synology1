// Phase 7A: AI Comparison Workspace
// Run the same prompt against multiple providers and compare results.

import { useState } from "react";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Terminal, Sparkles, Check, AlertTriangle, Copy, Trophy,
  Clock, Loader2,
} from "lucide-react";

const PROVIDERS = [
  { value: "gemini", label: "Google Gemini", color: "bg-blue-100 text-blue-700" },
  { value: "openai", label: "OpenAI / GPT", color: "bg-emerald-100 text-emerald-700" },
  { value: "anthropic", label: "Anthropic Claude", color: "bg-purple-100 text-purple-700" },
  { value: "ollama", label: "Ollama (Local)", color: "bg-amber-100 text-amber-700" },
];

interface ComparisonResult {
  provider: string;
  response: string;
  success: boolean;
  error: string | null;
  elapsedMs: number;
}

export default function AiComparisonWorkspace() {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<string[]>(["gemini", "openai"]);
  const [results, setResults] = useState<ComparisonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);

  const toggleProvider = (p: string) => {
    setSelectedProviders((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  };

  const runComparison = async () => {
    if (!prompt.trim()) { toast({ title: "Enter a prompt", variant: "destructive" }); return; }
    if (selectedProviders.length === 0) { toast({ title: "Select at least one provider", variant: "destructive" }); return; }

    setLoading(true);
    setResults([]);
    setWinner(null);
    try {
      const data = await api.post<{ results: ComparisonResult[] }>("/api/ai-comparison/run", {
        prompt,
        providers: selectedProviders,
      });
      setResults(data.results);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWinner = async (provider: string, response: string) => {
    try {
      await api.post("/api/ai-comparison/save-winner", { prompt, provider, response });
      setWinner(provider);
      toast({ title: `Winner saved: ${provider}` });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Comparison Workspace"
        subtitle="Run the same prompt against multiple AI providers and compare results side-by-side"
      />

      <div className="space-y-4">
        {/* Provider selection */}
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              onClick={() => toggleProvider(p.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                selectedProviders.includes(p.value)
                  ? `${p.color} border-current`
                  : "bg-muted text-muted-foreground border-muted"
              }`}
            >
              {selectedProviders.includes(p.value) && <Check className="h-3 w-3 inline mr-1" />}
              {p.label}
            </button>
          ))}
        </div>

        {/* Prompt input */}
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a prompt to test against multiple providers..."
          rows={6}
          className="text-sm"
        />

        <Button onClick={runComparison} disabled={loading} className="w-full">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Terminal className="h-4 w-4 mr-1" />}
          Run Comparison
        </Button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className="text-sm font-medium">Results</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {results.map((r) => {
              const meta = PROVIDERS.find((p) => p.value === r.provider);
              return (
                <div key={r.provider} className="border rounded-lg bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge className={meta?.color ?? "bg-muted"}>{meta?.label ?? r.provider}</Badge>
                      {r.success ? (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <Check className="h-3 w-3" /> Success
                        </span>
                      ) : (
                        <span className="text-xs text-red-600 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Failed
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" /> {r.elapsedMs}ms
                    </div>
                  </div>

                  {r.success ? (
                    <div className="text-[11px] whitespace-pre-wrap bg-muted/30 rounded p-3 max-h-[300px] overflow-y-auto">
                      {r.response}
                    </div>
                  ) : (
                    <div className="text-[11px] text-red-600 bg-red-50 rounded p-3">{r.error}</div>
                  )}

                  {r.success && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="text-xs" onClick={() => handleCopy(r.response)}>
                        <Copy className="h-3 w-3 mr-1" /> Copy
                      </Button>
                      <Button
                        variant={winner === r.provider ? "default" : "outline"}
                        size="sm"
                        className="text-xs"
                        onClick={() => handleSaveWinner(r.provider, r.response)}
                      >
                        <Trophy className="h-3 w-3 mr-1" />
                        {winner === r.provider ? "Winner" : "Select Winner"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="text-[11px] text-amber-600 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded p-2">
          <AlertTriangle className="h-3 w-3" />
          All AI outputs are drafts. Radiologist remains the final authority.
        </div>
      )}
    </div>
  );
}
