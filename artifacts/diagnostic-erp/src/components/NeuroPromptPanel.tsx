/**
 * NeuroPromptPanel
 *
 * Phase 2 — AI Prompt Library integration for the Radiology Command Center.
 *
 * Shows neuro-specific prompt categories (MRI Brain, MRI Brain Stroke, etc.)
 * fetched from /api/ai-prompt-library. On selection, sends the chosen prompt
 * (impression / system / findings type) to /api/ai-reporting/query via the
 * existing cloud AI provider, then inserts the result into the impression field.
 *
 * Reuses: existing api client, existing /api/ai-prompt-library endpoints,
 *         existing /api/ai-reporting/query endpoint.
 * Does NOT duplicate: LocalAiPanel (Ollama), AiPromptManager (full CRUD editor).
 *
 * Safety: AI output always requires radiologist review — never auto-finalizes.
 */

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { queryAiReporting } from "@/lib/aiReportingClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, Loader2, AlertTriangle, CheckCircle2,
  ChevronRight, Sparkles, Brain, Zap, RefreshCw,
  FileText, Search, ArrowRight,
} from "lucide-react";
import FazekasGuide from "@/components/FazekasGuide";

// ── Types ────────────────────────────────────────────────────────────────────

interface PromptLibraryEntry {
  id: number;
  name: string;
  modality: string;
  libraryOwner: string;
  prompts: {
    system?: string;
    impression?: string;
    findings?: string;
    differential?: string;
    followup?: string;
    quality?: string;
    polish?: string;
    formatting?: string;
    image_review?: string;
  };
  version: number;
  isActive: boolean;
}

interface WorklistEntry {
  id: number;
  modality: string;
  bodyPart?: string | null;
  patientName: string;
  age?: string | null;
  sex?: string | null;
  studyDescription?: string | null;
  clinicalHistory?: string | null;
}

