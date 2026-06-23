import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "@/lib/fetchApi";
import PageHeader from "@/components/PageHeader";
import ReportPrintSettingsDialog from "@/components/ReportPrintSettingsDialog";
import {
  generateReportPDF, loadPrintSettings, savePrintSettings, type PrintSettings,
} from "@/lib/reportPdfGenerator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, ExternalLink, Sparkles, Save, CheckCircle2, AlertTriangle,
  User, FileText, RefreshCw, ChevronDown, ChevronUp, Download, Settings2,
} from "lucide-react";
import { readStaffSession } from "@/lib/staffSession";

type WorklistEntry = {
  id: number;
  studyId: number | null;
  patientId: number | null;
  patientName: string;
  age: string | null;
  sex: string | null;
  modality: string;
  studyDescription: string | null;
  studyDate: string | null;
  accessionNumber: string;
  studyInstanceUID: string | null;
  aeTitle: string | null;
  ipAddress: string | null;
  port: number | null;
  referringDoctor: string | null;
  weasisUrl: string | null;
  status: string;
  assignedRadiologist: string | null;
  aiDraftStatus: string;
  aiDraftJson: string | null;
  reportId: number | null;
  deliveryStatus: string | null;
};

type AiDraft = {
  title: string;
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
  formattedReportHtml: string;
  formattedReportText: string;
  aiGenerated: boolean;
  templateUsed: string;
};

const TEMPLATE_NAMES = [
  "MRI Brain Plain",
  "MRI Brain With Contrast",
  "MRI LS Spine",
  "MRI Cervical Spine",
  "CT Brain",
  "X-Ray Chest",
  "USG Abdomen",
];

function DemographicsPanel({ entry }: { entry: WorklistEntry }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span><span className="font-medium text-muted-foreground">Patient:</span> <span className="font-semibold">{entry.patientName}</span></span>
        <span><span className="font-medium text-muted-foreground">Age/Sex:</span> {[entry.age, entry.sex].filter(Boolean).join(" / ") || "—"}</span>
        <span><span className="font-medium text-muted-foreground">Modality:</span> <Badge variant="outline" className="font-mono text-xs">{entry.modality}</Badge></span>
        <span><span className="font-medium text-muted-foreground">Study:</span> {entry.studyDescription || "—"}</span>
        <span><span className="font-medium text-muted-foreground">Accession:</span> <code className="text-xs">{entry.accessionNumber}</code></span>
        <span><span className="font-medium text-muted-foreground">Date:</span> {entry.studyDate || "—"}</span>
        {entry.referringDoctor && (
          <span><span className="font-medium text-muted-foreground">Ref. Doctor:</span> {entry.referringDoctor}</span>
        )}
        {entry.aeTitle && (
          <span><span className="font-medium text-muted-foreground">AE Title:</span> {entry.aeTitle}</span>
        )}
      </div>
    </div>
  );
}

