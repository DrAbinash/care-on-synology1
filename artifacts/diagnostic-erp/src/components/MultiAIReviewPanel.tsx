/**
 * Phase 10C: Multi-AI Image Review Panel
 * Send a case to multiple AI providers and compare findings side-by-side.
 * AI Draft – Requires Radiologist Review
 */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/fetchApi";
import {
  Bot, Sparkles, Copy, Check, CheckCircle, AlertTriangle, ChevronDown, ChevronUp, Trophy, Wifi, WifiOff, HelpCircle,
} from "lucide-react";
import AIConfidenceBadge, { parseConfidenceFromText } from "./AIConfidenceBadge";
import { isFeatureEnabled } from "@/lib/staffSession";

interface AIProviderResult {
  provider: string;
  model: string;
  findings: string;
  differentials: string[];
  missedFindings: string[];
  confidence: number;
  rawResponse?: string;
}

interface MultiAIResponse {
  results: AIProviderResult[];
  caseContext: { modality: string; bodyPart: string };
}

interface Props {
  modality?: string;
  bodyPart?: string;
  findingsText?: string;
  impressionText?: string;
  onUseResult?: (result: AIProviderResult) => void;
}

const PROVIDERS = [
  { id: "gemini", label: "Gemini", color: "bg-blue-100 text-blue-700" },
  { id: "claude", label: "Claude (Haiku)", color: "bg-orange-100 text-orange-700" },
  { id: "openrouter", label: "OpenRouter (GPT-4o-mini)", color: "bg-purple-100 text-purple-700" },
  { id: "ollama", label: "Ollama (Local)", color: "bg-green-100 text-green-700" },
];

function ConfidenceBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-medium w-8 text-right">{pct}%</span>
    </div>
  );
}

