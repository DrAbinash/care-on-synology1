/**
 * AI Orchestration Pipeline Manager — Phase 12
 * Monitor AI jobs: OCR, impression, structured report, critical detection, etc.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import { MobileTableScroll } from "@/components/MobileTableScroll";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Cpu, BrainCircuit, Zap, AlertTriangle, CheckCircle2,
  Clock, RotateCcw, XCircle, UserCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const JOB_TYPE_LABELS: Record<string, string> = {
  ocr_extraction: "OCR",
  impression: "Impression",
  structured_report: "Structured Report",
  critical_detection: "Critical Detection",
  template_recommendation: "Template",
  auto_coding: "Auto Coding",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-slate-500",
  processing: "bg-cyan-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-rose-500",
  cancelled: "bg-slate-500",
};

const AI_TOGGLES = [
  { key: "ct_brain", label: "CT Brain AI" },
  { key: "cxr", label: "CXR AI" },
  { key: "spine_mri", label: "Spine MRI AI" },
  { key: "trauma", label: "Trauma AI" },
  { key: "usg_ocr", label: "USG OCR AI" },
];

export default function AiPipelineManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState("");
  const [modalityToggles, setModalityToggles] = useState<Record<string, boolean>>({
    ct_brain: true, cxr: true, spine_mri: true, trauma: true, usg_ocr: false,
  });

  const { data, refetch } = useQuery<any[]>({
    queryKey: ["ai-jobs", filterStatus],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      return api.get(`/api/radiology-workflow/ai-jobs?${params.toString()}`);
    },
    refetchInterval: 3000,
  });

  const overrideMut = useMutation({
    mutationFn: (id: number) => api.patch(`/api/radiology-workflow/ai-jobs/${id}/override`, {}),
    onSuccess: () => { toast({ title: "AI overridden by human" }); qc.invalidateQueries({ queryKey: ["ai-jobs"] }); },
  });

  const jobs = data ?? [];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-100">
      <div className="px-6 py-5">
        <div className="flex items-center justify-between mb-6">
          <PageHeader
            title="AI Pipeline Manager"
            subtitle="Orchestrate AI jobs: OCR, impression, critical detection, templates"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* AI Toggles */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 mb-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Modality AI Toggles</h3>
          <div className="flex gap-3 flex-wrap">
            {AI_TOGGLES.map((t) => (
              <button
                key={t.key}
                onClick={() => setModalityToggles((prev) => ({ ...prev, [t.key]: !prev[t.key] }))}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  modalityToggles[t.key]
                    ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                    : "bg-slate-800 border-slate-700 text-slate-400"
                }`}
              >
                {modalityToggles[t.key] ? "ON" : "OFF"} · {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-3 mb-4">
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200">
            <option value="">All Jobs</option>
            <option value="queued">Queued</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        {/* Job Table */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden min-w-0 max-w-full">
          <MobileTableScroll>
          <table className="w-full text-sm min-w-[56rem]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400 text-left">
                <th className="px-4 py-3">Study ID</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Modality</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Retries</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-4 py-3">Inference</th>
                <th className="px-4 py-3">GPU</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j: any) => (
                <tr key={j.id} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                  <td className="px-4 py-3 text-slate-300">{j.studyId}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="border-slate-700 text-slate-300">{JOB_TYPE_LABELS[j.jobType] || j.jobType}</Badge>
                  </td>
                  <td className="px-4 py-3"><Badge variant="outline" className="border-slate-700 text-slate-300">{j.modality}</Badge></td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white ${STATUS_COLORS[j.status] ?? "bg-slate-600"}`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{j.priority}</td>
                  <td className="px-4 py-3 text-slate-400">{j.retryCount}/{j.maxRetries}</td>
                  <td className="px-4 py-3 text-slate-300">{j.confidenceScore != null ? `${j.confidenceScore}%` : "—"}</td>
                  <td className="px-4 py-3 text-slate-400">{j.inferenceTimeMs != null ? `${j.inferenceTimeMs}ms` : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold ${j.gpuMode ? "text-cyan-400" : "text-slate-400"}`}>
                      {j.gpuMode ? "GPU" : "CPU"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {j.status === "completed" && !j.humanOverridden && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10" onClick={() => overrideMut.mutate(j.id)}>
                          <UserCheck className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-500">No AI jobs</td></tr>
              )}
            </tbody>
          </table>
          </MobileTableScroll>
        </div>
      </div>
    </div>
  );
}
