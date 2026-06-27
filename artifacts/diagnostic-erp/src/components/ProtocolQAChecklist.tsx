/**
 * ProtocolQAChecklist — Phase 3
 *
 * Renders the QA checklist for the active MRI study from the protocol spec
 * created in Phase 1 (mri_protocol_specs.quality_checklist).
 *
 * On mount: fetches the protocol whose protocolKey matches the current
 * templateId from /api/radiology/report-generator/protocols/:key
 *
 * On submit: POSTs results to /api/radiology/report-generator/protocols/quality-result
 *
 * Shows nothing for non-MRI modalities or when no protocol key is available.
 * All state is local — does not modify any existing report or findings text.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, XCircle, Minus, AlertTriangle,
  ClipboardCheck, ChevronDown, ChevronUp, Loader2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type QaResult = "pass" | "fail" | "na";

interface QaChecklistItem {
  id: string;
  label: string;
  description: string;
  failAction: "reject" | "warn" | "note";
}

interface MriProtocol {
  id: number;
  protocolKey: string;
  name: string;
  qualityChecklist: QaChecklistItem[];
}

interface Props {
  studyId: number;
  draftId?: number;
  protocolKey: string | undefined;   // e.g. "MRI_BRAIN_PLAIN" — from current template
  completedBy: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RESULT_CONFIG: Record<QaResult, { icon: React.ReactNode; label: string; bg: string; border: string }> = {
  pass: {
    icon: <CheckCircle2 size={13} className="text-emerald-400" />,
    label: "Pass",
    bg: "bg-emerald-950/40",
    border: "border-emerald-800/50",
  },
  fail: {
    icon: <XCircle size={13} className="text-red-400" />,
    label: "Fail",
    bg: "bg-red-950/40",
    border: "border-red-800/50",
  },
  na: {
    icon: <Minus size={13} className="text-slate-500" />,
    label: "N/A",
    bg: "bg-slate-900/60",
    border: "border-slate-700",
  },
};

function failActionBadge(action: QaChecklistItem["failAction"]) {
  if (action === "reject") return (
    <span className="text-[8px] font-bold text-red-400 bg-red-950/40 border border-red-900/40 px-1 py-0.5 rounded uppercase tracking-wider">Reject</span>
  );
  if (action === "warn") return (
    <span className="text-[8px] font-bold text-amber-400 bg-amber-950/30 border border-amber-900/30 px-1 py-0.5 rounded uppercase tracking-wider">Warn</span>
  );
  return (
    <span className="text-[8px] text-slate-500 bg-slate-900 border border-slate-800 px-1 py-0.5 rounded uppercase tracking-wider">Note</span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProtocolQAChecklist({ studyId, draftId, protocolKey, completedBy }: Props) {
  const [results, setResults] = useState<Record<string, QaResult>>({});
  const [expanded, setExpanded] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  // Fetch protocol spec from Phase 1 API
  const { data, isLoading, isError } = useQuery<{ success: boolean; protocol: MriProtocol }>({
    queryKey: ["protocol-qa", protocolKey],
    queryFn: () => api.get(`/api/radiology/report-generator/protocols/${protocolKey}`),
    enabled: Boolean(protocolKey),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const protocol = data?.protocol;
  const checklist: QaChecklistItem[] = protocol?.qualityChecklist ?? [];

  // Initialise all items to "na" when protocol loads
  useEffect(() => {
    if (checklist.length > 0) {
      setResults((prev) => {
        const next = { ...prev };
        checklist.forEach((item) => {
          if (!next[item.id]) next[item.id] = "na";
        });
        return next;
      });
      setSubmitted(false);
    }
  }, [protocol?.protocolKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post("/api/radiology/report-generator/protocols/quality-result", {
        studyId,
        draftId,
        protocolId: protocol!.id,
        results,
        overallGrade: overallGrade(),
      }),
    onSuccess: () => setSubmitted(true),
  });

  if (!protocolKey || isError) return null;
  if (isLoading) return (
    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 py-2">
      <Loader2 size={11} className="animate-spin" /> Loading QA checklist…
    </div>
  );
  if (checklist.length === 0) return null;

  function setResult(id: string, val: QaResult) {
    setResults((prev) => ({ ...prev, [id]: val }));
    setSubmitted(false);
  }

  function overallGrade(): "acceptable" | "suboptimal" | "non-diagnostic" {
    const rejectFails = checklist.filter(
      (item) => item.failAction === "reject" && results[item.id] === "fail"
    );
    if (rejectFails.length > 0) return "non-diagnostic";
    const warnFails = checklist.filter(
      (item) => item.failAction === "warn" && results[item.id] === "fail"
    );
    if (warnFails.length > 0) return "suboptimal";
    return "acceptable";
  }

  const grade = overallGrade();
  const allAnswered = checklist.every((item) => results[item.id] !== undefined);
  const failCount = checklist.filter((item) => results[item.id] === "fail").length;
  const passCount = checklist.filter((item) => results[item.id] === "pass").length;

  const gradeConfig = {
    acceptable: { label: "Acceptable", color: "text-emerald-400", bg: "bg-emerald-950/30 border-emerald-800/40" },
    suboptimal: { label: "Suboptimal", color: "text-amber-400", bg: "bg-amber-950/30 border-amber-900/40" },
    "non-diagnostic": { label: "Non-Diagnostic", color: "text-red-400", bg: "bg-red-950/30 border-red-900/40" },
  }[grade];

  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-950/60 hover:bg-slate-900/60 transition-colors"
      >
        <span className="flex items-center gap-2 text-[11px] font-bold text-sky-400 font-mono">
          <ClipboardCheck size={12} />
          Protocol QA Checklist
          <span className="text-[9px] text-slate-500 font-normal">{protocol?.name}</span>
        </span>
        <div className="flex items-center gap-2">
          {failCount > 0 && (
            <Badge className="text-[8px] bg-red-950/40 text-red-400 border-red-900/40">
              {failCount} fail{failCount > 1 ? "s" : ""}
            </Badge>
          )}
          {passCount > 0 && failCount === 0 && (
            <Badge className="text-[8px] bg-emerald-950/40 text-emerald-400 border-emerald-900/40">
              {passCount}/{checklist.length} pass
            </Badge>
          )}
          {expanded ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
        </div>
      </button>

      {expanded && (
        <div className="p-3 flex flex-col gap-2">
          {/* Checklist items */}
          {checklist.map((item) => {
            const current = results[item.id] ?? "na";
            return (
              <div key={item.id} className="flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-slate-200">{item.label}</span>
                      {failActionBadge(item.failAction)}
                    </div>
                    <p className="text-[9px] text-slate-500 leading-relaxed mt-0.5">{item.description}</p>
                  </div>
                  {/* Pass / Fail / N/A buttons */}
                  <div className="flex gap-1 shrink-0">
                    {(["pass", "fail", "na"] as QaResult[]).map((r) => {
                      const cfg = RESULT_CONFIG[r];
                      const active = current === r;
                      return (
                        <button
                          key={r}
                          onClick={() => setResult(item.id, r)}
                          className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                            active
                              ? `${cfg.bg} ${cfg.border} font-semibold`
                              : "bg-slate-900/40 border-slate-800 text-slate-500 hover:border-slate-600"
                          }`}
                        >
                          {cfg.icon}
                          <span>{cfg.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Fail warning for reject-level items */}
                {current === "fail" && item.failAction === "reject" && (
                  <div className="flex items-center gap-1 text-[9px] text-red-400 pl-1">
                    <AlertTriangle size={9} />
                    Study may be non-diagnostic — consider repeating sequence
                  </div>
                )}
              </div>
            );
          })}

          {/* Overall grade + submit */}
          <div className={`mt-1 flex items-center justify-between rounded p-2 border ${gradeConfig.bg}`}>
            <span className={`text-[10px] font-bold ${gradeConfig.color}`}>
              Overall: {gradeConfig.label}
            </span>
            {submitted ? (
              <span className="flex items-center gap-1 text-[9px] text-emerald-400">
                <CheckCircle2 size={10} /> Saved
              </span>
            ) : (
              <Button
                size="sm"
                className="h-5 text-[9px] px-2"
                disabled={!allAnswered || submitMutation.isPending}
                onClick={() => submitMutation.mutate()}
              >
                {submitMutation.isPending ? (
                  <Loader2 size={9} className="animate-spin mr-1" />
                ) : (
                  <ClipboardCheck size={9} className="mr-1" />
                )}
                Save QA
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