function ProviderCard({
  result, onUse, isWinner, onSelectWinner, confidenceVizEnabled,
}: {
  result: AIProviderResult;
  onUse: () => void;
  isWinner: boolean;
  onSelectWinner: () => void;
  confidenceVizEnabled: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(result.findings);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${isWinner ? "border-yellow-400 ring-1 ring-yellow-400" : "border-card-border"}`}>
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/30">
        <Bot size={14} className="text-primary" />
        <span className="font-semibold text-xs">{result.provider}</span>
        {isWinner && <Badge className="bg-yellow-100 text-yellow-700 text-[10px] flex items-center gap-0.5"><Trophy size={9} /> Winner</Badge>}
        <Badge variant="outline" className="text-[10px]">{result.model}</Badge>
        <div className="flex-1 mx-2">
          <ConfidenceBar pct={result.confidence} />
        </div>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={handleCopy}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </Button>
        <Button
          size="sm"
          variant={isWinner ? "default" : "outline"}
          className={`h-6 px-2 text-[11px] ${isWinner ? "bg-yellow-500 hover:bg-yellow-600" : ""}`}
          onClick={onSelectWinner}
        >
          <Trophy size={10} className="mr-1" />{isWinner ? "Winner" : "Select"}
        </Button>
        <Button size="sm" className="h-6 px-2 text-[11px]" onClick={onUse}>Use This</Button>
        <button onClick={() => setExpanded((v) => !v)} className="text-muted-foreground">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {expanded && (
        <div className="p-3 space-y-3 text-xs">
          <div className="bg-yellow-50 border border-yellow-200 rounded p-1.5 text-[10px] text-yellow-800 flex items-center gap-1">
            <Sparkles size={10} /> AI Draft — Requires Radiologist Review
          </div>

          <div>
            <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Findings</div>
            {confidenceVizEnabled ? (
              <AIConfidenceBadge metadata={{
                confidence: parseConfidenceFromText(result.findings),
                provider: result.provider,
                model: result.model,
              }}>
                <div className="bg-muted/30 rounded p-2 whitespace-pre-wrap leading-relaxed text-[11px]">{result.findings}</div>
              </AIConfidenceBadge>
            ) : (
              <div className="bg-muted/30 rounded p-2 whitespace-pre-wrap leading-relaxed text-[11px]">{result.findings}</div>
            )}
          </div>

          {result.differentials.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Differentials</div>
              <ul className="space-y-0.5">
                {result.differentials.map((d, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-muted-foreground mt-0.5">•</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.missedFindings.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-orange-600 uppercase mb-1 flex items-center gap-1">
                <AlertTriangle size={10} /> Possible Missed Findings
              </div>
              <ul className="space-y-0.5">
                {result.missedFindings.map((m, i) => (
                  <li key={i} className="text-orange-700 flex items-start gap-1.5">
                    <span className="mt-0.5">•</span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type OllamaStatus = "loading" | "not_configured" | "connected" | "disconnected";

interface OllamaStatusResponse {
  configured: boolean;
  urlValid: boolean;
  urlError: string | null;
  baseUrl: string | null;
  model: string | null;
}

function OllamaStatusBadge({ status }: { status: OllamaStatus }) {
  if (status === "loading") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground animate-pulse">
        <HelpCircle size={9} /> checking…
      </span>
    );
  }
  if (status === "not_configured") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        <HelpCircle size={9} /> not configured
      </span>
    );
  }
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
        <Wifi size={9} /> connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400">
      <WifiOff size={9} /> disconnected
    </span>
  );
}

export default function MultiAIReviewPanel({ modality, bodyPart, findingsText, impressionText, onUseResult }: Props) {
  const { toast } = useToast();
  const [selectedProviders, setSelectedProviders] = useState<string[]>(["gemini"]);
  const [caseContext, setCaseContext] = useState(findingsText ?? "");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<AIProviderResult[]>([]);
  const [winnerProvider, setWinnerProvider] = useState<string | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    api.get<OllamaStatusResponse>("/api/radiology-ollama/status")
      .then((data) => {
        if (cancelled) return;
        if (!data.configured) {
          setOllamaStatus("not_configured");
        } else if (data.urlValid) {
          setOllamaStatus("connected");
        } else {
          setOllamaStatus("disconnected");
        }
      })
      .catch(() => {
        if (!cancelled) setOllamaStatus("disconnected");
      });
    return () => { cancelled = true; };
  }, []);

  const toggleProvider = (id: string) => {
    setSelectedProviders((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleRun = async () => {
    if (!caseContext.trim()) { toast({ title: "Enter case context first", variant: "destructive" }); return; }
    if (selectedProviders.length === 0) { toast({ title: "Select at least one provider", variant: "destructive" }); return; }
    setRunning(true);
    setResults([]);

    try {
      // Fan out to all selected providers via the backend multi-review endpoint.
      // The backend computes deterministic confidence scores (not random) based on
      // response length, structure, and uncertainty language.
      const resp = await api.post<{
        results: Array<AIProviderResult & { processingMs?: number; error?: string }>;
        successfulProviders: number;
        totalProcessingMs: number;
        note: string;
      }>("/api/radiology-ollama/multi-review", {
        modality: modality ?? "",
        bodyPart: bodyPart ?? "",
        findingsText: findingsText ?? "",
        clinicalHistory: caseContext,
        providers: selectedProviders,
      });

      const providerResults: AIProviderResult[] = (resp.results ?? []).map((r) => ({
        provider: r.provider,
        model: r.model,
        findings: r.findings || (r.error ? `Error: ${r.error}` : "No response"),
        differentials: r.differentials ?? extractDifferentials(r.findings ?? ""),
        missedFindings: r.missedFindings ?? [],
        confidence: r.confidence ?? 0,
        rawResponse: r.findings,
      }));

      setResults(providerResults);
      const successful = providerResults.filter((r) => r.confidence > 0).length;
      if (successful > 0) {
        toast({
          title: `${successful} AI review${successful > 1 ? "s" : ""} complete`,
          description: "AI Draft — Requires Radiologist Review",
        });
      } else {
        toast({ title: "No providers responded", description: "Check that Gemini/Ollama are configured in Settings.", variant: "destructive" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Request failed";
      toast({ title: "Multi-AI review failed", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const handleSelectWinner = async (provider: string) => {
    setWinnerProvider(provider);
    try {
      await api.post("/api/radiology-ollama/multi-review/winner", {
        winnerProvider: provider,
        modality: modality ?? "",
        bodyPart: bodyPart ?? "",
        providers: selectedProviders,
      });
      toast({ title: `${provider} selected as best review`, description: "Winner logged for QA." });
    } catch {
      /* winner logging is best-effort; don't block the user */
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Bot size={16} className="text-primary" />
        <span className="font-semibold text-sm">Multi-AI Review</span>
        <Badge variant="outline" className="text-[10px]">Phase 10C</Badge>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-[11px] text-yellow-800 flex items-center gap-1">
        <Sparkles size={11} /> AI Draft — Requires Radiologist Review. Radiologist is the final authority.
      </div>

      {/* Provider selection */}
      <div className="space-y-1">
        <Label className="text-[10px] uppercase text-muted-foreground">Providers</Label>
        <div className="flex flex-wrap gap-2 items-center">
          {PROVIDERS.map((p) => (
            <div key={p.id} className="flex items-center gap-1">
              <button
                onClick={() => toggleProvider(p.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                  selectedProviders.includes(p.id) ? p.color + " border-transparent" : "bg-muted text-muted-foreground border-card-border"
                }`}
              >
                {selectedProviders.includes(p.id) && <CheckCircle size={11} />}
                {p.label}
              </button>
              {p.id === "ollama" && <OllamaStatusBadge status={ollamaStatus} />}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          OpenRouter requires <code>OPENROUTER_API_KEY</code>. Ollama requires local setup in Settings.
          When <strong>Local-only mode</strong> is ON, only Ollama is called regardless of selection.
        </p>
      </div>

      {/* Case context input */}
      <div>
        <Label className="text-[10px] uppercase text-muted-foreground">Case Context / Clinical History</Label>
        <Textarea
          value={caseContext}
          onChange={(e) => setCaseContext(e.target.value)}
          placeholder="Paste clinical history, prior impression, or key findings for AI review..."
          rows={4}
          className="text-xs mt-1"
        />
      </div>

      <Button onClick={handleRun} disabled={running || selectedProviders.length === 0} className="w-full" size="sm">
        <Bot size={14} className="mr-1.5" />
        {running ? "Running AI reviews..." : `Run Review (${selectedProviders.length} provider${selectedProviders.length > 1 ? "s" : ""})`}
      </Button>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase">{results.length} Result{results.length > 1 ? "s" : ""}</div>
          {results.map((r, i) => (
            <ProviderCard
              key={i}
              result={r}
              onUse={() => onUseResult?.(r)}
              isWinner={winnerProvider === r.provider}
              onSelectWinner={() => handleSelectWinner(r.provider)}
              confidenceVizEnabled={isFeatureEnabled("confidenceVisualization")}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function extractDifferentials(text: string): string[] {
  const lines = text.split("\n");
  const diffs: string[] = [];
  let inDiff = false;
  for (const line of lines) {
    const l = line.trim();
    if (/differential|diagnosis|impression/i.test(l)) { inDiff = true; continue; }
    if (inDiff && (l.startsWith("-") || l.startsWith("•") || /^\d+\./.test(l))) {
      const clean = l.replace(/^[-•\d.]\s*/, "").trim();
      if (clean) diffs.push(clean);
    }
    if (inDiff && diffs.length >= 5) break;
  }
  return diffs;
}
