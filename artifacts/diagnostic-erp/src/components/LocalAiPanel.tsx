/**
 * LocalAiPanel — Ollama Local AI Assistant for the Radiology Command Center
 *
 * Provides 5 AI action buttons that call the backend radiologyOllama router.
 * ALL outputs go into the report draft area only. AI never auto-finalizes.
 *
 * ⚠️ SAFETY RULE: AI Draft must be verified by radiologist before finalization.
 */
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Zap, BrainCircuit, WandSparkles, Pencil, SpellCheck,
  Repeat2, FileDown, AlertTriangle, Loader2, CheckCircle2,
  RefreshCw, Wifi, WifiOff, ChevronDown,
} from "lucide-react";

interface OllamaStatus {
  configured: boolean;
  enabled: boolean;
  primaryUrl: string | null;
  fallbackUrl: string | null;
  model: string | null;
  knownModels: string[];
  localOnly: boolean;
  primaryUrlValid: boolean;
  primaryUrlError: string | null;
}

interface WorklistEntry {
  id: number;
  modality: string;
  bodyPart?: string | null;
  patientName: string;
  age?: string | null;
  sex?: string | null;
  studyDescription?: string | null;
}

interface LocalAiPanelProps {
  study: WorklistEntry | null | undefined;
  currentFindings: string;
  onInsertFindings: (text: string) => void;
  onInsertImpression: (text: string) => void;
}

type ActionState = "idle" | "loading" | "done" | "error";

interface ActionResult {
  text: string;
  endpoint?: string;
  model?: string;
}

const ACTIONS = [
  {
    id: "generate-draft",
    endpoint: "/api/radiology-ollama/draft",
    label: "Generate AI Draft",
    icon: BrainCircuit,
    color: "text-orange-400",
    bg: "bg-orange-950/30 border-orange-900/40 hover:bg-orange-950/50",
    description: "Full report draft from study info",
    outputKey: "draft",
    insertTarget: "findings" as const,
  },
  {
    id: "improve",
    endpoint: "/api/radiology-ollama/improve",
    label: "Improve Report",
    icon: WandSparkles,
    color: "text-amber-400",
    bg: "bg-amber-950/30 border-amber-900/40 hover:bg-amber-950/50",
    description: "Better radiology language, same findings",
    outputKey: "improved",
    insertTarget: "findings" as const,
  },
  {
    id: "impression-from-findings",
    endpoint: "/api/radiology-ollama/impression-from-findings",
    label: "Findings → Impression",
    icon: Repeat2,
    color: "text-purple-400",
    bg: "bg-purple-950/30 border-purple-900/40 hover:bg-purple-950/50",
    description: "Convert findings to concise impression",
    outputKey: "impression",
    insertTarget: "impression" as const,
  },
  {
    id: "care-format",
    endpoint: "/api/radiology-ollama/format-care-style",
    label: "Care Format",
    icon: FileDown,
    color: "text-cyan-400",
    bg: "bg-cyan-950/30 border-cyan-900/40 hover:bg-cyan-950/50",
    description: "Technique / Findings / Impression format",
    outputKey: "formatted",
    insertTarget: "findings" as const,
  },
  {
    id: "grammar",
    endpoint: "/api/radiology-ollama/grammar",
    label: "Grammar Cleanup",
    icon: SpellCheck,
    color: "text-green-400",
    bg: "bg-green-950/30 border-green-900/40 hover:bg-green-950/50",
    description: "Fix grammar without changing meaning",
    outputKey: "corrected",
    insertTarget: "findings" as const,
  },
] as const;