export default function RadiologyReportEditor({ studyId }: { studyId: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = readStaffSession();

  // Form state
  const [reportTitle, setReportTitle] = useState("");
  const [rawFindings, setRawFindings] = useState("");
  const [clinicalHistory, setClinicalHistory] = useState("");
  const [reportBody, setReportBody] = useState("");
  const [impression, setImpression] = useState("");
  const [isCritical, setIsCritical] = useState(false);
  const [criticalNote, setCriticalNote] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [showRawFindings, setShowRawFindings] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);

  // Print / PDF
  const [printSettings, setPrintSettings] = useState<PrintSettings>(loadPrintSettings);
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false);
  const { data: clinicSettings } = useQuery<{ name?: string; tagline?: string; address?: string; phone?: string; email?: string; website?: string; logoDataUrl?: string | null }>({
    queryKey: ["clinic-settings"],
    queryFn: () => api.get("/api/clinic-settings/branding"),
    staleTime: 5 * 60_000,
  });

  // Load worklist entry
  const { data: entry, isLoading: entryLoading } = useQuery<WorklistEntry>({
    queryKey: ["worklist-entry", studyId],
    queryFn: () => api.get<WorklistEntry>(`/api/internal/radiology/worklist/${studyId}`),
    enabled: !!studyId,
  });

  // Pre-populate from AI draft stored on entry
  useEffect(() => {
    if (!entry) return;
    setReportTitle(entry.studyDescription ? `${entry.studyDescription} — Report` : "Radiology Report");
    if (entry.aiDraftJson) {
      try {
        const draft = JSON.parse(entry.aiDraftJson) as Partial<AiDraft>;
        if (draft.formattedReportText) setReportBody(draft.formattedReportText);
        if (draft.impression) setImpression(draft.impression);
        if (draft.title) setReportTitle(draft.title);
      } catch { /* ignore parse error */ }
    }
  }, [entry]);

  // Generate AI draft
  const aiDraftMutation = useMutation({
    mutationFn: () => api.post<AiDraft>("/api/internal/radiology/ai-draft", {
      studyId: entry?.id,
      modality: entry?.modality,
      studyDescription: entry?.studyDescription ?? entry?.modality,
      clinicalHistory: clinicalHistory.trim() || undefined,
      rawFindings: rawFindings.trim() || undefined,
      templateName: selectedTemplate || undefined,
      patientName: entry?.patientName,
      age: entry?.age,
      sex: entry?.sex,
      accessionNumber: entry?.accessionNumber,
      studyDate: entry?.studyDate,
    }),
    onSuccess: (draft) => {
      setReportBody(draft.formattedReportText);
      setImpression(draft.impression);
      setReportTitle(draft.title);
      toast({
        title: draft.aiGenerated ? "AI Draft Generated" : "Template Applied",
        description: draft.aiGenerated ? "Gemini AI generated the draft. Review before finalizing." : "Template populated. Edit as needed.",
      });
      void qc.invalidateQueries({ queryKey: ["worklist-entry", studyId] });
    },
    onError: (err) => {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Draft generation failed", variant: "destructive" });
    },
  });

  // Save final report — posts to patient-reports and then updates worklist status
  const saveFinalMutation = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("No entry loaded");

      // 1. Save to patient_reports
      const reportPayload = {
        patientId: entry.patientId,
        testId: null, // PACS-sourced studies may not have a testId
        studyId: entry.studyId ?? null,
        type: "radiology",
        title: reportTitle.trim() || "Radiology Report",
        body: reportBody,
        impression: impression,
        parameters: JSON.stringify({
          modality: entry.modality,
          studyDescription: entry.studyDescription,
          accessionNumber: entry.accessionNumber,
          studyInstanceUID: entry.studyInstanceUID,
          weasisUrl: entry.weasisUrl,
          aeTitle: entry.aeTitle,
          ipAddress: entry.ipAddress,
          port: entry.port,
        }),
        isCritical,
        criticalNote: isCritical ? criticalNote : null,
        createdBy: session?.user.name ?? "Radiologist",
      };

      // Only post to patient-reports if we have a patientId and can form a valid report
      let reportId: number | null = null;
      if (entry.patientId) {
        const report = await api.post<{ id: number }>("/api/patient-reports", reportPayload);
        reportId = report.id;
      }

      // 2. Update worklist status to REPORT_FINAL (and set deliveryStatus = READY_TO_SEND)
      await api.post("/api/internal/radiology/report-status", {
        accessionNumber: entry.accessionNumber,
        studyInstanceUID: entry.studyInstanceUID,
        status: "REPORT_FINAL",
        deliveryStatus: "READY_TO_SEND",
        reportId: reportId ?? undefined,
        actor: session?.user.name ?? "staff",
      });

      return { reportId };
    },
    onSuccess: ({ reportId }) => {
      toast({
        title: "Report Saved",
        description: reportId
          ? `Final report saved (ID: ${reportId}). Status: REPORT_FINAL.`
          : "Worklist updated to REPORT_FINAL.",
      });
      void qc.invalidateQueries({ queryKey: ["worklist-entry", studyId] });
      void qc.invalidateQueries({ queryKey: ["radiology-worklist"] });
    },
    onError: (err) => {
      toast({ title: "Save Failed", description: err instanceof Error ? err.message : "Could not save report", variant: "destructive" });
    },
  });

  function openWeasis() {
    if (!entry?.weasisUrl) {
      toast({ title: "Weasis URL not available", variant: "destructive" });
      return;
    }
    window.open(entry.weasisUrl, "_blank");
  }

  if (entryLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
        <AlertTriangle className="h-8 w-8" />
        <p>Worklist entry not found.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/radiology/worklist")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Worklist
        </Button>
      </div>
    );
  }

  const isFinal = entry.status === "REPORT_FINAL" || entry.status === "DELIVERED";

  return (
    <div className="flex flex-col gap-4 p-4 max-w-5xl mx-auto">
      <PageHeader
        title="Report Editor"
        subtitle={entry.accessionNumber}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/radiology/worklist")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={openWeasis}
              disabled={!entry.weasisUrl}
              title={entry.weasisUrl ? "Open in Weasis DICOM Viewer" : "No Weasis URL"}
            >
              <ExternalLink className="h-4 w-4 mr-1" /> Open in Weasis
            </Button>
            <Button size="sm" variant="outline" onClick={() => {
              if (!entry) return;
              generateReportPDF({
                patientName: entry.patientName,
                age: entry.age ?? undefined,
                sex: entry.sex ?? undefined,
                accessionNumber: entry.accessionNumber,
                studyDate: entry.studyDate ?? undefined,
                referringDoctor: entry.referringDoctor ?? undefined,
                modality: entry.modality,
                bodyPart: entry.studyDescription ?? undefined,
                clinicalHistory,
                findings: reportBody,
                impression,
                recommendation: criticalNote || undefined,
                reportTitle: reportTitle || "Radiology Report",
                printedBy: session?.user.name ?? undefined,
              }, printSettings, clinicSettings ?? null);
              toast({ title: "PDF downloaded" });
            }}>
              <Download className="h-4 w-4 mr-1" /> PDF
            </Button>
            <Button size="sm" variant="ghost" className="px-2" onClick={() => setPrintSettingsOpen(true)} title="Print settings">
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {/* Patient Demographics */}
      <DemographicsPanel entry={entry} />

      {/* Status banner if final */}
      {isFinal && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4" />
          This report is finalized ({entry.status}). Editing is disabled.
        </div>
      )}

      {/* Raw Findings Prompt */}
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <button
          className="flex items-center justify-between w-full text-sm font-semibold text-left"
          onClick={() => setShowRawFindings((v) => !v)}
        >
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            AI Draft Input (Findings Prompt)
          </span>
          {showRawFindings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {showRawFindings && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Clinical History</label>
              <Textarea
                placeholder="Clinical history, presenting complaint, relevant investigations..."
                value={clinicalHistory}
                onChange={(e) => setClinicalHistory(e.target.value)}
                disabled={isFinal}
                rows={2}
                className="text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Raw Findings / Dictation</label>
              <Textarea
                placeholder="Type or paste raw findings, voice dictation transcript, or key observations..."
                value={rawFindings}
                onChange={(e) => setRawFindings(e.target.value)}
                disabled={isFinal}
                rows={4}
                className="text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Template</label>
                <Select
                  value={selectedTemplate || "__auto__"}
                  onValueChange={(v) => setSelectedTemplate(v === "__auto__" ? "" : v)}
                  disabled={isFinal}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Auto-detect from modality" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__auto__">Auto-detect</SelectItem>
                    {TEMPLATE_NAMES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => aiDraftMutation.mutate()}
                disabled={aiDraftMutation.isPending || isFinal}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {aiDraftMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-1" />
                )}
                Generate AI Draft
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Report Editor */}
      <div className="rounded-lg border p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" /> Formatted Report
          </h2>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={previewMode ? "default" : "outline"}
              className="h-7 text-xs px-2"
              onClick={() => setPreviewMode(true)}
            >
              Preview
            </Button>
            <Button
              size="sm"
              variant={!previewMode ? "default" : "outline"}
              className="h-7 text-xs px-2"
              onClick={() => setPreviewMode(false)}
            >
              Edit
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Report Title</label>
          <Input
            value={reportTitle}
            onChange={(e) => setReportTitle(e.target.value)}
            disabled={isFinal}
            className="text-sm font-medium"
            placeholder="Report title..."
          />
        </div>

        {previewMode ? (
          <div
            className="min-h-[300px] rounded-md border bg-white p-4 text-sm prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: reportBody.replace(/\n/g, "<br/>") }}
          />
        ) : (
          <Textarea
            value={reportBody}
            onChange={(e) => setReportBody(e.target.value)}
            disabled={isFinal}
            rows={18}
            className="font-mono text-xs leading-relaxed resize-y"
            placeholder="Report body — type here or generate with AI Draft above..."
          />
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Impression</label>
          <Textarea
            value={impression}
            onChange={(e) => setImpression(e.target.value)}
            disabled={isFinal}
            rows={4}
            className="text-sm"
            placeholder="1–4 line impression summary..."
          />
        </div>
      </div>

      {/* Critical flag */}
      <div className="rounded-lg border p-4 flex flex-col gap-3">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isCritical}
            onChange={(e) => setIsCritical(e.target.checked)}
            disabled={isFinal}
            className="h-4 w-4 accent-red-600"
          />
          <span className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className={`h-4 w-4 ${isCritical ? "text-red-500" : "text-muted-foreground"}`} />
            Mark as Critical Finding
          </span>
        </label>
        {isCritical && (
          <Textarea
            value={criticalNote}
            onChange={(e) => setCriticalNote(e.target.value)}
            disabled={isFinal}
            rows={2}
            className="text-sm border-red-300 focus-visible:ring-red-400"
            placeholder="Describe the critical finding requiring urgent clinical attention..."
          />
        )}
      </div>

      {/* Signed by */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <User className="h-4 w-4" />
        Reporting: <span className="font-medium text-foreground">{session?.user.name ?? "Current User"}</span>
      </div>

      {/* Save Final Report */}
      {!isFinal && (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-semibold">Important: </span>
              Clicking "Save Final Report" will permanently record this as the final radiologist report
              and set the study status to REPORT_FINAL. This action cannot be automatically undone.
              Automated patient email delivery is NOT triggered — status will be set to READY_TO_SEND only.
            </div>
          </div>

          <Button
            onClick={() => {
              if (!reportBody.trim()) {
                toast({ title: "Report body is empty", description: "Please write or generate a report before saving.", variant: "destructive" });
                return;
              }
              if (!confirm("Save this as the FINAL radiologist report?")) return;
              saveFinalMutation.mutate();
            }}
            disabled={saveFinalMutation.isPending}
            className="self-end bg-green-600 hover:bg-green-700 text-white"
            size="lg"
          >
            {saveFinalMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Final Report
          </Button>
        </div>
      )}

      <ReportPrintSettingsDialog
        open={printSettingsOpen}
        onClose={() => setPrintSettingsOpen(false)}
        settings={printSettings}
        onChange={(s) => { setPrintSettings(s); savePrintSettings(s); }}
      />
    </div>
  );
}