interface NeuroPromptPanelProps {
  study: WorklistEntry | null | undefined;
  currentFindings: string;
  onInsertImpression: (text: string) => void;
  onInsertFindings: (text: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PROMPT_TYPE_CONFIG = [
  {
    key: "impression" as const,
    label: "Impression",
    icon: FileText,
    color: "text-purple-400",
    bg: "bg-purple-950/30 border-purple-900/40 hover:bg-purple-950/50",
    insertTarget: "impression" as const,
    description: "Generate structured impression",
  },
  {
    key: "findings" as const,
    label: "Extract Findings",
    icon: Search,
    color: "text-blue-400",
    bg: "bg-blue-950/30 border-blue-900/40 hover:bg-blue-950/50",
    insertTarget: "findings" as const,
    description: "Structure findings from dictation",
  },
  {
    key: "differential" as const,
    label: "Differential Dx",
    icon: Brain,
    color: "text-cyan-400",
    bg: "bg-cyan-950/30 border-cyan-900/40 hover:bg-cyan-950/50",
    insertTarget: "impression" as const,
    description: "Generate differential diagnosis",
  },
  {
    key: "followup" as const,
    label: "Follow-Up Rec.",
    icon: ArrowRight,
    color: "text-green-400",
    bg: "bg-green-950/30 border-green-900/40 hover:bg-green-950/50",
    insertTarget: "impression" as const,
    description: "Recommend follow-up plan",
  },
  {
    key: "polish" as const,
    label: "Polish Language",
    icon: Sparkles,
    color: "text-amber-400",
    bg: "bg-amber-950/30 border-amber-900/40 hover:bg-amber-950/50",
    insertTarget: "findings" as const,
    description: "Improve report language",
  },
] as const;

type PromptTypeKey = typeof PROMPT_TYPE_CONFIG[number]["key"];

// ── Category icon mapping ────────────────────────────────────────────────────

function categoryIcon(name: string): React.ReactNode {
  if (name.toLowerCase().includes("stroke")) {
    return <Zap size={11} className="text-red-400 shrink-0" />;
  }
  if (name.toLowerCase().includes("tumour") || name.toLowerCase().includes("tumor")) {
    return <AlertTriangle size={11} className="text-orange-400 shrink-0" />;
  }
  if (name.toLowerCase().includes("white")) {
    return <Brain size={11} className="text-indigo-400 shrink-0" />;
  }
  if (name.toLowerCase().includes("spine")) {
    return <ChevronRight size={11} className="text-teal-400 shrink-0" />;
  }
  return <BookOpen size={11} className="text-purple-400 shrink-0" />;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NeuroPromptPanel({
  study,
  currentFindings,
  onInsertImpression,
  onInsertFindings,
}: NeuroPromptPanelProps) {
  const [selectedEntry, setSelectedEntry] = useState<PromptLibraryEntry | null>(null);
  const [activeType, setActiveType] = useState<PromptTypeKey>("impression");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch MRI prompt library entries for current owner
  const { data, isLoading, refetch } = useQuery<{ entries: PromptLibraryEntry[] }>({
    queryKey: ["neuro-prompt-library", "MRI"],
    queryFn: () => api.get("/api/ai-prompt-library?modality=MRI"),
    staleTime: 5 * 60 * 1000,
  });

  const entries = data?.entries ?? [];
  const availableType = PROMPT_TYPE_CONFIG.find((t) => t.key === activeType);

  const selectedPromptText = selectedEntry?.prompts?.[activeType] ?? null;

  const handleGenerate = useCallback(async () => {
    if (!selectedPromptText || !currentFindings.trim()) return;
    setGenerating(true);
    setResult(null);
    setError(null);

    // Build context-aware prompt: system role + selected prompt type + findings
    const systemRole = selectedEntry?.prompts?.system ?? "";
    const patientContext = [
      study?.modality ? `Modality: ${study.modality}` : "",
      study?.studyDescription ? `Study: ${study.studyDescription}` : "",
      study?.age ? `Age: ${study.age}` : "",
      study?.sex ? `Sex: ${study.sex}` : "",
    ].filter(Boolean).join(" | ");

    const fullPrompt = [
      systemRole ? `ROLE: ${systemRole}` : "",
      patientContext ? `PATIENT CONTEXT: ${patientContext}` : "",
      selectedPromptText,
      currentFindings,
    ].filter(Boolean).join("\n\n");

    try {
      const res = await queryAiReporting({
        promptText: fullPrompt,
        studyInstanceUID: (study as any)?.studyInstanceUID,
        accessionNumber: (study as any)?.accessionNumber,
        includeDemographics: false,
        provider: "gemini",
        maxImages: 0,
      });
      setResult(res.aiResponse ?? "");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "AI request failed";
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }, [selectedPromptText, currentFindings, selectedEntry, study]);

  const handleInsert = useCallback(() => {
    if (!result) return;
    const target = availableType?.insertTarget;
    if (target === "impression") {
      onInsertImpression(result);
    } else {
      onInsertFindings(result);
    }
    setResult(null);
    setError(null);
  }, [result, availableType, onInsertImpression, onInsertFindings]);

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 shrink-0">
        <span className="text-[11px] font-bold text-purple-400 font-mono flex items-center gap-1">
          <BookOpen size={12} />
          Neuro Prompt Library
        </span>
        <button
          onClick={() => refetch()}
          className="text-slate-500 hover:text-slate-300 transition-colors"
          title="Refresh prompts"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <Loader2 size={11} className="animate-spin" />
          Loading prompt library…
        </div>
      )}

      {/* Empty state */}
      {!isLoading && entries.length === 0 && (
        <div className="flex flex-col gap-1.5 bg-slate-900 border border-slate-700 rounded p-3 text-[10px] text-slate-400">
          <p className="font-semibold text-slate-300">No MRI prompts found</p>
          <p>Run the Phase 2 seed migration:</p>
          <code className="text-[9px] bg-slate-800 px-2 py-1 rounded font-mono text-slate-300">
            psql $DATABASE_URL -f migrations/seed_neuro_prompt_library.sql
          </code>
          <p className="text-[9px] text-slate-500 mt-1">Or manage prompts via Settings → AI Prompt Library</p>
        </div>
      )}

      {/* Category selector */}
      {!isLoading && entries.length > 0 && (
        <div className="shrink-0">
          <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">Study Category</p>
          <div className="flex flex-col gap-1">
            {entries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => {
                  setSelectedEntry(entry);
                  setResult(null);
                  setError(null);
                }}
                className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded border transition-colors text-left ${
                  selectedEntry?.id === entry.id
                    ? "bg-purple-950/50 border-purple-700/60 text-purple-300"
                    : "bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-600 hover:bg-slate-900"
                }`}
              >
                {categoryIcon(entry.name)}
                <span className="font-medium flex-1">{entry.name}</span>
                {selectedEntry?.id === entry.id && (
                  <CheckCircle2 size={10} className="text-purple-400 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fazekas guide — shown when White Matter category selected */}
      {selectedEntry && selectedEntry.name.toLowerCase().includes("white") && (
        <FazekasGuide
          onSelectGrade={(text) => {
            onInsertImpression(text);
          }}
        />
      )}

      {/* Prompt type selector */}
      {selectedEntry && (
        <div className="shrink-0">
          <p className="text-[9px] text-slate-500 uppercase tracking-wider mb-1.5 font-semibold">Action</p>
          <div className="grid grid-cols-2 gap-1">
            {PROMPT_TYPE_CONFIG.map((pt) => {
              const hasPrompt = Boolean(selectedEntry.prompts?.[pt.key]);
              return (
                <button
                  key={pt.key}
                  onClick={() => {
                    setActiveType(pt.key);
                    setResult(null);
                    setError(null);
                  }}
                  disabled={!hasPrompt}
                  className={`flex items-center gap-1.5 text-[9px] px-2 py-1 rounded border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                    activeType === pt.key && hasPrompt
                      ? `${pt.bg} ${pt.color} border-current font-semibold`
                      : "bg-slate-900/40 border-slate-800 text-slate-400 hover:border-slate-600"
                  }`}
                  title={pt.description}
                >
                  <pt.icon size={9} />
                  {pt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Prompt preview */}
      {selectedEntry && selectedPromptText && (
        <div className="shrink-0 bg-slate-900/60 border border-slate-800 rounded p-2">
          <p className="text-[8px] text-slate-500 uppercase tracking-wider mb-1">Prompt Preview</p>
          <p className="text-[9px] text-slate-400 line-clamp-3 leading-relaxed whitespace-pre-wrap">
            {selectedPromptText}
          </p>
        </div>
      )}

      {/* No findings warning */}
      {selectedEntry && !currentFindings.trim() && (
        <div className="flex items-start gap-1.5 bg-amber-950/20 border border-amber-900/30 rounded p-2 text-[9px] text-amber-400 shrink-0">
          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
          <span>Enter findings in the report workspace first, then generate.</span>
        </div>
      )}

      {/* Generate button */}
      {selectedEntry && selectedPromptText && (
        <Button
          size="sm"
          className="h-7 text-[10px] bg-purple-700 hover:bg-purple-600 text-white shrink-0"
          disabled={generating || !currentFindings.trim()}
          onClick={handleGenerate}
        >
          {generating ? (
            <>
              <Loader2 size={11} className="mr-1.5 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles size={11} className="mr-1.5" />
              Generate {PROMPT_TYPE_CONFIG.find((t) => t.key === activeType)?.label}
            </>
          )}
        </Button>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-950/30 border border-red-900/40 rounded p-2 text-[9px] text-red-400 shrink-0">
          <AlertTriangle size={10} className="inline mr-1" />
          {error}
        </div>
      )}

      {/* Result */}
      {result && !error && (
        <div className="flex flex-col gap-1.5 bg-slate-900/60 border border-slate-700 rounded p-2 flex-1 min-h-0">
          <div className="flex items-center justify-between">
            <p className="text-[8px] text-slate-500 uppercase tracking-wider">AI Output — Verify before inserting</p>
            <Badge className="text-[7px] bg-amber-900/30 text-amber-400 border-amber-900/40">
              Requires review
            </Badge>
          </div>
          <div className="flex-1 overflow-y-auto">
            <p className="text-[9px] text-slate-200 leading-relaxed whitespace-pre-wrap">{result}</p>
          </div>
          <Button
            size="sm"
            className="h-6 text-[9px] shrink-0"
            variant="outline"
            onClick={handleInsert}
          >
            <CheckCircle2 size={9} className="mr-1 text-green-400" />
            Insert into {availableType?.insertTarget === "impression" ? "Impression" : "Findings"} Draft
          </Button>
        </div>
      )}

      {/* Safety notice */}
      <div className="flex items-start gap-1.5 bg-amber-950/20 border border-amber-900/30 rounded p-2 text-[8px] text-amber-400 shrink-0 mt-auto">
        <AlertTriangle size={9} className="shrink-0 mt-0.5" />
        <span>AI output <strong>must be verified and edited</strong> by radiologist. Never auto-finalized.</span>
      </div>
    </div>
  );
}