export default function LocalAiPanel({ study, currentFindings, onInsertFindings, onInsertImpression }: LocalAiPanelProps) {
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [actionResults, setActionResults] = useState<Record<string, ActionResult>>({});
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<OllamaStatus>({
    queryKey: ["ollama-status"],
    queryFn: () => api.get<OllamaStatus>("/api/radiology-ollama/status"),
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const effectiveModel = selectedModel || status?.model || "";
  const isOnline = status?.configured && status?.enabled && status?.primaryUrlValid;
  const knownModels = status?.knownModels ?? [];

  const runAction = useCallback(async (action: typeof ACTIONS[number]) => {
    setActionStates((s) => ({ ...s, [action.id]: "loading" }));
    setActionResults((r) => ({ ...r, [action.id]: { text: "" } }));

    try {
      const body: Record<string, string> = {
        modality: study?.modality ?? "",
        bodyPart: study?.bodyPart ?? "",
        patientName: study?.patientName ?? "",
        age: study?.age ?? "",
        sex: study?.sex ?? "",
        findings: currentFindings,
        reportText: currentFindings,
      };
      if (effectiveModel) body.model = effectiveModel;

      const data = await api.post<Record<string, string>>(action.endpoint, body);
      const text = data[action.outputKey] ?? "";

      setActionResults((r) => ({
        ...r,
        [action.id]: { text, endpoint: data.endpointUsed, model: data.model },
      }));
      setActionStates((s) => ({ ...s, [action.id]: "done" }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Request failed";
      setActionResults((r) => ({ ...r, [action.id]: { text: `Error: ${msg}` } }));
      setActionStates((s) => ({ ...s, [action.id]: "error" }));
    }
  }, [study, currentFindings, effectiveModel]);

  const insertResult = useCallback((action: typeof ACTIONS[number]) => {
    const text = actionResults[action.id]?.text ?? "";
    if (!text) return;
    if (action.insertTarget === "impression") {
      onInsertImpression(text);
    } else {
      onInsertFindings(text);
    }
    setActionStates((s) => ({ ...s, [action.id]: "idle" }));
    setActionResults((r) => ({ ...r, [action.id]: { text: "" } }));
  }, [actionResults, onInsertFindings, onInsertImpression]);

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <span className="text-[11px] font-bold text-orange-400 font-mono flex items-center gap-1">
          <Zap size={12} />
          Local AI Assistant
        </span>
        <button onClick={() => refetchStatus()} className="text-slate-500 hover:text-slate-300 transition-colors">
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Status indicator */}
      {statusLoading ? (
        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          <Loader2 size={11} className="animate-spin" /> Checking Ollama…
        </div>
      ) : !status?.configured ? (
        <div className="flex items-start gap-2 bg-slate-900 border border-slate-700 rounded p-2 text-[10px] text-slate-400">
          <WifiOff size={14} className="text-slate-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-slate-300">Ollama not configured</p>
            <p>Go to <span className="text-orange-400">Settings → AI → Local AI</span> to set the primary URL: <code className="text-[9px] bg-slate-800 px-1 rounded">http://172.16.1.140:11434</code> · model <code className="text-[9px] bg-slate-800 px-1 rounded">qwen3-vl:8b</code></p>
          </div>
        </div>
      ) : !status?.enabled ? (
        <div className="flex items-center gap-2 bg-amber-950/30 border border-amber-900/40 rounded p-2 text-[10px] text-amber-400">
          <AlertTriangle size={12} /> Local AI is disabled. Enable in Settings → AI.
        </div>
      ) : !isOnline ? (
        <div className="flex items-start gap-2 bg-red-950/30 border border-red-900/40 rounded p-2 text-[10px] text-red-400">
          <WifiOff size={12} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Ollama unreachable</p>
            <p className="text-[9px] text-slate-400 mt-0.5">{status?.primaryUrlError ?? "Check that Ollama is running on the Windows PC."}</p>
            {status?.fallbackUrl && <p className="text-[9px] text-slate-500 mt-0.5">Fallback: {status.fallbackUrl}</p>}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-green-950/30 border border-green-900/40 rounded p-1.5 text-[10px] text-green-400">
          <Wifi size={11} />
          <span>Ollama online</span>
          <Badge className="text-[8px] bg-green-900/40 text-green-300 border-green-800/40 ml-auto px-1">{status?.primaryUrl?.replace("http://", "")}</Badge>
        </div>
      )}

      {/* Model selector */}
      {isOnline && knownModels.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowModelDropdown((s) => !s)}
            className="w-full flex items-center justify-between text-[10px] bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 hover:border-slate-500 transition-colors"
          >
            <span className="font-mono truncate">{effectiveModel || "Select model…"}</span>
            <ChevronDown size={10} className="shrink-0 ml-1" />
          </button>
          {showModelDropdown && (
            <div className="absolute top-full left-0 right-0 z-50 bg-slate-900 border border-slate-700 rounded mt-0.5 shadow-xl max-h-36 overflow-y-auto">
              {knownModels.map((m) => (
                <button
                  key={m}
                  className={`w-full text-left text-[10px] px-2 py-1.5 hover:bg-slate-800 transition-colors font-mono ${m === effectiveModel ? "text-orange-400 bg-slate-800" : "text-slate-300"}`}
                  onClick={() => { setSelectedModel(m); setShowModelDropdown(false); }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Safety warning */}
      <div className="flex items-start gap-1.5 bg-amber-950/30 border border-amber-900/40 rounded p-2 text-[9px] text-amber-300">
        <AlertTriangle size={11} className="shrink-0 mt-0.5 text-amber-400" />
        <span>AI draft <strong>must be verified by radiologist</strong> before finalization. Never auto-finalized.</span>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-1.5">
        {ACTIONS.map((action) => {
          const state = actionStates[action.id] ?? "idle";
          const result = actionResults[action.id];
          const Icon = action.icon;
          const hasResult = state === "done" && result?.text;

          return (
            <div key={action.id} className="flex flex-col gap-1">
              <button
                disabled={!isOnline || state === "loading"}
                onClick={() => runAction(action)}
                className={`w-full flex items-center gap-2 text-[10px] border rounded px-2 py-1.5 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed ${action.bg}`}
              >
                {state === "loading" ? (
                  <Loader2 size={12} className={`${action.color} animate-spin shrink-0`} />
                ) : state === "done" ? (
                  <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                ) : state === "error" ? (
                  <AlertTriangle size={12} className="text-red-400 shrink-0" />
                ) : (
                  <Icon size={12} className={`${action.color} shrink-0`} />
                )}
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold ${action.color}`}>{action.label}</div>
                  <div className="text-slate-500 text-[8px] truncate">{action.description}</div>
                </div>
              </button>

              {/* Result area */}
              {hasResult && (
                <div className="bg-slate-900/60 border border-slate-700 rounded p-2 text-[9px] text-slate-300">
                  <p className="line-clamp-4 leading-relaxed whitespace-pre-wrap">{result.text}</p>
                  {result.endpoint && (
                    <p className="text-[8px] text-slate-600 mt-1">via {result.endpoint?.replace("http://", "")} · {result.model}</p>
                  )}
                  <button
                    onClick={() => insertResult(action)}
                    className={`mt-1.5 flex items-center gap-1 text-[9px] font-semibold ${action.color} hover:opacity-80 transition-opacity`}
                  >
                    <Pencil size={9} />
                    Insert into {action.insertTarget === "impression" ? "impression" : "findings"} draft
                  </button>
                </div>
              )}

              {state === "error" && result?.text && (
                <p className="text-[9px] text-red-400 px-1">{result.text}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer links */}
      <div className="text-[9px] text-slate-600 mt-1 flex flex-col gap-0.5 border-t border-slate-800 pt-2">
        <p>Configure: <span className="text-slate-500">Settings → AI → Local AI Assistant</span></p>
        <p>Primary: <code className="font-mono">{status?.primaryUrl ?? "not set"}</code></p>
        {status?.fallbackUrl && <p>Fallback: <code className="font-mono">{status.fallbackUrl}</code></p>}
      </div>
    </div>
  );
}
